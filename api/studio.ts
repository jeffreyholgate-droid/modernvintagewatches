import { timingSafeEqual } from "node:crypto";
import { verifyAdminToken } from "./_lib/auth.js";
import { json, methodNotAllowed } from "./_lib/respond.js";
import { parseRecipe, studioPresets } from "../lib/virtual-studio.js";
import {
  loadSource,
  decodeImageData,
  normalizeMask,
  pngUrl,
} from "./_lib/studio/images.js";
import { prepareWatch } from "./_lib/studio/ai.js";
import { compositeWatch } from "./_lib/studio/render.js";
import { photographWatch } from "./_lib/studio/photograph.js";
import { openAIConfigured, openAITextModel } from "../server/openai-client.js";
import { approveOakPhoto, checkPhotoStorage, inventoryStudioSource, serveOakPhoto, stageOakPhoto } from "./_lib/studio/gallery.js";

export const config = { maxDuration: 180 };
const MAX_BODY = 4_000_000;
async function authorize(req: any) {
  const raw = req.headers?.authorization;
  const token =
    typeof raw === "string" && raw.startsWith("Bearer ") ? raw.slice(7) : "";
  if (!token) return false;
  const service = process.env.MVW_STUDIO_SERVICE_KEY;
  if (service && service.length >= 32) {
    const a = Buffer.from(service),
      b = Buffer.from(token);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  try {
    await verifyAdminToken(token);
    return true;
  } catch {
    return false;
  }
}
async function body(req: any) {
  if (Number(req.headers?.["content-length"] || 0) > MAX_BODY)
    throw new Error("REQUEST_TOO_LARGE");
  let value = req.body;
  if (value === undefined) {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new Error("REQUEST_TOO_LARGE");
      chunks.push(Buffer.from(chunk));
    }
    value = Buffer.concat(chunks).toString();
  }
  if (typeof value === "string" || Buffer.isBuffer(value)) {
    if (Buffer.byteLength(value) > MAX_BODY)
      throw new Error("REQUEST_TOO_LARGE");
    try {
      return JSON.parse(value.toString());
    } catch {
      throw new Error("INVALID_JSON");
    }
  }
  if (Buffer.byteLength(JSON.stringify(value ?? {})) > MAX_BODY)
    throw new Error("REQUEST_TOO_LARGE");
  return value;
}
const safeErrors = new Set([
  "INVALID_SOURCE",
  "INVALID_IMAGE",
  "IMAGE_TOO_LARGE",
  "IMAGE_TOO_SMALL",
  "UNSUPPORTED_IMAGE",
  "INVALID_IMAGE_URL",
  "IMAGE_HOST_NOT_ALLOWED",
  "SOURCE_UNAVAILABLE",
  "INVALID_MASK",
  "INVALID_SEGMENTATION_GUIDANCE",
  "SEGMENTATION_FAILED",
  "MASK_NEEDS_REVIEW",
  "EMPTY_MASK",
  "AI_NOT_CONFIGURED",
  "AI_CREDITS_DEPLETED",
  "AI_ACCESS_DENIED",
  "AI_MODEL_UNAVAILABLE",
  "AI_RATE_LIMITED",
  "AI_TIMEOUT",
  "AI_SERVICE_UNAVAILABLE",
  "AI_RESPONSE_INVALID",
  "AI_RESPONSE_REFUSED",
  "AI_ANALYSIS_INVALID",
  "AI_MASK_NEEDS_REVIEW",
  "AI_MASK_INVALID",
  "AI_SCENE_INVALID",
  "AI_SCENE_ALIGNMENT",
  "SCENE_SOURCE_TOO_SMALL",
  "SOURCE_TOO_SMALL_FOR_HERO",
  "INVALID_PHOTOGRAPH_STYLE",
  "INVALID_PHOTOGRAPH_REFERENCE",
  "INVALID_PHOTOGRAPH_REQUEST",
  "PHOTOGRAPH_REQUIRES_OPAQUE_SOURCE",
  "PHOTOGRAPH_GEOMETRY_MISMATCH",
  "PHOTOGRAPH_PRESERVATION_FAILED",
  "INVALID_RECIPE",
  "UNSUPPORTED_RECIPE_VERSION",
  "INVALID_PRESET",
  "INVALID_FORMAT",
  "INVALID_SIZE",
  "WATCH_OUTSIDE_FRAME",
  "SOURCE_CHANGED",
  "REVIEW_REQUIRED",
  "REQUEST_TOO_LARGE",
  "INVALID_STUDIO_LISTING",
  "STUDIO_REVIEW_EXPIRED",
  "STUDIO_STORAGE_UNAVAILABLE",
  "LISTING_CHANGED",
  "INVALID_JSON",
  "EXPORT_TOO_LARGE",
]);
export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const admin = await authorize(req);
  if (req.method === 'GET' && req.query?.photo !== undefined) {
    return serveOakPhoto(req.query.item, req.query.photo, admin, res);
  }
  if (!admin) return json(res, 401, { error: "UNAUTHORIZED" });
  if (req.method === "GET")
    return json(res, 200, {
      ok: true,
      presets: studioPresets,
      aiConfigured: openAIConfigured(),
      aiProvider: "openai",
      textModel: process.env.OPENAI_STUDIO_ANALYSIS_MODEL || openAITextModel(),
      isolationMode: "source-coordinate-grabcut",
      productPixelsProtected: true,
      renderMode: "fixed-studio-plate",
      photographMode: "source-matched-scene",
      maxUploadBytes: 3 * 1024 * 1024,
      publication: "manual-review-only",
    });
  if (req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"]);
  try {
    const input = await body(req);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("INVALID_JSON");
    if (input.export === true && input.reviewed !== true)
      throw new Error("REVIEW_REQUIRED");
    const action =
      req.query?.action ||
      new URL(req.url || "/api/studio", "http://localhost").searchParams.get(
        "action",
      ) ||
      input.action;
    if (action === 'approve-photo') {
      if (input.reviewed !== true) throw new Error('REVIEW_REQUIRED');
      await approveOakPhoto(input.proof);
      return json(res, 200, { ok: true });
    }
    if (!["prepare", "render", "compose", "photograph"].includes(action))
      return json(res, 400, { error: "INVALID_ACTION" });
    const linked = action === 'photograph' && input.listing !== undefined
      ? await inventoryStudioSource(input.listing?.itemId, input.listing?.url)
      : null;
    if (linked && input.responseFormat !== 'png') throw new Error('INVALID_FORMAT');
    const source = await loadSource(linked?.source ?? input.source);
    if (input.sourceSha256 && input.sourceSha256 !== source.sha256)
      throw new Error("SOURCE_CHANGED");
    if (action === "prepare") {
      const prepared = await prepareWatch(source, input.maskDataUrl);
      if (Buffer.byteLength(JSON.stringify(prepared)) > 4_300_000)
        throw new Error("EXPORT_TOO_LARGE");
      return json(res, 200, prepared);
    }
    let prepared;
    if (action === "compose")
      prepared = await prepareWatch(source, input.maskDataUrl);
    const mask = prepared
      ? decodeImageData(prepared.maskDataUrl)
      : action === "photograph"
        ? decodeImageData(input.maskDataUrl)
        : await normalizeMask(
            decodeImageData(input.maskDataUrl),
            source.width,
            source.height,
          );
    if (action === "photograph" && !input.sourceSha256)
      throw new Error("SOURCE_CHANGED");
    if (linked) await checkPhotoStorage();
    const recipe = parseRecipe(input.recipe || prepared?.recipe || {});
    const result =
      action === "photograph"
        ? await photographWatch(source, mask, {
            stylePreset: "oak-study",
            referenceAssetPath: "public/studio/study-atmosphere-approved.jpg",
          })
        : await compositeWatch(source, mask, recipe);
    if (input.export === true && input.reviewed !== true)
      throw new Error("REVIEW_REQUIRED");
    if (
      input.responseFormat === "png" &&
      ["render", "photograph"].includes(action)
    ) {
      if (result.png.length > 4_300_000) throw new Error("EXPORT_TOO_LARGE");
      if (linked && 'protectedRgbVerified' in result.manifest && result.manifest.protectedRgbVerified) {
        res.setHeader('X-Studio-Photo-Proof', await stageOakPhoto(linked.item.id, linked.url, result.png, result.manifest));
      }
      res.setHeader("Content-Type", "image/png");
      res.setHeader(
        "X-Studio-Manifest",
        encodeURIComponent(JSON.stringify(result.manifest)),
      );
      res.statusCode = 200;
      return res.end(result.png);
    }
    if (result.png.length > 2_950_000) throw new Error("EXPORT_TOO_LARGE");
    const payload = {
      imageDataUrl: pngUrl(result.png),
      manifest: result.manifest,
      ...(prepared
        ? { analysis: prepared.analysis, maskDataUrl: prepared.maskDataUrl }
        : {}),
    };
    if (Buffer.byteLength(JSON.stringify(payload)) > 4_300_000)
      throw new Error("EXPORT_TOO_LARGE");
    return json(res, 200, payload);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    const code =
      safeErrors.has(msg) || msg.startsWith("INVALID_CONTROL_")
        ? msg
        : "STUDIO_PROCESSING_FAILED";
    return json(
      res,
      [
        "AI_NOT_CONFIGURED",
        "AI_CREDITS_DEPLETED",
        "AI_ACCESS_DENIED",
        "AI_MODEL_UNAVAILABLE",
        "AI_SERVICE_UNAVAILABLE",
        "STUDIO_STORAGE_UNAVAILABLE",
      ].includes(code)
        ? 503
        : code === "AI_RATE_LIMITED"
          ? 429
          : code === "AI_TIMEOUT"
            ? 504
            : code === "AI_RESPONSE_INVALID"
              ? 502
              : ['SOURCE_CHANGED', 'REVIEW_REQUIRED', 'LISTING_CHANGED', 'STUDIO_REVIEW_EXPIRED'].includes(code)
                ? 409
                : code === "REQUEST_TOO_LARGE" ||
                    code === "IMAGE_TOO_LARGE" ||
                    code === "EXPORT_TOO_LARGE"
                  ? 413
                  : code === "STUDIO_PROCESSING_FAILED"
                    ? 502
                    : 400,
      { error: code },
    );
  }
}
