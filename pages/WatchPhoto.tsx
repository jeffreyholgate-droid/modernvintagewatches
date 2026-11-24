import React, { useId, useState } from 'react';
import { maskPath, oakPhotoPath, studioPlacement, type WatchPhoto as Photo } from '../lib/watch-photos';

export function WatchPhoto({ photo, alt, eager = false, originalView = false, onReady }: {
  photo?: Photo;
  alt: string;
  eager?: boolean;
  originalView?: boolean;
  onReady?: (ready: boolean) => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const clipId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const mask = originalView ? undefined : photo?.mask;
  const studio = mask && studioPlacement(mask);
  const oak = !originalView && photo?.oak;
  const url = oak ? oakPhotoPath(oak) : photo?.url;
  const shadowId = `${clipId}-shadow`;
  return <div className={`watch-photo-frame${studio ? ' watch-photo-studio' : ''}${oak ? ' watch-photo-oak' : ''}${originalView ? ' watch-photo-original' : ''}`}>
    {photo && url && failedUrl !== url ?
      mask && studio ? <svg className="watch-photo-cutout" viewBox={studio.viewBox}
        role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={!alt}>
        <defs>
          <clipPath id={clipId}><path d={maskPath(mask)} clipRule="evenodd" /></clipPath>
          <radialGradient id={shadowId}>
            <stop offset="0" stopColor="var(--mvw-studio-shadow)" stopOpacity=".12" />
            <stop offset=".48" stopColor="var(--mvw-studio-shadow)" stopOpacity=".075" />
            <stop offset="1" stopColor="var(--mvw-studio-shadow)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse {...studio.shadow} fill={`url(#${shadowId})`} />
        <image href={photo.url} width={mask.width} height={mask.height} data-tone={photo.tone}
          clipPath={`url(#${clipId})`} onLoad={() => onReady?.(true)}
        onError={() => { setFailedUrl(url); onReady?.(false); }} />
      </svg> : <img src={url} alt={alt} data-tone={photo.tone}
        loading={eager ? 'eager' : 'lazy'} decoding="async"
        onLoad={() => onReady?.(true)}
        onError={() => { setFailedUrl(url); onReady?.(false); }} />
      : <p className="px-2 text-center text-xs text-muted">Photo unavailable</p>}
  </div>;
}
