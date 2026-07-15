package expo.modules.mediapipehanddetector

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Wraps MediaPipe Tasks Vision's HandLandmarker (the Android SDK build of
 * the exact same official model/pipeline the server's matching-service
 * already uses via its Python bindings -- see hand_landmarker.task in this
 * app's assets, copied from aequitas-biometric-beta/matching-service/models).
 *
 * Runs single-image detection (RunningMode.IMAGE), not a real-time frame
 * processor -- biometric-capture.tsx polls this periodically on individual
 * captured preview photos while showing the palm guide, which is simpler
 * and far lower-risk to get right than reimplementing MediaPipe's own
 * anchor-decoding/NMS math in JS (the only other route that would have
 * worked without an official Tasks Vision wrapper).
 */
class MediapipeHandDetectorModule : Module() {
  private var handLandmarker: HandLandmarker? = null

  private fun getOrCreateLandmarker(): HandLandmarker {
    handLandmarker?.let { return it }
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    val baseOptions = BaseOptions.builder()
      .setModelAssetPath("hand_landmarker.task")
      .build()
    val options = HandLandmarker.HandLandmarkerOptions.builder()
      .setBaseOptions(baseOptions)
      .setMinHandDetectionConfidence(0.5f)
      .setMinTrackingConfidence(0.5f)
      .setMinHandPresenceConfidence(0.5f)
      .setNumHands(1)
      .setRunningMode(RunningMode.IMAGE)
      .build()
    return HandLandmarker.createFromOptions(context, options).also { handLandmarker = it }
  }

  // Real-device report: hand detection never fired at all, on any capture.
  // capturePhotoToFile (like most Android camera APIs) saves the JPEG in
  // the sensor's native orientation plus an EXIF rotation tag -- it is NOT
  // already upright the way the live preview displays it. Decoding the
  // raw pixels without applying that tag handed MediaPipe a sideways or
  // upside-down image every time, which it couldn't recognize as a hand.
  private fun decodeUprightBitmap(path: String): Bitmap? {
    val bitmap = BitmapFactory.decodeFile(path) ?: return null
    val orientation = ExifInterface(path)
      .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    val rotationDegrees = when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> 90f
      ExifInterface.ORIENTATION_ROTATE_180 -> 180f
      ExifInterface.ORIENTATION_ROTATE_270 -> 270f
      else -> return bitmap
    }
    val matrix = Matrix().apply { postRotate(rotationDegrees) }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
  }

  override fun definition() = ModuleDefinition {
    Name("MediapipeHandDetector")

    AsyncFunction("detectHand") { imagePath: String ->
      val cleanPath = imagePath.removePrefix("file://")
      val bitmap = decodeUprightBitmap(cleanPath)
        ?: return@AsyncFunction null

      val mpImage = BitmapImageBuilder(bitmap).build()
      val result = getOrCreateLandmarker().detect(mpImage)
      val landmarks = result.landmarks()
      if (landmarks.isEmpty()) return@AsyncFunction null

      val points = landmarks[0]
      val xs = points.map { it.x() }
      val ys = points.map { it.y() }
      mapOf(
        "minX" to (xs.minOrNull() ?: 0f),
        "maxX" to (xs.maxOrNull() ?: 0f),
        "minY" to (ys.minOrNull() ?: 0f),
        "maxY" to (ys.maxOrNull() ?: 0f)
      )
    }
  }
}
