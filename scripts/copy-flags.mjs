// Copies the 4x3 flag SVGs that the game uses from the flag-icons package (MIT) into public/flags.
// It runs before `dev` and `build`, so the flags are served from our own site.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "flag-icons", "flags", "4x3");
const dest = join(root, "public", "flags");
const codes = [...readFileSync(join(root, "src", "lib", "countries.ts"), "utf8").matchAll(/^\s*\["([a-z]{2})",/gm)].map((m) => m[1]);

if (!codes.length) throw new Error("copy-flags: no country codes found in src/lib/countries.ts");
mkdirSync(dest, { recursive: true });
const missing = [];
for (const code of codes) {
  const file = join(src, `${code}.svg`);
  if (existsSync(file)) copyFileSync(file, join(dest, `${code}.svg`));
  else missing.push(code);
}
if (missing.length) throw new Error(`copy-flags: flag-icons has no flag for: ${missing.join(", ")}`);
console.log(`copy-flags: ${codes.length} flags copied to public/flags`);
