// Compiles src/chainready/* into the single self-contained chainready.html. Run: npm run build
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const dir = "src/chainready/";
const [js, css, template] = await Promise.all([
  build({
    entryPoints: [dir + "app.jsx"], bundle: true, minify: true, write: false,
    format: "iife", target: "es2020", jsx: "automatic", jsxImportSource: "preact",
  }).then((r) => r.outputFiles[0].text),
  build({ entryPoints: [dir + "styles.css"], minify: true, write: false }).then((r) => r.outputFiles[0].text),
  readFile(dir + "template.html", "utf8"),
]);

const html = template
  .replace("/*__CSS__*/", () => css.trim())
  .replace("/*__JS__*/", () => js.trim().replace(/<\/script/gi, "<\\/script"));
await writeFile("chainready.html", html);
console.log(`chainready.html ${(html.length / 1024).toFixed(1)} KB`);
