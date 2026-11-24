export const photoTones = ['original', 'soft-light', 'soft-highlights'] as const;
export type PhotoTone = typeof photoTones[number];
export type MaskPoint = [number, number];
export type PhotoMask = { width: number; height: number; outlines: MaskPoint[][] };
export type OakPhoto = { itemId: string; outputSha256: string; sourceSha256: string };
export type WatchPhoto = { url: string; tone: PhotoTone; mask?: PhotoMask; oak?: OakPhoto };

export const photoHashPattern = /^[a-f0-9]{64}$/;
export const studioItemPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function oakSourceUrl(url: string) {
  return url.replace(
    /^(https:\/\/i\.ebayimg\.com\/images\/(?:[^/?#]+\/)+)s-l\d+(\.(?:jpg|png|webp))(?=[?#]|$)/,
    '$1s-l1600$2',
  );
}

export function oakPhotoPath(photo: OakPhoto) {
  return `/api/studio?item=${encodeURIComponent(photo.itemId)}&photo=${photo.outputSha256}`;
}

export function reviewedOakGallery(urls: string[], reviewed: WatchPhoto[], coverUrl?: string) {
  const validated = parsePhotoReview(reviewed, urls);
  if (!validated?.every(photo => photo.oak)) return null;
  const cover = coverUrl ?? urls[0];
  if (!urls.includes(cover)) return null;
  const byUrl = new Map(validated.map(photo => [photo.url, photo]));
  return [cover, ...urls.filter(url => url !== cover)].map(url => byUrl.get(url)!);
}

export const MAX_OUTLINES = 8;
export const MAX_MASK_POINTS = 160;
export const STUDIO_SUBJECT_SCALE = 0.83;

export function validOutline(points: unknown): points is MaskPoint[] {
  if (!Array.isArray(points) || points.length < 3 || points.length > MAX_MASK_POINTS ||
      points.some(point => !Array.isArray(point) || point.length !== 2 ||
        point.some(value => !Number.isInteger(value) || value < 0 || value > 1000))) return false;
  const twiceArea = points.reduce((sum, [x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length];
    return sum + x * ny - nx * y;
  }, 0);
  return Math.abs(twiceArea) >= 16;
}

export function parsePhotoMask(value: unknown): PhotoMask | null {
  if (!value || typeof value !== 'object') return null;
  const { width, height, outlines } = value as PhotoMask;
  if (!Number.isInteger(width) || width < 1 || width > 16000 ||
      !Number.isInteger(height) || height < 1 || height > 16000 ||
      !Array.isArray(outlines) || outlines.length < 1 || outlines.length > MAX_OUTLINES ||
      !outlines.every(validOutline)) return null;
  return { width, height, outlines: outlines.map(points => points.map(([x, y]) => [x, y])) };
}

export function maskPath(mask: PhotoMask) {
  return mask.outlines.map(points =>
    points.map(([x, y], i) => `${i ? 'L' : 'M'}${x * mask.width / 1000} ${y * mask.height / 1000}`).join(' ') + ' Z'
  ).join(' ');
}

/** Centre all retained shapes on a square canvas with the approved subject scale. */
export function studioPlacement(mask: PhotoMask) {
  const points = mask.outlines.flat();
  const xs = points.map(([x]) => x * mask.width / 1000);
  const ys = points.map(([, y]) => y * mask.height / 1000);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;
  const side = Math.max(width, height) / STUDIO_SUBJECT_SCALE;
  const midX = left + width / 2;
  const midY = top + height / 2;
  return {
    viewBox: [midX - side / 2, midY - side / 2, side, side].join(' '),
    shadow: { cx: midX + side * 0.025, cy: top + height - side * 0.042, rx: side * 0.31, ry: side * 0.058 },
  };
}

export const photoToneLabels: Record<PhotoTone, string> = {
  original: 'Original lighting',
  'soft-light': 'Lift shadows',
  'soft-highlights': 'Soften highlights',
};

export function watchPhotoUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => {
    if (typeof entry !== 'string' || entry.length > 2048) return false;
    try {
      const url = new URL(entry);
      return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
    } catch { return false; }
  }))];
}

/** Require explicit review of the complete photo set, including detail shots. */
export function parsePhotoReview(value: unknown, urls: string[], requireBackground = false): WatchPhoto[] | null {
  if (!Array.isArray(value) || !urls.length || value.length !== urls.length) return null;
  const photos: WatchPhoto[] = [];
  const remaining = new Set(urls);
  for (const photo of value) {
    if (!photo || !remaining.delete(photo.url) || !photoTones.includes(photo.tone)) return null;
    const mask = parsePhotoMask(photo.mask);
    const oak = photo.oak;
    if (oak !== undefined && (!oak || photo.tone !== 'original' || photo.mask !== undefined ||
        typeof oak.itemId !== 'string' || !studioItemPattern.test(oak.itemId) ||
        typeof oak.outputSha256 !== 'string' || !photoHashPattern.test(oak.outputSha256) ||
        typeof oak.sourceSha256 !== 'string' || !photoHashPattern.test(oak.sourceSha256))) return null;
    if (!mask && (photo.mask !== undefined || requireBackground && !oak)) return null;
    photos.push({ url: photo.url, tone: photo.tone, ...(mask ? { mask } : {}), ...(oak ? {
      oak: { itemId: oak.itemId, outputSha256: oak.outputSha256, sourceSha256: oak.sourceSha256 },
    } : {}) });
  }
  return photos;
}

export function displayWatchPhotos(urls: unknown, review: unknown): WatchPhoto[] {
  const images = watchPhotoUrls(urls);
  return parsePhotoReview(review, images) ?? images.map(url => ({ url, tone: 'original' }));
}
