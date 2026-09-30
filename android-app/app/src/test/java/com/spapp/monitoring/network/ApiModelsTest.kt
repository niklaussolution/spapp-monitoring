package com.spapp.monitoring.network

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Verifies the Retrofit/Gson request & response models serialize with the
 * exact field names the backend's POST /api/devices/activate expects
 * (backend/src/routes/device.routes.js) — camelCase request, snake_case
 * nested device object.
 */
class ApiModelsTest {

    private val gson = Gson()

    @Test
    fun `activate request serializes with camelCase keys backend expects`() {
        val request = ActivateRequest(
            deviceToken = "abc123",
            osVersion = "Android 14",
            appVersion = "1.0.0"
        )

        val json = gson.toJson(request)

        assertEquals(
            """{"deviceToken":"abc123","osVersion":"Android 14","appVersion":"1.0.0"}""",
            json
        )
    }

    @Test
    fun `activate response deserializes backend's snake_case device object`() {
        val json = """
            {
              "authToken": "jwt.token.here",
              "device": {
                "id": "187bde94-cbd8-4330-9ee4-2f268af9dee1",
                "tenant_id": "d83748a2-a02a-4d01-a033-d310dbdf5106",
                "device_label": "Kid Phone 1",
                "status": "active"
              }
            }
        """.trimIndent()

        val response = gson.fromJson(json, ActivateResponse::class.java)

        assertEquals("jwt.token.here", response.authToken)
        assertEquals("187bde94-cbd8-4330-9ee4-2f268af9dee1", response.device.id)
        assertEquals("active", response.device.status)
    }
}
