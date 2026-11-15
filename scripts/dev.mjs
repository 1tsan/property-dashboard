// Local preview: serves the static pages and runs the Netlify functions in-process.
// Run: REIMAGINE_PASSCODE=… ANTHROPIC_API_KEY=… GEMINI_API_KEY=… npm run dev
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const types = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".js": "text/javascript", ".css": "text/css" };

const routes = new Map();
for (const file of await readdir(join(root, "netlify/functions"))) {
  const mod = await import(join(root, "netlify/functions", file));
  routes.set(mod.config.path, mod.default);
}
const pages = new Map(
  (await readFile(join(root, "_redirects"), "utf8")).split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2).map(([from, to]) => [from, to]),
);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const fn = routes.get(url.pathname);
    if (fn) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const out = await fn(new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }));
      res.writeHead(out.status, Object.fromEntries(out.headers));
      return res.end(Buffer.from(await out.arrayBuffer()));
    }
    const path = normalize(pages.get(url.pathname) ?? url.pathname);
    const file = join(root, path.toLowerCase() === "/index.html" ? "Index.html" : path);
    if (!file.startsWith(root)) throw new Error("outside root");
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch (err) {
    res.writeHead(err.code === "ENOENT" || err.code === "EISDIR" ? 404 : 500);
    res.end(err.code ? "Not found" : String(err));
  }
}).listen(process.env.PORT || 8888, () => console.log(`http://localhost:${process.env.PORT || 8888}/reimagine`));
