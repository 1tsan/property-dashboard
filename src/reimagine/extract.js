// Finds a listing's photos in page HTML. Shared by the bookmarklet (runs on the listing page in the
// user's browser), the listing function (server-side best effort) and the image proxy (host allowlist).

const LISTING_HOST = /(^|\.)(rightmove\.co\.uk|zoopla\.co\.uk)$/;
const IMAGE_HOSTS = new Set(["media.rightmove.co.uk", "lid.zoocdn.com"]);
export const MAX_IMAGES = 40;

function parse(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

export function isListingUrl(url) {
  const u = parse(url);
  return !!u && LISTING_HOST.test(u.hostname.toLowerCase());
}

export function isImageUrl(url) {
  const u = parse(url);
  return !!u && IMAGE_HOSTS.has(u.hostname.toLowerCase()) && /\.(jpe?g|png|webp)$/i.test(u.pathname);
}

// URLs often sit inside JSON blobs with escaped slashes.
const unescape = (html) => html.replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&");

function rightmove(html) {
  const found = new Map();
  const re = /https:\/\/media\.rightmove\.co\.uk\/[^"'\s\\<>()]+?\.(?:jpe?g|png|webp)/gi;
  for (const [url] of html.matchAll(re)) {
    const file = url.slice(url.lastIndexOf("/") + 1);
    if (!/_IMG_\d+/i.test(file)) continue; // skips floorplans (FLP), EPCs and agent logos
    // Thumbnails are /dir/[crop/<ratio>/]…_max_WxH.jpeg; the original lives at the same path without them.
    const full = url.replace(/\/dir\/(?:crop\/[^/]+\/)?/, "/").replace(/_max_\d+x\d+(?=\.\w+$)/, "");
    const key = full.slice(full.lastIndexOf("/") + 1).toLowerCase();
    if (!found.has(key)) found.set(key, full);
  }
  return [...found.entries()].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })).map(([, u]) => u);
}

function zoopla(html) {
  const best = new Map(); // photo hash -> largest variant seen, in page order
  const re = /https:\/\/lid\.zoocdn\.com\/(?:u\/)?(\d+)\/(\d+)\/([a-f0-9]{16,})\.(?:jpe?g|png|webp)/gi;
  for (const m of html.matchAll(re)) {
    const width = Number(m[1]);
    const prev = best.get(m[3]);
    if (!prev || width > prev.width) best.set(m[3], { width, url: m[0] });
  }
  return [...best.values()].map((v) => v.url);
}

export function extractImages(rawHtml) {
  const html = unescape(String(rawHtml || ""));
  const images = [...rightmove(html), ...zoopla(html)];
  return images.filter(isImageUrl).slice(0, MAX_IMAGES);
}

export function extractTitle(rawHtml) {
  const html = String(rawHtml || "");
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  const title = og?.[1] ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "";
  return title.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim().slice(0, 200);
}

// The bookmarklet hands the listing to the tool in the URL fragment, which never reaches a server.
export function encodeHandoff({ url, title, images }) {
  return "#l=" + encodeURIComponent(JSON.stringify({ u: url, t: title, i: images }));
}

export function decodeHandoff(hash) {
  if (!hash || !hash.startsWith("#l=")) return null;
  try {
    const d = JSON.parse(decodeURIComponent(hash.slice(3)));
    const images = (Array.isArray(d.i) ? d.i : []).filter((u) => typeof u === "string" && isImageUrl(u)).slice(0, MAX_IMAGES);
    if (!images.length) return null;
    return {
      url: typeof d.u === "string" && isListingUrl(d.u) ? d.u : "",
      title: typeof d.t === "string" ? d.t.slice(0, 200) : "",
      images,
    };
  } catch {
    return null;
  }
}
