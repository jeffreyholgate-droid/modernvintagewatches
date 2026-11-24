export const studioPresets = [
  {
    id: "oak-reference",
    name: "Window-side oak",
    image: "oak-reference.png",
    view: "three-quarter",
    note: "Preferred photographic reference",
  },
  {
    id: "signature",
    name: "Signature diagonal",
    image: "01_SIGNATURE.png",
    view: "three-quarter",
    note: "Fixed 3D set · 85 mm",
  },
  {
    id: "high",
    name: "Higher viewpoint",
    image: "02_HIGH_THREE_QUARTER.png",
    view: "high",
    note: "Fixed 3D set · 85 mm",
  },
  {
    id: "opposite",
    name: "Opposite diagonal",
    image: "03_OPPOSITE_DIAGONAL.png",
    view: "three-quarter",
    note: "Fixed 3D set · 85 mm",
  },
  {
    id: "low",
    name: "Case profile",
    image: "04_LOW_CASE_PROFILE.png",
    view: "low",
    note: "Fixed 3D set · 90 mm",
  },
  {
    id: "overhead",
    name: "Overhead",
    image: "05_OVERHEAD.png",
    view: "overhead",
    note: "Fixed 3D set · 75 mm",
  },
  {
    id: "wide",
    name: "Wider study",
    image: "06_ENVIRONMENT.png",
    view: "three-quarter",
    note: "Fixed 3D set · 50 mm",
  },
] as const;
export type StudioPreset = (typeof studioPresets)[number]["id"];
export type StudioSource = { url: string } | { dataUrl: string };
export type StudioRecipe = {
  version: 1;
  preset: StudioPreset;
  format: "square" | "landscape" | "portrait";
  size: 960 | 1200 | 1600;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  backgroundExposure: number;
  warmth: number;
  backgroundBlur: number;
  lightAngle: number;
  lightFalloff: number;
  shadowOpacity: number;
  shadowSoftness: number;
  shadowLength: number;
  shadowAngle: number;
  shadowFlatten: number;
  contactY: number;
  contactAngle: number;
  contactStrength: number;
  edgeFeather: number;
};
export type StudioAnalysis = {
  view: string;
  confidence: number;
  recommendedPreset: StudioPreset;
  lightAngle: number;
  occluded: boolean;
  cutOff: boolean;
  multipleWatches: boolean;
  issues: string[];
  rationale: string;
  sourceSha256: string;
  width: number;
  height: number;
  maskSha256: string;
  method: "ai" | "source-alpha" | "manual";
  provider?: "openai";
  analysisModel?: string;
  maskModel?: string;
  maskMethod?: "image-edit-alpha" | "source-coordinate-grabcut";
  segmentation?: Record<string, unknown>;
  alignmentError?: number;
  reviewRequired: true;
};
export type StudioPrepared = {
  analysis: StudioAnalysis;
  maskDataUrl: string;
  cutoutDataUrl: string;
  recipe: StudioRecipe;
};
export const defaultRecipe: StudioRecipe = {
  version: 1,
  preset: "oak-reference",
  format: "square",
  size: 1200,
  x: 0.5,
  y: 0.53,
  scale: 0.57,
  rotation: 0,
  backgroundExposure: 0,
  warmth: 0,
  backgroundBlur: 0,
  lightAngle: 225,
  lightFalloff: 0.12,
  shadowOpacity: 0.24,
  shadowSoftness: 9,
  shadowLength: 26,
  shadowAngle: 45,
  shadowFlatten: 0.18,
  contactY: 1,
  contactAngle: 0,
  contactStrength: 0.3,
  edgeFeather: 0,
};
export function parseRecipe(value: unknown): StudioRecipe {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_RECIPE");
  const v = value as Record<string, unknown>;
  const r = { ...defaultRecipe };
  if (v.version !== undefined && v.version !== 1)
    throw new Error("UNSUPPORTED_RECIPE_VERSION");
  if (v.preset !== undefined) {
    if (!studioPresets.some((p) => p.id === v.preset))
      throw new Error("INVALID_PRESET");
    r.preset = v.preset as StudioPreset;
  }
  if (v.format !== undefined) {
    if (!["square", "landscape", "portrait"].includes(v.format as string))
      throw new Error("INVALID_FORMAT");
    r.format = v.format as StudioRecipe["format"];
  }
  if (v.size !== undefined) {
    if (![960, 1200, 1600].includes(v.size as number))
      throw new Error("INVALID_SIZE");
    r.size = v.size as StudioRecipe["size"];
  }
  const ranges: Record<string, [number, number]> = {
    x: [0.12, 0.88],
    y: [0.12, 0.88],
    scale: [0.12, 0.82],
    rotation: [-45, 45],
    backgroundExposure: [-1.5, 1.5],
    warmth: [-0.25, 0.25],
    backgroundBlur: [0, 16],
    lightAngle: [0, 360],
    lightFalloff: [0, 0.6],
    shadowOpacity: [0, 0.65],
    shadowSoftness: [1, 30],
    shadowLength: [0, 120],
    shadowAngle: [0, 360],
    shadowFlatten: [0.02, 0.65],
    contactY: [0.25, 1],
    contactAngle: [-45, 45],
    contactStrength: [0, 0.65],
    edgeFeather: [0, 1.5],
  };
  for (const [k, [lo, hi]] of Object.entries(ranges))
    if (v[k] !== undefined) {
      if (
        typeof v[k] !== "number" ||
        !Number.isFinite(v[k]) ||
        (v[k] as number) < lo ||
        (v[k] as number) > hi
      )
        throw new Error("INVALID_CONTROL_" + k.toUpperCase());
      (r as any)[k] = v[k];
    }
  return r;
}
export function outputDimensions(r: StudioRecipe) {
  return r.format === "landscape"
    ? { width: r.size, height: Math.round(r.size * 0.8) }
    : r.format === "portrait"
      ? { width: Math.round(r.size * 0.8), height: r.size }
      : { width: r.size, height: r.size };
}
export function sourceNeedsReview(a: StudioAnalysis) {
  return a.occluded || a.cutOff || a.multipleWatches || a.confidence < 0.65;
}
