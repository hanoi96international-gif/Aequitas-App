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

class PPGModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "PPGModule"

    private var cameraDevice: CameraDevice? = null
    private var imageReader: ImageReader? = null
    private val handlerThread = HandlerThread("PPGThread").also { it.start() }
    private val handler = Handler(handlerThread.looper)

    private val greenChannel = mutableListOf<Double>()
    private val timestamps = mutableListOf<Long>()
    private val SAMPLE_COUNT = 150
    private val MEASURE_DURATION_MS = 8000L // 8 Sekunden

    @ReactMethod
    fun measurePPG(promise: Promise) {
        greenChannel.clear()
        timestamps.clear()
        val startTime = System.currentTimeMillis()

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
    if (facing == CameraCharacteristics.LENS_FACING_BACK) {
        frontCameraId = id
        break
    }
}

            imageReader = ImageReader.newInstance(320, 240, ImageFormat.YUV_420_888, 10)

            imageReader?.setOnImageAvailableListener({ reader ->
                val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
                val now = System.currentTimeMillis()

                try {
                    val elapsed = now - startTime

                    if (elapsed < MEASURE_DURATION_MS) {
                        val yBuffer = image.planes[0].buffer
                        val yBytes = ByteArray(yBuffer.remaining())
                        yBuffer.get(yBytes)

                        // Stirn-Region messen
                        val width = 320
                        val height = 80
                        var sum = 0.0
                        var count = 0

                        for (i in 0 until height * width) {
                            if (i < yBytes.size) {
                                sum += (yBytes[i].toInt() and 0xFF).toDouble()
                                count++
                            }
                        }

                        val avg = if (count > 0) sum / count else 0.0
                        greenChannel.add(avg)
                        timestamps.add(now)

                    } else {
                        // Messung abgeschlossen
                        cameraDevice?.close()
                        cameraDevice = null

                        if (greenChannel.size < 30) {
                            promise.reject("INSUFFICIENT", "Not enough data")
                            return@setOnImageAvailableListener
                        }

                        val ppgHash = extractPPGFeatures(greenChannel, timestamps)
                        promise.resolve(ppgHash)
                    }
                } finally {
                    image.close()
                }
            }, handler)

            manager.openCamera(frontCameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    cameraDevice = camera
                    val surface = imageReader!!.surface
                    val captureRequest = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW)
captureRequest.addTarget(surface)
captureRequest.set(CaptureRequest.FLASH_MODE, CameraMetadata.FLASH_MODE_TORCH)

                    camera.createCaptureSession(listOf(surface),
                        object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(session: CameraCaptureSession) {
                                session.setRepeatingRequest(captureRequest.build(), null, handler)
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

    private fun extractPPGFeatures(signal: List<Double>, times: List<Long>): String {
        // 1. Echte FPS berechnen
        val durationSeconds = (times.last() - times.first()) / 1000.0
        val actualFPS = signal.size / durationSeconds

        // 2. Moving Average glätten
        val smoothed = mutableListOf<Double>()
        val windowSize = 5
        for (i in windowSize until signal.size - windowSize) {
            val window = signal.subList(i - windowSize, i + windowSize)
            smoothed.add(window.average())
        }

        // 3. Normalisieren
        val mean = smoothed.average()
        val std = sqrt(smoothed.map { (it - mean).pow(2) }.average())
        val normalized = if (std > 0) smoothed.map { (it - mean) / std } else smoothed

        // 4. Peak Detection
        val threshold = 0.3
        val minDistanceFrames = (actualFPS * 0.4).toInt() // Min 400ms zwischen Peaks
        val peaks = mutableListOf<Int>()

        for (i in 1 until normalized.size - 1) {
            if (normalized[i] > threshold &&
                normalized[i] > normalized[i-1] &&
                normalized[i] > normalized[i+1]) {
                if (peaks.isEmpty() || i - peaks.last() >= minDistanceFrames) {
                    peaks.add(i)
                }
            }
        }

        // 5. Herzrate mit echter FPS berechnen
        val heartRate = if (peaks.size >= 2) {
            val intervals = peaks.zipWithNext { a, b -> b - a }
            val medianInterval = intervals.sorted()[intervals.size / 2]
            val bpm = 60.0 / (medianInterval / actualFPS)
            // Auf 5 BPM runden für Toleranz
            ((bpm / 5).toInt() * 5).coerceIn(40, 200)
        } else 72 // Default Herzrate

        // 6. Signal-Qualität
        val energy = normalized.map { it * it }.average()
        val energyBucket = ((energy * 10).toInt()).coerceIn(0, 20)

        // 7. Stabiler Feature-String
        val stableFeature = "hr_${heartRate}_e_${energyBucket}"

        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(stableFeature.toByteArray())
        return hash.joinToString("") { "%02x".format(it) }
    }
}