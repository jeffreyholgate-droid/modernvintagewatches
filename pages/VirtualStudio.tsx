import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchAllItems, studioRequest, studioRender } from "../lib/api";
import {
  defaultRecipe,
  parseRecipe,
  studioPresets,
  sourceNeedsReview,
  type StudioRecipe,
  type StudioPrepared,
  type StudioSource,
} from "../lib/virtual-studio";
import StudioMaskEditor from "./StudioMaskEditor";
import "./virtual-studio.css";
type Rendered = { imageDataUrl: string; manifest: Record<string, any> };
const errors: Record<string, string> = {
  AI_NOT_CONFIGURED:
    "OpenAI API access is not connected yet. Use a transparent PNG, import a mask or use Refine mask.",
  AI_CREDITS_DEPLETED:
    "The OpenAI API project has no available quota or credits. Check its API billing, or import a mask to continue.",
  AI_ACCESS_DENIED:
    "OpenAI rejected API access. Check the server key and the project's model access.",
  AI_MODEL_UNAVAILABLE:
    "The configured OpenAI model is unavailable to this API project.",
  AI_RATE_LIMITED:
    "OpenAI is temporarily rate limiting requests. Wait a moment before trying again.",
  AI_TIMEOUT:
    "OpenAI preparation timed out. No automatic retry was made. Try again or import a mask.",
  AI_SERVICE_UNAVAILABLE:
    "OpenAI could not complete this request. Try again later or import a mask.",
  AI_RESPONSE_INVALID:
    "OpenAI returned an incomplete result. Try again or import a mask.",
  AI_RESPONSE_REFUSED:
    "OpenAI did not process this photograph. Use a manual mask or another source photograph.",
  AI_MASK_NEEDS_REVIEW:
    "The AI could not make a reliable watch mask. Import a mask or use Refine mask.",
  INVALID_SEGMENTATION_GUIDANCE:
    "The watch outline was unclear. Use Refine mask or try another source photograph.",
  SEGMENTATION_FAILED:
    "Edge isolation could not complete. Use Refine mask or try another source photograph.",
  AI_MASK_INVALID:
    "The AI mask was invalid. Please use a transparent PNG or refine the mask.",
  AI_ANALYSIS_INVALID:
    "The AI assessment was incomplete. Retry or use a manual mask.",
  STUDIO_PROCESSING_FAILED:
    "The image service could not complete this request. Retry, or import a mask to continue.",
  MASK_NEEDS_REVIEW:
    "The mask must keep the watch and remove the surrounding background.",
  WATCH_OUTSIDE_FRAME:
    "The watch extends outside the frame. Reduce its scale or move it towards the centre.",
  IMAGE_TOO_LARGE: "Use a source image smaller than 3 MB.",
  EXPORT_TOO_LARGE: "Choose a smaller output size, then render again.",
  SOURCE_CHANGED: "The source has changed. Prepare the photograph again.",
  IMAGE_HOST_NOT_ALLOWED:
    "This image host is not configured. Download the source and use Upload photograph.",
};
function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}
function jsonDownload(value: unknown, name: string) {
  const u = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  download(u, name);
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function readFile(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}
export default function VirtualStudio() {
  const [params] = useSearchParams(),
    [items, setItems] = useState<any[]>([]),
    [itemId, setItemId] = useState(params.get("item") || "");
  const [source, setSource] = useState<StudioSource | null>(null),
    [sourceName, setSourceName] = useState(""),
    [prepared, setPrepared] = useState<StudioPrepared | null>(null),
    [recipe, setRecipe] = useState<StudioRecipe>({ ...defaultRecipe });
  const [rendered, setRendered] = useState<Rendered | null>(null),
    [renderKey, setRenderKey] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [editing, setEditing] = useState(false),
    [compare, setCompare] = useState(false),
    [exportReady, setExportReady] = useState<Rendered | null>(null),
    [aiConfigured, setAIConfigured] = useState<boolean | null>(null);
  const sourceUrl = source
      ? "url" in source
        ? source.url
        : source.dataUrl
      : "",
    item = items.find((i) => i.id === itemId),
    photos: string[] = item?.imageUrls || [];
  const current = !!rendered && renderKey === JSON.stringify(recipe),
    preset = studioPresets.find((p) => p.id === recipe.preset)!;
  useEffect(() => {
    studioRequest("GET")
      .then((config) => setAIConfigured(config.aiConfigured))
      .catch(() => {});
    fetchAllItems()
      .then(setItems)
      .catch(() =>
        setError(
          "Inventory could not be loaded. You can still upload a photograph.",
        ),
      );
  }, []);
  function choose(next: StudioSource, name: string) {
    setExportReady(null);
    setSource(next);
    setSourceName(name);
    setPrepared(null);
    setRendered(null);
    setReviewed(false);
    setError("");
    setRecipe({ ...defaultRecipe });
  }
  function change(key: keyof StudioRecipe, value: any) {
    setExportReady(null);
    setRecipe((r) => ({ ...r, [key]: value }));
    setReviewed(false);
  }
  async function run<T>(label: string, task: () => Promise<T>) {
    setBusy(label);
    setError("");
    try {
      return await task();
    } catch (e: any) {
      setError(
        errors[e.message] ||
          "Something went wrong. Check the photograph and try again.",
      );
    } finally {
      setBusy("");
    }
  }
  async function prepare(maskDataUrl?: string) {
    if (!source) return;
    setExportReady(null);
    setEditing(false);
    setReviewed(false);
    const p = await run<StudioPrepared>("Preparing with OpenAI…", () =>
      studioRequest("POST", { action: "prepare", source, maskDataUrl }),
    );
    if (p) {
      setPrepared(p);
      setRecipe(p.recipe);
      setRendered(null);
      await render(p, p.recipe);
    }
  }
  async function render(p = prepared, r = recipe) {
    if (!source || !p) return;
    setExportReady(null);
    setReviewed(false);
    const v = await run<Rendered>("Rendering studio…", () =>
      studioRender({
        action: "render",
        source,
        sourceSha256: p.analysis.sourceSha256,
        maskDataUrl: p.maskDataUrl,
        recipe: r,
      }),
    );
    if (v) {
      setRendered(v);
      setRenderKey(JSON.stringify(r));
    }
  }
  async function exportImage() {
    if (!current || !reviewed || !prepared || !source) return;
    const v = await run<Rendered>("Preparing export…", () =>
      studioRender({
        action: "render",
        source,
        sourceSha256: prepared.analysis.sourceSha256,
        maskDataUrl: prepared.maskDataUrl,
        recipe,
        export: true,
        reviewed: true,
      }),
    );
    if (v) {
      setExportReady({
        imageDataUrl: v.imageDataUrl,
        manifest: {
          ...v.manifest,
          analysis: prepared.analysis,
          reviewedAt: new Date().toISOString(),
          maskDataUrl: prepared.maskDataUrl,
        },
      });
    }
  }
  function range(
    key: keyof StudioRecipe,
    label: string,
    min: number,
    max: number,
    step: number,
    unit = "",
  ) {
    return (
      <label className="studio-range" key={key}>
        <span>
          {label}
          <output>
            {Number(recipe[key]).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}
            {unit}
          </output>
        </span>
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={recipe[key]}
          onChange={(e) => change(key, +e.target.value)}
        />
      </label>
    );
  }
  return (
    <div className="virtual-studio">
      <header className="studio-heading">
        <div>
          <span className="studio-kicker">
            Modern Vintage Watches / Photography
          </span>
          <h1>The Oak Study</h1>
          <p>A repeatable setting. The actual watch, carefully placed.</p>
        </div>
        <div className="studio-status">
          ● &nbsp; Private studio · Review before use
        </div>
      </header>
      <div className="studio-layout">
        <aside className="studio-panel studio-source">
          <div className="studio-section-heading">
            <span>01</span>
            <h2>Choose a watch</h2>
          </div>
          <label className="studio-label">
            From MVW inventory
            <select
              value={itemId}
              disabled={!!busy}
              onChange={(e) => setItemId(e.target.value)}
            >
              <option value="">Select a listing</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.titleBoutique || i.titleRaw || i.id}
                </option>
              ))}
            </select>
          </label>
          {photos.length > 0 && (
            <div className="studio-source-grid">
              {photos.map((url, i) => (
                <button
                  key={url + i}
                  disabled={!!busy}
                  className={sourceUrl === url ? "selected" : ""}
                  aria-label={"Use photograph " + (i + 1)}
                  onClick={() =>
                    choose(
                      { url },
                      (item.titleBoutique || item.titleRaw) + " · " + (i + 1),
                    )
                  }
                >
                  <img src={url} alt={"Source photograph " + (i + 1)} />
                </button>
              ))}
            </div>
          )}
          <label className="studio-upload">
            Upload photograph
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={!!busy}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 3 * 1024 * 1024) {
                  setError(errors.IMAGE_TOO_LARGE);
                  return;
                }
                choose({ dataUrl: await readFile(f) }, f.name);
                e.target.value = "";
              }}
            />
          </label>
          <p className="studio-small">
            JPEG, PNG or WebP · up to 3 MB. Choose a complete watch at the
            intended angle.
          </p>
          <p className="studio-small" role="status">
            {aiConfigured === null
              ? "Checking OpenAI setup…"
              : aiConfigured
                ? "OpenAI · API key configured"
                : "OpenAI · setup needed. Connect an API key on the server for automatic preparation. Transparent PNGs and manual masks work now."}
          </p>
          {source && (
            <>
              <img
                className="studio-original"
                src={sourceUrl}
                alt="Selected original photograph"
              />
              <p className="studio-filename">{sourceName}</p>
              <button
                className="studio-primary"
                disabled={!!busy}
                onClick={() => prepare()}
              >
                Prepare with OpenAI
              </button>
              <div className="studio-toolbar">
                <button disabled={!!busy} onClick={() => setEditing(true)}>
                  Refine mask
                </button>
                <label className="studio-file-button">
                  Import mask
                  <input
                    type="file"
                    accept="image/png"
                    disabled={!!busy}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        if (f.size > 3 * 1024 * 1024)
                          setError(errors.IMAGE_TOO_LARGE);
                        else await prepare(await readFile(f));
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </>
          )}
          {prepared && (
            <div className="studio-assessment">
              <h3>Source assessment</h3>
              <p>{prepared.analysis.rationale}</p>
              <span className="studio-tag">
                {prepared.analysis.view} ·{" "}
                {prepared.analysis.method === "ai"
                  ? "AI assisted"
                  : prepared.analysis.method === "manual"
                    ? "Manual mask"
                    : "Source transparency"}
              </span>
              <ul>
                {prepared.analysis.issues.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              {sourceNeedsReview(prepared.analysis) && (
                <p className="studio-warning">
                  Inspect this source carefully. A new photograph may be needed
                  for a convincing result.
                </p>
              )}
            </div>
          )}
        </aside>
        <section className="studio-stage-panel">
          <div className="studio-stage-toolbar">
            <div>
              <span className="studio-kicker">02 / Compose</span>
              <h2>{preset.name}</h2>
            </div>
            <button
              disabled={!source}
              aria-pressed={compare}
              onClick={() => setCompare(!compare)}
            >
              {compare ? "Show studio" : "Compare source"}
            </button>
          </div>
          <div
            className={"studio-stage " + (compare ? "studio-compare" : "")}
            style={{
              aspectRatio:
                recipe.format === "landscape"
                  ? "5/4"
                  : recipe.format === "portrait"
                    ? "4/5"
                    : "1",
            }}
          >
            {compare && source ? (
              <img src={sourceUrl} alt="Original source for comparison" />
            ) : (
              <img
                src={rendered?.imageDataUrl || "/studio/" + preset.image}
                alt={
                  rendered
                    ? "Rendered watch in oak study"
                    : "Empty oak study studio plate"
                }
              />
            )}{" "}
            {!prepared && !compare && (
              <div className="studio-empty">
                <span>YOUR WATCH. THIS SETTING.</span>
                <p>Choose a photograph to begin.</p>
              </div>
            )}
            {busy && (
              <div className="studio-progress" role="status">
                <span className="studio-spinner" />
                {busy}
                <small>This can take a minute. Keep this tab open.</small>
              </div>
            )}
            {rendered && !current && !busy && !compare && (
              <div className="studio-stale">
                Controls changed · Render to update
              </div>
            )}
          </div>
          <div className="studio-render-bar">
            <span>
              {rendered
                ? `${rendered.manifest.width} × ${rendered.manifest.height} px`
                : "Fixed studio plates · v01"}
              {current ? " · Preview current" : ""}
            </span>
            <button
              className="studio-primary"
              disabled={!prepared || !!busy}
              onClick={() => render()}
            >
              Render preview
            </button>
          </div>
          {error && (
            <div className="studio-error" role="alert">
              {error}
            </div>
          )}
          <div className="studio-presets">
            {studioPresets.map((p) => (
              <button
                key={p.id}
                disabled={!!busy}
                className={recipe.preset === p.id ? "selected" : ""}
                aria-pressed={recipe.preset === p.id}
                onClick={() => change("preset", p.id)}
              >
                <img src={"/studio/" + p.image} alt="" />
                <strong>{p.name}</strong>
                <small>
                  {p.id === "oak-reference"
                    ? "Preferred reference"
                    : "3D set / prototype"}
                </small>
              </button>
            ))}
          </div>
          <p className="studio-small">
            Match the camera to the source photograph. One photograph cannot
            reveal another side of the watch. The six 3D views share one set;
            their material finish is still a prototype.
          </p>
          <div className="studio-export">
            <span className="studio-kicker">03 / Review & export</span>
            <h2>Ready for a closer look.</h2>
            <label>
              <input
                type="checkbox"
                checked={reviewed}
                disabled={!current || !!busy}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I checked the dial, hands, condition, mask edges, contact and
              lighting against the original.
            </label>
            <div className="studio-toolbar">
              <button
                className="studio-primary"
                disabled={!reviewed || !current || !!busy}
                onClick={exportImage}
              >
                Export PNG + recipe
              </button>
              {exportReady && current && reviewed && (
                <span className="studio-downloads" role="status">
                  Export ready:{" "}
                  <a
                    href={exportReady.imageDataUrl}
                    download={"MVW-" + recipe.preset + ".png"}
                  >
                    Download PNG
                  </a>{" "}
                  ·{" "}
                  <a
                    href={
                      "data:application/json;charset=utf-8," +
                      encodeURIComponent(
                        JSON.stringify(exportReady.manifest, null, 2),
                      )
                    }
                    download={"MVW-" + recipe.preset + "-recipe.json"}
                  >
                    Download recipe
                  </a>
                </span>
              )}
              <button
                disabled={!prepared || !!busy}
                onClick={() =>
                  jsonDownload(
                    { version: 1, source, sourceName, prepared, recipe },
                    "MVW-studio-session.json",
                  )
                }
              >
                Save session
              </button>
              <label className="studio-file-button">
                Open session
                <input
                  type="file"
                  accept="application/json"
                  disabled={!!busy}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      if (f.size > 12_000_000) throw Error();
                      const v = JSON.parse(await f.text()),
                        r = parseRecipe(v.recipe);
                      if (
                        v.version !== 1 ||
                        !v.source ||
                        !v.prepared?.maskDataUrl ||
                        !v.prepared?.analysis?.sourceSha256
                      )
                        throw Error();
                      choose(v.source, String(v.sourceName || "Saved session"));
                      setPrepared(v.prepared);
                      setRecipe(r);
                    } catch {
                      setError("Choose a valid MVW studio session JSON file.");
                    }
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="studio-small">
              Downloads are for review. Publishing to a listing is a separate
              step.
            </p>
          </div>
        </section>
        <aside className="studio-panel studio-controls">
          <div className="studio-section-heading">
            <span>↗</span>
            <h2>Art direction</h2>
          </div>
          <fieldset disabled={!!busy}>
            <details open>
              <summary>Placement</summary>
              {range("x", "Horizontal position", 0.12, 0.88, 0.01)}
              {range("y", "Vertical position", 0.12, 0.88, 0.01)}
              {range("scale", "Watch scale", 0.12, 0.82, 0.01)}
              {range("rotation", "Rotation", -45, 45, 1, "°")}
            </details>
            <details open>
              <summary>Light & atmosphere</summary>
              {range(
                "backgroundExposure",
                "Background exposure",
                -1.5,
                1.5,
                0.05,
                " EV",
              )}
              {range("warmth", "Background warmth", -0.25, 0.25, 0.01)}
              {range("lightAngle", "Light direction", 0, 360, 1, "°")}
              {range("lightFalloff", "Light falloff", 0, 0.6, 0.01)}
              {range(
                "backgroundBlur",
                "Background softness",
                0,
                16,
                0.5,
                " px",
              )}
              <p className="studio-small">
                Saved backgrounds have baked focus and reflections. These
                controls adjust the background; watch detail and colour stay
                protected.
              </p>
            </details>
            <details open>
              <summary>Shadow & contact</summary>
              {range("shadowOpacity", "Cast shadow strength", 0, 0.65, 0.01)}
              {range("shadowAngle", "Shadow direction", 0, 360, 1, "°")}
              {range("shadowLength", "Shadow length", 0, 120, 1)}
              {range("shadowSoftness", "Shadow softness", 1, 30, 1)}
              {range("shadowFlatten", "Shadow perspective", 0.02, 0.65, 0.01)}
              {range("contactY", "Contact height", 0.25, 1, 0.01)}
              {range("contactAngle", "Contact angle", -45, 45, 1, "°")}
              {range("contactStrength", "Contact strength", 0, 0.65, 0.01)}
              {range("edgeFeather", "Edge feather", 0, 1.5, 0.05, " px")}
            </details>
            <details open>
              <summary>Output</summary>
              <label className="studio-label">
                Format
                <select
                  value={recipe.format}
                  onChange={(e) => change("format", e.target.value)}
                >
                  <option value="square">Square · 1:1</option>
                  <option value="landscape">Landscape · 5:4</option>
                  <option value="portrait">Portrait · 4:5</option>
                </select>
              </label>
              <label className="studio-label">
                Long edge
                <select
                  value={recipe.size}
                  onChange={(e) => change("size", +e.target.value)}
                >
                  <option value="960">960 px</option>
                  <option value="1200">1200 px</option>
                  <option value="1600">1600 px</option>
                </select>
              </label>
            </details>
            <button
              onClick={() => {
                setRecipe(prepared?.recipe || { ...defaultRecipe });
                setReviewed(false);
              }}
            >
              Reset controls
            </button>
          </fieldset>
        </aside>
      </div>
      {editing && source && (
        <StudioMaskEditor
          source={sourceUrl}
          mask={prepared?.maskDataUrl}
          onApply={prepare}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
