import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { defaultRecipe, parseRecipe } from "../lib/virtual-studio.js";
import {
  allowedImageURL,
  loadSource,
  normalizeMask,
  cutoutFromMask,
  pngUrl,
} from "../api/_lib/studio/images.js";
import { prepareWatch } from "../api/_lib/studio/ai.js";
import { compositeWatch } from "../api/_lib/studio/render.js";
import handler from "../api/studio.js";
const width = 240,
  height = 180;
async function fixture() {
  const rgba = Buffer.alloc(width * height * 4),
    m = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      rgba[i * 4] = x;
      rgba[i * 4 + 1] = y;
      rgba[i * 4 + 2] = 123;
      rgba[i * 4 + 3] = 255;
      m[i] = x >= 50 && x < 190 && y >= 40 && y < 140 ? 255 : 0;
    }
  const png = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  const mask = await sharp(m, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  return { source: await loadSource({ dataUrl: pngUrl(png) }), mask, png };
}
function response() {
  return {
    statusCode: 0,
    body: null as any,
    setHeader() {},
    status(n: number) {
      this.statusCode = n;
      return this;
    },
    json(v: any) {
      this.body = v;
      return this;
    },
    end(v: string) {
      this.body = JSON.parse(v);
    },
  };
}
test("studio refuses unauthenticated requests before parsing/fetching images", async () => {
  const res = response();
  await handler(
    {
      method: "POST",
      headers: {},
      body: { source: { url: "https://127.0.0.1" } },
    },
    res,
  );
  assert.equal(res.statusCode, 401);
});
test("studio URL policy blocks private IPs, redirects via untrusted hosts, credentials and deceptive suffixes", () => {
  for (const url of [
    "http://i.ebayimg.com/a.jpg",
    "https://127.0.0.1/a",
    "https://i.ebayimg.com.evil.test/a",
    "https://user:pass@i.ebayimg.com/a",
    "https://i.ebayimg.com:8080/a",
    "file:///etc/passwd",
  ])
    assert.throws(() => allowedImageURL(url));
  assert.equal(
    allowedImageURL("https://i.ebayimg.com/images/g/test.jpg").hostname,
    "i.ebayimg.com",
  );
});
test("recipe rejects nonfinite values and invalid plates or versions", () => {
  for (const v of [
    { x: NaN },
    { x: Infinity },
    { scale: 2 },
    { size: 9999 },
    { preset: "../../secret" },
    { version: 2 },
    { shadowOpacity: -1 },
  ])
    assert.throws(() => parseRecipe(v));
  assert.deepEqual(parseRecipe({}), defaultRecipe);
});
test("masking retains every original RGB sample in the watch bounding box", async () => {
  const { source, mask } = await fixture(),
    cut = await cutoutFromMask(source, mask),
    raw = await sharp(cut.buffer).raw().toBuffer();
  assert.deepEqual(cut.box, { left: 50, top: 40, width: 140, height: 100 });
  for (let y = 0; y < 100; y++)
    for (let x = 0; x < 140; x++) {
      const i = (y * 140 + x) * 4;
      assert.deepEqual([...raw.subarray(i, i + 4)], [x + 50, y + 40, 123, 255]);
    }
});
test("empty and all-white masks cannot masquerade as extracted watches", async () => {
  for (const background of ["#000", "#fff"]) {
    const mask = await sharp({
      create: { width, height, channels: 3, background },
    })
      .png()
      .toBuffer();
    await assert.rejects(
      normalizeMask(mask, width, height),
      /MASK_NEEDS_REVIEW/,
    );
  }
});
test("manual prepare needs no AI account or external call", async () => {
  const { source, mask } = await fixture(),
    p = await prepareWatch(source, pngUrl(mask));
  assert.equal(p.analysis.method, "manual");
  assert.equal(p.analysis.sourceSha256, source.sha256);
  assert.equal(p.analysis.reviewRequired, true);
  assert.match(p.cutoutDataUrl, /^data:image\/png/);
});
test("transparent input works even when an AI key is configured and preserves edge alpha", async () => {
  const { png } = await fixture(),
    rgba = await sharp(png).raw().toBuffer();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      rgba[(y * width + x) * 4 + 3] =
        x >= 50 && x < 190 && y >= 40 && y < 140 ? (x === 50 ? 128 : 255) : 0;
    }
  const input = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
    source = await loadSource({ dataUrl: pngUrl(input) }),
    p = await prepareWatch(source),
    cut = await sharp(Buffer.from(p.cutoutDataUrl.split(",")[1], "base64"))
      .raw()
      .toBuffer();
  assert.equal(p.analysis.method, "source-alpha");
  assert.equal(cut[3], 128);
});
test("background controls change the scene while retaining product interior RGB", async () => {
  const { source, mask } = await fixture();
  const r = {
    ...defaultRecipe,
    size: 960 as const,
    edgeFeather: 0,
    shadowOpacity: 0,
    contactStrength: 0,
  };
  const a = await compositeWatch(source, mask, r),
    b = await compositeWatch(source, mask, {
      ...r,
      backgroundExposure: -0.8,
      warmth: 0.15,
      backgroundBlur: 3,
    });
  assert.notEqual(a.manifest.outputSha256, b.manifest.outputSha256);
  assert.equal(a.manifest.productGenerated, false);
  const region = {
    left: a.manifest.watchBox.left + 15,
    top: a.manifest.watchBox.top + 15,
    width: 110,
    height: 70,
  };
  assert.deepEqual(
    await sharp(a.png).extract(region).raw().toBuffer(),
    await sharp(b.png).extract(region).raw().toBuffer(),
  );
});
test("shadow affects background outside product silhouette", async () => {
  const { source, mask } = await fixture();
  const r = {
    ...defaultRecipe,
    size: 960 as const,
    edgeFeather: 0,
    shadowOpacity: 0,
    contactStrength: 0,
  };
  const a = await compositeWatch(source, mask, r),
    b = await compositeWatch(source, mask, {
      ...r,
      shadowOpacity: 0.6,
      contactStrength: 0.5,
      shadowLength: 100,
    });
  assert.notEqual(a.manifest.outputSha256, b.manifest.outputSha256);
});
test("render rejects watch extending beyond frame", async () => {
  const { source, mask } = await fixture();
  await assert.rejects(
    compositeWatch(source, mask, { ...defaultRecipe, size: 960, x: 0.01 }),
    /WATCH_OUTSIDE_FRAME/,
  );
});
test("service API verifies review and source hash before processing", async () => {
  const old = process.env.MVW_STUDIO_SERVICE_KEY;
  process.env.MVW_STUDIO_SERVICE_KEY = "test-service-key-32-characters-minimum";
  try {
    const { png, mask } = await fixture();
    const req = {
      method: "POST",
      headers: {
        authorization: "Bearer " + process.env.MVW_STUDIO_SERVICE_KEY,
      },
      body: {
        action: "render",
        source: { dataUrl: pngUrl(png) },
        sourceSha256: "wrong",
        maskDataUrl: pngUrl(mask),
        recipe: { size: 960 },
      },
    };
    let res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "SOURCE_CHANGED");
    res = response();
    await handler({ ...req, body: { ...req.body, export: true } }, res);
    assert.equal(res.body.error, "REVIEW_REQUIRED");
    res = response();
    await handler({ ...req, body: null }, res);
    assert.equal(res.statusCode, 400);
  } finally {
    if (old === undefined) delete process.env.MVW_STUDIO_SERVICE_KEY;
    else process.env.MVW_STUDIO_SERVICE_KEY = old;
  }
});
