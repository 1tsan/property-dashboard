// One listing photo in, a designer's assessment and three improvement schemes out.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { denied, json, readJson, imageType } from "../lib/http.mjs";
import { DESIGNER, STYLES, Advice } from "../lib/designer.mjs";

export const config = { path: "/api/reimagine/analyze", method: "POST" };

export default async (req) => {
  const no = denied(req);
  if (no) return no;

  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(400, { error: "Bad request." });
  }
  const mediaType = imageType(body.image);
  if (!mediaType) return json(400, { error: "Send one photo as a JPEG, PNG or WebP." });
  const style = STYLES[body.style] ? body.style : "designer";
  const title = typeof body.title === "string" ? body.title.slice(0, 200) : "";

  // Stay inside the function's time limit rather than retrying into a timeout.
  const client = new Anthropic({ timeout: 55_000, maxRetries: 0 });
  try {
    const message = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // If a safety filter ever declines a photo, the API re-runs it on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(Advice) },
      system: [{ type: "text", text: DESIGNER, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: body.image } },
            {
              type: "text",
              text: `Listing: ${title || "not given"}\nClient's preferred direction: ${STYLES[style]}\n\nAssess this photo and propose your three schemes.`,
            },
          ],
        },
      ],
    });
    if (message.stop_reason === "refusal") return json(422, { error: "This photo couldn't be assessed." });
    if (!message.parsed_output) return json(502, { error: "The designer's notes came back incomplete. Try again." });
    return json(200, message.parsed_output);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return json(503, { error: "ANTHROPIC_API_KEY is missing or invalid in the site's environment variables." });
    if (err instanceof Anthropic.RateLimitError) return json(429, { error: "Too many requests at once. Give it a moment and try again." });
    if (err instanceof Anthropic.APIConnectionError) return json(504, { error: "The design model took too long. Try again." });
    if (err instanceof Anthropic.APIError) return json(502, { error: `The design model returned an error (${err.status}).` });
    throw err;
  }
};
