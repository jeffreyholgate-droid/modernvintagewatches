import React, { useId, useState } from 'react';
import { maskPath, maskViewBox, type WatchPhoto as Photo } from '../lib/watch-photos';

export function WatchPhoto({ photo, alt, eager = false, onReady }: {
  photo?: Photo;
  alt: string;
  eager?: boolean;
  onReady?: (ready: boolean) => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const clipId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const mask = photo?.mask;
  return <div className="watch-photo-frame">
    {photo && failedUrl !== photo.url ?
      mask ? <svg className="watch-photo-cutout" viewBox={maskViewBox(mask)}
        role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={!alt}>
        <defs>
          <clipPath id={clipId}><path d={maskPath(mask)} clipRule="evenodd" /></clipPath>
        </defs>
        <image href={photo.url} width={mask.width} height={mask.height} data-tone={photo.tone}
          clipPath={`url(#${clipId})`} onLoad={() => onReady?.(true)}
          onError={() => { setFailedUrl(photo.url); onReady?.(false); }} />
      </svg> : <img src={photo.url} alt={alt} data-tone={photo.tone}
        loading={eager ? 'eager' : 'lazy'} decoding="async"
        onLoad={() => onReady?.(true)}
        onError={() => { setFailedUrl(photo.url); onReady?.(false); }} />
      : <p className="px-2 text-center text-xs text-muted">Photo unavailable</p>}
  </div>;
}
