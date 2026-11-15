import { timingSafeEqual, createHash } from "node:crypto";

export const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const digest = (s) => createHash("sha256").update(String(s)).digest();

// Personal tool: every endpoint needs the passcode set in REIMAGINE_PASSCODE. Fails closed if it is unset.
export function denied(req) {
  const expected = process.env.REIMAGINE_PASSCODE;
  if (!expected) return json(503, { error: "Reimagine isn't configured yet: set REIMAGINE_PASSCODE in the site's environment variables." });
  const given = req.headers.get("x-reimagine-passcode") || "";
  if (!timingSafeEqual(digest(given), digest(expected))) return json(401, { error: "Wrong passcode." });
  return null;
}

export async function readJson(req, maxBytes = 5_500_000) {
  const text = await req.text();
  if (text.length > maxBytes) throw new Error("too large");
  return JSON.parse(text);
}

// Accepts a base64 JPEG/PNG/WebP (no data: prefix) and returns its media type, or null.
export function imageType(b64) {
  if (typeof b64 !== "string" || b64.length < 100 || b64.length > 5_000_000) return null;
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("iVBORw0KGgo")) return "image/png";
  if (b64.startsWith("UklGR")) return "image/webp";
  return null;
}
