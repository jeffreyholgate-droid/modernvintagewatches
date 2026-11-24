import sharp from "sharp";
import { createHash } from "node:crypto";
import type { StudioSource } from "../../../lib/virtual-studio.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_DATA_BYTES = 3 * 1024 * 1024;
export const MAX_PIXELS = 24_000_000;
export const digest = (b: Buffer) =>
  createHash("sha256").update(b).digest("hex");
export const pngUrl = (b: Buffer) =>
  "data:image/png;base64," + b.toString("base64");
export function decodeImageData(
  value: unknown,
  limit = MAX_DATA_BYTES,
): Buffer {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil((limit * 4) / 3) + 80
  )
    throw new Error("IMAGE_TOO_LARGE");
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    value,
  );
  if (!m || m[2].length % 4 !== 0) throw new Error("INVALID_IMAGE");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > limit) throw new Error("IMAGE_TOO_LARGE");
  return bytes;
}
export function allowedImageURL(value: unknown): URL {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("INVALID_IMAGE_URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("INVALID_IMAGE_URL");
  }
  const hosts = new Set([
    "i.ebayimg.com",
    ...(process.env.STUDIO_IMAGE_HOSTS || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  ]);
  if (process.env.SUPABASE_URL) {
    try {
      hosts.add(new URL(process.env.SUPABASE_URL).hostname);
    } catch {}
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !hosts.has(url.hostname.toLowerCase())
  )
    throw new Error("IMAGE_HOST_NOT_ALLOWED");
  return url;
}
async function fetchImage(url: URL): Promise<Buffer> {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: { Accept: "image/png,image/jpeg,image/webp" },
  });
  if (!response.ok || !response.body) throw new Error("SOURCE_UNAVAILABLE");
  if (Number(response.headers.get("content-length") || 0) > MAX_IMAGE_BYTES)
    throw new Error("IMAGE_TOO_LARGE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
export async function loadSource(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_SOURCE");
  const source = value as StudioSource;
  if ("url" in source === "dataUrl" in source)
    throw new Error("INVALID_SOURCE");
  const original =
    "url" in source
      ? await fetchImage(allowedImageURL(source.url))
      : decodeImageData(source.dataUrl);
  const meta = await sharp(original, {
    limitInputPixels: MAX_PIXELS,
    failOn: "error",
  }).metadata();
  if (
    !["png", "jpeg", "webp"].includes(meta.format || "") ||
    (meta.pages && meta.pages > 1)
  )
    throw new Error("UNSUPPORTED_IMAGE");
  const normalized = await sharp(original, { limitInputPixels: MAX_PIXELS })
    .autoOrient()
    .toColourspace("srgb")
    .ensureAlpha()
    .png()
    .toBuffer();
  const { width, height } = await sharp(normalized).metadata();
  if (!width || !height || width < 100 || height < 100)
    throw new Error("IMAGE_TOO_SMALL");
  return { original, normalized, width, height, sha256: digest(original) };
}
export type LoadedSource = Awaited<ReturnType<typeof loadSource>>;
export async function normalizeMask(
  bytes: Buffer,
  width: number,
  height: number,
) {
  const meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
  if (meta.format !== "png" || (meta.pages && meta.pages > 1))
    throw new Error("INVALID_MASK");
  const mask = await sharp(bytes, { limitInputPixels: MAX_PIXELS })
    .removeAlpha()
    .greyscale()
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();
  const raw = await sharp(mask).raw().toBuffer();
  let covered = 0;
  for (const a of raw) if (a > 127) covered++;
  if (covered < raw.length * 0.002 || covered > raw.length * 0.985)
    throw new Error("MASK_NEEDS_REVIEW");
  return mask;
}
export async function cutoutFromMask(source: LoadedSource, mask: Buffer) {
  const rgb = await sharp(source.normalized).removeAlpha().raw().toBuffer();
  const originalAlpha = await sharp(source.normalized)
    .extractChannel(3)
    .raw()
    .toBuffer();
  const alpha = await sharp(mask).removeAlpha().greyscale().raw().toBuffer();
  const rgba = Buffer.alloc(source.width * source.height * 4);
  let minX = source.width,
    minY = source.height,
    maxX = -1,
    maxY = -1;
  for (let i = 0; i < alpha.length; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = Math.round((alpha[i] * originalAlpha[i]) / 255);
    if (rgba[i * 4 + 3] > 24) {
      const x = i % source.width,
        y = Math.floor(i / source.width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error("EMPTY_MASK");
  const box = {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
  const buffer = await sharp(rgba, {
    raw: { width: source.width, height: source.height, channels: 4 },
  })
    .extract(box)
    .png()
    .toBuffer();
  return { buffer, box };
}
