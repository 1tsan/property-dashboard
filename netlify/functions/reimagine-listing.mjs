// Best-effort fallback for pasted links: fetches one listing page and returns its photo URLs.
// Rightmove and Zoopla often refuse server requests; the bookmarklet is the reliable route.
import { denied, json, readJson } from "../lib/http.mjs";
import { isListingUrl, extractImages, extractTitle } from "../../src/reimagine/extract.js";

export const config = { path: "/api/reimagine/listing", method: "POST" };

const BLOCKED = "That site wouldn't let the page be fetched from a server. Use the Reimagine bookmark button on the listing page instead, or drop the photos in.";

export default async (req) => {
  const no = denied(req);
  if (no) return no;

  let url;
  try {
    ({ url } = await readJson(req, 4000));
  } catch {
    return json(400, { error: "Bad request." });
  }
  if (!isListingUrl(url)) return json(400, { error: "Paste a Rightmove or Zoopla property link." });

  let res;
  try {
    res = await fetch(url, {
      headers: { accept: "text/html", "accept-language": "en-GB" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return json(502, { error: BLOCKED });
  }
  if (!res.ok || !isListingUrl(res.url)) return json(502, { error: BLOCKED });

  const html = (await res.text()).slice(0, 5_000_000);
  const images = extractImages(html);
  if (!images.length) return json(502, { error: BLOCKED });
  return json(200, { url, title: extractTitle(html), images });
};
