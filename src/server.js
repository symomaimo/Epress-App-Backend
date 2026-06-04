// src/server.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const path = require("path");
require("dotenv").config();

const connectDB = require("./database/db");

const authRoutes = require("./routes/auth/AuthRoutes");
const parentRoutes = require("./routes/parent/parentRoutes");
const studentRoutes = require("./routes/student/StudentRoutes");
const classRoutes = require("./routes/class/ClassRoutes");
const feesRoutes = require("./routes/fee/FeesRoutes");
const feedingRoutes = require("./routes/feeding/FeedingRoutes");
const extraPriceRoutes = require("./routes/extraprice/ExtraPrice");
const adjustmentRoutes = require("./routes/adjustment/Adjustment");

const app = express();

/** ---------- security & perf ---------- */
app.use(helmet());              // sensible HTTP headers
app.use(compression());         // gzip responses
app.set("trust proxy", 1);      // okay behind proxies if ever needed

/** ---------- CORS ----------
 * DEV (laptop): http://localhost:5173
 * PROD (school PC): change FRONTEND_ORIGIN in .env if the UI runs elsewhere
 */
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false, // set true only if you use cookies
  })
);
app.options("*", cors());

/** ---------- parsers ---------- */
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/** ---------- DB connect early ---------- */
connectDB();

/** ---------- health & root ---------- */
const publicPath = path.join(__dirname, "..", "public");
app.get("/api/health", (req, res) =>
  res.json({ ok: true, env: process.env.NODE_ENV || "development" })
);

/** ---------- API routes ---------- */
app.use("/auth", authRoutes);
app.use("/parents", parentRoutes);
app.use("/students", studentRoutes);
app.use("/classes", classRoutes);
app.use("/fees", feesRoutes);
app.use("/feeding", feedingRoutes);
app.use("/extraprices", extraPriceRoutes);
app.use("/adjustments", adjustmentRoutes);

/** ---------- frontend ---------- */
app.use(express.static(publicPath));

app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});


/** ---------- error handler ---------- */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

/** ---------- start server ---------- */
const PORT = Number(process.env.PORT || 5000);
// Bind to 0.0.0.0 so it also works over LAN when you open the firewall
const HOST = process.env.HOST || "0.0.0.0";

const server = app.listen(PORT, HOST, () =>
  console.log(`API listening on http://${HOST}:${PORT}`)
);

/** ---------- graceful shutdown ---------- */
process.on("SIGINT", () => {
  console.log("Shutting down...");
  server.close(() => {
    console.log("HTTP closed");
    process.exit(0);
  });
});
