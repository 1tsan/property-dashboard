// Repaints a listing photo to show one improvement scheme, using Google's Gemini image model.
import { denied, json, readJson, imageType } from "../lib/http.mjs";
import { RENDER_RULES } from "../lib/designer.mjs";

export const config = { path: "/api/reimagine/render", method: "POST" };

export default async (req) => {
  const no = denied(req);
  if (no) return no;

  const key = process.env.GEMINI_API_KEY;
  if (!key) return json(503, { error: "GEMINI_API_KEY is missing from the site's environment variables." });
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(400, { error: "Bad request." });
  }
  const mediaType = imageType(body.image);
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 3000) : "";
  if (!mediaType || prompt.length < 20) return json(400, { error: "Send a photo and a brief." });

  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: RENDER_RULES + prompt }, { inlineData: { mimeType: mediaType, data: body.image } }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    return json(504, { error: "The image model took too long. Try again." });
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 429) return json(429, { error: "The image model is rate limited. Give it a moment and try again." });
    if (res.status === 400 || res.status === 403 || res.status === 404) {
      return json(503, { error: `The image model rejected the request (${res.status}): ${data?.error?.message?.slice(0, 200) || "check GEMINI_API_KEY and GEMINI_IMAGE_MODEL"}` });
    }
    return json(502, { error: `The image model returned an error (${res.status}).` });
  }

  const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) return json(422, { error: "The image model didn't return a picture for this one. Try another idea." });
  return json(200, { image: part.inlineData.data, type: part.inlineData.mimeType || "image/png" });
};
