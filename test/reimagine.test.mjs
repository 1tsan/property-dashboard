import test from "node:test";
import assert from "node:assert/strict";
import { extractImages, extractTitle, isListingUrl, isImageUrl, encodeHandoff, decodeHandoff } from "../src/reimagine/extract.js";
import listing from "../netlify/functions/reimagine-listing.mjs";
import img from "../netlify/functions/reimagine-img.mjs";
import analyze from "../netlify/functions/reimagine-analyze.mjs";
import render from "../netlify/functions/reimagine-render.mjs";

const RM = "https://media.rightmove.co.uk";

test("rightmove: dedupes size variants to the original, skips floorplans and logos, keeps photo order", () => {
  const html = `
    <img src="${RM}/dir/crop/10:9-16:9/123k/122345/150000001/122345_ABC_IMG_01_0000_max_476x317.jpeg">
    <script>window.PAGE_MODEL={"images":[{"url":"${RM.replace(/\//g, "\\/")}\\/123k\\/122345\\/150000001\\/122345_ABC_IMG_00_0000.jpeg"},
      {"url":"${RM}/dir/123k/122345/150000001/122345_ABC_IMG_01_0000_max_656x437.jpeg"},
      {"url":"${RM}/123k/122345/150000001/122345_ABC_IMG_10_0000.jpeg"},
      {"url":"${RM}/123k/122345/150000001/122345_ABC_IMG_02_0000.jpeg"}],
      "floorplans":[{"url":"${RM}/123k/122345/150000001/122345_ABC_FLP_00_0000.jpeg"}],
      "logo":"${RM}/company/clogo_rmchoice_122345_0002.png"}</script>`;
  assert.deepEqual(extractImages(html), [
    `${RM}/123k/122345/150000001/122345_ABC_IMG_00_0000.jpeg`,
    `${RM}/123k/122345/150000001/122345_ABC_IMG_01_0000.jpeg`,
    `${RM}/123k/122345/150000001/122345_ABC_IMG_02_0000.jpeg`,
    `${RM}/123k/122345/150000001/122345_ABC_IMG_10_0000.jpeg`,
  ]);
});

test("zoopla: keeps the largest variant of each photo", () => {
  const a = "0123456789abcdef0123456789abcdef01234567", b = "fedcba9876543210fedcba9876543210fedcba98";
  const html = `<source srcset="https://lid.zoocdn.com/u/480/360/${a}.jpg 480w, https://lid.zoocdn.com/u/1600/1200/${a}.jpg 1600w">
    <img src="https://lid.zoocdn.com/645/430/${b}.jpg"><img src="https://lc.zoocdn.com/${a}.png">`;
  assert.deepEqual(extractImages(html), [`https://lid.zoocdn.com/u/1600/1200/${a}.jpg`, `https://lid.zoocdn.com/645/430/${b}.jpg`]);
});

test("url allowlists", () => {
  assert.ok(isListingUrl("https://www.rightmove.co.uk/properties/123#/"));
  assert.ok(isListingUrl("https://www.zoopla.co.uk/for-sale/details/123/"));
  assert.ok(!isListingUrl("http://www.rightmove.co.uk/properties/123"));
  assert.ok(!isListingUrl("https://rightmove.co.uk.evil.com/x"));
  assert.ok(!isListingUrl("https://evilrightmove.co.uk/x"));
  assert.ok(isImageUrl(`${RM}/1k/2/3/2_A_IMG_00_0000.jpeg`));
  assert.ok(!isImageUrl("https://media.rightmove.co.uk.evil.com/a.jpg"));
  assert.ok(!isImageUrl("https://169.254.169.254/latest/meta-data/a.jpg"));
  assert.ok(!isImageUrl(`${RM}/x.html`));
});

test("title and bookmarklet handoff round-trip", () => {
  assert.equal(extractTitle(`<title>3 bed house   for sale in Acacia Avenue &amp; Co</title>`), "3 bed house for sale in Acacia Avenue & Co");
  const data = { url: "https://www.rightmove.co.uk/properties/1", title: "3 bed, £450,000 – “nice”", images: [`${RM}/1k/2/3/2_A_IMG_00_0000.jpeg`] };
  assert.deepEqual(decodeHandoff(encodeHandoff(data)), data);
  assert.equal(decodeHandoff(encodeHandoff({ ...data, images: ["https://evil.com/a.jpg"] })), null);
  assert.equal(decodeHandoff("#l=%7Bbroken"), null);
  assert.equal(decodeHandoff(""), null);
});

test("every endpoint fails closed without the passcode", async () => {
  const post = (pass) => new Request("http://x/api", { method: "POST", headers: pass ? { "x-reimagine-passcode": pass } : {}, body: "{}" });
  delete process.env.REIMAGINE_PASSCODE;
  for (const fn of [listing, img, analyze, render]) assert.equal((await fn(post("anything"))).status, 503);
  process.env.REIMAGINE_PASSCODE = "open sesame";
  for (const fn of [listing, img, analyze, render]) {
    assert.equal((await fn(post())).status, 401);
    assert.equal((await fn(post("open sesam"))).status, 401);
  }
});

test("endpoints validate input before calling anything external", async () => {
  process.env.REIMAGINE_PASSCODE = "p";
  delete process.env.GEMINI_API_KEY;
  const headers = { "x-reimagine-passcode": "p" };
  const post = (body) => new Request("http://x/api", { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal((await listing(post({ url: "https://example.com/" }))).status, 400);
  assert.equal((await img(new Request("http://x/api?u=" + encodeURIComponent("https://example.com/a.jpg"), { headers }))).status, 400);
  assert.equal((await analyze(post({ image: "not an image" }))).status, 400);
  assert.equal((await render(post({ image: "x", prompt: "y" }))).status, 503); // no Gemini key configured
  process.env.GEMINI_API_KEY = "k";
  assert.equal((await render(post({ image: "x", prompt: "y" }))).status, 400);
});
