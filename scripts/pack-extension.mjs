// Zips ./extension into client/public/chariora-extension.zip so the web app can offer it as a download.
import { zipSync } from "fflate";
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "extension");
const files = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files["chariora-extension/" + relative(src, p).split("\\").join("/")] = readFileSync(p);
  }
})(src);
const out = join(root, "client/public/chariora-extension.zip");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, zipSync(files, { level: 9 }));
console.log(`Packed ${Object.keys(files).length} files -> ${relative(root, out)}`);
