// Loopback development server. Uses the real API handlers; no mocked image responses.
import { createServer as createHTTPServer } from "node:http";
import { createServer as createViteServer } from "vite";
if (process.env.VERCEL || process.env.NODE_ENV === "production")
  throw Error("Development server only");
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "spa",
});
const routes = {
  "/api/studio": "/api/studio.ts",
  "/api/items": "/api/items.ts",
  "/api/auth/login": "/api/auth/login.ts",
};
const server = createHTTPServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (routes[url.pathname]) {
    try {
      req.query = Object.fromEntries(url.searchParams);
      res.status = (n) => ((res.statusCode = n), res);
      res.json = (v) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(v));
      };
      const { default: handler } = await vite.ssrLoadModule(
        routes[url.pathname],
      );
      await handler(req, res);
    } catch {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "DEV_SERVER_ERROR" }));
    }
  } else vite.middlewares(req, res);
});
server.listen(4175, "127.0.0.1", () =>
  console.log(
    "Studio development server: http://127.0.0.1:4175/#/admin/studio",
  ),
);
async function stop() {
  server.close();
  await vite.close();
  process.exit();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
