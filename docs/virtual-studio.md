# MVW Oak Study studio — OpenAI preview v04

Open `/#/admin/studio` and sign in with the existing preview admin credentials. The Photo studio link is in the admin navigation. This branch adds an admin tool and authenticated API; it does not rewrite listing photos or save anything to the catalogue.

## Working flow

1. Choose an MVW listing and source photograph, or upload JPEG/PNG/WebP (up to 3 MiB).
2. Prepare with OpenAI when configured, or use a transparent PNG/imported black-and-white mask. White keeps the original photograph; black removes it. Refine mask provides restore/erase brushes and undo.
3. Match a saved camera view to the source. Adjust placement, background exposure, warmth, directional falloff, extra softness, contact shadow, support angle and projected silhouette shadow. Render preview applies the controls.
4. Compare the original, check edges and watch condition, then acknowledge review. Export downloads a PNG and a JSON recipe including the mask and source/output hashes. Changing a control invalidates the review.
5. Save/open session retains the source, mask, analysis and controls locally in a JSON file. An uploaded source is embedded in that file. Treat it as the original photograph, not a public URL.

## AI status and limits

OpenAI is the only AI provider in this branch, for studio preparation and catalogue drafts. Set server-only `OPENAI_API_KEY` in this branch's Vercel Preview environment and redeploy. Never use a `VITE_` prefix or put the key in a saved session, browser request or source control. The studio configuration endpoint reports whether a key is present, not whether billing or model access has been verified. Existing credentials for other providers are unused by this code; the legacy SDK has been removed.

The default vision/text model is `gpt-6.2-sol` (`OPENAI_TEXT_MODEL`, optionally `OPENAI_STUDIO_ANALYSIS_MODEL`). Native server-side AI requests go only to `api.openai.com/v1/responses`, with bounded responses, strict structured output, `store: false`, and no automatic paid retries. Watch preparation does not call an image generator.

For an opaque photo, one vision request identifies the complete visible watch outline, genuine background holes, foreground/background seed points, source pose and lighting. Coordinates refer to the full, auto-oriented source image. A local OpenCV GrabCut pass refines the edge against the original photograph. The eroded interior is protected so a white dial or bright reflection is not removed merely because it resembles the background. Only the alpha mask changes: the cutout takes RGB directly from the normalized source. No watch RGB comes back from AI. Processing is capped at 1200 pixels along the working crop; the mask is mapped back to the exact full source frame. Malformed or unusable geometry fails with a safe error.

Automatic masks still need edge review, especially on low-contrast straps, reflective metal, bracelet gaps, or a busy background. Refine mask remains available. A hidden or cropped watch surface cannot be recovered without inventing it, so choose another source photograph. Transparent inputs and manual masks do not make an AI request. Assessment does not verify authenticity or condition.

Live validation on 24 November 2026 used a Cartier Santos 100 and a Baume & Mercier Clifton M0A10303 from the MVW inventory. The new source-coordinate pipeline completed successfully for both. Before resizing, 492,138 fully opaque Cartier pixels and 68,936 fully opaque Clifton pixels matched normalized source RGB exactly (zero changed colour channels). These counts describe those test masks, not an accuracy guarantee for every boundary. The Clifton source has only about 390 pixels of watch width and a reflection across its crystal; the example retains that real detail and does not upscale it.

ChatGPT and API billing are managed separately. An eligible subscription benefit can fund API usage without reducing normal ChatGPT or signed-in Codex allowances. The claim flow warns that accepting this benefit disables Codex access through the receiving organization's API keys, including purchased-credit usage; this does not affect the studio's Responses endpoint. Review current benefit terms when provisioning another account.

The renderer uses seven saved plates: the preferred photographic oak reference and six renders from the shared Blender set. The latter are material prototypes. Saved plates have baked focus, light and reflections; controls add background softness/exposure and approximate shadows. This is not a live Blender renderer, reconstructed watch geometry, physically accurate relighting, or a guarantee of seamless photographic integration. Original watch reflections remain. Choose compatible source lighting and pose; ask for a better source when the watch is held, cut off or obscured. Never invent unseen surfaces.

The cutout retains the normalized source RGB exactly. Subsequent uniform resizing and in-plane rotation resample those pixels normally. The default edge feather is zero to avoid carrying source-background colour into a halo; the segmentation mask already has a subpixel transition. Contact height and support angle align the shadow to the visible resting edge. No perspective warp, dial reconstruction or generative watch repainting. This protects listing accuracy but limits how far a mismatched source can be harmonized.

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

Safe error codes include `UNAUTHORIZED`, `AI_CREDITS_DEPLETED`, `AI_NOT_CONFIGURED`, `AI_ACCESS_DENIED`, `AI_MODEL_UNAVAILABLE`, `AI_RATE_LIMITED`, `AI_TIMEOUT`, `AI_RESPONSE_INVALID`, `AI_MASK_NEEDS_REVIEW`, `SOURCE_CHANGED`, `MASK_NEEDS_REVIEW`, `WATCH_OUTSIDE_FRAME` and `EXPORT_TOO_LARGE`. Provider access failures return 503 rather than an MVW authentication failure; rate limits return 429 and timeouts 504. Provider messages and keys are never returned. Retry a smaller size for large outputs; do not automatically retry paid AI calls indefinitely.

## Development and deployment

`pnpm typecheck`, `pnpm test`, `pnpm build`. `node scripts/studio-dev.mjs` serves Vite and real studio/login/inventory APIs on loopback port 4175. Supply development auth and the preview Supabase environment. It refuses to start in production/Vercel. No secrets are committed.

Branch `codex/mvw-virtual-studio` is isolated from `codex/mvw-recovery`. Automatic Git deployments are disabled only for this branch. Deploy the pushed commit through Vercel's create-deployment API with `gitSource: {type: "github", repoId: 1146858590, ref: "codex/mvw-virtual-studio", sha: "<pushed SHA>"}`. This resolves branch-specific preview variables. A bare CLI upload from this worktree did not apply those overrides; do not use that deployment path without independently validating its environment.

Preview must use `https://aognusoolndwhmcprter.supabase.co`, its service key, preview admin credentials and `CHECKOUT_ENABLED=false`. Do not inherit global production database credentials. `vercel.json` bundles studio plates with the serverless function. The verified preview is https://mvw-studio-preview.vercel.app/#/admin/studio, protected by Vercel authentication and MVW admin sign-in.

Validation: TypeScript and the production build pass. The full 157-test suite passed before the final conservative edge-cleanup addition; targeted segmentation checks cover that addition. Tests cover exclusive OpenAI routing, strict response handling, source-coordinate geometry, protected white dials, holes, invalid outlines, deterministic masking, unchanged original RGB, bounded processing, sloped contact shadows, feathered resizing, authentication and export review gates. The hosted opaque-photo preparation check exercises the actual OpenCV runtime. Live provider output is assessed separately from mocked regression tests.

References: [OpenCV GrabCut](https://docs.opencv.org/4.13.0/dd/dfc/tutorial_js_grabcut.html), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [ChatGPT and API billing](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform), [Sharp compositing](https://sharp.pixelplumbing.com/api-composite/).
