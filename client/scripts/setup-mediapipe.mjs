// Copies the MediaPipe WASM runtime into public/ and downloads the face models once,
// so proctoring works on an intranet without depending on a CDN at exam time.
// Never fails the install: if the download is blocked, the app falls back to the CDN.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../public/mediapipe");

const MODELS = {
  "face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  "blaze_face_short_range.tflite": "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
};

async function main() {
  try {
    // walk up from client/ to find the (possibly hoisted) package
    let pkgDir = null;
    for (let dir = path.resolve(here, ".."); ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, "node_modules", "@mediapipe", "tasks-vision");
      if (fs.existsSync(path.join(candidate, "wasm"))) { pkgDir = candidate; break; }
      if (path.dirname(dir) === dir) break;
    }
    if (!pkgDir) throw new Error("@mediapipe/tasks-vision not installed");
    const wasmSrc = path.join(pkgDir, "wasm");
    const wasmDst = path.join(publicDir, "wasm");
    fs.mkdirSync(wasmDst, { recursive: true });
    for (const f of fs.readdirSync(wasmSrc)) fs.copyFileSync(path.join(wasmSrc, f), path.join(wasmDst, f));
    console.log("[mediapipe] WASM runtime copied to public/mediapipe/wasm");
  } catch (e) {
    console.warn("[mediapipe] could not copy WASM runtime:", e.message);
  }
  const modelDir = path.join(publicDir, "models");
  fs.mkdirSync(modelDir, { recursive: true });
  for (const [file, url] of Object.entries(MODELS)) {
    const dst = path.join(modelDir, file);
    if (fs.existsSync(dst) && fs.statSync(dst).size > 1000) continue;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
      console.log(`[mediapipe] downloaded ${file}`);
    } catch (e) {
      console.warn(`[mediapipe] could not download ${file} (${e.message}). The browser will load it from Google's CDN instead.`);
    }
  }
}
main();
