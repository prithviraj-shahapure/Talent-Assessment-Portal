import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { env } from "../config/env";

/**
 * Private file storage. Files are never served statically — only through
 * authorised API routes. Swap this implementation for S3/Azure Blob in production.
 */
export const storage = {
  async put(folder: "resumes" | "verification" | "evidence", buffer: Buffer, ext: string): Promise<string> {
    const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 5).toLowerCase();
    const key = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${safeExt}`;
    const full = resolveKey(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, buffer, { mode: 0o600 });
    return key;
  },
  stream(key: string) {
    return fs.createReadStream(resolveKey(key));
  },
  async exists(key: string) {
    try {
      await fsp.access(resolveKey(key));
      return true;
    } catch {
      return false;
    }
  },
  async remove(key: string) {
    await fsp.rm(resolveKey(key), { force: true });
  },
};

function resolveKey(key: string) {
  const full = path.resolve(env.storageDir, key);
  if (!full.startsWith(env.storageDir + path.sep)) throw new Error("Invalid storage key");
  return full;
}
