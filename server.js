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

// ─── Rate limiting ───
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150, // limit each IP to 150 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use(limiter);

// Stricter limit for auth-related pages
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 login page loads per 15 min
  standardHeaders: true,
  legacyHeaders: false,
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
// Block direct access to billing.html — only accessible inside admin app (iframe after login)
app.get("/admin/billing.html", (req, res) => {
  const referer = req.headers.referer || "";
  if (!referer.includes("/admin")) {
    return res.status(403).send("Access denied. This tool is only available inside the Admin Panel.");
  }
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
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
