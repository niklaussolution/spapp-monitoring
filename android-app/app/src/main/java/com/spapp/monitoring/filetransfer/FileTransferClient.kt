package com.spapp.monitoring.filetransfer

import com.spapp.monitoring.BuildConfig
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.io.File
import kotlin.coroutines.resume

/**
 * Streams one file to the backend's WebSocket relay, which forwards the
 * bytes live to whichever admin dashboard is waiting on the same commandId.
 * Nothing is buffered server-side — see backend/src/ws/fileRelay.js.
 */
class FileTransferClient(private val authToken: String) {

    private val wsBaseUrl: String by lazy {
        // BuildConfig.API_BASE_URL is "http://10.0.2.2:4000/" (debug) or an
        // https:// URL (release) — swap scheme for the WebSocket equivalent.
        BuildConfig.API_BASE_URL
            .replaceFirst("http://", "ws://")
            .replaceFirst("https://", "wss://")
            .trimEnd('/')
    }

    /** Returns true if the whole file streamed successfully. */
    suspend fun uploadFile(commandId: String, file: File, mimeType: String?): Boolean {
        val client = OkHttpClient.Builder().build()
        val url = "$wsBaseUrl/ws/file-transfer?role=device&token=$authToken&commandId=$commandId"
        val request = Request.Builder().url(url).build()

        return suspendCancellableCoroutine { continuation ->
            var resumed = false
            fun finish(success: Boolean) {
                if (!resumed) {
                    resumed = true
                    continuation.resume(success)
                }
            }

            val ws = client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    val header = JSONObject().apply {
                        put("filename", file.name)
                        put("sizeBytes", file.length())
                        put("mimeType", mimeType ?: "application/octet-stream")
                    }
                    webSocket.send(header.toString())

                    try {
                        file.inputStream().use { input ->
                            val buffer = ByteArray(32 * 1024)
                            var read: Int
                            while (input.read(buffer).also { read = it } != -1) {
                                webSocket.send(buffer.copyOf(read).toByteString())
                            }
                        }
                        webSocket.close(1000, "upload complete")
                        finish(true)
                    } catch (e: Exception) {
                        webSocket.close(1011, "upload failed")
                        finish(false)
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    finish(false)
                }
            })

            continuation.invokeOnCancellation { ws.cancel() }
        }
    }
}
