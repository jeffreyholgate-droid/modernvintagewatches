import React, { useState } from 'react';
import { photoToneLabels, photoTones, type PhotoTone, type WatchPhoto as Photo } from '../lib/watch-photos';
import { WatchPhoto } from './WatchPhoto';
import { BackdropEditor } from './BackdropEditor';

export function PhotoReview({ photos, onApproval, disabled }: {
  photos: Photo[];
  onApproval: (photos: Photo[] | null) => void;
  disabled: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [cover, setCover] = useState(0);
  const [gallery, setGallery] = useState<Photo[]>(photos);
  const [approved, setApproved] = useState<Set<number>>(() => new Set());
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const photo: Photo | undefined = gallery[index];

  function apply(next: Set<number>, nextGallery: Photo[], nextCover: number) {
    setApproved(next);
    setGallery(nextGallery);
    setCover(nextCover);
    if (next.size !== nextGallery.length || !nextGallery.every(entry => entry.mask) || !nextGallery.length) {
      onApproval(null);
      return;
    }
    const [lead] = nextGallery.slice(nextCover, nextCover + 1);
    onApproval([lead, ...nextGallery.filter((_, i) => i !== nextCover)]);
  }

  function updatePhoto(patch: Partial<Photo>) {
    const next = new Set<number>(approved);
    next.delete(index);
    apply(next, gallery.map((entry, i) => i === index ? { ...entry, ...patch } : entry), cover);
  }

  return <fieldset disabled={disabled} className="space-y-3 border border-stone-200 p-4">
    <legend className="px-1 font-medium">Photo review</legend>
    <p className="text-sm text-stone-600">Give every photo the same MVW backdrop. Compare each cutout with the original before approving it. Keep every edge, mark and relevant accessory visible.</p>
    {!photo ? <p className="text-sm text-amber-800">No source photos are available. The listing cannot be published.</p> : <>
      <div className="flex flex-wrap gap-2" aria-label="Select a photo to review">
        {gallery.map((entry, i) => <button type="button" key={entry.url} aria-pressed={index === i}
          onClick={() => { setIndex(i); setEditing(false); }} className={`border px-2 py-1 text-xs ${index === i ? 'border-black' : 'border-line'}`}>
          Photo {i + 1}{i === cover ? ' · cover' : ''}{approved.has(i) ? ' · reviewed' : ''}
        </button>)}
      </div>
      <button type="button" className="border border-line px-3 py-2 text-sm"
        onClick={() => setEditing(value => !value)}>
        {editing ? 'Compare with original' : photo.mask ? 'Edit cutout' : 'Outline subject'}
      </button>
      {editing ? <div key={photo.url}>
        <BackdropEditor url={photo.url} mask={photo.mask} onEdit={() => updatePhoto({})}
          onChange={mask => updatePhoto({ mask })} />
      </div> : <div className="grid grid-cols-2 gap-3">
        <figure>
          <figcaption className="mb-1 text-xs text-muted">Original</figcaption>
          <WatchPhoto photo={{ url: photo.url, tone: 'original' }} alt={`Original photo ${index + 1}`} eager
            onReady={ready => {
              setLoaded(previous => ({ ...previous, [photo.url]: ready }));
              if (!ready && approved.has(index)) updatePhoto({});
            }} />
        </figure>
        <figure>
          <figcaption className="mb-1 text-xs text-muted">MVW backdrop</figcaption>
          {photo.mask ? <WatchPhoto photo={photo} alt={`Studio view of photo ${index + 1}`} eager /> :
            <div className="watch-photo-frame"><p className="text-center text-sm text-muted">Outline the watch to preview its new backdrop.</p></div>}
        </figure>
      </div>}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label>Lighting <select value={photo.tone} className="ml-1 border border-line bg-white p-1"
          onChange={event => updatePhoto({ tone: event.target.value as PhotoTone })}>
          {photoTones.map(tone => <option key={tone} value={tone}>{photoToneLabels[tone]}</option>)}
        </select></label>
        <button type="button" disabled={cover === index} className="underline disabled:opacity-50"
          onClick={() => apply(new Set<number>(approved), gallery, index)}>Use as cover</button>
        <a href={photo.url} target="_blank" rel="noopener noreferrer" className="underline">Open original at full size</a>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" disabled={editing || !photo.mask || !loaded[photo.url]}
          checked={approved.has(index)} onChange={event => {
            const next = new Set<number>(approved);
            if (event.target.checked) next.add(index);
            else next.delete(index);
            apply(next, gallery, cover);
          }} />
        Wear and detail remain visible, and this image is suitable to show publicly.
      </label>
      <p role="status" className="text-xs text-muted">{approved.size} of {photos.length} photos reviewed</p>
    </>}
  </fieldset>;
}
