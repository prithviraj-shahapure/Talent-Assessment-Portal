/** Shared media state, so the stream acquired in the pre-exam checks is reused by the exam room. */
export const mediaStore: { stream: MediaStream | null; verificationPhoto: Blob | null; consent: { webcam: boolean; microphone: boolean; evidence: boolean } | null; justStarted: string | null } = {
  stream: null,
  justStarted: null,
  verificationPhoto: null,
  consent: null,
};

export async function acquireMedia(video: boolean, audio: boolean): Promise<MediaStream | null> {
  if (!video && !audio) return null;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not support camera/microphone access. Use the latest Chrome or Edge.");
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: video ? { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 }, facingMode: "user" } : false,
      audio: audio ? { echoCancellation: true, noiseSuppression: false, autoGainControl: false } : false,
    });
  } catch (e) {
    const err = e as DOMException;
    if (err.name === "NotAllowedError") throw new Error("Permission was denied. Click the camera icon in the address bar, allow access, and try again.");
    if (err.name === "NotFoundError") throw new Error(video ? "No camera or microphone was found. Connect one and try again." : "No microphone was found.");
    if (err.name === "NotReadableError") throw new Error("Your camera or microphone is being used by another application (e.g. Teams, Zoom). Close it and try again.");
    throw new Error(err.message || "Could not access camera/microphone");
  }
}

export function stopMedia(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

export function captureFrame(video: HTMLVideoElement, width: number, quality: number): Promise<Blob | null> {
  if (!video.videoWidth) return Promise.resolve(null);
  const h = Math.round((video.videoHeight / video.videoWidth) * width);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = h;
  c.getContext("2d")!.drawImage(video, 0, 0, width, h);
  return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", quality));
}

export function captureDataUrl(video: HTMLVideoElement, width: number, quality: number): string | null {
  if (!video.videoWidth) return null;
  const h = Math.round((video.videoHeight / video.videoWidth) * width);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = h;
  c.getContext("2d")!.drawImage(video, 0, 0, width, h);
  return c.toDataURL("image/jpeg", quality);
}

/** Audio level meter (RMS 0–1). Only levels are computed — no audio is recorded or transmitted. */
export class AudioMeter {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array | null = null;
  start(stream: MediaStream) {
    const track = stream.getAudioTracks()[0];
    if (!track) return false;
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(new MediaStream([track]));
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => undefined);
    return true;
  }
  level() {
    if (!this.analyser || !this.buf) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 4); // scaled for display
  }
  stop() {
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;
  }
}

export function browserInfo() {
  const ua = navigator.userAgent;
  const edge = /Edg\/(\d+)/.exec(ua);
  const chrome = /Chrome\/(\d+)/.exec(ua);
  const firefox = /Firefox\/(\d+)/.exec(ua);
  const safari = /Version\/(\d+).*Safari/.exec(ua);
  const name = edge ? "Microsoft Edge" : chrome ? "Google Chrome" : firefox ? "Mozilla Firefox" : safari ? "Safari" : "Unknown browser";
  const version = Number((edge ?? chrome ?? firefox ?? safari)?.[1] ?? 0);
  const supported = (edge && version >= 100) || (chrome && version >= 100) || (firefox && version >= 110);
  const mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
  return { name, version, supported: !!supported && !mobile, mobile, userAgent: ua };
}

/** Enter fullscreen without ever blocking: some browsers never settle the promise. */
export function enterFullscreen(timeoutMs = 1500): Promise<void> {
  const req = document.documentElement.requestFullscreen?.();
  if (!req) return Promise.resolve();
  return Promise.race([req.catch(() => undefined), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}
