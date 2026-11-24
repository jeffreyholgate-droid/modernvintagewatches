import React, { useState } from 'react';
import { photoToneLabels, photoTones, type PhotoTone, type WatchPhoto as Photo } from '../lib/watch-photos';
import { WatchPhoto } from './WatchPhoto';

export function PhotoReview({ photos, onApproval, disabled }: {
  photos: Photo[];
  onApproval: (photos: Photo[] | null) => void;
  disabled: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [cover, setCover] = useState(0);
  const [tones, setTones] = useState(() => photos.map(photo => photo.tone));
  const [approved, setApproved] = useState<Set<number>>(() => new Set());
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const photo = photos[index];

  function apply(next: Set<number>, nextTones: PhotoTone[], nextCover: number) {
    setApproved(next);
    setTones(nextTones);
    setCover(nextCover);
    if (next.size !== photos.length || !photos.length) {
      onApproval(null);
      return;
    }
    const gallery = photos.map((entry, i) => ({ url: entry.url, tone: nextTones[i] }));
    const [lead] = gallery.splice(nextCover, 1);
    onApproval([lead, ...gallery]);
  }

  return <fieldset disabled={disabled} className="space-y-3 border border-stone-200 p-4">
    <legend className="px-1 font-medium">Photo review</legend>
    <p className="text-sm text-stone-600">Choose the cover that best shows the watch. Compare each studio view with the original. Keep the listing in review if any image shows private details or makes wear harder to see.</p>
    {!photo ? <p className="text-sm text-amber-800">No source photos are available. The listing cannot be published.</p> : <>
      <div className="flex flex-wrap gap-2" aria-label="Select a photo to review">
        {photos.map((entry, i) => <button type="button" key={entry.url} aria-pressed={index === i}
          onClick={() => setIndex(i)} className={`border px-2 py-1 text-xs ${index === i ? 'border-black' : 'border-line'}`}>
          Photo {i + 1}{i === cover ? ' · cover' : ''}{approved.has(i) ? ' · reviewed' : ''}
        </button>)}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <figure>
          <figcaption className="mb-1 text-xs text-muted">Original</figcaption>
          <WatchPhoto photo={{ ...photo, tone: 'original' }} alt={`Original photo ${index + 1}`} eager
            onReady={ready => {
              setLoaded(previous => ({ ...previous, [photo.url]: ready }));
              if (!ready && approved.has(index)) {
                const next = new Set<number>(approved);
                next.delete(index);
                apply(next, tones, cover);
              }
            }} />
        </figure>
        <figure>
          <figcaption className="mb-1 text-xs text-muted">Studio preview</figcaption>
          <WatchPhoto photo={{ ...photo, tone: tones[index] }} alt={`Studio view of photo ${index + 1}`} eager />
        </figure>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label>Lighting <select value={tones[index]} className="ml-1 border border-line bg-white p-1"
          onChange={event => {
            const nextTones = [...tones];
            nextTones[index] = event.target.value as PhotoTone;
            const next = new Set<number>(approved);
            next.delete(index);
            apply(next, nextTones, cover);
          }}>
          {photoTones.map(tone => <option key={tone} value={tone}>{photoToneLabels[tone]}</option>)}
        </select></label>
        <button type="button" disabled={cover === index} className="underline disabled:opacity-50"
          onClick={() => apply(new Set<number>(approved), tones, index)}>Use as cover</button>
        <a href={photo.url} target="_blank" rel="noopener noreferrer" className="underline">Open original at full size</a>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" disabled={!loaded[photo.url]}
          checked={approved.has(index)} onChange={event => {
            const next = new Set<number>(approved);
            if (event.target.checked) next.add(index);
            else next.delete(index);
            apply(next, tones, cover);
          }} />
        Wear and detail remain visible, and this image is suitable to show publicly.
      </label>
      <p role="status" className="text-xs text-muted">{approved.size} of {photos.length} photos reviewed</p>
    </>}
  </fieldset>;
}
