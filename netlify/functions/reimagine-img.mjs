// Fetches a listing photo so the browser can read its pixels (the photo CDNs send no CORS headers).
// Only the two listing-photo hosts are allowed, so this can't be used to reach anything else.
import { denied, json } from "../lib/http.mjs";
import { isImageUrl } from "../../src/reimagine/extract.js";

export const config = { path: "/api/reimagine/img", method: "GET" };

const MAX_BYTES = 5_500_000; // Netlify caps buffered responses at about 6 MB

export default async (req) => {
  const no = denied(req);
  if (no) return no;

  const target = new URL(req.url).searchParams.get("u") || "";
  if (!isImageUrl(target)) return json(400, { error: "Not a listing photo." });

  let res;
  try {
    res = await fetch(target, { headers: { accept: "image/*" }, redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch {
    return json(502, { error: "Couldn't fetch that photo." });
  }
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.startsWith("image/")) return json(502, { error: "Couldn't fetch that photo." });

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return json(413, { error: "That photo is too large." });
  return new Response(bytes, { headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
};
