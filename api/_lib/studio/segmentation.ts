import sharp from "sharp";
import cvModule from "@techstark/opencv-js";
import type { LoadedSource } from "./images.js";

export type SegmentationPoint = { x: number; y: number };
export type SegmentationGuidance = {
  /** Normalized coordinates in the complete, auto-oriented source image. */
  outline: SegmentationPoint[];
  holes: SegmentationPoint[][];
  foregroundPoints: SegmentationPoint[];
  backgroundPoints: SegmentationPoint[];
};
export type SegmentationDiagnostics = {
  method: "source-coordinate-grabcut";
  processingWidth: number;
  processingHeight: number;
  sourceBounds: { left: number; top: number; width: number; height: number };
  edgeBandPixels: number;
  foregroundFraction: number;
  retainedOutlineFraction: number;
  removedEdgePixels: number;
};

type CV = typeof cvModule;
let runtime: Promise<{ cv: CV }> | undefined;
function openCV() {
  // OpenCV 5 exports a Promise; older builds export the initialized module.
  // Wrapping cv prevents older thenable modules from being assimilated again.
  return (runtime ??= Promise.resolve(cvModule).then((cv) => ({ cv })));
}

const invalid = () => new Error("INVALID_SEGMENTATION_GUIDANCE");
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const cross = (
  a: SegmentationPoint,
  b: SegmentationPoint,
  c: SegmentationPoint,
) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function onSegment(
  a: SegmentationPoint,
  b: SegmentationPoint,
  p: SegmentationPoint,
) {
  return (
    Math.abs(cross(a, b, p)) < 1e-10 &&
    p.x >= Math.min(a.x, b.x) - 1e-10 &&
    p.x <= Math.max(a.x, b.x) + 1e-10 &&
    p.y >= Math.min(a.y, b.y) - 1e-10 &&
    p.y <= Math.max(a.y, b.y) + 1e-10
  );
}
function inside(point: SegmentationPoint, polygon: SegmentationPoint[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j],
      b = polygon[i];
    if (onSegment(a, b, point)) return true;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
}
function points(value: unknown, max: number): SegmentationPoint[] {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  return value.map((point) => {
    if (
      !point ||
      typeof point !== "object" ||
      typeof point.x !== "number" ||
      typeof point.y !== "number" ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1
    )
      throw invalid();
    return { x: point.x, y: point.y };
  });
}
function polygon(value: unknown): SegmentationPoint[] {
  const p = points(value, 160);
  // A repeated closing vertex is harmless, and common in polygon responses.
  if (p.length > 3 && p[0].x === p.at(-1)!.x && p[0].y === p.at(-1)!.y) p.pop();
  if (p.length < 3) throw invalid();
  let twiceArea = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-7) throw invalid();
    twiceArea += a.x * b.y - b.x * a.y;
    for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      const c = p[j],
        d = p[(j + 1) % p.length];
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 &&
          cross(c, d, a) * cross(c, d, b) < 0) ||
        onSegment(a, b, c) ||
        onSegment(a, b, d) ||
        onSegment(c, d, a) ||
        onSegment(c, d, b)
      )
        throw invalid();
    }
  }
  if (Math.abs(twiceArea) < 1e-8) throw invalid();
  return p;
}
export function validateSegmentationGuidance(
  value: unknown,
): SegmentationGuidance {
  if (!value || typeof value !== "object") throw invalid();
  const v = value as Record<string, unknown>;
  const outline = polygon(v.outline);
  const rawHoles = v.holes ?? [];
  if (!Array.isArray(rawHoles) || rawHoles.length > 32) throw invalid();
  const holes = rawHoles.map(polygon);
  if (
    outline.length + holes.reduce((n, h) => n + h.length, 0) > 1536 ||
    holes.some((hole) => hole.some((point) => !inside(point, outline)))
  )
    throw invalid();
  const foregroundPoints = points(v.foregroundPoints ?? [], 128);
  const backgroundPoints = points(v.backgroundPoints ?? [], 128);
  if (
    foregroundPoints.some(
      (point) =>
        !inside(point, outline) ||
        holes.some((hole) => inside(point, hole)) ||
        backgroundPoints.some(
          (other) => Math.hypot(point.x - other.x, point.y - other.y) < 1e-6,
        ),
    )
  )
    throw invalid();
  return { outline, holes, foregroundPoints, backgroundPoints };
}

/** Pixel-center rasterization avoids moving the source when the working crop changes. */
function fillPolygon(
  data: Uint8Array,
  width: number,
  height: number,
  shape: SegmentationPoint[],
  value: number,
) {
  const minY = clamp(Math.floor(Math.min(...shape.map((p) => p.y))), 0, height);
  const maxY = clamp(Math.ceil(Math.max(...shape.map((p) => p.y))), 0, height);
  for (let y = minY; y < maxY; y++) {
    const scanY = y + 0.5,
      intersections: number[] = [];
    for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
      const a = shape[j],
        b = shape[i];
      if (a.y > scanY !== b.y > scanY)
        intersections.push(a.x + ((scanY - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const start = clamp(Math.ceil(intersections[i] - 0.5), 0, width);
      const end = clamp(Math.ceil(intersections[i + 1] - 0.5), 0, width);
      data.fill(value, y * width + start, y * width + end);
    }
  }
}

function seedDisk(
  labels: Uint8Array,
  width: number,
  height: number,
  point: SegmentationPoint,
  value: number,
) {
  const cx = Math.floor(point.x),
    cy = Math.floor(point.y);
  for (let y = Math.max(0, cy - 2); y <= Math.min(height - 1, cy + 2); y++)
    for (let x = Math.max(0, cx - 2); x <= Math.min(width - 1, cx + 2); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= 4) labels[y * width + x] = value;
}

/** Discard detached background islands without discarding connected straps or crowns. */
function connectedToProtectedForeground(
  mask: Uint8Array,
  protectedPixels: Uint8Array,
  width: number,
  height: number,
) {
  const queue = new Uint32Array(mask.length);
  let head = 0,
    tail = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && protectedPixels[i]) {
      mask[i] = 128;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const at = queue[head++],
      x = at % width,
      y = Math.floor(at / width);
    for (let dy = -1; dy <= 1; dy++) {
      if (y + dy < 0 || y + dy >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= width) continue;
        const next = at + dy * width + dx;
        if (mask[next] === 255) {
          mask[next] = 128;
          queue[tail++] = next;
        }
      }
    }
  }
  for (let i = 0; i < mask.length; i++) mask[i] = mask[i] === 128 ? 255 : 0;
  return tail;
}

/**
 * Refine a source-coordinate outline using local, deterministic classical CV.
 * Only alpha is produced. The original source RGB never enters a generative model
 * here, and must be copied unchanged by cutoutFromMask after this operation.
 */
export async function segmentWatch(
  source: LoadedSource,
  guidance: unknown,
): Promise<{
  mask: Buffer;
  diagnostics: SegmentationDiagnostics;
}> {
  const g = validateSegmentationGuidance(guidance);
  if (
    !Number.isInteger(source.width) ||
    !Number.isInteger(source.height) ||
    source.width < 2 ||
    source.height < 2 ||
    source.width * source.height > 24_000_000
  )
    throw new Error("INVALID_IMAGE");
  const xs = g.outline.map((p) => p.x * source.width);
  const ys = g.outline.map((p) => p.y * source.height);
  const extent = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
  const margin = Math.max(12, Math.ceil(extent * 0.075));
  const left = Math.max(0, Math.floor(Math.min(...xs)) - margin);
  const top = Math.max(0, Math.floor(Math.min(...ys)) - margin);
  const right = Math.min(source.width, Math.ceil(Math.max(...xs)) + margin);
  const bottom = Math.min(source.height, Math.ceil(Math.max(...ys)) + margin);
  const bounds = { left, top, width: right - left, height: bottom - top };
  if (bounds.width < 8 || bounds.height < 8)
    throw new Error("MASK_NEEDS_REVIEW");
  const scale = Math.min(1, 1200 / Math.max(bounds.width, bounds.height));
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const local = (p: SegmentationPoint): SegmentationPoint => ({
    x: ((p.x * source.width - left) * width) / bounds.width,
    y: ((p.y * source.height - top) * height) / bounds.height,
  });
  const edgeBand = clamp(Math.ceil(extent * scale * 0.018), 3, 24);
  const rgb = await sharp(source.normalized)
    .extract(bounds)
    .resize(width, height)
    .removeAlpha()
    .raw()
    .toBuffer();
  const { cv } = await openCV();
  const disposable: Array<{ delete(): void }> = [];
  const own = <T extends { delete(): void }>(value: T): T => {
    disposable.push(value);
    return value;
  };
  let alpha: Uint8Array,
    area: number,
    originalArea = 0,
    removedEdgePixels = 0;
  try {
    const image = own(new cv.Mat(height, width, cv.CV_8UC3));
    image.data.set(rgb);
    const shape = own(cv.Mat.zeros(height, width, cv.CV_8UC1));
    const holeShape = own(cv.Mat.zeros(height, width, cv.CV_8UC1));
    fillPolygon(shape.data, width, height, g.outline.map(local), 255);
    for (const hole of g.holes) {
      fillPolygon(shape.data, width, height, hole.map(local), 0);
      fillPolygon(holeShape.data, width, height, hole.map(local), 255);
    }
    const kernel = own(
      cv.getStructuringElement(
        cv.MORPH_ELLIPSE,
        new cv.Size(edgeBand * 2 + 1, edgeBand * 2 + 1),
      ),
    );
    const holeKernel = own(
      cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)),
    );
    const eroded = own(new cv.Mat()),
      dilated = own(new cv.Mat()),
      holeCore = own(new cv.Mat());
    cv.erode(shape, eroded, kernel);
    cv.dilate(shape, dilated, kernel);
    cv.erode(holeShape, holeCore, holeKernel);
    const labels = own(new cv.Mat(height, width, cv.CV_8UC1));
    for (let i = 0; i < shape.data.length; i++) {
      if (shape.data[i]) originalArea++;
      labels.data[i] = holeCore.data[i]
        ? cv.GC_BGD
        : eroded.data[i]
          ? cv.GC_FGD
          : shape.data[i]
            ? cv.GC_PR_FGD
            : dilated.data[i]
              ? cv.GC_PR_BGD
              : cv.GC_BGD;
    }
    for (const p of g.foregroundPoints)
      seedDisk(labels.data, width, height, local(p), cv.GC_FGD);
    for (const p of g.backgroundPoints)
      seedDisk(labels.data, width, height, local(p), cv.GC_BGD);
    const protectedPixels = new Uint8Array(width * height);
    let hardForeground = 0,
      hardBackground = 0;
    for (let i = 0; i < protectedPixels.length; i++) {
      if (labels.data[i] === cv.GC_FGD) {
        protectedPixels[i] = 1;
        hardForeground++;
      }
      if (labels.data[i] === cv.GC_BGD) hardBackground++;
    }
    if (originalArea < 25 || hardForeground < 5 || hardBackground < 5)
      throw new Error("MASK_NEEDS_REVIEW");
    const bgModel = own(cv.Mat.zeros(1, 65, cv.CV_64FC1));
    const fgModel = own(cv.Mat.zeros(1, 65, cv.CV_64FC1));
    cv.setRNGSeed(0);
    cv.grabCut(
      image,
      labels,
      new cv.Rect(),
      bgModel,
      fgModel,
      3,
      cv.GC_INIT_WITH_MASK,
    );
    alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++)
      alpha[i] =
        labels.data[i] === cv.GC_FGD || labels.data[i] === cv.GC_PR_FGD
          ? 255
          : 0;
    // Color similarity can attach a thin filament of nearby lettering to
    // polished metal. Remove only narrow protrusions outside the supplied
    // silhouette; keep all segmented pixels inside it and every protected seed.
    // Limit cleanup to a two-pixel radius, independent of product dimensions.
    const edgeMask = own(new cv.Mat(height, width, cv.CV_8UC1));
    edgeMask.data.set(alpha);
    const opened = own(new cv.Mat());
    const edgeKernel = own(
      cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5)),
    );
    cv.morphologyEx(edgeMask, opened, cv.MORPH_OPEN, edgeKernel);
    for (let i = 0; i < alpha.length; i++) {
      if (
        alpha[i] &&
        !shape.data[i] &&
        !protectedPixels[i] &&
        !opened.data[i]
      ) {
        alpha[i] = 0;
        removedEdgePixels++;
      }
    }
    area = connectedToProtectedForeground(
      alpha,
      protectedPixels,
      width,
      height,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "MASK_NEEDS_REVIEW")
      throw error;
    throw new Error("SEGMENTATION_FAILED", { cause: error });
  } finally {
    for (let i = disposable.length - 1; i >= 0; i--) disposable[i].delete();
  }
  const retainedOutlineFraction = area! / originalArea;
  const foregroundFraction =
    ((area! / (width * height)) * bounds.width * bounds.height) /
    (source.width * source.height);
  if (
    retainedOutlineFraction < 0.35 ||
    retainedOutlineFraction > 1.65 ||
    foregroundFraction < 0.002 ||
    foregroundFraction > 0.985
  )
    throw new Error("MASK_NEEDS_REVIEW");
  // A subpixel edge transition, never a blur of source RGB. Extending after resize
  // restores the exact source coordinate frame even for a small off-center watch.
  const mask = await sharp(Buffer.from(alpha!), {
    raw: { width, height, channels: 1 },
  })
    .resize(bounds.width, bounds.height, { kernel: "cubic" })
    .blur(0.4)
    .extend({
      left,
      top,
      right: source.width - right,
      bottom: source.height - bottom,
      background: { r: 0, g: 0, b: 0 },
    })
    .greyscale()
    .toColourspace("b-w")
    .png()
    .toBuffer();
  return {
    mask,
    diagnostics: {
      method: "source-coordinate-grabcut",
      processingWidth: width,
      processingHeight: height,
      sourceBounds: bounds,
      edgeBandPixels: edgeBand,
      foregroundFraction,
      retainedOutlineFraction,
      removedEdgePixels,
    },
  };
}
