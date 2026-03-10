import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ─── Auction app at /auction ───
app.use("/auction", express.static(join(__dirname, "dist/auction")));
app.get("/auction/*", (req, res) => {
  res.sendFile(join(__dirname, "dist/auction/index.html"));
});

// ─── Logistics app at /logistics ───
app.use("/logistics", express.static(join(__dirname, "dist/logistics")));
app.get("/logistics/*", (req, res) => {
  res.sendFile(join(__dirname, "dist/logistics/index.html"));
});

// ─── Admin panel at /admin ───
app.use("/admin", express.static(join(__dirname, "dist/admin")));
app.get("/admin/*", (req, res) => {
  res.sendFile(join(__dirname, "dist/admin/index.html"));
});

// ─── Landing page at / (must be last) ───
app.use(express.static(join(__dirname, "dist/landing")));
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "dist/landing/index.html"));
});

app.listen(PORT, () => {
  console.log(`Sayarah Hub running on port ${PORT}`);
});
