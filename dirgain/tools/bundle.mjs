// Inlines web/app.js and its relative imports into one HTML file that works from file://.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT_RE = /import\s*\{[^}]*\}\s*from\s*"(\.[^"]+)";?/g;
const order = [];
const seen = new Set();

function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(IMPORT_RE)) visit(resolve(dirname(file), m[1]));
  order.push({ file, src });
}

visit(join(root, "web", "app.js"));

const names = new Map();
const chunks = order.map(({ file, src }) => {
  const body = src.replace(IMPORT_RE, "").replace(/^export\s+(?=(async\s+)?function|const|let|class)/gm, "");
  for (const m of body.matchAll(/^(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (names.has(m[1])) throw new Error(`top-level name ${m[1]} defined in ${names.get(m[1])} and ${file}`);
    names.set(m[1], file);
  }
  if (/^\s*export\b/m.test(body)) throw new Error(`unhandled export form in ${file}`);
  return `// ---- ${file.slice(root.length + 1)}\n${body}`;
});

const html = readFileSync(join(root, "web", "index.html"), "utf8");
const tag = '<script type="module" src="app.js"></script>';
if (!html.includes(tag)) throw new Error("script tag not found in index.html");
const out = html.replace(tag, () => `<script type="module">\n${chunks.join("\n")}\n</script>`);
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "dirgain-calibrator.html"), out);
console.log(`wrote dist/dirgain-calibrator.html from ${order.length} modules`);

// --artifact <path>: the same page for the claude.ai artifact viewer, which supplies the
// document wrapper itself and cannot download files.
const ai = process.argv.indexOf("--artifact");
if (ai > 0) {
  const artifact = out
    .replace(/<!doctype html>\s*/i, "")
    .replace(/<html[^>]*>\s*/i, "")
    .replace(/<\/?head>\s*/gi, "")
    .replace(/<\/?body>\s*/gi, "")
    .replace(/<\/html>\s*/i, "")
    .replace(/<meta charset="utf-8">\s*/i, "")
    .replace(/<meta name="viewport"[^>]*>\s*/i, "")
    .replace(/<link rel="icon"[^>]*>\s*/i, "")
    .replace('<script type="module">', '<script>globalThis.DIRGAIN_ARTIFACT = true;</script>\n<script type="module">');
  writeFileSync(process.argv[ai + 1], artifact);
  console.log(`wrote artifact variant ${process.argv[ai + 1]}`);
}
