// HG hub API — Express entry point (cPanel Passenger runs this as the Node app).
require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");

const { router: authRouter } = require("./auth");
const { router: tablesRouter } = require("./tables");
const { router: filesRouter, UPLOADS_DIR } = require("./files");
const { router: rpcRouter } = require("./rpc");
const { router: aiRouter } = require("./ai");
const { router: cronRouter } = require("./cron");
const { router: mastersRouter } = require("./masters");
const { router: proofRouter, mintRouter: proofMintRouter } = require("./proof");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// Same-origin deployment (frontend + API on the same cPanel domain) — no CORS needed.
// If DEV_ORIGIN is set (local dev: static server on another port), allow it with credentials.
if (process.env.DEV_ORIGIN) {
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", process.env.DEV_ORIGIN);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
}

app.get("/api/health", (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use("/api/auth", authRouter);
app.use("/api/t", tablesRouter);
app.use("/api/files", filesRouter);
app.use("/api/rpc", rpcRouter);
app.use("/api/ai", aiRouter);
app.use("/api/cron", cronRouter);
app.use("/api/masters", mastersRouter);
app.use("/api/proof-mint", proofMintRouter);   // auth'd: mint a completion link
app.use("/proof", proofRouter);                 // NO auth: token-gated site uploads

// uploaded files (same-origin static).
app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "7d" }));

// frontend (all-in-one: this Node app serves the hub + tools too, so the whole
// thing is one origin — no CORS, no Apache/Passenger path juggling).
// prepare-public.js copies the safe frontend files into server/public.
const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(__dirname, "public");
app.use(express.static(FRONTEND_DIR, {
  extensions: ["html"], dotfiles: "deny",
  // HTML must always revalidate (tools update); static assets can cache a bit
  setHeaders(res, p) {
    if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    else res.setHeader("Cache-Control", "public, max-age=3600");
  }
}));

// error safety net — never leak stack traces
app.use((err, req, res, next) => {
  console.error("[hg-api]", err);
  res.status(500).json({ error: { message: "Server error" } });
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => console.log("hg-api listening on :" + PORT));
