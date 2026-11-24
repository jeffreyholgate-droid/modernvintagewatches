import React, { useEffect, useRef, useState } from "react";
export default function StudioMaskEditor({
  source,
  mask,
  onApply,
  onClose,
}: {
  source: string;
  mask?: string;
  onApply: (mask: string) => void;
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    drawing = useRef(false),
    history = useRef<ImageData[]>([]);
  const [erase, setErase] = useState(false),
    [brush, setBrush] = useState(24),
    [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const img = new Image();
    img.onload = () => {
      if (!active || !canvas.current) return;
      const c = canvas.current,
        ratio = Math.min(
          1,
          1600 / Math.max(img.naturalWidth, img.naturalHeight),
        );
      c.width = Math.round(img.naturalWidth * ratio);
      c.height = Math.round(img.naturalHeight * ratio);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, c.width, c.height);
      if (mask) {
        const m = new Image();
        m.onload = () => {
          if (active) {
            ctx.drawImage(m, 0, 0, c.width, c.height);
            setReady(true);
          }
        };
        m.src = mask;
      } else setReady(true);
    };
    img.src = source;
    return () => {
      active = false;
    };
  }, [source, mask]);
  function paint(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const c = e.currentTarget,
      b = c.getBoundingClientRect(),
      ctx = c.getContext("2d")!;
    ctx.fillStyle = erase ? "#000" : "#fff";
    ctx.beginPath();
    ctx.arc(
      ((e.clientX - b.left) * c.width) / b.width,
      ((e.clientY - b.top) * c.height) / b.height,
      (brush * c.width) / b.width / 2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  return (
    <div
      className="studio-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mask-title"
    >
      <div className="studio-dialog-body">
        <header>
          <h2 id="mask-title">Refine the watch edges</h2>
          <button onClick={onClose}>Close</button>
        </header>
        <p>
          White keeps the photograph. Black removes it. Check the crown,
          bracelet openings and strap edges. Hidden parts cannot be restored.
        </p>
        <div className="studio-toolbar">
          <button aria-pressed={!erase} onClick={() => setErase(false)}>
            Restore watch
          </button>
          <button aria-pressed={erase} onClick={() => setErase(true)}>
            Erase background
          </button>
          <label>
            Brush{" "}
            <input
              aria-label="Brush size"
              type="range"
              min="2"
              max="100"
              value={brush}
              onChange={(e) => setBrush(+e.target.value)}
            />
          </label>
          <button
            onClick={() => {
              const prev = history.current.pop();
              if (prev)
                canvas.current!.getContext("2d")!.putImageData(prev, 0, 0);
            }}
          >
            Undo
          </button>
        </div>
        <div className="studio-mask-surface">
          <img src={source} alt="Original watch photograph" />
          <canvas
            ref={canvas}
            aria-label="Paint watch mask"
            onPointerDown={(e) => {
              if (!ready) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              const c = e.currentTarget;
              history.current.push(
                c.getContext("2d")!.getImageData(0, 0, c.width, c.height),
              );
              if (history.current.length > 8) history.current.shift();
              drawing.current = true;
              paint(e);
            }}
            onPointerMove={paint}
            onPointerUp={() => {
              drawing.current = false;
            }}
            onPointerCancel={() => {
              drawing.current = false;
            }}
          />
        </div>
        <p className="studio-small">
          The translucent overlay lets you see the original underneath. Import a
          black-and-white PNG mask for precision work.
        </p>
        <button
          className="studio-primary"
          disabled={!ready}
          onClick={() => onApply(canvas.current!.toDataURL("image/png"))}
        >
          Apply mask
        </button>
      </div>
    </div>
  );
}
