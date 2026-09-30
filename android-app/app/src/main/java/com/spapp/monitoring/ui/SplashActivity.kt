package com.spapp.monitoring.ui

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.spapp.monitoring.data.DeviceState

/**
 * Routes to the consent screen on first launch, or straight to the main
 * status screen once the device has already been activated.
 */
class SplashActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val state = DeviceState(this)
        val next = if (state.isActivated) {
            Intent(this, MainActivity::class.java)
        } else {
            Intent(this, ConsentActivity::class.java)
        }
        startActivity(next)
        finish()
    }
}
