// Server-only Images Edits transport. Exactly one paid request, never retried.
export const openAIStudioSceneModel = () =>
  process.env.OPENAI_STUDIO_SCENE_MODEL || "gpt-image-2.6-sunburst";

export type OpenAIImageEdit = {
  image: Buffer;
  mask: Buffer;
  reference?: Buffer;
  prompt: string;
  width: number;
  height: number;
};

export async function editOpenAIEnvironment(input: OpenAIImageEdit): Promise<{
  image: Buffer;
  model: string;
  requestId: string | null;
}> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("AI_NOT_CONFIGURED");
  if (
    input.image.length > 16 * 1024 * 1024 ||
    input.mask.length >= 4 * 1024 * 1024 ||
    (input.reference?.length ?? 0) > 8 * 1024 * 1024 ||
    input.prompt.length > 12000 ||
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width % 16 ||
    input.height % 16 ||
    input.width > 1536 ||
    input.height > 1536 ||
    input.width * input.height < 655360 ||
    Math.max(input.width, input.height) >
      3 * Math.min(input.width, input.height)
  )
    throw new Error("INVALID_PHOTOGRAPH_REQUEST");
  const model = openAIStudioSceneModel();
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", input.prompt);
  form.set("n", "1");
  form.set("size", `${input.width}x${input.height}`);
  form.set("quality", "high");
  form.set("output_format", "png");
  form.set("background", "opaque");
  form.append(
    "image[]",
    new Blob([new Uint8Array(input.image)], { type: "image/png" }),
    "source.png",
  );
  if (input.reference)
    form.append(
      "image[]",
      new Blob([new Uint8Array(input.reference)], { type: "image/png" }),
      "environment-reference.png",
    );
  form.set(
    "mask",
    new Blob([new Uint8Array(input.mask)], { type: "image/png" }),
    "protected-product.png",
  );
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(150000),
      headers: { Authorization: "Bearer " + key },
      body: form,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ["AbortError", "TimeoutError"].includes(error.name)
    )
      throw new Error("AI_TIMEOUT");
    throw new Error("AI_SERVICE_UNAVAILABLE");
  }
  const limit = 32 * 1024 * 1024;
  if (
    !response.body ||
    Number(response.headers.get("content-length") || 0) > limit
  )
    throw new Error("AI_RESPONSE_INVALID");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) throw new Error("AI_RESPONSE_INVALID");
      chunks.push(next.value);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      ["AbortError", "TimeoutError"].includes(error.name)
    )
      throw new Error("AI_TIMEOUT");
    throw new Error("AI_RESPONSE_INVALID");
  } finally {
    await reader.cancel().catch(() => {});
  }
  let result: any;
  try {
    result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("AI_RESPONSE_INVALID");
  }
  if (!response.ok) {
    const code = result?.error?.code;
    if (
      response.status === 402 ||
      [
        "insufficient_quota",
        "billing_hard_limit_reached",
        "credit_balance_exhausted",
      ].includes(code)
    )
      throw new Error("AI_CREDITS_DEPLETED");
    if (response.status === 401 || response.status === 403)
      throw new Error("AI_ACCESS_DENIED");
    if (response.status === 404 || code === "model_not_found")
      throw new Error("AI_MODEL_UNAVAILABLE");
    if (response.status === 429) throw new Error("AI_RATE_LIMITED");
    if (["content_policy_violation", "moderation_blocked"].includes(code))
      throw new Error("AI_RESPONSE_REFUSED");
    throw new Error("AI_SERVICE_UNAVAILABLE");
  }
  const base64 = result?.data?.[0]?.b64_json;
  if (
    !Array.isArray(result?.data) ||
    result.data.length !== 1 ||
    typeof base64 !== "string" ||
    base64.length < 16 ||
    base64.length % 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    throw new Error("AI_RESPONSE_INVALID");
  const image = Buffer.from(base64, "base64");
  if (
    image.length > 20 * 1024 * 1024 ||
    !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("AI_RESPONSE_INVALID");
  const requestId = response.headers.get("x-request-id");
  return {
    image,
    model,
    requestId:
      requestId && /^[A-Za-z0-9_-]{1,160}$/.test(requestId) ? requestId : null,
  };
}
