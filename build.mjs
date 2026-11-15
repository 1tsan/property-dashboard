// Compiles src/<tool>/* into single self-contained HTML pages. Run: npm run build
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const js = (entry, extra = {}) =>
  build({
    entryPoints: [entry], bundle: true, minify: true, write: false,
    format: "iife", target: "es2020", jsx: "automatic", jsxImportSource: "preact", ...extra,
  }).then((r) => r.outputFiles[0].text.trim());

async function page(name, out, define = {}) {
  const dir = `src/${name}/`;
  const [script, css, template] = await Promise.all([
    js(dir + "app.jsx", { define }),
    build({ entryPoints: [dir + "styles.css"], minify: true, write: false }).then((r) => r.outputFiles[0].text),
    readFile(dir + "template.html", "utf8"),
  ]);
  const html = template
    .replace("/*__CSS__*/", () => css.trim())
    .replace("/*__JS__*/", () => script.replace(/<\/script/gi, "<\\/script"));
  await writeFile(out, html);
  console.log(`${out} ${(html.length / 1024).toFixed(1)} KB`);
}

await page("chainready", "chainready.html");
// The bookmarklet is compiled on its own and embedded in the Reimagine page as a string.
const bookmarklet = await js("src/reimagine/bookmarklet.js");
await page("reimagine", "reimagine.html", { __BOOKMARKLET__: JSON.stringify(bookmarklet) });
