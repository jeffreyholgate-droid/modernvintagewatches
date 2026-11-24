import sharp from "sharp";
import cvModule from "@techstark/opencv-js";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { digest, type LoadedSource } from "./images.js";
import {
  editOpenAIEnvironment,
  openAIStudioSceneModel,
} from "../../../server/openai-image-client.js";

export type PhotographOptions = {
  stylePreset?: "oak-study";
  /** Server-selected asset only; public callers must not control this path. */
  referenceAssetPath?: string;
  /** Optional explicitly reviewed source support area. Never inferred from a silhouette. */
  contactMask?: Buffer;
};
export type PhotographManifest = {
  mode: "source-matched-scene";
  renderMode: "source-matched-scene";
  stylePreset: "oak-study";
  productGenerated: false;
  backgroundGenerated: true;
  sourceSha256: string;
  maskSha256: string;
  outputSha256: string;
  normalizedSourceSha256: string;
  protectedMaskSha256: string;
  protectedPixelCount: number;
  protectedRgbVerified: true;
  edgeBlend: true;
  sourceScale: number;
  width: number;
  height: number;
  model: string;
  reviewRequired: true;
  alignment: PhotographAlignment;
};
export type PhotographAlignment = {
  method: "exact-source-core" | "orb-similarity";
  accepted: boolean;
  featureMatches: number;
  inliers: number;
  inlierFraction: number;
  translationX: number;
  translationY: number;
  scale: number;
  rotationDegrees: number;
  residualP90: number;
  maximumDisplacement: number;
  environmentAligned: boolean;
};
export type PhotographCanvas = {
  image: Buffer;
  editMask: Buffer;
  sourceRGBA: Buffer;
  protectedPixels: Buffer;
  blendAlpha: Buffer;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
  left: number;
  top: number;
  sourceScale: number;
  protectedPixelCount: number;
  normalizedSourceSha256: string;
};

const round16 = (n: number) => Math.ceil(n / 16) * 16;
const canonicalPrompt = `Edit only the surroundings of the FIRST photograph to create an authentic luxury-watch photograph in a quiet antique study. The existing watch is the real product and is immutable: preserve its exact position, scale, perspective, silhouette, focus, lighting, reflections, dial, hands, lettering, wear and strap. Do not draw, redesign, retouch, sharpen or relight the watch. Do not add another watch or watch reflection. Keep the camera, crop and original pose exactly fixed. Continue the original supporting surface and physical contact beneath the watch naturally; preserve the sense of its existing weight and original contact shadow. The surroundings should be rich, gently worn antique oak or dark walnut, warm restrained brown tones, soft window daylight consistent with the watch's existing light, and a softly defocused collector's study with very subtle old books or framed art in the distance. Keep props away from the product and do not obscure any watch pixel. If a second image is provided, it is only a reference for the environment's materials and atmosphere; never copy a product, viewpoint or composition from it. No added text, logos, labels, watermark, pedestal, dramatic spotlight or exaggerated blur. The opaque mask protects the real watch and any explicitly preserved source contact patch; only transparent regions are editable. Match the surrounding light and color to the photographed watch, never the reverse.`;
const supportPrompt = ` Preserve any visible supporting table edge in the source at the same coordinates. Do not replace its geometry with a broad flat tabletop. The background style reference is only distant atmosphere; the source camera and contact geometry are authoritative.`;

type FeaturePair = {
  x: number;
  y: number;
  u: number;
  v: number;
  distance: number;
};
type Similarity = { a: number; b: number; tx: number; ty: number };
const residual = (p: FeaturePair, t: Similarity) =>
  Math.hypot(
    t.a * p.x - t.b * p.y + t.tx - p.u,
    t.b * p.x + t.a * p.y + t.ty - p.v,
  );
function fitSimilarity(pairs: FeaturePair[]): Similarity | null {
  const n = pairs.length;
  const means = pairs.reduce(
    (s, p) => ({
      x: s.x + p.x / n,
      y: s.y + p.y / n,
      u: s.u + p.u / n,
      v: s.v + p.v / n,
    }),
    { x: 0, y: 0, u: 0, v: 0 },
  );
  let denominator = 0,
    real = 0,
    imaginary = 0;
  for (const p of pairs) {
    const x = p.x - means.x,
      y = p.y - means.y,
      u = p.u - means.u,
      v = p.v - means.v;
    denominator += x * x + y * y;
    real += x * u + y * v;
    imaginary += x * v - y * u;
  }
  if (denominator < 100) return null;
  const a = real / denominator,
    b = imaginary / denominator;
  return {
    a,
    b,
    tx: means.u - a * means.x + b * means.y,
    ty: means.v - b * means.x - a * means.y,
  };
}
function robustSimilarity(pairs: FeaturePair[]) {
  let best: FeaturePair[] = [],
    state = 7093;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % pairs.length;
  };
  for (let trial = 0; trial < 400; trial++) {
    const first = pairs[random()],
      second = pairs[random()];
    if (Math.hypot(first.x - second.x, first.y - second.y) < 80) continue;
    const model = fitSimilarity([first, second]);
    if (
      !model ||
      Math.hypot(model.a, model.b) < 0.8 ||
      Math.hypot(model.a, model.b) > 1.2
    )
      continue;
    const inliers = pairs.filter((p) => residual(p, model) <= 3);
    if (inliers.length > best.length) best = inliers;
  }
  if (best.length < 18) return null;
  let model = fitSimilarity(best)!;
  for (let iteration = 0; iteration < 2; iteration++) {
    best = pairs.filter((p) => residual(p, model) <= 3);
    if (best.length < 18) return null;
    model = fitSimilarity(best)!;
  }
  return { model, inliers: best };
}

async function alignEnvironment(
  canvas: PhotographCanvas,
  pixels: Buffer,
  apply: boolean,
) {
  const empty: PhotographAlignment = {
    method: "orb-similarity",
    accepted: false,
    featureMatches: 0,
    inliers: 0,
    inlierFraction: 0,
    translationX: 0,
    translationY: 0,
    scale: 1,
    rotationDegrees: 0,
    residualP90: 0,
    maximumDisplacement: 0,
    environmentAligned: false,
  };
  let identical = true;
  for (let i = 0; i < canvas.protectedPixels.length && identical; i++)
    if (canvas.protectedPixels[i])
      for (let c = 0; c < 3; c++)
        if (pixels[i * 4 + c] !== canvas.sourceRGBA[i * 4 + c]) {
          identical = false;
          break;
        }
  if (identical)
    return {
      pixels,
      alignment: {
        ...empty,
        method: "exact-source-core" as const,
        accepted: true,
      },
    };
  const cv = await cvModule;
  const disposable: Array<{ delete(): void }> = [];
  const own = <T extends { delete(): void }>(item: T) => {
    disposable.push(item);
    return item;
  };
  try {
    const original = own(new cv.Mat(canvas.height, canvas.width, cv.CV_8UC4));
    original.data.set(canvas.sourceRGBA);
    const generated = own(new cv.Mat(canvas.height, canvas.width, cv.CV_8UC4));
    generated.data.set(pixels);
    const sourceGray = own(new cv.Mat()),
      targetGray = own(new cv.Mat());
    cv.cvtColor(original, sourceGray, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(generated, targetGray, cv.COLOR_RGBA2GRAY);
    const mask = own(new cv.Mat(canvas.height, canvas.width, cv.CV_8UC1));
    mask.data.set(canvas.protectedPixels);
    const sourceMask = own(new cv.Mat()),
      targetMask = own(new cv.Mat());
    const innerKernel = own(
      cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(25, 25)),
    );
    const searchKernel = own(
      cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(65, 65)),
    );
    cv.erode(mask, sourceMask, innerKernel);
    cv.dilate(mask, targetMask, searchKernel);
    const orb = own(new cv.ORB(1800));
    const sourceKeys = own(new cv.KeyPointVector()),
      targetKeys = own(new cv.KeyPointVector());
    const sourceDescriptors = own(new cv.Mat()),
      targetDescriptors = own(new cv.Mat());
    orb.detectAndCompute(sourceGray, sourceMask, sourceKeys, sourceDescriptors);
    orb.detectAndCompute(targetGray, targetMask, targetKeys, targetDescriptors);
    if (sourceDescriptors.rows < 18 || targetDescriptors.rows < 18)
      return { pixels, alignment: empty };
    const matcher = own(new cv.BFMatcher(cv.NORM_HAMMING, false));
    const matches = own(new cv.DMatchVectorVector());
    matcher.knnMatch(sourceDescriptors, targetDescriptors, matches, 2);
    const unique = new Map<number, FeaturePair>();
    for (let i = 0; i < matches.size(); i++) {
      const row = matches.get(i);
      try {
        if (row.size() < 2) continue;
        const best = row.get(0),
          next = row.get(1);
        if (best.distance > 64 || best.distance >= next.distance * 0.72)
          continue;
        const from = sourceKeys.get(best.queryIdx).pt,
          to = targetKeys.get(best.trainIdx).pt;
        const pair = {
          x: from.x,
          y: from.y,
          u: to.x,
          v: to.y,
          distance: best.distance,
        };
        if (
          !unique.has(best.trainIdx) ||
          unique.get(best.trainIdx)!.distance > pair.distance
        )
          unique.set(best.trainIdx, pair);
      } finally {
        row.delete();
      }
    }
    const pairs = [...unique.values()]
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 300);
    empty.featureMatches = pairs.length;
    if (pairs.length < 18) return { pixels, alignment: empty };
    const fit = robustSimilarity(pairs);
    if (!fit) return { pixels, alignment: empty };
    const { model, inliers } = fit;
    let left = canvas.width,
      top = canvas.height,
      right = 0,
      bottom = 0;
    for (let i = 0; i < canvas.protectedPixels.length; i++)
      if (canvas.protectedPixels[i]) {
        const x = i % canvas.width,
          y = Math.floor(i / canvas.width);
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    const cx = (left + right) / 2,
      cy = (top + bottom) / 2;
    const translationX = model.a * cx - model.b * cy + model.tx - cx;
    const translationY = model.b * cx + model.a * cy + model.ty - cy;
    const scale = Math.hypot(model.a, model.b),
      rotationDegrees = (Math.atan2(model.b, model.a) * 180) / Math.PI;
    const residuals = pairs
      .map((p) => residual(p, model))
      .sort((a, b) => a - b);
    const residualP90 = residuals[Math.floor((residuals.length - 1) * 0.9)];
    const maximumDisplacement = Math.max(
      ...[
        [left, top],
        [right, top],
        [left, bottom],
        [right, bottom],
      ].map(([x, y]) =>
        Math.hypot(
          model.a * x - model.b * y + model.tx - x,
          model.b * x + model.a * y + model.ty - y,
        ),
      ),
    );
    const spreadX =
      Math.max(...inliers.map((p) => p.x)) -
      Math.min(...inliers.map((p) => p.x));
    const spreadY =
      Math.max(...inliers.map((p) => p.y)) -
      Math.min(...inliers.map((p) => p.y));
    const accepted =
      inliers.length >= 18 &&
      inliers.length / pairs.length >= 0.8 &&
      residualP90 <= 3 &&
      spreadX >= (right - left) * 0.3 &&
      spreadY >= (bottom - top) * 0.3 &&
      scale >= 0.97 &&
      scale <= 1.03 &&
      Math.abs(rotationDegrees) <= 3 &&
      Math.hypot(translationX, translationY) <=
        Math.min(canvas.width, canvas.height) * 0.05 &&
      maximumDisplacement <= Math.min(canvas.width, canvas.height) * 0.06;
    const alignment: PhotographAlignment = {
      method: "orb-similarity",
      accepted,
      featureMatches: pairs.length,
      inliers: inliers.length,
      inlierFraction: inliers.length / pairs.length,
      translationX,
      translationY,
      scale,
      rotationDegrees,
      residualP90,
      maximumDisplacement,
      environmentAligned: false,
    };
    if (!accepted || !apply || maximumDisplacement < 0.2)
      return { pixels, alignment };
    const transform = own(
      cv.matFromArray(2, 3, cv.CV_64FC1, [
        model.a,
        -model.b,
        model.tx,
        model.b,
        model.a,
        model.ty,
      ]),
    );
    const aligned = own(new cv.Mat());
    // F maps source coordinates to generated coordinates. Inverse-map sampling
    // corrects only the generated environment; source pixels are never warped.
    cv.warpAffine(
      generated,
      aligned,
      transform,
      new cv.Size(canvas.width, canvas.height),
      cv.INTER_CUBIC | cv.WARP_INVERSE_MAP,
      cv.BORDER_REFLECT_101,
    );
    alignment.environmentAligned = true;
    return { pixels: Buffer.from(aligned.data), alignment };
  } catch {
    return { pixels, alignment: empty };
  } finally {
    for (let i = disposable.length - 1; i >= 0; i--) disposable[i].delete();
  }
}

async function generatedPixels(canvas: PhotographCanvas, generated: Buffer) {
  if (generated.length > 20 * 1024 * 1024)
    throw new Error("AI_RESPONSE_INVALID");
  const meta = await sharp(generated, {
    limitInputPixels: 1536 * 1536,
  }).metadata();
  if (meta.format !== "png" || (meta.pages && meta.pages > 1))
    throw new Error("AI_RESPONSE_INVALID");
  const isCanvas =
    meta.width === canvas.canvasWidth && meta.height === canvas.canvasHeight;
  if (
    !isCanvas &&
    (meta.width !== canvas.width || meta.height !== canvas.height)
  )
    throw new Error("PHOTOGRAPH_GEOMETRY_MISMATCH");
  let pipeline = sharp(generated).toColourspace("srgb").ensureAlpha();
  if (isCanvas)
    pipeline = pipeline.extract({
      left: canvas.left,
      top: canvas.top,
      width: canvas.width,
      height: canvas.height,
    });
  return pipeline.raw().toBuffer();
}

/** Offline, no-paid-call diagnostics for rejecting movement or non-rigid redraws. */
export async function measurePhotographAlignment(
  canvas: PhotographCanvas,
  generated: Buffer,
) {
  return (
    await alignEnvironment(
      canvas,
      await generatedPixels(canvas, generated),
      false,
    )
  ).alignment;
}

async function readMask(mask: Buffer, width: number, height: number) {
  if (!Buffer.isBuffer(mask) || mask.length > 8 * 1024 * 1024)
    throw new Error("INVALID_MASK");
  const meta = await sharp(mask, { limitInputPixels: 24_000_000 }).metadata();
  if (
    meta.format !== "png" ||
    meta.width !== width ||
    meta.height !== height ||
    (meta.pages && meta.pages > 1)
  )
    throw new Error("INVALID_MASK");
  return sharp(mask).removeAlpha().greyscale().raw().toBuffer();
}

/** Prepare source coordinates once; padding changes the canvas, never product resolution. */
export async function preparePhotographCanvas(
  source: LoadedSource,
  mask: Buffer,
  options: PhotographOptions = {},
): Promise<PhotographCanvas> {
  if (options.stylePreset !== undefined && options.stylePreset !== "oak-study")
    throw new Error("INVALID_PHOTOGRAPH_STYLE");
  if (
    !Number.isInteger(source.width) ||
    !Number.isInteger(source.height) ||
    source.width < 100 ||
    source.height < 100 ||
    source.width * source.height > 24_000_000
  )
    throw new Error("INVALID_IMAGE");
  const originalMask = await readMask(mask, source.width, source.height);
  let minX = source.width,
    minY = source.height,
    maxX = -1,
    maxY = -1,
    covered = 0;
  for (let i = 0; i < originalMask.length; i++)
    if (originalMask[i] > 127) {
      const x = i % source.width,
        y = Math.floor(i / source.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      covered++;
    }
  if (
    covered < originalMask.length * 0.002 ||
    covered > originalMask.length * 0.985
  )
    throw new Error("MASK_NEEDS_REVIEW");
  const sourceScale = Math.min(1, 1536 / Math.max(source.width, source.height));
  if (
    Math.max(maxX - minX + 1, maxY - minY + 1) * sourceScale < 600 ||
    Math.min(maxX - minX + 1, maxY - minY + 1) * sourceScale < 350
  )
    throw new Error("SOURCE_TOO_SMALL_FOR_HERO");
  const width = Math.round(source.width * sourceScale),
    height = Math.round(source.height * sourceScale);
  const resize = {
    width: source.width >= source.height ? width : undefined,
    height: source.height > source.width ? height : undefined,
    withoutEnlargement: true,
  };
  const working = await sharp(source.normalized)
    .resize(resize)
    .ensureAlpha()
    .png()
    .toBuffer();
  const sourceRGBA = await sharp(working).ensureAlpha().raw().toBuffer();
  const watch = await sharp(originalMask, {
    raw: { width: source.width, height: source.height, channels: 1 },
  })
    .resize({ ...resize, kernel: "cubic" })
    .greyscale()
    .raw()
    .toBuffer();
  const contact = options.contactMask
    ? await sharp(
        await readMask(options.contactMask, source.width, source.height),
        { raw: { width: source.width, height: source.height, channels: 1 } },
      )
        .resize({ ...resize, kernel: "cubic" })
        .greyscale()
        .raw()
        .toBuffer()
    : undefined;
  const protectedPixels = Buffer.alloc(width * height);
  const blendAlpha = Buffer.alloc(width * height);
  let protectedPixelCount = 0;
  for (let i = 0; i < protectedPixels.length; i++) {
    // Preserve the supplied matte at the boundary, including a graded explicit
    // contact patch. Promoting soft edge alpha to opaque would copy background
    // contamination into the new scene and create a hard source-colored halo.
    const alpha = Math.max(watch[i], contact?.[i] ?? 0);
    blendAlpha[i] = alpha >= 250 ? 255 : alpha;
    if (alpha > 0) {
      if (sourceRGBA[i * 4 + 3] !== 255)
        throw new Error("PHOTOGRAPH_REQUIRES_OPAQUE_SOURCE");
    }
    if (alpha >= 250) {
      protectedPixels[i] = 255;
      protectedPixelCount++;
    }
  }
  if (
    protectedPixelCount > protectedPixels.length * 0.985 ||
    protectedPixelCount < covered * sourceScale * sourceScale * 0.5
  )
    throw new Error("MASK_NEEDS_REVIEW");
  let canvasWidth = round16(Math.max(width, height / 3));
  let canvasHeight = round16(Math.max(height, width / 3));
  if (canvasWidth * canvasHeight < 655360) {
    const padScale = Math.sqrt(655360 / (canvasWidth * canvasHeight));
    canvasWidth = Math.min(1536, round16(canvasWidth * padScale));
    canvasHeight = Math.min(1536, round16(canvasHeight * padScale));
  }
  const left = Math.floor((canvasWidth - width) / 2),
    top = Math.floor((canvasHeight - height) / 2);
  const extension = {
    left,
    top,
    right: canvasWidth - width - left,
    bottom: canvasHeight - height - top,
  };
  const image = await sharp(working)
    .extend({ ...extension, extendWith: "copy" })
    .png()
    .toBuffer();
  const maskRGBA = Buffer.alloc(width * height * 4);
  for (let i = 0; i < protectedPixels.length; i++) {
    maskRGBA[i * 4] = maskRGBA[i * 4 + 1] = maskRGBA[i * 4 + 2] = 255;
    maskRGBA[i * 4 + 3] = blendAlpha[i];
  }
  const editMask = await sharp(maskRGBA, {
    raw: { width, height, channels: 4 },
  })
    .extend({ ...extension, background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  return {
    image,
    editMask,
    sourceRGBA,
    protectedPixels,
    blendAlpha,
    width,
    height,
    canvasWidth,
    canvasHeight,
    left,
    top,
    sourceScale,
    protectedPixelCount,
    normalizedSourceSha256: digest(working),
  };
}

async function restorePrepared(
  source: LoadedSource,
  mask: Buffer,
  generated: Buffer,
  canvas: PhotographCanvas,
  model: string,
) {
  const { pixels, alignment } = await alignEnvironment(
    canvas,
    await generatedPixels(canvas, generated),
    true,
  );
  if (!alignment.accepted)
    throw Object.assign(new Error("AI_SCENE_ALIGNMENT"), { alignment });
  for (let i = 0; i < canvas.protectedPixels.length; i++) {
    if (pixels[i * 4 + 3] !== 255) throw new Error("AI_RESPONSE_INVALID");
    const a = canvas.blendAlpha[i];
    for (let channel = 0; channel < 3; channel++) {
      const offset = i * 4 + channel;
      pixels[offset] =
        a === 255
          ? canvas.sourceRGBA[offset]
          : Math.round(
              (canvas.sourceRGBA[offset] * a + pixels[offset] * (255 - a)) /
                255,
            );
    }
    pixels[i * 4 + 3] = 255;
  }
  const png = await sharp(pixels, {
    raw: { width: canvas.width, height: canvas.height, channels: 4 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const verified = await sharp(png).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < canvas.protectedPixels.length; i++)
    if (canvas.protectedPixels[i]) {
      for (let c = 0; c < 4; c++)
        if (verified[i * 4 + c] !== canvas.sourceRGBA[i * 4 + c])
          throw new Error("PHOTOGRAPH_PRESERVATION_FAILED");
    }
  const manifest: PhotographManifest = {
    mode: "source-matched-scene",
    renderMode: "source-matched-scene",
    stylePreset: "oak-study",
    productGenerated: false,
    backgroundGenerated: true,
    sourceSha256: source.sha256,
    maskSha256: digest(mask),
    outputSha256: digest(png),
    normalizedSourceSha256: canvas.normalizedSourceSha256,
    protectedMaskSha256: digest(canvas.protectedPixels),
    protectedPixelCount: canvas.protectedPixelCount,
    protectedRgbVerified: true,
    edgeBlend: true,
    sourceScale: canvas.sourceScale,
    width: canvas.width,
    height: canvas.height,
    model,
    reviewRequired: true,
    alignment,
  };
  return { png, manifest };
}

/** Offline proof helper. Generated image must already match prepared canvas or source frame. */
export async function restorePhotographSource(
  source: LoadedSource,
  mask: Buffer,
  generated: Buffer,
  options: PhotographOptions = {},
) {
  const canvas = await preparePhotographCanvas(source, mask, options);
  return restorePrepared(
    source,
    mask,
    generated,
    canvas,
    "provided-environment",
  );
}

async function environmentReference(assetPath?: string) {
  if (!assetPath) return undefined;
  const root = path.resolve(process.cwd(), "public", "studio");
  const resolved = path.resolve(process.cwd(), assetPath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("INVALID_PHOTOGRAPH_REFERENCE");
  const info = await stat(resolved);
  if (!info.isFile() || info.size > 8 * 1024 * 1024)
    throw new Error("INVALID_PHOTOGRAPH_REFERENCE");
  return sharp(await readFile(resolved), { limitInputPixels: 24_000_000 })
    .resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}

/** Create a new surrounding environment; source restoration is mandatory afterward. */
export async function photographWatch(
  source: LoadedSource,
  mask: Buffer,
  options: PhotographOptions = {},
) {
  const canvas = await preparePhotographCanvas(source, mask, options);
  const reference = await environmentReference(options.referenceAssetPath);
  const result = await editOpenAIEnvironment({
    image: canvas.image,
    mask: canvas.editMask,
    reference,
    prompt: canonicalPrompt + supportPrompt,
    width: canvas.canvasWidth,
    height: canvas.canvasHeight,
  });
  const meta = await sharp(result.image, {
    limitInputPixels: 1536 * 1536,
  }).metadata();
  if (meta.width !== canvas.canvasWidth || meta.height !== canvas.canvasHeight)
    throw new Error("PHOTOGRAPH_GEOMETRY_MISMATCH");
  return restorePrepared(
    source,
    mask,
    result.image,
    canvas,
    result.model || openAIStudioSceneModel(),
  );
}
