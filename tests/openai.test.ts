import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { structuredOpenAI, openAIConfigured } from "../server/openai-client.js";
import { OpenAIService } from "../server/openai.js";
import { analysisImage, prepareWatch } from "../api/_lib/studio/ai.js";
import {
  loadSource,
  pngUrl,
  decodeImageData,
} from "../api/_lib/studio/images.js";
import handler from "../api/studio.js";
import { Category } from "../types.js";

const schema = {
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
};
const completed = (value: unknown) => ({
  status: "completed",
  output: [
    {
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(value) }],
    },
  ],
});
function env(t: any, values: Record<string, string | undefined>) {
  const old = Object.fromEntries(
    Object.keys(values).map((k) => [k, process.env[k]]),
  );
  for (const [k, v] of Object.entries(values))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  t.after(() => {
    for (const [k, v] of Object.entries(old))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });
}
function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
async function fixture(width = 240, height = 180) {
  return loadSource({
    dataUrl: pngUrl(
      await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 80, g: 120, b: 160 },
        },
      })
        .png()
        .toBuffer(),
    ),
  });
}
test("OpenAI requires its own key and never falls back to a legacy provider", async (t) => {
  env(t, {
    OPENAI_API_KEY: undefined,
    GEMINI_API_KEY: "unused-legacy-key",
    API_KEY: "unused-generic-key",
  });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    throw Error("must not call");
  });
  assert.equal(openAIConfigured(), false);
  await assert.rejects(
    structuredOpenAI("test", schema, "test", "test"),
    /^Error: AI_NOT_CONFIGURED$/,
  );
  await assert.rejects(
    prepareWatch(await fixture()),
    /^Error: AI_NOT_CONFIGURED$/,
  );
  assert.equal(requests, 0);
});
test("structured output uses only OpenAI Responses with server key, strict schema and storage disabled", async (t) => {
  env(t, { OPENAI_API_KEY: "test-key", OPENAI_TEXT_MODEL: "test-text-model" });
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, "Bearer test-key");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "test-text-model");
    assert.equal(body.store, false);
    assert.deepEqual(body.text.format, {
      type: "json_schema",
      name: "test",
      strict: true,
      schema,
    });
    return jsonResponse(completed({ value: "ok" }));
  });
  assert.deepEqual(await structuredOpenAI("test", schema, "test", "test"), {
    value: "ok",
  });
});
test("provider failures are sanitised and never retried automatically", async (t) => {
  env(t, { OPENAI_API_KEY: "test-key" });
  for (const [status, code, expected] of [
    [429, "insufficient_quota", "AI_CREDITS_DEPLETED"],
    [429, "credit_balance_exhausted", "AI_CREDITS_DEPLETED"],
    [429, "rate_limit_exceeded", "AI_RATE_LIMITED"],
    [401, "invalid_api_key", "AI_ACCESS_DENIED"],
    [404, "model_not_found", "AI_MODEL_UNAVAILABLE"],
    [500, "server_error", "AI_SERVICE_UNAVAILABLE"],
  ] as const) {
    let requests = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => {
      requests++;
      return jsonResponse(
        { error: { code, message: "private-provider-sentinel" } },
        status,
      );
    });
    await assert.rejects(structuredOpenAI("test", schema, "test", "test"), {
      message: expected,
    });
    assert.equal(requests, 1);
    mock.mock.restore();
  }
});
test("incomplete, refused and oversized responses cannot become successful results", async (t) => {
  env(t, { OPENAI_API_KEY: "test-key" });
  for (const [response, expected] of [
    [jsonResponse({ status: "incomplete", output: [] }), "AI_RESPONSE_INVALID"],
    [
      jsonResponse({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "sentinel" }],
          },
        ],
      }),
      "AI_RESPONSE_REFUSED",
    ],
    [
      new Response("{}", {
        headers: { "content-length": String(33 * 1024 * 1024) },
      }),
      "AI_RESPONSE_INVALID",
    ],
  ] as const) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(structuredOpenAI("test", schema, "test", "test"), {
      message: expected,
    });
    mock.mock.restore();
  }
});
test("vision input preserves source coordinates without padding or enlargement", async () => {
  for (const [width, height] of [
    [301, 100],
    [100, 300],
    [180, 240],
    [4000, 2000],
  ]) {
    const input = await analysisImage(await fixture(width, height));
    const meta = await sharp(input).metadata();
    assert.ok(Math.abs(meta.width! / meta.height! - width / height) < 0.01);
    assert.ok(meta.width! <= Math.min(width, 1536));
    assert.ok(meta.height! <= Math.min(height, 1536));
  }
});
test("AI preparation requests geometry once and masks only original source RGB", async (t) => {
  env(t, {
    OPENAI_API_KEY: "test-key",
    OPENAI_TEXT_MODEL: "test-text",
    OPENAI_STUDIO_ANALYSIS_MODEL: undefined,
  });
  const width = 240,
    height = 180,
    pixels = Buffer.alloc(width * height * 3, 255);
  // Include white dial detail inside a dark case. It must remain opaque.
  for (let y = 40; y < 140; y++)
    for (let x = 70; x < 170; x++) {
      const i = (y * width + x) * 3;
      pixels[i] = 80;
      pixels[i + 1] = 120;
      pixels[i + 2] = 160;
      if (x > 100 && x < 140 && y > 70 && y < 110) pixels.fill(255, i, i + 3);
    }
  const source = await loadSource({
    dataUrl: pngUrl(
      await sharp(pixels, { raw: { width, height, channels: 3 } })
        .png()
        .toBuffer(),
    ),
  });
  const calls: string[] = [];
  const assessment = {
    view: "three-quarter",
    confidence: 0.8,
    recommendedPreset: "oak-reference",
    lightAngle: 225,
    occluded: false,
    cutOff: false,
    multipleWatches: false,
    issues: [],
    rationale: "Compatible source.",
    segmentation: {
      outline: [
        { x: 0.29, y: 0.22 },
        { x: 0.71, y: 0.22 },
        { x: 0.71, y: 0.78 },
        { x: 0.29, y: 0.78 },
      ],
      holes: [],
      foregroundPoints: [
        { x: 0.35, y: 0.4 },
        { x: 0.5, y: 0.5 },
        { x: 0.6, y: 0.6 },
      ],
      backgroundPoints: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
      ],
    },
  };
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    calls.push(String(url));
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body);
    assert.ok(body.max_output_tokens >= 5000);
    return jsonResponse(completed(assessment));
  });
  const result = await prepareWatch(source);
  assert.equal(calls.length, 1);
  assert.equal(result.analysis.provider, "openai");
  assert.equal(result.analysis.maskMethod, "source-coordinate-grabcut");
  assert.equal(result.analysis.reviewRequired, true);
  const mask = await sharp(decodeImageData(result.maskDataUrl))
    .greyscale()
    .raw()
    .toBuffer();
  assert.equal(
    mask[90 * width + 120],
    255,
    "white dial must not become a hole",
  );
  assert.equal(mask[0], 0, "external white background must be removed");
  const { cutoutFromMask } = await import("../api/_lib/studio/images.js");
  const cutout = await cutoutFromMask(
    source,
    decodeImageData(result.maskDataUrl),
  );
  const rgba = await sharp(cutout.buffer).raw().toBuffer();
  for (let y = 0; y < cutout.box.height; y++)
    for (let x = 0; x < cutout.box.width; x++) {
      const i = (y * cutout.box.width + x) * 4,
        j = ((y + cutout.box.top) * width + x + cutout.box.left) * 3;
      assert.deepEqual(
        [...rgba.subarray(i, i + 3)],
        [...pixels.subarray(j, j + 3)],
      );
    }
});
test("listing normalization cannot promote an AI authenticity guarantee", async (t) => {
  env(t, { OPENAI_API_KEY: "test-key" });
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(
      completed({
        brand: "Omega",
        model: "Seamaster",
        reference: "",
        year: "",
        material: "",
        condition: "Scratched bezel",
        authenticityGuaranteed: true,
      }),
    ),
  );
  const result = await new OpenAIService().normalizeListing(
    Category.WATCH,
    "Omega Seamaster",
    "Scratched bezel",
  );
  assert.equal(result.authenticityGuaranteed, false);
  assert.equal(result.condition, "Scratched bezel");
});
test("studio reports only OpenAI configuration and missing key fails without logging the user out", async (t) => {
  env(t, {
    OPENAI_API_KEY: undefined,
    MVW_STUDIO_SERVICE_KEY: "test-service-key-at-least-32-characters",
  });
  const req = {
    method: "GET",
    headers: { authorization: "Bearer " + process.env.MVW_STUDIO_SERVICE_KEY },
  };
  const res = {
    statusCode: 0,
    body: null as any,
    setHeader() {},
    end(value: string) {
      this.body = JSON.parse(value);
    },
  };
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.aiProvider, "openai");
  assert.equal(res.body.aiConfigured, false);
  await handler(
    {
      ...req,
      method: "POST",
      body: {
        action: "prepare",
        source: { dataUrl: pngUrl((await fixture()).normalized) },
      },
    },
    res,
  );
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "AI_NOT_CONFIGURED");
});
