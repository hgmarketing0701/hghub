// Copies ONLY the safe frontend files into server/public/ so app.js can serve them.
// Run once after deploy (and after any frontend change):  node prepare-public.js
// Never copies server/, mysql/, import/, supabase/, .env, .git — those stay private.
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");           // frontend lives at the repo root
const OUT = path.join(__dirname, "public");

const FILES = fs.readdirSync(REPO).filter(f =>
  f.endsWith(".html") || f === "hg-client.js" || f === "hg-readiness.js" || f === "hg-logo.png" ||
  f === "hg-logo-light.png" || f === "favicon.ico"
);
const DIRS = ["hub"];                              // design assets referenced by index.html

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

let n = 0;
for (const f of FILES) {
  if (fs.existsSync(path.join(REPO, f))) { fs.copyFileSync(path.join(REPO, f), path.join(OUT, f)); n++; }
}
for (const dir of DIRS) {
  const src = path.join(REPO, dir);
  if (fs.existsSync(src)) { copyDir(src, path.join(OUT, dir)); n++; }
}
console.log(`prepared server/public/ — ${FILES.length} files + ${DIRS.length} dir(s) copied (${n} items)`);
