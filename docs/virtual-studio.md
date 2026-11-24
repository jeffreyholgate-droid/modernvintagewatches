# MVW Oak Study studio — OpenAI preview v03

Open `/#/admin/studio` and sign in with the existing preview admin credentials. The Photo studio link is in the admin navigation. This branch adds an admin tool and authenticated API; it does not rewrite listing photos or save anything to the catalogue.

## Working flow

1. Choose an MVW listing and source photograph, or upload JPEG/PNG/WebP (up to 3 MiB).
2. Prepare with OpenAI when configured, or use a transparent PNG/imported black-and-white mask. White keeps the original photograph; black removes it. Refine mask provides restore/erase brushes and undo.
3. Match a saved camera view to the source. Adjust placement, background exposure, warmth, directional falloff, extra softness, contact shadow and projected silhouette shadow. Render preview applies the controls.
4. Compare the original, check edges and watch condition, then acknowledge review. Export downloads a PNG and a JSON recipe including the mask and source/output hashes. Changing a control invalidates the review.
5. Save/open session retains the source, mask, analysis and controls locally in a JSON file. An uploaded source is embedded in that file. Treat it as the original photograph, not a public URL.

## AI status and limits

OpenAI is the only AI provider in this branch, for studio preparation and catalogue drafts. Set server-only `OPENAI_API_KEY` in this branch's Vercel Preview environment and redeploy. Never use a `VITE_` prefix or put the key in a saved session, browser request or source control. The studio configuration endpoint reports whether a key is present, not whether billing or model access has been verified. Existing credentials for other providers are unused by this code; the legacy SDK has been removed.

The default text model is `gpt-6.2-sol` (`OPENAI_TEXT_MODEL`, optionally `OPENAI_STUDIO_ANALYSIS_MODEL`). The image model is `gpt-image-2.6-sunburst` (`OPENAI_IMAGE_MODEL`). Native server-side requests go only to `api.openai.com/v1/responses` and `/v1/images/edits`, with bounded responses and no automatic paid retries. Responses requests use strict structured output and `store: false`.

For an opaque photo, one vision assessment and one transparent image edit run concurrently. The edit's RGB is discarded: only its alpha channel becomes a candidate mask over the original photograph. The assessment suggests a saved camera plate and lighting direction. Input resizing and padding meet the image API's dimensions; output canvas size, alpha coverage and coarse RGB alignment are checked. This is an experimental image-edit isolation method, not guaranteed pixel-accurate segmentation. Incorrect mask edges or hidden parts still need manual review. Assessment does not verify authenticity or condition.

OpenAI access was configured and tested on 24 November 2026. The protected preview uses a restricted server-side key with Responses write access and Images request access. A live catalogue normalization request passed. Both the vision assessment and image edit for a real watch returned HTTP 200. The image edit moved/enlarged the watch, so the alignment guard correctly rejected it with `AI_MASK_NEEDS_REVIEW`; no finished composite was accepted or published. Automatic isolation still needs quality refinement. Do not relax the guard or use generated watch RGB to turn that test into a pass. Manual masks and transparent inputs work without any AI account.

ChatGPT and API billing are managed separately. An eligible subscription benefit can fund API usage without reducing normal ChatGPT or signed-in Codex allowances. The claim flow warns that accepting this benefit disables Codex access through the receiving organization's API keys, including purchased-credit usage; this does not affect the studio's Responses and Images endpoints. Review current benefit terms when provisioning another account.

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

Safe error codes include `UNAUTHORIZED`, `AI_CREDITS_DEPLETED`, `AI_NOT_CONFIGURED`, `AI_ACCESS_DENIED`, `AI_MODEL_UNAVAILABLE`, `AI_RATE_LIMITED`, `AI_TIMEOUT`, `AI_RESPONSE_INVALID`, `AI_MASK_NEEDS_REVIEW`, `SOURCE_CHANGED`, `MASK_NEEDS_REVIEW`, `WATCH_OUTSIDE_FRAME` and `EXPORT_TOO_LARGE`. Provider access failures return 503 rather than an MVW authentication failure; rate limits return 429 and timeouts 504. Provider messages and keys are never returned. Retry a smaller size for large outputs; do not automatically retry paid AI calls indefinitely.

## Development and deployment

`pnpm typecheck`, `pnpm test`, `pnpm build`. `node scripts/studio-dev.mjs` serves Vite and real studio/login/inventory APIs on loopback port 4175. Supply development auth and the preview Supabase environment. It refuses to start in production/Vercel. No secrets are committed.

Branch `codex/mvw-virtual-studio` is isolated from `codex/mvw-recovery`. Automatic Git deployments are disabled only for this branch. Deploy the pushed commit through Vercel's create-deployment API with `gitSource: {type: "github", repoId: 1146858590, ref: "codex/mvw-virtual-studio", sha: "<pushed SHA>"}`. This resolves branch-specific preview variables. A bare CLI upload from this worktree did not apply those overrides; do not use that deployment path without independently validating its environment.

Preview must use `https://aognusoolndwhmcprter.supabase.co`, its service key, preview admin credentials and `CHECKOUT_ENABLED=false`. Do not inherit global production database credentials. `vercel.json` bundles studio plates with the serverless function. The verified preview is https://mvw-studio-preview.vercel.app/#/admin/studio, protected by Vercel authentication and MVW admin sign-in.

Validation: the 152-test suite passed at migration, and all 10 targeted OpenAI tests plus TypeScript passed after adding the current `credit_balance_exhausted` billing error code. The hosted API reports OpenAI configured, renders a 1200 x 1200 PNG from a transparent fixture and rejects unauthenticated access. The live provider results are described above. The regression tests mock provider responses to check exclusive provider routing, strict response handling, quota/access failures, dimensions, candidate mask rejection and original RGB preservation. They do not demonstrate real provider image quality. Earlier browser checks covered inventory selection, transparent upload, preparation, 1200 px rendering, mask editor opening and review invalidation. The in-app browser blocks data-URL file downloads, so its download-to-disk UI could not be verified; export links and actual hosted PNG bytes were verified separately.

References: [OpenAI image generation and editing](https://developers.openai.com/api/docs/guides/image-generation), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [ChatGPT and API billing](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform), [Sharp compositing](https://sharp.pixelplumbing.com/api-composite/).
