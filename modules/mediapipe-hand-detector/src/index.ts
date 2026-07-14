import { requireNativeModule } from 'expo-modules-core';

/**
 * Normalized (0..1) bounding box of the single most confident hand detected
 * in the image, derived from MediaPipe HandLandmarker's 21 landmark points
 * (min/max across all points) -- not a dedicated "palm" region, but close
 * enough for a positioning guide (see biometric-capture.tsx's PalmGuide).
 */
export interface HandBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface NativeMediapipeHandDetector {
  detectHand(imagePath: string): Promise<HandBounds | null>;
}

const native = requireNativeModule<NativeMediapipeHandDetector>('MediapipeHandDetector');

/**
 * Runs MediaPipe's HandLandmarker (same model family the server's
 * matching-service already uses in Python) on a single captured image file.
 * Returns null if no hand was detected.
 */
export async function detectHand(imagePath: string): Promise<HandBounds | null> {
  return native.detectHand(imagePath);
}
