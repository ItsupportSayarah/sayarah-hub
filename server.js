import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import morgan from "morgan";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ─── Request logging ───
app.use(morgan("combined"));

// ─── Security headers (helmet) ───
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://apis.google.com", "https://*.firebaseapp.com", "https://*.googleapis.com", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.googleapis.com", "https://*.googleusercontent.com", "https://firebasestorage.googleapis.com"],
      connectSrc: ["'self'", "blob:", "https://*.firebaseio.com", "https://*.googleapis.com", "https://*.firebaseapp.com", "wss://*.firebaseio.com", "https://firebasestorage.googleapis.com", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "https://ipapi.co", "https://api.ipify.org", "http://ip-api.com", "https://api.anthropic.com", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      frameSrc: ["'self'", "https://*.firebaseapp.com"],
      workerSrc: ["'self'", "blob:"],
      scriptSrcAttr: ["'unsafe-inline'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ─── Gzip compression ───
app.use(compression());

// ─── Request body size limits (prevent DoS) ───
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// ─── Rate limiting ───
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150, // limit each IP to 150 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  // Static assets (hashed JS/CSS, logos, fonts, source maps) are cheap and
  // a single page load fetches several of them — counting each against the
  // 150-req budget means ~20 hard refreshes burns through the quota and
  // trips real API calls. Exempt them so the limit only bites meaningful
  // traffic: HTML navigations, API POSTs, auth flows.
  skip: (req) => req.method === "GET" && /\.(js|mjs|css|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|map)$/i.test(req.path),
});
app.use(limiter);

// Stricter limit for auth-related pages
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 login page loads per 15 min
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Claude AI proxy for billing tool (keeps API key server-side) ───
const aiLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { error: "AI rate limit reached. Try again in an hour." } });
app.post("/api/ai/analyze", aiLimiter, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "AI not configured. Set ANTHROPIC_API_KEY env var." });
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);
    res.json(data);
  } catch (e) { res.status(500).json({ error: "AI request failed: " + e.message }); }
});

// ─── Health check ───
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ─── HTTPS enforcement & www redirect (Heroku) ───
app.use((req, res, next) => {
  const host = req.headers.host || "";
  const proto = req.headers["x-forwarded-proto"];

  if (host === "atlanticcarconnect.com") {
    return res.redirect(301, `https://www.atlanticcarconnect.com${req.url}`);
  }

  if (proto && proto !== "https") {
    return res.redirect(301, `https://${host}${req.url}`);
  }

  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  next();
});

// ─── Cache headers for hashed assets ───
const cacheStatic = (maxAge) => express.static.bind(null);
const staticOpts = { maxAge: "1y", immutable: true };
const htmlOpts = { maxAge: "0", setHeaders: (res) => res.setHeader("Cache-Control", "no-cache") };

// Serve hashed JS/CSS with long cache, HTML with no-cache
const serveApp = (route, dir) => {
  app.use(route, express.static(join(__dirname, dir, "assets"), staticOpts));
  app.use(route, express.static(join(__dirname, dir), { maxAge: "1h" }));
  app.get(`${route}/*`, (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(__dirname, dir, "index.html"));
  });
};

// ─── Auction app at /auction ───
serveApp("/auction", "dist/auction");

// ─── Logistics app at /logistics ───
serveApp("/logistics", "dist/logistics");

// ─── Admin panel at /admin ───
app.use("/admin", authLimiter);
// Serve billing.html under /admin — protected by same-origin iframe + rate limiter
app.get("/admin/billing.html", (req, res) => {
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.sendFile(join(__dirname, "apps/admin/billing.html"));
});
serveApp("/admin", "dist/admin");

// ─── Block direct access to billing.html ───
app.get("/billing.html", (req, res) => {
  res.status(404).send("Not found");
});

// ─── Landing page at / (must be last) ───
app.use(express.static(join(__dirname, "dist/landing"), {
  maxAge: "1h",
  setHeaders: (res, path) => {
    if (path.endsWith("billing.html")) {
      res.status(403);
    }
  },
}));
app.get("*", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(join(__dirname, "dist/landing/index.html"));
});

// ─── 404 handler ───
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ─── Global error handler ───
app.use((err, req, res, next) => {
  console.error("Server error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Sayarah Hub running on port ${PORT} [${process.env.NODE_ENV || "development"}]`);
});
