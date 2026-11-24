import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchAllItems, studioRequest, studioRender, studioSavedPhoto } from "../lib/api";
import type { AppStateItem } from "../lib/store";
import { oakPhotoPath, oakSourceUrl, watchPhotoUrls } from "../lib/watch-photos";
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
type StudioMode = "photograph" | "manual";
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
  SOURCE_TOO_SMALL_FOR_HERO:
    "The watch is too small in this source for a detailed studio photograph. Choose a closer or higher-resolution view.",
  PHOTOGRAPH_REQUIRES_OPAQUE_SOURCE:
    "Use the original photograph with its surroundings for this mode. Transparent cutouts work with manual plates.",
  PHOTOGRAPH_GEOMETRY_MISMATCH:
    "The generated scene changed the framing, so it was rejected. No automatic retry was made.",
  PHOTOGRAPH_PRESERVATION_FAILED:
    "The watch preservation check failed. This scene cannot be exported.",
  SCENE_SOURCE_TOO_SMALL:
    "Choose a higher-resolution photograph with the complete watch clearly visible.",
  AI_SCENE_INVALID:
    "The scene could not be verified. No export was accepted. Try another source or use manual plates.",
  AI_SCENE_NEEDS_REVIEW:
    "The generated scene did not align reliably with the original watch. Try another source photograph.",
  AI_SCENE_ALIGNMENT:
    "The scene did not align with the original watch. Choose a clearer source photograph and try again.",
  AI_SCENE_OUTPUT_INVALID:
    "The scene response was incomplete. No automatic retry was made.",
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
  LISTING_CHANGED: "Another review or source refresh changed this listing. Reopen it and check the latest photographs.",
  STUDIO_REVIEW_EXPIRED: "This review has expired. Reopen the source and prepare a fresh result.",
  STUDIO_STORAGE_UNAVAILABLE: "Oak Study storage is unavailable. Your listing has not changed.",
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
function readFile(f: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}
export default function VirtualStudio() {
  const [params] = useSearchParams(),
    [items, setItems] = useState<AppStateItem[]>([]),
    [itemId, setItemId] = useState(params.get("item") || "");
  const [source, setSource] = useState<StudioSource | null>(null),
    [sourceName, setSourceName] = useState(""),
    [prepared, setPrepared] = useState<StudioPrepared | null>(null),
    [recipe, setRecipe] = useState<StudioRecipe>({ ...defaultRecipe });
  const [rendered, setRendered] = useState<Rendered | null>(null),
    [renderKey, setRenderKey] = useState(""),
    [mode, setMode] = useState<StudioMode>("photograph"),
    [photographResult, setPhotographResult] = useState<Rendered | null>(null),
    [listingPhoto, setListingPhoto] = useState<{ itemId: string; url: string } | null>(null),
    [photoProof, setPhotoProof] = useState<string | undefined>(),
    [savedPreview, setSavedPreview] = useState(""),
    [savedNotice, setSavedNotice] = useState(""),
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
    photos = watchPhotoUrls(item?.imageUrls),
    savedOak = item?.oakPhotoReview?.find(photo => photo.url === listingPhoto?.url)?.oak,
    pendingPhoto = photos.findIndex(url => !item?.oakPhotoReview?.some(photo => photo.url === url));
  const activeResult = mode === "photograph" ? photographResult : rendered,
    current =
      mode === "photograph"
        ? !!photographResult &&
          photographResult.manifest.sourceSha256 ===
            prepared?.analysis.sourceSha256 &&
          photographResult.manifest.maskSha256 === prepared?.analysis.maskSha256
        : !!rendered && renderKey === JSON.stringify(recipe),
    exportName =
      mode === "photograph"
        ? "MVW-Oak-Study-photograph"
        : "MVW-" + recipe.preset,
    preset = studioPresets.find((p) => p.id === recipe.preset)!;
  useEffect(() => {
    studioRequest("GET")
      .then((config) => setAIConfigured(config.aiConfigured))
      .catch(() => {});
    fetchAllItems()
      .then((inventory: AppStateItem[]) => {
        setItems(inventory);
        const selected = inventory.find(entry => entry.id === params.get("item"));
        const index = Number(params.get("photo")) - 1;
        const url = watchPhotoUrls(selected?.imageUrls)[index];
        if (selected && url) chooseInventoryPhoto(selected, url, index);
      })
      .catch(() =>
        setError(
          "Inventory could not be loaded. You can still upload a photograph.",
        ),
      );
  }, []);
  function choose(next: StudioSource | null, name = "", linked: typeof listingPhoto = null) {
    setExportReady(null);
    setSource(next);
    setSourceName(name);
    setListingPhoto(linked);
    setPhotoProof(undefined);
    setSavedPreview("");
    setSavedNotice("");
    setPrepared(null);
    setRendered(null);
    setPhotographResult(null);
    setReviewed(false);
    setError("");
    setRecipe({ ...defaultRecipe });
  }
  function chooseInventoryPhoto(entry: AppStateItem, url: string, index: number) {
    choose({ url: oakSourceUrl(url) }, (entry.titleBoutique || entry.titleRaw) + " · " + (index + 1),
      entry.status === "ACTIVE" ? { itemId: entry.id, url } : null);
  }
  function switchMode(next: StudioMode) {
    if (next === mode) return;
    setMode(next);
    setExportReady(null);
    setReviewed(false);
    setCompare(false);
    setError("");
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
    setPhotographResult(null);
    setPhotoProof(undefined);
    const p = await run<StudioPrepared>("Preparing with OpenAI…", () =>
      studioRequest("POST", { action: "prepare", source, maskDataUrl }),
    );
    if (p) {
      setPrepared(p);
      setRecipe(p.recipe);
      setRendered(null);
      if (mode === "manual") await render(p, p.recipe);
    }
  }
  async function photograph() {
    if (!source || !prepared || busy) return;
    setExportReady(null);
    setReviewed(false);
    setSavedNotice("");
    const result = await run<Rendered & { proof?: string }>("Photographing in the study…", () =>
      studioRender({
        action: "photograph",
        source,
        sourceSha256: prepared.analysis.sourceSha256,
        maskDataUrl: prepared.maskDataUrl,
        ...(listingPhoto ? { listing: listingPhoto } : {}),
      }),
    );
    if (result) {
      if (
        result.manifest.renderMode !== "source-matched-scene" ||
        result.manifest.sourceSha256 !== prepared.analysis.sourceSha256 ||
        result.manifest.maskSha256 !== prepared.analysis.maskSha256
      ) {
        setError(errors.AI_SCENE_INVALID);
        return;
      }
      setPhotographResult({ imageDataUrl: result.imageDataUrl, manifest: result.manifest });
      setPhotoProof(result.proof);
      setCompare(false);
    }
  }
  async function saveListingPhoto() {
    if (!listingPhoto || !photoProof || !reviewed || !current || mode !== "photograph") return;
    const saved = await run<{ ok: boolean }>("Saving reviewed gallery photo…", () =>
      studioRequest("POST", { action: "approve-photo", reviewed: true, proof: photoProof }),
    );
    if (saved?.ok && photographResult && prepared) {
      const { itemId, url } = listingPhoto;
      const photo = { url, tone: "original" as const, oak: {
        itemId, outputSha256: photographResult.manifest.outputSha256 as string,
        sourceSha256: prepared.analysis.sourceSha256,
      } };
      setItems(previous => previous.map(entry => entry.id === itemId ? {
        ...entry, oakPhotoReview: [...(entry.oakPhotoReview ?? []).filter(value => value.url !== url), photo],
      } : entry));
      setPhotoProof(undefined);
      setSavedPreview("");
      setSavedNotice("Photo approved and saved to the listing draft.");
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
    if (mode === "photograph") {
      if (!photographResult) return;
      // Export the exact reviewed response. Never repeat a paid scene request.
      setExportReady({
        imageDataUrl: photographResult.imageDataUrl,
        manifest: {
          ...photographResult.manifest,
          analysis: prepared.analysis,
          reviewedAt: new Date().toISOString(),
          maskDataUrl: prepared.maskDataUrl,
        },
      });
      return;
    }
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
          <p>The oak study, composed around your original watch photograph.</p>
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
              onChange={(e) => { setItemId(e.target.value); choose(null); }}
            >
              <option value="">Select a listing</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.titleBoutique || i.titleRaw || i.id}
                </option>
              ))}
            </select>
          </label>
          {item?.status === "ACTIVE" && <p className="studio-small" role="status">
            {item.oakPhotoReview?.length ?? 0} of {photos.length} Oak Study photos approved · <Link to="/admin/inventory">Back to inventory</Link>
          </p>}
          {photos.length > 0 && (
            <div className="studio-source-grid">
              {photos.map((url, i) => (
                <button
                  key={url + i}
                  disabled={!!busy}
                  className={
                    listingPhoto?.url === url || oakSourceUrl(sourceUrl) === oakSourceUrl(url)
                      ? "selected"
                      : ""
                  }
                  aria-label={"Use photograph " + (i + 1)}
                  onClick={() => { if (item) chooseInventoryPhoto(item, url, i); }}
                >
                  <img src={url} alt={"Source photograph " + (i + 1)} />
                  {item?.oakPhotoReview?.some(photo => photo.url === url) && <span>Approved</span>}
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
            intended angle. Higher-resolution inventory sources are used where
            available.
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
              {savedOak && <div className="studio-toolbar">
                <button disabled={!!busy} onClick={async () => {
                  if (savedPreview) return setSavedPreview("");
                  const preview = await run("Loading saved photo…", async () => readFile(await studioSavedPhoto(oakPhotoPath(savedOak))));
                  if (preview) setSavedPreview(preview);
                }}>{savedPreview ? "Hide saved Oak Study photo" : "View saved Oak Study photo"}</button>
                {savedPreview && <img className="studio-original" src={savedPreview} alt="Approved Oak Study gallery photograph" />}
              </div>}
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
          <div
            className="studio-mode-switch"
            role="group"
            aria-label="Studio workflow"
          >
            <button
              disabled={!!busy}
              aria-pressed={mode === "photograph"}
              onClick={() => switchMode("photograph")}
            >
              Studio photograph
            </button>
            <button
              disabled={!!busy}
              aria-pressed={mode === "manual"}
              onClick={() => switchMode("manual")}
            >
              Manual plates
            </button>
          </div>
          <div className="studio-stage-toolbar">
            <div>
              <span className="studio-kicker">02 / Compose</span>
              <h2>
                {mode === "photograph"
                  ? "A scene for this photograph"
                  : preset.name}
              </h2>
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
            className={
              "studio-stage " +
              (compare || (mode === "photograph" && !photographResult)
                ? "studio-compare"
                : "")
            }
            style={{
              aspectRatio:
                mode === "photograph"
                  ? photographResult
                    ? `${photographResult.manifest.width}/${photographResult.manifest.height}`
                    : prepared
                      ? `${prepared.analysis.width}/${prepared.analysis.height}`
                      : "4/5"
                  : recipe.format === "landscape"
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
                src={
                  activeResult?.imageDataUrl ||
                  (mode === "photograph" && sourceUrl
                    ? sourceUrl
                    : "/studio/" + preset.image)
                }
                alt={
                  activeResult
                    ? mode === "photograph"
                      ? "Generated oak study scene with the original watch photograph"
                      : "Manual watch composite in oak study"
                    : mode === "photograph" && source
                      ? "Original watch photograph awaiting a studio scene"
                      : "Empty oak study studio plate"
                }
              />
            )}{" "}
            {!source && !compare && (
              <div className="studio-empty">
                <span>YOUR WATCH. THIS SETTING.</span>
                <p>Choose a photograph to begin.</p>
              </div>
            )}
            {busy && (
              <div className="studio-progress" role="status">
                <span className="studio-spinner" />
                {busy}
                <small>This can take a few minutes. Keep this tab open.</small>
              </div>
            )}
            {mode === "manual" && rendered && !current && !busy && !compare && (
              <div className="studio-stale">
                Controls changed · Render to update
              </div>
            )}
          </div>
          <div className="studio-render-bar">
            <span>
              {activeResult
                ? `${activeResult.manifest.width} × ${activeResult.manifest.height} px · ${mode === "photograph" ? "Generated scene" : "Manual plate preview"}`
                : mode === "photograph"
                  ? "Original pose · studio environment"
                  : "Manual plate preview"}
              {current ? " · Ready to review" : ""}
            </span>
            <button
              className="studio-primary"
              disabled={
                !prepared ||
                !!busy ||
                (mode === "photograph" && aiConfigured === false)
              }
              onClick={() => (mode === "photograph" ? photograph() : render())}
            >
              {mode === "photograph"
                ? photographResult
                  ? "Create another scene"
                  : "Photograph in the study"
                : "Render manual preview"}
            </button>
          </div>
          {mode === "photograph" && (
            <p className="studio-small studio-scene-note">
              {prepared
                ? "The scene follows the watch's original pose, framing and lighting. "
                : "Choose a photograph and prepare its watch mask first. "}
              One AI scene request. Review before export. Downloading a reviewed
              result does not make another AI request.
            </p>
          )}
          {error && (
            <div className="studio-error" role="alert">
              {error}
            </div>
          )}
          {mode === "manual" && (
            <>
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
                reveal another side of the watch. The six 3D views share one
                set; their material finish is still a prototype.
              </p>
            </>
          )}
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
                {mode === "photograph"
                  ? "Prepare reviewed download"
                  : "Export PNG + recipe"}
              </button>
              {listingPhoto && mode === "photograph" && <button
                disabled={!photoProof || !reviewed || !current || !!busy}
                onClick={saveListingPhoto}>Approve and save to listing</button>}
              {savedNotice && <p className="studio-small" role="status">{savedNotice}</p>}
              {savedNotice && item && pendingPhoto >= 0 && <button disabled={!!busy}
                onClick={() => chooseInventoryPhoto(item, photos[pendingPhoto], pendingPhoto)}>
                Open next pending photo
              </button>}
              {exportReady && current && reviewed && (
                <span className="studio-downloads" role="status">
                  Export ready:{" "}
                  <a
                    href={exportReady.imageDataUrl}
                    download={exportName + ".png"}
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
                    download={
                      exportName +
                      (mode === "photograph"
                        ? "-metadata.json"
                        : "-recipe.json")
                    }
                  >
                    {mode === "photograph"
                      ? "Download metadata"
                      : "Download recipe"}
                  </a>
                </span>
              )}
              <button
                disabled={!prepared || !!busy}
                onClick={() =>
                  jsonDownload(
                    {
                      version: 1,
                      source,
                      sourceName,
                      prepared,
                      recipe,
                      mode,
                      photographResult,
                    },
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
                      const savedScene = v.photographResult;
                      if (
                        savedScene &&
                        typeof savedScene.imageDataUrl === "string" &&
                        /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(
                          savedScene.imageDataUrl,
                        ) &&
                        savedScene.manifest?.renderMode ===
                          "source-matched-scene" &&
                        savedScene.manifest.sourceSha256 ===
                          v.prepared.analysis.sourceSha256 &&
                        savedScene.manifest.maskSha256 ===
                          v.prepared.analysis.maskSha256 &&
                        Number.isFinite(savedScene.manifest.width) &&
                        savedScene.manifest.width > 0 &&
                        Number.isFinite(savedScene.manifest.height) &&
                        savedScene.manifest.height > 0
                      ) {
                        setPhotographResult(savedScene);
                      }
                      setMode(
                        v.mode === "manual" || v.mode === undefined
                          ? "manual"
                          : "photograph",
                      );
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
            <h2>Manual plate controls</h2>
          </div>
          {mode === "photograph" && (
            <div className="studio-scene-note">
              <p className="studio-small">
                Generated scenes use the source photograph's pose and lighting.
                These controls apply to manual plate previews.
              </p>
              <button disabled={!!busy} onClick={() => switchMode("manual")}>
                Open manual controls
              </button>
            </div>
          )}
          <fieldset
            hidden={mode !== "manual"}
            disabled={!!busy || mode !== "manual"}
          >
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
                setExportReady(null);
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
