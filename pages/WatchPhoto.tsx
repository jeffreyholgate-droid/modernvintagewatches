import React, { useState } from 'react';
import type { WatchPhoto as Photo } from '../lib/watch-photos';

export function WatchPhoto({ photo, alt, eager = false, onReady }: {
  photo?: Photo;
  alt: string;
  eager?: boolean;
  onReady?: (ready: boolean) => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return <div className="watch-photo-frame">
    {photo && failedUrl !== photo.url ?
      <img src={photo.url} alt={alt} data-tone={photo.tone}
        loading={eager ? 'eager' : 'lazy'} decoding="async"
        onLoad={() => onReady?.(true)}
        onError={() => { setFailedUrl(photo.url); onReady?.(false); }} />
      : <p className="px-2 text-center text-xs text-muted">Photo unavailable</p>}
  </div>;
}
