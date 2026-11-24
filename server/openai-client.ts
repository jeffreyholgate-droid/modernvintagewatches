// Server-only OpenAI transport. Bounded responses; no automatic paid retries.
export const openAITextModel = () =>
  process.env.OPENAI_TEXT_MODEL || "gpt-6.2-sol";
export const openAIConfigured = () =>
  Boolean(process.env.OPENAI_API_KEY?.trim());
async function request(
  path: "responses",
  body: Record<string, unknown>,
  timeout: number,
) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("AI_NOT_CONFIGURED");
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/" + path, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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
  if (Number(res.headers.get("content-length") || 0) > limit || !res.body)
    throw new Error("AI_RESPONSE_INVALID");
  const reader = res.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("AI_RESPONSE_INVALID");
      chunks.push(value);
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
  let data: any;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("AI_RESPONSE_INVALID");
  }
  if (!res.ok) {
    const code = data?.error?.code;
    if (
      res.status === 402 ||
      [
        "insufficient_quota",
        "billing_hard_limit_reached",
        "credit_balance_exhausted",
      ].includes(code)
    )
      throw new Error("AI_CREDITS_DEPLETED");
    if (res.status === 401 || res.status === 403)
      throw new Error("AI_ACCESS_DENIED");
    if (res.status === 404 || code === "model_not_found")
      throw new Error("AI_MODEL_UNAVAILABLE");
    if (res.status === 429) throw new Error("AI_RATE_LIMITED");
    throw new Error("AI_SERVICE_UNAVAILABLE");
  }
  return data;
}
export async function structuredOpenAI(
  name: string,
  schema: Record<string, unknown>,
  instructions: string,
  input: unknown,
  model = openAITextModel(),
  options: { maxOutputTokens?: number; timeout?: number } = {},
): Promise<any> {
  const result = await request(
    "responses",
    {
      model,
      instructions,
      input,
      store: false,
      max_output_tokens: options.maxOutputTokens ?? 2500,
      text: { format: { type: "json_schema", name, strict: true, schema } },
    },
    options.timeout ?? 60000,
  );
  if (result.status !== "completed" || !Array.isArray(result.output))
    throw new Error("AI_RESPONSE_INVALID");
  const content = result.output
    .filter((o: any) => o.type === "message")
    .flatMap((o: any) => (Array.isArray(o.content) ? o.content : []));
  if (content.some((c: any) => c.type === "refusal"))
    throw new Error("AI_RESPONSE_REFUSED");
  const text = content
    .filter((c: any) => c.type === "output_text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("");
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value;
  } catch {
    throw new Error("AI_RESPONSE_INVALID");
  }
}
