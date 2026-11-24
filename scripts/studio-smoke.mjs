import { createServer } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { loadSource } = await vite.ssrLoadModule("/api/_lib/studio/images.ts");
  const { prepareWatch } = await vite.ssrLoadModule("/api/_lib/studio/ai.ts");
  const { compositeWatch } = await vite.ssrLoadModule(
    "/api/_lib/studio/render.ts",
  );
  const file = process.argv[2];
  const destination = process.argv[3];
  const bytes = await readFile(file);
  const source = await loadSource({
    dataUrl: "data:image/jpeg;base64," + bytes.toString("base64"),
  });
  console.log(
    "Preparing source",
    source.width,
    source.height,
    "AI configured:",
    Boolean(process.env.GEMINI_API_KEY),
  );
  const prepared = await prepareWatch(source);
  await mkdir(destination, { recursive: true });
  await writeFile(destination + "/prepared.json", JSON.stringify(prepared));
  const mask = Buffer.from(prepared.maskDataUrl.split(",")[1], "base64");
  const rendered = await compositeWatch(source, mask, prepared.recipe);
  await writeFile(destination + "/result.png", rendered.png);
  console.log(
    JSON.stringify({
      status: "ok",
      analysis: prepared.analysis,
      pngBytes: rendered.png.length,
    }),
  );
} catch (e) {
  console.log(
    "SMOKE_FAILED",
    e.status || "",
    String(e.message)
      .replace(/AIza[\w-]+/g, "[redacted]")
      .slice(0, 700),
  );
  process.exitCode = 1;
} finally {
  await vite.close();
}
