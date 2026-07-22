// File uploads — replaces Supabase Storage buckets.
// POST /api/files/:bucket  (multipart field "file", optional "path")  → { data: { path, publicUrl } }
// Files land in UPLOADS_DIR/<bucket>/<path> and are served statically by app.js at /uploads.

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { requireAuth } = require("./auth");

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads");
const PUBLIC_BASE = process.env.UPLOADS_PUBLIC_BASE || "/uploads"; // same-origin static mount

const BUCKETS = new Set([
  // one per storage.from('<bucket>') across the tools + module BUCKET manifests
  "quotation-files", "subcon-invoices", "inventory-files", "claim-receipts",
  "expense-receipts", "visual", "scaffold", "worker-docs", "mall-sketches",
  "pl-files", "blog-images", "storage-rental", "lorry", "transport", "misc",
  // the 6 newly-built tools
  "jcr", "attendance", "hoarding-library", "payable", "receivable"
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

const router = express.Router();
router.use(requireAuth);

function safeRel(p) {
  // client-supplied path like "2026/07/receipt-abc.jpg" — no traversal, no absolute
  const clean = String(p || "").replace(/\\/g, "/").split("/")
    .filter(seg => seg && seg !== "." && seg !== "..").join("/");
  return clean;
}

router.post("/:bucket", upload.single("file"), (req, res) => {
  const bucket = req.params.bucket;
  if (!BUCKETS.has(bucket)) return res.status(400).json({ error: { message: "Unknown bucket: " + bucket } });
  if (!req.file) return res.status(400).json({ error: { message: "No file" } });

  const rel = safeRel(req.body.path) ||
    Date.now() + "-" + Math.random().toString(36).slice(2, 8) + path.extname(req.file.originalname || "");
  const dest = path.join(UPLOADS_DIR, bucket, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, req.file.buffer);

  const publicUrl = `${PUBLIC_BASE}/${bucket}/${rel}`;
  res.json({ data: { path: rel, fullPath: `${bucket}/${rel}`, publicUrl } });
});

// content-type-corrected serving — legacy files were stored without extensions,
// so express.static hands them out as octet-stream (browser downloads garbage).
// GET /api/files-view/<bucket>/<path...>        → inline with sniffed content-type
// GET /api/files-view/<bucket>/<path...>?dl=1   → attachment with a proper filename+ext
const SNIFF = [
  { sig: [0x25, 0x50, 0x44, 0x46], mime: "application/pdf", ext: ".pdf" },   // %PDF
  { sig: [0x89, 0x50, 0x4e, 0x47], mime: "image/png", ext: ".png" },
  { sig: [0xff, 0xd8, 0xff], mime: "image/jpeg", ext: ".jpg" },
  { sig: [0x52, 0x49, 0x46, 0x46], mime: "image/webp", ext: ".webp" }        // RIFF
];
router.get(/^\/view\/([^/]+)\/(.+)$/, (req, res) => {
  try {
    const bucket = req.params[0];
    const rel = safeRel(req.params[1]);
    if (!BUCKETS.has(bucket) || !rel) return res.status(404).end();
    const abs = path.join(UPLOADS_DIR, bucket, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return res.status(404).end();
    const head = fs.readFileSync(abs).subarray(0, 8);
    let mime = "application/octet-stream", ext = "";
    for (const s of SNIFF) if (s.sig.every((b, i) => head[i] === b)) { mime = s.mime; ext = s.ext; break; }
    res.setHeader("Content-Type", mime);
    if (req.query.dl) {
      let name = path.basename(rel);
      if (ext && !name.toLowerCase().endsWith(ext)) name += ext;   // repair missing extension
      res.setHeader("Content-Disposition", 'attachment; filename="' + name.replace(/"/g, "") + '"');
    } else {
      res.setHeader("Content-Disposition", "inline");
    }
    fs.createReadStream(abs).pipe(res);
  } catch (e) { res.status(500).json({ error: { message: e.message } }); }
});

// mirrors storage.from(b).getPublicUrl(p) for the shim (no auth needed — URL math only)
router.get("/:bucket/public-url", (req, res) => {
  const bucket = req.params.bucket;
  const rel = safeRel(req.query.path);
  res.json({ data: { publicUrl: `${PUBLIC_BASE}/${bucket}/${rel}` } });
});

module.exports = { router, UPLOADS_DIR };
