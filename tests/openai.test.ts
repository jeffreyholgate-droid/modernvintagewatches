import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  structuredOpenAI,
  isolateWithOpenAI,
  openAIConfigured,
} from "../server/openai-client.js";
import { OpenAIService } from "../server/openai.js";
import {
  isolationCanvas,
  maskFromOpenAI,
  prepareWatch,
} from "../api/_lib/studio/ai.js";
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
async function candidate(
  canvas: Awaited<ReturnType<typeof isolationCanvas>>,
  delta = 0,
) {
  const { data, info } = await sharp(canvas.image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      data[i + 3] =
        x > info.width * 0.25 &&
        x < info.width * 0.75 &&
        y > info.height * 0.25 &&
        y < info.height * 0.75
          ? 255
          : 0;
      for (let c = 0; c < 3; c++)
        data[i + c] = Math.min(255, data[i + c] + delta);
    }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
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
test("OpenAI image editing requests one transparent PNG and validates its response", async (t) => {
  env(t, {
    OPENAI_API_KEY: "test-key",
    OPENAI_IMAGE_MODEL: "gpt-image-2.6-sunburst",
  });
  const png = (await fixture()).normalized;
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    assert.equal(url, "https://api.openai.com/v1/images/edits");
    assert.equal(init.redirect, "error");
    const form = init.body as FormData;
    assert.equal(form.get("background"), "transparent");
    assert.equal(form.get("output_format"), "png");
    assert.equal(form.get("size"), "1024x1024");
    assert.equal(form.get("n"), "1");
    assert.equal(form.get("complexity"), "low");
    assert.ok(form.get("image") instanceof Blob);
    assert.equal(init.headers["Content-Type"], undefined);
    return jsonResponse({ data: [{ b64_json: png.toString("base64") }] });
  });
  assert.deepEqual(await isolateWithOpenAI(png, 1024, 1024), png);
});
test("image canvases preserve source aspect with API-compliant padding at extreme ratios", async () => {
  for (const [width, height] of [
    [301, 100],
    [300, 100],
    [100, 300],
    [107, 319],
    [180, 240],
    [4000, 2000],
  ]) {
    const source = await fixture(width, height);
    if (width / height > 3) {
      await assert.rejects(isolationCanvas(source), /AI_MASK_NEEDS_REVIEW/);
      continue;
    }
    const c = await isolationCanvas(source);
    assert.equal(c.canvasWidth % 16, 0);
    assert.equal(c.canvasHeight % 16, 0);
    assert.ok(
      c.canvasWidth / c.canvasHeight <= 3 &&
        c.canvasHeight / c.canvasWidth <= 3,
    );
    assert.ok(
      c.canvasWidth * c.canvasHeight >= 655360 &&
        c.canvasWidth * c.canvasHeight <= 8294400,
    );
    assert.ok(Math.abs(c.width / c.height - width / height) < 0.01);
  }
});
test("AI preparation discards generated RGB and uses the original photograph under the candidate alpha", async (t) => {
  env(t, {
    OPENAI_API_KEY: "test-key",
    OPENAI_TEXT_MODEL: "test-text",
    OPENAI_STUDIO_ANALYSIS_MODEL: undefined,
    OPENAI_IMAGE_MODEL: "gpt-image-2.6-sunburst",
  });
  const source = await fixture(),
    canvas = await isolationCanvas(source),
    edited = await candidate(canvas, 20),
    calls: string[] = [];
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
  };
  t.mock.method(globalThis, "fetch", async (url: any) => {
    calls.push(String(url));
    return String(url).endsWith("/responses")
      ? jsonResponse(completed(assessment))
      : jsonResponse({ data: [{ b64_json: edited.toString("base64") }] });
  });
  const result = await prepareWatch(source);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.startsWith("https://api.openai.com/v1/")));
  assert.equal(result.analysis.provider, "openai");
  assert.equal(result.analysis.maskMethod, "image-edit-alpha");
  assert.equal(result.analysis.reviewRequired, true);
  const { data, info } = await sharp(decodeImageData(result.cutoutDataUrl))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const middle =
    (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
  assert.deepEqual([...data.subarray(middle, middle + 4)], [80, 120, 160, 255]);
});
test("AI mask guard rejects altered, opaque or differently sized image results", async () => {
  const source = await fixture(),
    canvas = await isolationCanvas(source);
  await assert.rejects(
    maskFromOpenAI(source, canvas, await candidate(canvas, 100)),
    /AI_MASK_NEEDS_REVIEW/,
  );
  await assert.rejects(
    maskFromOpenAI(source, canvas, canvas.image),
    /AI_MASK_INVALID/,
  );
  await assert.rejects(
    maskFromOpenAI(
      source,
      canvas,
      await sharp(canvas.image).ensureAlpha().png().toBuffer(),
    ),
    /MASK_NEEDS_REVIEW/,
  );
  await assert.rejects(
    maskFromOpenAI(
      source,
      canvas,
      await sharp(canvas.image).resize(512, 512).ensureAlpha().png().toBuffer(),
    ),
    /AI_MASK_INVALID/,
  );
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
