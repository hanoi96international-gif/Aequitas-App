package com.aequitasbio

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.hardware.camera2.*
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import androidx.core.app.ActivityCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.security.MessageDigest

class FingerprintModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "FingerprintModule"

    private var cameraDevice: CameraDevice? = null
    private var imageReader: ImageReader? = null
    private val handlerThread = HandlerThread("CameraThread").also { it.start() }
    private val handler = Handler(handlerThread.looper)

    @ReactMethod
    fun captureFingerprint(promise: Promise) {
        try {
            val activity = currentActivity ?: run {
                promise.reject("NO_ACTIVITY", "No activity")
                return
            }

            if (ActivityCompat.checkSelfPermission(reactContext, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
                promise.reject("NO_PERMISSION", "Camera permission required")
                return
            }

            val manager = reactContext.getSystemService(CameraManager::class.java)
            // Rückkamera explizit auswählen
var cameraId = manager.cameraIdList[0]
for (id in manager.cameraIdList) {
    val chars = manager.getCameraCharacteristics(id)
    val facing = chars.get(CameraCharacteristics.LENS_FACING)
    if (facing == CameraCharacteristics.LENS_FACING_BACK) {
        cameraId = id
        break
    }
}

            imageReader = ImageReader.newInstance(640, 480, ImageFormat.YUV_420_888, 2)

            imageReader?.setOnImageAvailableListener({ reader ->
                val image = reader.acquireLatestImage()
                try {
                    val buffer = image.planes[0].buffer
                    val bytes = ByteArray(buffer.remaining())
                    buffer.get(bytes)

                    // Feature extraction — pixel intensity variance als Fingerprint-Hash
                    val hash = extractFingerprintFeatures(bytes)

                    cameraDevice?.close()
                    promise.resolve(hash)
                } finally {
                    image.close()
                }
            }, handler)

            manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    cameraDevice = camera
                    val surface = imageReader!!.surface
                    val captureRequest = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE)
                    captureRequest.addTarget(surface)

                    camera.createCaptureSession(listOf(surface),
                        object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(session: CameraCaptureSession) {
                                session.capture(captureRequest.build(), null, handler)
                            }
                            override fun onConfigureFailed(session: CameraCaptureSession) {
                                promise.reject("CONFIG_FAILED", "Camera config failed")
                            }
                        }, handler)
                }
                override fun onDisconnected(camera: CameraDevice) { camera.close() }
                override fun onError(camera: CameraDevice, error: Int) {
                    promise.reject("CAMERA_ERROR", "Camera error: $error")
                }
            }, handler)

        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    private fun extractFingerprintFeatures(pixels: ByteArray): String {
        // Vereinfachte Minutien-Extraktion
        // Teilt Bild in 8x8 Blöcke, berechnet Intensitäts-Varianz pro Block
        val blockSize = pixels.size / 64
        val features = StringBuilder()

        for (i in 0 until 64) {
            val block = pixels.slice(i * blockSize until minOf((i + 1) * blockSize, pixels.size))
            val mean = block.map { it.toInt() and 0xFF }.average()
            val variance = block.map { b ->
                val diff = (b.toInt() and 0xFF) - mean
                diff * diff
            }.average()
            features.append(variance.toInt().toString(16).padStart(4, '0'))
        }

        // SHA256 des Feature-Vektors
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(features.toString().toByteArray())
        return hash.joinToString("") { "%02x".format(it) }
    }
}