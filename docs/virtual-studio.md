# MVW Oak Study studio — source-matched photography preview v05

Open `/#/admin/studio` and sign in with the existing preview admin credentials. The Photo studio link is in the admin navigation. This branch adds an admin tool and authenticated API; it does not rewrite listing photos or save anything to the catalogue.

## Working flow

1. Select an MVW photograph or upload the original JPEG/PNG/WebP. Eligible eBay thumbnails are upgraded to the same image's 1600px source. The watch must occupy at least 600px along its long side and 350px along its short side after any downsampling. A tiny product crop cannot become a detailed hero photograph.
2. Use Prepare with OpenAI to create a source-coordinate mask and assessment. Refine mask if needed, especially blurred straps, reflective edges, and real openings. This makes one Responses API request for opaque images; manual masks and transparent inputs bypass it.
3. Photograph mode is primary. Explicitly click Photograph in the study to make one Images Edits request. The environment is built around the original camera, pose and supporting surface. The server masks the product, checks generated-image alignment, then restores protected source RGB. It never uses generated watch RGB in the protected core.
4. Review the source beside the result, including dial, hands, wear, silhouette, real support geometry and shadows. Review remains required even when pixel and alignment checks pass. Export the returned PNG and manifest; exporting does not make another paid request.
5. Save/Open session retains the original, mask, completed scene and provenance locally. A reopened scene needs fresh review, but no regeneration. A new source or mask invalidates the scene; switching modes invalidates review.

Manual plates remain a separate mode for compatible sources. Their placement, rotation, background exposure/warmth/focus and contact/cast shadow controls apply only to those fixed plates. A generated photograph is a complete image; those manual controls do not silently change it. A fresh generated scene requires another explicit request.

## Approved direction and accuracy

The user rejected the v04 Clifton composite: exact retained RGB did not overcome its soft 390px product crop, incompatible studio lighting/perspective, weak contact and rough mask boundary. That image is not the visual benchmark.

On 24 November 2026, the user approved a close Breitling B09 scene created by editing the environment around its original resting pose. The approved creative reference was generated with the built-in image tool. The app's API implementation is a separate workflow, with mask review, source restoration and geometry checks. The approved reference alone does not prove untouched watch pixels. `public/studio/study-atmosphere-approved.jpg` contains only the approved distant background, with no watch or competing desk geometry.

OpenAI is the only external AI provider. Set server-only `OPENAI_API_KEY`; never expose it in VITE variables, browser JavaScript or sessions. Vision defaults to `gpt-6.2-sol` (`OPENAI_TEXT_MODEL` or `OPENAI_STUDIO_ANALYSIS_MODEL`). Environment editing defaults to `gpt-image-2.6-sunburst` (`OPENAI_STUDIO_SCENE_MODEL`). The key needs Responses write and Images request access. One preparation plus one photograph uses two explicit AI requests; downloads and session reopening use none. Calls have bounded responses, timeouts and no automatic paid retries.

Vision returns a full-source outline, real holes and foreground/background points. Local OpenCV GrabCut refines the edge and protects the dial/interior. Masks are not guaranteed correct: soft boundaries and source-colored material can still need manual refinement. Hidden surfaces and cropped strap ends must not be reconstructed.

The scene request retains source framing, pads to valid image-API dimensions and never enlarges the watch. Sources longer than 1536px are uniformly downsampled once; the manifest records this scale. After generation, feature alignment checks compare watch geometry. Only small, strongly supported global movement may be corrected by transforming the generated surroundings; the original product is not warped. Large, unsupported or nonrigid movement is rejected. The final source frame is cropped from any padding.

Every fully protected source pixel is restored and checked by decoding the final PNG. Soft mask boundaries remain alpha blends, avoiding opaque background halos. The manifest records the protected-pixel count, source/mask/output hashes, alignment evidence, source scale, `backgroundGenerated:true`, `productGenerated:false` and `reviewRequired:true`. These checks establish protected pixel preservation and supported registration, not automatic photographic quality. Inspect case/strap contact, mask leakage, reflections and background realism before use. An explicitly reviewed support mask is available to server callers; the public action does not infer one from the watch silhouette.

The six 3D plates remain material prototypes. The user-approved approach adapts the environment to a real source angle; it cannot create an unseen side of the actual watch.

## API contract

`GET /api/studio` returns presets and configuration status. `POST /api/studio` accepts JSON with `action: prepare | photograph | render | compose`. Authentication is an existing admin Bearer JWT or a server-only `MVW_STUDIO_SERVICE_KEY` of at least 32 characters. Never expose a service key in browser JavaScript or VITE variables.

```js
const response = await fetch(`${MVW_ORIGIN}/api/studio`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${STUDIO_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    action: "photograph",
    source: { url: watch.imageUrls[0] },
    sourceSha256: prepared.analysis.sourceSha256,
    maskDataUrl: prepared.maskDataUrl,
    responseFormat: "png",
  }),
});
if (!response.ok) throw new Error((await response.json()).error);
const png = await response.arrayBuffer();
const manifest = JSON.parse(decodeURIComponent(response.headers.get("X-Studio-Manifest")));
// Store as a review draft. No implicit catalogue publishing.
```

`prepare` returns `analysis`, `maskDataUrl`, `cutoutDataUrl` and `recipe`. `photograph` requires the matching source hash and a full-source PNG mask, then returns a generated environment with restored watch pixels. Use `responseFormat:"png"`; the manifest preserves the supplied mask identity for client review checks. `render` accepts the same source, its `sourceSha256`, mask and recipe and returns `imageDataUrl` plus `manifest`. `compose` prepares and renders in one request. Use serial calls for multiple source angles; each source needs its own mask. A recipe cannot synthesize a new watch angle.

For larger lossless outputs, call `render` with `responseFormat: "png"`. The response is raw `image/png`; `X-Studio-Manifest` contains URI-encoded JSON metadata. This is the browser's default render/export path. PNG responses are limited to 4.3 MB. JSON adds base64 overhead, so choose 960 px for one-call JSON composition or use prepare then binary render. Oversized outputs fail explicitly instead of silently compressing watch detail.

`source` is exactly one of `{url}` or `{dataUrl}`. URLs are HTTPS on `i.ebayimg.com`, the configured Supabase host, or explicit `STUDIO_IMAGE_HOSTS` entries. Redirects are rejected. Download bytes, decoded pixels and JSON body/response sizes are bounded. Uploads are not persisted. Exports require `export: true, reviewed: true`; this is an acknowledgement from the authenticated caller, not an approval signature or separate publishing authority.

Safe error codes include `UNAUTHORIZED`, `AI_CREDITS_DEPLETED`, `AI_NOT_CONFIGURED`, `AI_ACCESS_DENIED`, `AI_MODEL_UNAVAILABLE`, `AI_RATE_LIMITED`, `AI_TIMEOUT`, `AI_RESPONSE_INVALID`, `AI_MASK_NEEDS_REVIEW`, `SOURCE_CHANGED`, `MASK_NEEDS_REVIEW`, `WATCH_OUTSIDE_FRAME` and `EXPORT_TOO_LARGE`. Provider access failures return 503 rather than an MVW authentication failure; rate limits return 429 and timeouts 504. Provider messages and keys are never returned. Retry a smaller size for large outputs; do not automatically retry paid AI calls indefinitely.

## Development and deployment

`pnpm typecheck`, `pnpm test`, `pnpm build`. `node scripts/studio-dev.mjs` serves Vite and real studio/login/inventory APIs on loopback port 4175. Supply development auth and the preview Supabase environment. It refuses to start in production/Vercel. No secrets are committed.

Branch `codex/mvw-virtual-studio` is isolated from `codex/mvw-recovery`. Automatic Git deployments are disabled only for this branch. Deploy the pushed commit through Vercel's create-deployment API with `gitSource: {type: "github", repoId: 1146858590, ref: "codex/mvw-virtual-studio", sha: "<pushed SHA>"}`. This resolves branch-specific preview variables. A bare CLI upload from this worktree did not apply those overrides; do not use that deployment path without independently validating its environment.

Preview must use `https://aognusoolndwhmcprter.supabase.co`, its service key, preview admin credentials and `CHECKOUT_ENABLED=false`. Do not inherit global production database credentials. `vercel.json` bundles studio plates with the serverless function. The verified preview is https://mvw-studio-preview.vercel.app/#/admin/studio, protected by Vercel authentication and MVW admin sign-in.

Validation for v05 includes source-restoration, alignment, masked API transport, no-retry billing behavior, source/mask identity and authentication checks in addition to the existing regression suite. The local real-photo test exercises the actual Images API; hosted and browser checks are recorded in the release guide. Tests cover exclusive OpenAI routing, strict response handling, source-coordinate geometry, protected white dials, holes, invalid outlines, deterministic masking, unchanged original RGB, bounded processing, sloped contact shadows, feathered resizing, authentication and export review gates. The hosted opaque-photo preparation check exercises the actual OpenCV runtime. Live provider output is assessed separately from mocked regression tests.

References: [OpenCV GrabCut](https://docs.opencv.org/4.13.0/dd/dfc/tutorial_js_grabcut.html), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [ChatGPT and API billing](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform), [Sharp compositing](https://sharp.pixelplumbing.com/api-composite/).
