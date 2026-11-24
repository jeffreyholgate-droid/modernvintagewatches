import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { loadSource, pngUrl, digest } from "../api/_lib/studio/images.js";
import {
  preparePhotographCanvas,
  restorePhotographSource,
  photographWatch,
  measurePhotographAlignment,
  type PhotographCanvas,
} from "../api/_lib/studio/photograph.js";
import { editOpenAIEnvironment } from "../server/openai-image-client.js";

async function fixture(
  width = 760,
  height = 920,
  box = { left: 70, top: 260, width: 620, height: 500 },
) {
  const pixels = Buffer.alloc(width * height * 3, 255),
    alpha = Buffer.alloc(width * height);
  for (let y = box.top; y < box.top + box.height; y++)
    for (let x = box.left; x < box.left + box.width; x++) {
      const i = y * width + x;
      pixels[i * 3] = 45 + (x % 160);
      pixels[i * 3 + 1] = 30 + (y % 190);
      pixels[i * 3 + 2] = (x + y) % 255;
      alpha[i] = 255;
    }
  // A fractional matte edge must remain fractional after restoration.
  for (let y = box.top; y < box.top + box.height; y++)
    alpha[y * width + box.left - 1] = 64;
  const png = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const mask = await sharp(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  return {
    source: await loadSource({ dataUrl: pngUrl(png) }),
    mask,
    pixels,
    box,
  };
}
async function environment(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 17, g: 28, b: 39 } },
  })
    .png()
    .toBuffer();
}
async function matchingEnvironment(
  canvas: PhotographCanvas,
  padded = false,
  dx = 0,
  dy = 0,
) {
  const width = padded ? canvas.canvasWidth : canvas.width,
    height = padded ? canvas.canvasHeight : canvas.height;
  const raw = await sharp(await environment(width, height))
    .ensureAlpha()
    .raw()
    .toBuffer();
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++) {
      const i = y * canvas.width + x;
      if (!canvas.protectedPixels[i]) continue;
      const xx = x + dx + (padded ? canvas.left : 0),
        yy = y + dy + (padded ? canvas.top : 0);
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      canvas.sourceRGBA.copy(raw, (yy * width + xx) * 4, i * 4, i * 4 + 4);
    }
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}
function mockFetch(implementation: typeof fetch) {
  const previous = globalThis.fetch,
    key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-key";
  globalThis.fetch = implementation;
  return () => {
    globalThis.fetch = previous;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  };
}

test("offline restoration copies every protected RGB sample and avoids a broad source-background halo", async () => {
  const { source, mask, pixels, box } = await fixture();
  const canvas = await preparePhotographCanvas(source, mask);
  const result = await restorePhotographSource(
    source,
    mask,
    await matchingEnvironment(canvas),
  );
  const raw = await sharp(result.png).ensureAlpha().raw().toBuffer();
  let count = 0;
  for (let y = box.top; y < box.top + box.height; y++)
    for (let x = box.left; x < box.left + box.width; x++) {
      const i = y * source.width + x;
      assert.deepEqual(
        raw.subarray(i * 4, i * 4 + 3),
        pixels.subarray(i * 3, i * 3 + 3),
      );
      count++;
    }
  const outside = (400 * source.width + box.left - 5) * 4;
  assert.deepEqual(
    raw.subarray(outside, outside + 3),
    Buffer.from([17, 28, 39]),
  );
  const edge = (400 * source.width + box.left - 1) * 4;
  assert.deepEqual(
    raw.subarray(edge, edge + 3),
    Buffer.from(
      [17, 28, 39].map((value) => Math.round((255 * 64 + value * 191) / 255)),
    ),
  );
  assert.equal(result.manifest.protectedPixelCount, count);
  assert.equal(result.manifest.protectedRgbVerified, true);
  assert.equal(result.manifest.edgeBlend, true);
  assert.equal(result.manifest.productGenerated, false);
  assert.equal(result.manifest.backgroundGenerated, true);
  assert.equal(result.manifest.outputSha256, digest(result.png));
  assert.equal(result.manifest.sourceScale, 1);
  assert.equal(result.manifest.alignment.method, "exact-source-core");
});

test("API canvas pads small images without upscale and final photograph returns original frame", async () => {
  const { source, mask } = await fixture(700, 600, {
    left: 40,
    top: 100,
    width: 620,
    height: 400,
  });
  const canvas = await preparePhotographCanvas(source, mask);
  assert.equal(canvas.sourceScale, 1);
  assert.equal(canvas.canvasWidth % 16, 0);
  assert.equal(canvas.canvasHeight % 16, 0);
  assert.ok(canvas.canvasWidth * canvas.canvasHeight >= 655360);
  assert.equal(canvas.width, 700);
  assert.equal(canvas.height, 600);
  const editAlpha = await sharp(canvas.editMask)
    .extractChannel(3)
    .raw()
    .toBuffer();
  assert.equal(editAlpha[0], 0, "padding is editable");
  assert.equal(
    editAlpha[(canvas.top + 200) * canvas.canvasWidth + canvas.left + 200],
    255,
  );
  const result = await restorePhotographSource(
    source,
    mask,
    await matchingEnvironment(canvas, true),
  );
  assert.equal(result.manifest.width, 700);
  assert.equal(result.manifest.height, 600);
});

test("large sources downsample once and verify against the correspondingly scaled source", async () => {
  const { source, mask } = await fixture(1600, 1800, {
    left: 150,
    top: 450,
    width: 1300,
    height: 1000,
  });
  const canvas = await preparePhotographCanvas(source, mask);
  assert.equal(canvas.height, 1536);
  assert.ok(canvas.sourceScale < 1);
  const result = await restorePhotographSource(
    source,
    mask,
    await matchingEnvironment(canvas, true),
  );
  const output = await sharp(result.png).ensureAlpha().raw().toBuffer();
  let checked = 0;
  for (let i = 0; i < canvas.protectedPixels.length; i++)
    if (canvas.protectedPixels[i]) {
      assert.deepEqual(
        output.subarray(i * 4, i * 4 + 4),
        canvas.sourceRGBA.subarray(i * 4, i * 4 + 4),
      );
      checked++;
    }
  assert.equal(result.manifest.protectedPixelCount, checked);
});

test("explicit contact mask retains only the reviewed supporting patch", async () => {
  const { source, mask, box } = await fixture();
  const contactRaw = Buffer.alloc(source.width * source.height);
  for (let y = box.top + box.height; y < box.top + box.height + 10; y++)
    contactRaw.fill(255, y * source.width + 250, y * source.width + 400);
  for (let y = box.top + box.height + 10; y < box.top + box.height + 15; y++)
    contactRaw.fill(128, y * source.width + 250, y * source.width + 400);
  const contactMask = await sharp(contactRaw, {
    raw: { width: source.width, height: source.height, channels: 1 },
  })
    .png()
    .toBuffer();
  const canvas = await preparePhotographCanvas(source, mask, { contactMask });
  const result = await restorePhotographSource(
    source,
    mask,
    await matchingEnvironment(canvas),
    { contactMask },
  );
  const raw = await sharp(result.png).removeAlpha().raw().toBuffer();
  assert.deepEqual(
    raw.subarray(
      (765 * source.width + 300) * 3,
      (765 * source.width + 300) * 3 + 3,
    ),
    Buffer.from([255, 255, 255]),
  );
  const feather = (772 * source.width + 300) * 3;
  assert.deepEqual(
    raw.subarray(feather, feather + 3),
    Buffer.from(
      [17, 28, 39].map((value) => Math.round((255 * 128 + value * 127) / 255)),
    ),
  );
  assert.deepEqual(
    raw.subarray(
      (780 * source.width + 300) * 3,
      (780 * source.width + 300) * 3 + 3,
    ),
    Buffer.from([17, 28, 39]),
  );
});

test("too-small product and incompatible image geometry are rejected before publication", async () => {
  const small = await fixture(700, 600, {
    left: 100,
    top: 100,
    width: 380,
    height: 300,
  });
  await assert.rejects(
    preparePhotographCanvas(small.source, small.mask),
    /SOURCE_TOO_SMALL_FOR_HERO/,
  );
  const { source, mask } = await fixture();
  await assert.rejects(
    restorePhotographSource(source, mask, await environment(1024, 1024)),
    /PHOTOGRAPH_GEOMETRY_MISMATCH/,
  );
  await assert.rejects(
    preparePhotographCanvas(source, mask, { stylePreset: "arbitrary" as any }),
    /INVALID_PHOTOGRAPH_STYLE/,
  );
  await assert.rejects(
    preparePhotographCanvas(source, await environment(300, 300)),
    /INVALID_MASK/,
  );
});

test("alignment corrects only the generated environment for a well-supported small translation and rejects large drift", async () => {
  const original = await fixture();
  let seed = 42;
  const random = (max: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % max;
  };
  const shapes = Array.from({ length: 120 }, () => {
    const x = 100 + random(550),
      y = 290 + random(430),
      r = 4 + random(11);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="white" stroke="black" stroke-width="3"/><circle cx="${x + 2}" cy="${y - 2}" r="2" fill="black"/>`;
  }).join("");
  const detailed = await sharp(original.source.normalized)
    .composite([
      { input: Buffer.from(`<svg width="760" height="920">${shapes}</svg>`) },
    ])
    .png()
    .toBuffer();
  const source = await loadSource({ dataUrl: pngUrl(detailed) }),
    mask = original.mask;
  const canvas = await preparePhotographCanvas(source, mask);
  const moved = await matchingEnvironment(canvas, false, 12, -9);
  const alignment = await measurePhotographAlignment(canvas, moved);
  assert.equal(alignment.accepted, true);
  assert.equal(alignment.method, "orb-similarity");
  assert.ok(alignment.inliers >= 18);
  assert.ok(Math.abs(alignment.translationX - 12) < 0.5);
  assert.ok(Math.abs(alignment.translationY + 9) < 0.5);
  assert.ok(alignment.residualP90 <= 3);
  const restored = await restorePhotographSource(source, mask, moved);
  assert.equal(restored.manifest.alignment.environmentAligned, true);
  const output = await sharp(restored.png).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < canvas.protectedPixels.length; i++)
    if (canvas.protectedPixels[i])
      assert.deepEqual(
        output.subarray(i * 4, i * 4 + 4),
        canvas.sourceRGBA.subarray(i * 4, i * 4 + 4),
      );
  await assert.rejects(
    restorePhotographSource(
      source,
      mask,
      await matchingEnvironment(canvas, false, 80, 0),
    ),
    /AI_SCENE_ALIGNMENT/,
  );
  const fixedRaw = await sharp(await matchingEnvironment(canvas))
    .ensureAlpha()
    .raw()
    .toBuffer();
  const shiftedRaw = await sharp(
    await matchingEnvironment(canvas, false, 12, 0),
  )
    .ensureAlpha()
    .raw()
    .toBuffer();
  shiftedRaw.copy(
    fixedRaw,
    Math.floor(canvas.height / 2) * canvas.width * 4,
    Math.floor(canvas.height / 2) * canvas.width * 4,
  );
  const nonRigid = await sharp(fixedRaw, {
    raw: { width: canvas.width, height: canvas.height, channels: 4 },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    restorePhotographSource(source, mask, nonRigid),
    /AI_SCENE_ALIGNMENT/,
  );
  await assert.rejects(
    restorePhotographSource(
      source,
      mask,
      await environment(canvas.width, canvas.height),
    ),
    /AI_SCENE_ALIGNMENT/,
  );
});

test("environment generation makes one bounded multipart edit and restores the protected product", async () => {
  const { source, mask } = await fixture();
  let calls = 0;
  const restore = mockFetch(async (url, init) => {
    calls++;
    assert.equal(String(url), "https://api.openai.com/v1/images/edits");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    const form = init?.body as FormData;
    assert.equal(form.get("n"), "1");
    assert.equal(form.get("output_format"), "png");
    assert.equal(form.get("quality"), "high");
    assert.match(String(form.get("prompt")), /immutable/);
    assert.equal(form.getAll("image[]").length, 1);
    const file = form.get("mask") as File;
    const metadata = await sharp(
      Buffer.from(await file.arrayBuffer()),
    ).metadata();
    const [w, h] = String(form.get("size")).split("x").map(Number);
    assert.equal(metadata.width, w);
    assert.equal(metadata.height, h);
    const sourceFile = form.getAll("image[]")[0] as File;
    return new Response(
      JSON.stringify({
        data: [
          {
            b64_json: Buffer.from(await sourceFile.arrayBuffer()).toString(
              "base64",
            ),
          },
        ],
      }),
      { status: 200, headers: { "x-request-id": "req_test" } },
    );
  });
  try {
    const result = await photographWatch(source, mask, {
      stylePreset: "oak-study",
    });
    assert.equal(result.manifest.renderMode, "source-matched-scene");
    assert.equal(result.manifest.protectedRgbVerified, true);
    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test("image-edit transport sanitizes provider errors and never retries paid work", async () => {
  const input = {
    image: Buffer.alloc(1),
    mask: Buffer.alloc(1),
    prompt: "test",
    width: 1024,
    height: 1024,
  };
  for (const [status, code, expected] of [
    [429, "rate_limit", "AI_RATE_LIMITED"],
    [400, "insufficient_quota", "AI_CREDITS_DEPLETED"],
    [401, "invalid_api_key", "AI_ACCESS_DENIED"],
    [404, "model_not_found", "AI_MODEL_UNAVAILABLE"],
  ] as const) {
    let calls = 0;
    const restore = mockFetch(async () => {
      calls++;
      return new Response(
        JSON.stringify({
          error: { code, message: "sensitive provider detail" },
        }),
        { status },
      );
    });
    try {
      await assert.rejects(
        editOpenAIEnvironment(input),
        new RegExp(`^Error: ${expected}$`),
      );
      assert.equal(calls, 1);
    } finally {
      restore();
    }
  }
});
