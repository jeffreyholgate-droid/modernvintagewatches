import React, { useState } from 'react';
import { MAX_MASK_POINTS, MAX_OUTLINES, validOutline, type MaskPoint, type PhotoMask } from '../lib/watch-photos';

export function BackdropEditor({ url, mask, onChange, onEdit }: {
  url: string;
  mask?: PhotoMask;
  onChange: (mask: PhotoMask | undefined) => void;
  onEdit: () => void;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [points, setPoints] = useState<MaskPoint[]>([]);
  const [marker, setMarker] = useState<MaskPoint>([500, 500]);
  const [failed, setFailed] = useState(false);
  const outlines = mask?.outlines ?? [];
  const pointList = (line: MaskPoint[]) => line.map(([x, y]) => `${x},${y}`).join(' ');
  const coordinate = (value: number) => Math.max(0, Math.min(1000, Math.round(value)));

  function add(point: MaskPoint) {
    if (!size || points.length >= MAX_MASK_POINTS || outlines.length >= MAX_OUTLINES) return;
    onEdit();
    setPoints(previous => [...previous, point]);
  }

  function closeOutline() {
    if (!size || !validOutline(points) || outlines.length >= MAX_OUTLINES) return;
    onChange({ ...size, outlines: [...outlines, points] });
    setPoints([]);
  }

  return <div className="space-y-2">
    <p className="text-sm text-stone-700">Tap around the outside of the watch and close the outline. Trace separate accessories or openings as needed. If a hand or stand hides part of the watch, use a clearer source photo.</p>
    <div className="relative mx-auto w-fit max-w-full">
      <img src={url} alt="Original watch photo to outline" className="block max-h-[65vh] max-w-full"
        onLoad={event => {
          const image = event.currentTarget;
          const nextSize = { width: image.naturalWidth, height: image.naturalHeight };
          setSize(nextSize);
          if (mask && (mask.width !== nextSize.width || mask.height !== nextSize.height)) onChange(undefined);
        }} onError={() => setFailed(true)} />
      {size && <svg viewBox="0 0 1000 1000" preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full cursor-crosshair focus-visible:outline focus-visible:outline-black"
        role="application" aria-label="Outline editor. Arrow keys move the marker. Enter adds a point." tabIndex={0}
        onClick={event => {
          const box = event.currentTarget.getBoundingClientRect();
          if (!box.width || !box.height) return;
          add([coordinate((event.clientX - box.left) * 1000 / box.width),
            coordinate((event.clientY - box.top) * 1000 / box.height)]);
        }} onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); add(marker); return; }
          const step = event.shiftKey ? 30 : 5;
          const movement: Record<string, MaskPoint> = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
          const delta = movement[event.key];
          if (!delta) return;
          event.preventDefault();
          setMarker(([x, y]) => [coordinate(x + delta[0]), coordinate(y + delta[1])]);
        }}>
        {outlines.map((line, i) => <polygon key={i} points={pointList(line)}
          fill="none" stroke="#facc15" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
        {points.length > 0 && <polyline points={pointList(points)} fill="none"
          stroke="#22d3ee" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
        {points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="5" fill="#22d3ee" />)}
        <circle cx={marker[0]} cy={marker[1]} r="8" fill="none" stroke="white"
          strokeWidth="2" vectorEffect="non-scaling-stroke" className="backdrop-keyboard-marker" />
      </svg>}
    </div>
    {failed && <p role="alert" className="text-sm text-amber-800">The source photo did not load. Reopen the review to try again.</p>}
    <div className="flex flex-wrap gap-4 text-sm">
      <button type="button" className="underline disabled:opacity-50" disabled={!validOutline(points) || outlines.length >= MAX_OUTLINES}
        onClick={closeOutline}>Close outline</button>
      <button type="button" className="underline disabled:opacity-50" disabled={!points.length}
        onClick={() => setPoints(previous => previous.slice(0, -1))}>Undo point</button>
      <button type="button" className="underline disabled:opacity-50" disabled={!outlines.length || !!points.length}
        onClick={() => onChange(mask && outlines.length > 1 ? { ...mask, outlines: outlines.slice(0, -1) } : undefined)}>Undo outline</button>
      <button type="button" className="underline disabled:opacity-50" disabled={!outlines.length && !points.length}
        onClick={() => { setPoints([]); onChange(undefined); }}>Reset cutout</button>
    </div>
    <p role="status" className="text-xs text-muted">
      {outlines.length} closed {outlines.length === 1 ? 'outline' : 'outlines'} · {points.length} points in progress
    </p>
  </div>;
}
