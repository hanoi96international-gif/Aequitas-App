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
import java.security.MessageDigest
import kotlin.math.*

class FaceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "FaceModule"

    private var cameraDevice: CameraDevice? = null
    private var imageReader: ImageReader? = null
    private val handlerThread = HandlerThread("FaceThread").also { it.start() }
    private val handler = Handler(handlerThread.looper)

    @ReactMethod
    fun captureFace(promise: Promise) {
        try {
            if (ActivityCompat.checkSelfPermission(reactContext, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
                promise.reject("NO_PERMISSION", "Camera permission required")
                return
            }

            val manager = reactContext.getSystemService(CameraManager::class.java)

            var frontCameraId = manager.cameraIdList[0]
            for (id in manager.cameraIdList) {
                val chars = manager.getCameraCharacteristics(id)
                val facing = chars.get(CameraCharacteristics.LENS_FACING)
                if (facing == CameraCharacteristics.LENS_FACING_FRONT) {
                    frontCameraId = id
                    break
                }
            }

            imageReader = ImageReader.newInstance(320, 240, ImageFormat.YUV_420_888, 2)

            imageReader?.setOnImageAvailableListener({ reader ->
                val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener

                try {
                    val yBuffer = image.planes[0].buffer
                    val yBytes = ByteArray(yBuffer.remaining())
                    yBuffer.get(yBytes)

                    val faceHash = extractFaceFeatures(yBytes, 320, 240)

                    cameraDevice?.close()
                    cameraDevice = null
                    promise.resolve(faceHash)

                } finally {
                    image.close()
                }
            }, handler)

            manager.openCamera(frontCameraId, object : CameraDevice.StateCallback() {
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

    private fun extractFaceFeatures(yBytes: ByteArray, width: Int, height: Int): String {
        val faceRegionStart = height / 3
        val faceRegionEnd = (height * 2) / 3

        val blockRows = 8
        val blockCols = 8
        val blockHeight = (faceRegionEnd - faceRegionStart) / blockRows
        val blockWidth = width / blockCols

        val features = StringBuilder()

        for (row in 0 until blockRows) {
            for (col in 0 until blockCols) {
                val startY = faceRegionStart + row * blockHeight
                val startX = col * blockWidth
                var sum = 0.0
                var count = 0

                for (y in startY until minOf(startY + blockHeight, height)) {
                    for (x in startX until minOf(startX + blockWidth, width)) {
                        val idx = y * width + x
                        if (idx < yBytes.size) {
                            sum += (yBytes[idx].toInt() and 0xFF).toDouble()
                            count++
                        }
                    }
                }

                val avg = if (count > 0) sum / count else 0.0
                val quantized = ((avg / 255.0) * 16).toInt().coerceIn(0, 15)
                features.append(quantized.toString(16))
            }
        }

        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(features.toString().toByteArray())
        return hash.joinToString("") { "%02x".format(it) }
    }
}
