// Bundle app/ into one self-contained HTML file (inline CSS + every classic script, in load order).
// Usage: node tools/build.mjs [out=dist/snow.html]
// The single file opens by double-click (file://) and is what the site root serves (see tools/release.sh).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.resolve(process.env.APP_DIR || path.join(ROOT, 'app'));   // APP_DIR: bundle another copy (tests)
const OUT = path.resolve(ROOT, process.argv[2] || 'dist/snow.html');
let html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const read = rel => {
  const p = path.join(APP, rel);
  if (!fs.existsSync(p)) throw new Error(`missing ${rel}`);
  return fs.readFileSync(p, 'utf8');
};
// a literal "</script" (or "</style") inside inlined code would end the element early; "<\/" is the same text to JS
const guard = (src, tag) => src.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);

let css = 0, js = 0;
html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g, (_, href) => {
  css++; return `<style>/* ${href} */\n${guard(read(href), 'style')}</style>`;
});
html = html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (_, src) => {
  js++; return `<script>/* ${src} */\n${guard(read(src), 'script')}\n</script>`;
});
if (/<script\s+src=|<link\s+rel="stylesheet"/.test(html)) throw new Error('an external script or stylesheet was not inlined');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`built ${path.relative(ROOT, OUT)}: ${css} stylesheet(s), ${js} script(s), ${(html.length / 1024).toFixed(0)} KB`);
