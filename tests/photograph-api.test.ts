import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import handler from "../api/studio.js";
import { loadSource, pngUrl, digest } from "../api/_lib/studio/images.js";
function response() {
  return {
    statusCode: 0,
    body: null as any,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    end(v: any) {
      this.body = Buffer.isBuffer(v) ? v : JSON.parse(v);
    },
  };
}
test("photograph API authenticates and checks source identity before paid requests", async (t) => {
  const old = process.env.MVW_STUDIO_SERVICE_KEY;
  process.env.MVW_STUDIO_SERVICE_KEY =
    "studio-test-service-key-long-enough-123";
  t.after(() => {
    if (old === undefined) delete process.env.MVW_STUDIO_SERVICE_KEY;
    else process.env.MVW_STUDIO_SERVICE_KEY = old;
  });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    throw Error("must not call");
  });
  const image = await sharp({
    create: { width: 200, height: 200, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const input = {
    action: "photograph",
    source: { dataUrl: pngUrl(image) },
    sourceSha256: "wrong",
    maskDataUrl: pngUrl(image),
  };
  const res = response();
  await handler({ method: "POST", headers: {}, body: input }, res);
  assert.equal(res.statusCode, 401);
  await handler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + process.env.MVW_STUDIO_SERVICE_KEY,
      },
      body: input,
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "SOURCE_CHANGED");
  assert.equal(requests, 0);
});
test("photograph API returns reviewed-source mask identity without a second generation", async (t) => {
  const old = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    MVW_STUDIO_SERVICE_KEY: process.env.MVW_STUDIO_SERVICE_KEY,
  };
  process.env.OPENAI_API_KEY = "test-only-key";
  process.env.MVW_STUDIO_SERVICE_KEY =
    "studio-test-service-key-long-enough-123";
  t.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const width = 1024,
    height = 1024;
  const image = await sharp({
    create: { width, height, channels: 3, background: "#a58a68" },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 700,
            height: 500,
            channels: 3,
            background: "#3f4958",
          },
        })
          .png()
          .toBuffer(),
        left: 162,
        top: 262,
      },
    ])
    .png()
    .toBuffer();
  const mask = await sharp({
    create: { width, height, channels: 3, background: "black" },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 700, height: 500, channels: 3, background: "white" },
        })
          .png()
          .toBuffer(),
        left: 162,
        top: 262,
      },
    ])
    .greyscale()
    .toColourspace("b-w")
    .png()
    .toBuffer();
  const source = await loadSource({ dataUrl: pngUrl(image) });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url: any, options: any) => {
    requests++;
    assert.equal(url, "https://api.openai.com/v1/images/edits");
    const input = (options.body as FormData).getAll("image[]")[0] as Blob;
    return new Response(
      JSON.stringify({
        data: [
          {
            b64_json: Buffer.from(await input.arrayBuffer()).toString("base64"),
          },
        ],
      }),
      { status: 200 },
    );
  });
  const res = response();
  await handler(
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + process.env.MVW_STUDIO_SERVICE_KEY,
      },
      body: {
        action: "photograph",
        source: { dataUrl: pngUrl(image) },
        sourceSha256: source.sha256,
        maskDataUrl: pngUrl(mask),
        responseFormat: "png",
      },
    },
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(requests, 1);
  assert.ok(Buffer.isBuffer(res.body));
  const m = JSON.parse(decodeURIComponent(res.headers["X-Studio-Manifest"]));
  assert.equal(m.sourceSha256, source.sha256);
  assert.equal(m.maskSha256, digest(mask));
  assert.equal(m.renderMode, "source-matched-scene");
  assert.equal(m.productGenerated, false);
  assert.equal(m.backgroundGenerated, true);
  assert.equal(m.protectedRgbVerified, true);
  assert.equal(res.headers["Content-Type"], "image/png");
});
