import multer from "multer";
import { badRequest } from "../lib/http";

const memory = multer.memoryStorage();

export const resumeUpload = multer({
  storage: memory,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(badRequest("Resume must be a PDF or Word document (max 5 MB)"));
  },
});

export const imageUpload = multer({
  storage: memory,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(badRequest("Image must be JPEG, PNG or WebP"));
  },
});

export const sheetUpload = multer({
  storage: memory,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(csv|xlsx)$/i.test(file.originalname);
    if (ok) cb(null, true);
    else cb(badRequest("Upload a .csv or .xlsx file"));
  },
});

/** Verifies file content by magic bytes — the client-declared MIME type is not trusted. */
export function sniff(buf: Buffer): "pdf" | "docx" | "doc" | "jpg" | "png" | "webp" | "xlsx" | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 4).toString() === "%PDF") return "pdf";
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return "docx"; // zip container (docx/xlsx)
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return "doc";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === "PNG") return "png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "webp";
  return null;
}
