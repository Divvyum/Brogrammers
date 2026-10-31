import { createHash } from "node:crypto";
import { HttpError } from "./http.js";

// Signed uploads to Cloudinary (replaces Firebase Storage, plan section 1).
// The browser uploads straight to Cloudinary with these parameters; the API
// secret never leaves the server.

export const UPLOAD_LIMITS = {
  "reward-proofs": { maxBytes: 10 * 1024 * 1024, formats: "jpg,jpeg,png,pdf" },
  "complaint-evidence": { maxBytes: 10 * 1024 * 1024, formats: "jpg,jpeg,png,pdf" },
  photos: { maxBytes: 2 * 1024 * 1024, formats: "jpg,jpeg,png,webp" },
  submissions: { maxBytes: 10 * 1024 * 1024, formats: "pdf,ppt,pptx" },
} as const;
export type UploadFolder = keyof typeof UPLOAD_LIMITS;

/** Cloudinary's signature: SHA-1 of the sorted params plus the API secret. */
export function cloudinarySignature(params: Record<string, string | number>, secret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(toSign + secret).digest("hex");
}

export function signUpload(folder: UploadFolder, eventId: string) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !secret) throw new HttpError(503, "UPLOADS_UNAVAILABLE", "Cloudinary is not configured");

  const params = {
    folder: `hackos/${eventId}/${folder}`,
    timestamp: Math.floor(Date.now() / 1000),
    allowed_formats: UPLOAD_LIMITS[folder].formats,
  };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
    apiKey,
    ...params,
    signature: cloudinarySignature(params, secret),
    maxBytes: UPLOAD_LIMITS[folder].maxBytes,
  };
}

/** Only accept URLs that point at our own Cloudinary account. */
export function isOurCloudinaryUrl(url: string): boolean {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  return Boolean(cloudName) && url.startsWith(`https://res.cloudinary.com/${cloudName}/`);
}
