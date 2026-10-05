import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { analyze } from "./orchestrator.js";
import { InputError } from "./normalize.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const app = express();
app.disable("x-powered-by");
// Behind a proxy (Railway, Render, Fly, nginx) set TRUST_PROXY=1 so rate limiting sees the real client IP.
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.use((_req, res, next) => { res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" }); next(); });
app.use(cors());
app.use(express.json({ limit: "10kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Try again in a minute." } }));

const Body = z.object({ target: z.string().min(1).max(500) });

app.post("/api/analyze", async (req, res) => {
  const p = Body.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Provide a 'target' string." });
  try {
    res.json(await analyze(p.data.target));
  } catch (e) {
    if (e instanceof InputError) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: "Analysis failed. Please try again." });
  }
});

app.get("/api/analyze/stream", async (req, res) => {
  const p = Body.safeParse({ target: req.query.target });
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (!p.success) { send("fail", { error: "Provide a 'target' query parameter." }); return res.end(); }
  try {
    send("result", await analyze(p.data.target, (step) => send("progress", { step })));
  } catch (e) {
    send("fail", { error: e instanceof InputError ? e.message : "Analysis failed. Please try again." });
  }
  res.end();
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

// Production: serve the built web app from this same server so one deploy covers everything.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
if (process.env.VITEST !== "true" && fs.existsSync(path.join(dist, "index.html"))) {
  app.use(express.static(dist, { maxAge: "1h", index: false }));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

if (process.env.VITEST !== "true") {
  const port = Number(process.env.PORT ?? 8787);
  app.listen(port, () => console.log(`Chariora API on http://localhost:${port}`));
}
