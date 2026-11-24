# MVW Oak Study studio — preview v01

Open `/#/admin/studio` and sign in with the existing preview admin credentials. The Photo studio link is in the admin navigation. This branch adds an admin tool and authenticated API; it does not rewrite listing photos or save anything to the catalogue.

## Working flow

1. Choose an MVW listing and source photograph, or upload JPEG/PNG/WebP (up to 3 MiB).
2. Prepare with AI when configured, or use a transparent PNG/imported black-and-white mask. White keeps the original photograph; black removes it. Refine mask provides restore/erase brushes and undo.
3. Match a saved camera view to the source. Adjust placement, background exposure, warmth, directional falloff, extra softness, contact shadow and projected silhouette shadow. Render preview applies the controls.
4. Compare the original, check edges and watch condition, then acknowledge review. Export downloads a PNG and a JSON recipe including the mask and source/output hashes. Changing a control invalidates the review.
5. Save/open session retains the source, mask, analysis and controls locally in a JSON file. An uploaded source is embedded in that file. Treat it as the original photograph, not a public URL.

## AI status and limits

The MVW Gemini account returned HTTP 402 (prepaid credits depleted) during the live integration test on 24 November 2026. Therefore automatic preparation has NOT passed a live end-to-end quality check. Manual masks and transparent inputs work without an AI request.

`STUDIO_SEGMENTATION_MODEL` is an explicit experimental raster-mask adapter with no production default. The preview uses `gemini-2.5-flash` pending testing. Google's published deprecation date/rerouting is 1 December 2026; do not assume its replacement supports raster masks. Validate and replace the segmentation adapter before production. Invalid/missing raster masks fail visibly rather than turning into a rectangle. Gemini analyses camera/lighting/occlusion; its recommendation is not authentication or condition verification.

The renderer uses seven saved plates: the preferred photographic oak reference and six renders from the shared Blender set. The latter are material prototypes. Saved plates have baked focus, light and reflections; controls add background softness/exposure and approximate shadows. This is not a live Blender renderer, reconstructed watch geometry, physically accurate relighting, or a guarantee of seamless photographic integration. Original watch reflections remain. Choose compatible source lighting and pose; ask for a better source when the watch is held, cut off or obscured. Never invent unseen surfaces.

The product layer retains original RGB through masking, colour-profile normalization, uniform resizing and in-plane rotation. No perspective warp, dial reconstruction or generative watch repainting. This protects listing accuracy but limits how far a mismatched source can be harmonized.

## API contract

`GET /api/studio` returns presets and configuration status. `POST /api/studio` accepts JSON with `action: prepare | render | compose`. Authentication is an existing admin Bearer JWT or a server-only `MVW_STUDIO_SERVICE_KEY` of at least 32 characters. Never expose a service key in browser JavaScript or VITE variables.

```js
const response = await fetch(`${MVW_ORIGIN}/api/studio`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${STUDIO_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    action: "compose",
    source: { url: watch.imageUrls[0] },
    // Optional: maskDataUrl for a prepared/manual full-frame grayscale PNG.
    recipe: { preset: "oak-reference", format: "square", size: 1200 },
  }),
});
if (!response.ok) throw new Error((await response.json()).error);
const { imageDataUrl, manifest, analysis, maskDataUrl } = await response.json();
// Store as a review draft. No implicit catalogue publishing.
```

`prepare` returns `analysis`, `maskDataUrl`, `cutoutDataUrl` and `recipe`. `render` accepts the same source, its `sourceSha256`, mask and recipe and returns `imageDataUrl` plus `manifest`. `compose` prepares and renders in one request. Use serial calls for multiple source angles; each source needs its own mask. A recipe cannot synthesize a new watch angle.

For larger lossless outputs, call `render` with `responseFormat: "png"`. The response is raw `image/png`; `X-Studio-Manifest` contains URI-encoded JSON metadata. This is the browser's default render/export path. PNG responses are limited to 4.3 MB. JSON adds base64 overhead, so choose 960 px for one-call JSON composition or use prepare then binary render. Oversized outputs fail explicitly instead of silently compressing watch detail.

`source` is exactly one of `{url}` or `{dataUrl}`. URLs are HTTPS on `i.ebayimg.com`, the configured Supabase host, or explicit `STUDIO_IMAGE_HOSTS` entries. Redirects are rejected. Download bytes, decoded pixels and JSON body/response sizes are bounded. Uploads are not persisted. Exports require `export: true, reviewed: true`; this is an acknowledgement from the authenticated caller, not an approval signature or separate publishing authority.

Safe error codes include `UNAUTHORIZED`, `AI_CREDITS_DEPLETED`, `AI_NOT_CONFIGURED`, `SEGMENTATION_NOT_CONFIGURED`, `AI_MASK_NEEDS_REVIEW`, `SOURCE_CHANGED`, `MASK_NEEDS_REVIEW`, `WATCH_OUTSIDE_FRAME` and `EXPORT_TOO_LARGE`. Retry a smaller size for large outputs; do not automatically retry paid AI calls indefinitely.

## Development and deployment

`pnpm typecheck`, `pnpm test`, `pnpm build`. `node scripts/studio-dev.mjs` serves Vite and real studio/login/inventory APIs on loopback port 4175. Supply development auth and the preview Supabase environment. It refuses to start in production/Vercel. No secrets are committed.

Branch `codex/mvw-virtual-studio` is isolated from `codex/mvw-recovery`. Automatic Vercel Git deployment is disabled only for this branch so its preview environment can be configured before a manual CLI deployment. Preview must use `https://aognusoolndwhmcprter.supabase.co`, its service key, preview admin credentials and `CHECKOUT_ENABLED=false`. Do not inherit the project's global production database credentials. `vercel.json` includes the studio plates in the serverless function bundle.

References: [Google image understanding](https://aistudio.google.com/docs/image-understanding), [model deprecations](https://aistudio.google.com/docs/deprecations), [Sharp compositing](https://sharp.pixelplumbing.com/api-composite/).
