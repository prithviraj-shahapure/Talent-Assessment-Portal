import type { FaceDetector, FaceLandmarker } from "@mediapipe/tasks-vision";

/**
 * Lightweight face analysis using MediaPipe Tasks (runs entirely in the browser).
 * Primary: FaceLandmarker (face count + head pose from the facial transformation matrix).
 * Fallback: FaceDetector (face count + rough yaw from keypoints).
 * This detects the PRESENCE of faces only — it does not identify who the person is.
 */
export interface FaceResult {
  faceCount: number;
  yaw: number | null; // degrees, + = turned to candidate's left
  pitch: number | null; // degrees, + = looking down
}

const VERSION = "0.10.18";
const LOCAL_WASM = "/mediapipe/wasm";
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODELS = {
  landmarker: ["/mediapipe/models/face_landmarker.task", "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"],
  detector: ["/mediapipe/models/blaze_face_short_range.tflite", "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"],
};

async function firstReachable(urls: string[]) {
  for (const u of urls) {
    if (u.startsWith("http")) return u; // remote: let MediaPipe fetch it
    try {
      const r = await fetch(u, { method: "HEAD" });
      if (r.ok && !(r.headers.get("content-type") ?? "").includes("text/html")) return u;
    } catch {
      /* try next */
    }
  }
  return urls[urls.length - 1];
}

export class FaceAnalyzer {
  private landmarker: FaceLandmarker | null = null;
  private detector: FaceDetector | null = null;
  ready = false;
  mode: "landmarker" | "detector" | "none" = "none";
  error: string | null = null;

  async init() {
    try {
      const vision = await import("@mediapipe/tasks-vision");
      let fileset;
      try {
        const probe = await fetch(`${LOCAL_WASM}/vision_wasm_internal.js`, { method: "HEAD" });
        fileset = await vision.FilesetResolver.forVisionTasks(probe.ok ? LOCAL_WASM : CDN_WASM);
      } catch {
        fileset = await vision.FilesetResolver.forVisionTasks(CDN_WASM);
      }
      try {
        this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: await firstReachable(MODELS.landmarker), delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 3,
          outputFacialTransformationMatrixes: true,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
        });
        this.mode = "landmarker";
      } catch (e) {
        console.warn("[proctor] FaceLandmarker unavailable, falling back to FaceDetector", e);
        this.detector = await vision.FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: await firstReachable(MODELS.detector), delegate: "CPU" },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.5,
        });
        this.mode = "detector";
      }
      this.ready = true;
    } catch (e) {
      this.error = (e as Error).message || "Face detection could not be loaded";
      this.mode = "none";
      console.warn("[proctor] face detection unavailable", e);
    }
    return this.ready;
  }

  analyze(video: HTMLVideoElement, ts: number): FaceResult | null {
    if (!this.ready || video.readyState < 2 || video.videoWidth === 0) return null;
    try {
      if (this.landmarker) {
        const r = this.landmarker.detectForVideo(video, ts);
        const count = r.faceLandmarks?.length ?? 0;
        let yaw: number | null = null;
        let pitch: number | null = null;
        const m = r.facialTransformationMatrixes?.[0]?.data;
        if (m && m.length >= 16) {
          // column-major 4x4; rotation part R[row][col] = m[col*4 + row]
          const r20 = m[2], r21 = m[6], r22 = m[10];
          yaw = (Math.atan2(-r20, Math.sqrt(r21 * r21 + r22 * r22)) * 180) / Math.PI;
          pitch = (Math.atan2(r21, r22) * 180) / Math.PI;
        }
        return { faceCount: count, yaw, pitch };
      }
      if (this.detector) {
        const r = this.detector.detectForVideo(video, ts);
        const count = r.detections.length;
        let yaw: number | null = null;
        const kp = r.detections[0]?.keypoints;
        if (kp && kp.length >= 3) {
          const [re, le, nose] = kp;
          const eyeDist = Math.abs(le.x - re.x) || 1e-3;
          yaw = (((nose.x - (re.x + le.x) / 2) / eyeDist) * 90);
        }
        return { faceCount: count, yaw, pitch: null };
      }
    } catch (e) {
      console.warn("[proctor] analyze failed", e);
    }
    return null;
  }

  close() {
    this.landmarker?.close();
    this.detector?.close();
    this.landmarker = null;
    this.detector = null;
    this.ready = false;
  }
}
