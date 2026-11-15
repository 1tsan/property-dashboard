// Downloads the homepage's Unsplash photos into img/ as WebP and points Index.html at the local copies.
// Run once from the repo root on a machine that can reach images.unsplash.com:  npm run self-host-images
import { readFile, writeFile, mkdir } from "node:fs/promises";

const page = process.argv[2] || "Index.html";
const base = process.env.UNSPLASH_BASE || "https://images.unsplash.com";
const names = {
  "photo-1762544968153-b9b47435fefd": "hero",
  "photo-1601993957728-1e56ab70c5a8": "staircase",
  "photo-1724582586458-a51791349977": "living-room",
  "photo-1567016376408-0226e4d0c1ea": "interior",
};

let html = await readFile(page, "utf8");
const remote = /https:\/\/images\.unsplash\.com\/(photo-[\w-]+)\?[^"\s]*?&w=(\d+)/g;
const wanted = new Map();
for (const [url, id, width] of html.matchAll(remote)) {
  if (!names[id]) throw new Error(`No local name configured for ${id}`);
  wanted.set(url, { id, width, file: `img/${names[id]}-${width}.webp` });
}
if (wanted.size === 0) { console.log("No Unsplash images referenced — nothing to do."); process.exit(0); }

await mkdir("img", { recursive: true });
// Fetch everything before touching the page, so a failed download never leaves it half-converted.
const files = await Promise.all([...wanted.values()].map(async ({ id, width, file }) => {
  const res = await fetch(`${base}/${id}?fm=webp&fit=crop&q=72&w=${width}`);
  if (!res.ok) throw new Error(`${id} at ${width}px: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1000) throw new Error(`${id} at ${width}px: response too small to be an image`);
  return { file, bytes };
}));
for (const { file, bytes } of files) await writeFile(file, bytes);

for (const [url, { file }] of wanted) html = html.replaceAll(url, "/" + file);
html = html.replace(/<link rel="preconnect" href="https:\/\/images\.unsplash\.com">\n/, "");
await writeFile(page, html);
console.log(`Saved ${files.length} images to img/ and updated ${page}.`);
