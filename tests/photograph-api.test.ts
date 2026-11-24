import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import handler from "../api/studio.js";
import { loadSource, pngUrl, digest } from "../api/_lib/studio/images.js";
import { signStudioProof } from "../api/_lib/auth.js";
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

test("private Oak Study approvals require review and never expose a draft image to the shop", async (t) => {
  const config = {
    SUPABASE_URL: "https://oak-preview.example",
    SUPABASE_SERVICE_ROLE_KEY: "fixture",
    ADMIN_JWT_SECRET: "test-oak-proof-secret",
    MVW_STUDIO_SERVICE_KEY: "only-a-test-studio-service-token-123",
  };
  const original = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const itemId = "bdae6777-7aff-4187-ab2b-cb4120f4b55f";
  const url = "https://i.ebayimg.com/images/g/example/s-l500.jpg";
  const photo = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "red" } }).png().toBuffer();
  const outputSha256 = digest(photo);
  const sourceSha256 = digest(photo);
  let published = false;
  const approved = { url, tone: "original", oak: { itemId, sourceSha256, outputSha256 } };
  let saved: Array<typeof approved> = [];
  let sourceRequests = 0, storageReads = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const address = new URL(input);
    if (address.host === "i.ebayimg.com") {
      assert.equal(address.pathname, "/images/g/example/s-l1600.jpg");
      sourceRequests++;
      return new Response(new Uint8Array(photo));
    }
    assert.equal(address.origin, config.SUPABASE_URL);
    if (address.pathname.includes("/storage/v1/object/")) {
      storageReads++;
      assert.ok(address.pathname.endsWith(`/mvw-oak-study/${itemId}/${outputSha256}.png`));
      return new Response(new Uint8Array(photo));
    }
    assert.equal(address.pathname, "/rest/v1/items");
    if (init.method === "PATCH") {
      assert.equal(address.searchParams.get("oak_photo_review"), "eq.[]");
      saved = JSON.parse(String(init.body)).oak_photo_review;
      return Response.json([{ id: itemId }]);
    }
    return Response.json({
      id: itemId, status: "ACTIVE", category: "WATCH", publish_state: published ? "PUBLISHED" : "DRAFT",
      image_urls: [url], photo_review: published ? saved : null, oak_photo_review: saved,
      first_seen_at: "2026-11-24T10:00:00Z", last_seen_at: "2026-11-24T10:00:00Z",
    });
  });
  const headers = { authorization: "Bearer " + config.MVW_STUDIO_SERVICE_KEY };
  const proof = await signStudioProof({ itemId, url, sourceSha256, outputSha256 });
  const confirm = async (reviewed: boolean, token = proof) => {
    const res = response();
    await handler({ method: "POST", headers, body: { action: "approve-photo", reviewed, proof: token } }, res);
    return res;
  };
  assert.equal((await confirm(false)).body.error, "REVIEW_REQUIRED");
  assert.equal((await confirm(true, "not-a-proof")).body.error, "STUDIO_REVIEW_EXPIRED");
  assert.equal((await confirm(true)).statusCode, 200);
  assert.equal((await confirm(true)).statusCode, 200);
  assert.equal(sourceRequests, 1);
  assert.deepEqual(saved, [approved]);
  const image = async (auth = {}) => {
    const res = response();
    await handler({ method: "GET", query: { photo: outputSha256, item: itemId }, headers: auth }, res);
    return res;
  };
  assert.equal((await image()).statusCode, 404);
  assert.equal(storageReads, 0);
  assert.deepEqual((await image(headers)).body, photo);
  published = true;
  assert.deepEqual((await image()).body, photo);
  assert.equal(storageReads, 2);
});
