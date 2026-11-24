export const photoTones = ['original', 'soft-light', 'soft-highlights'] as const;
export type PhotoTone = typeof photoTones[number];
export type WatchPhoto = { url: string; tone: PhotoTone };

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
export function parsePhotoReview(value: unknown, urls: string[]): WatchPhoto[] | null {
  if (!Array.isArray(value) || !urls.length || value.length !== urls.length) return null;
  const photos: WatchPhoto[] = [];
  const remaining = new Set(urls);
  for (const photo of value) {
    if (!photo || !remaining.delete(photo.url) || !photoTones.includes(photo.tone)) return null;
    photos.push({ url: photo.url, tone: photo.tone });
  }
  return photos;
}

export function displayWatchPhotos(urls: unknown, review: unknown): WatchPhoto[] {
  const images = watchPhotoUrls(urls);
  return parsePhotoReview(review, images) ?? images.map(url => ({ url, tone: 'original' }));
}
