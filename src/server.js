const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("./database/db");
const cors = require("cors"); // <-- add this

// import routes
const parentRoutes = require("./routes/parent/parentRoutes");
const studentRoutes = require("./routes/student/StudentRoutes");
const classRoutes = require("./routes/class/ClassRoutes");
const feesRoutes = require("./routes/fee/FeesRoutes");

// CONNECT TO MONGODB
connectDB();

// Middlewares
app.use(cors()); // <-- allow frontend access
app.use(express.json());

// Test route
app.get("/", (req, res) => {
  res.send("yooh");
});

// Use routes
app.use("/parents", parentRoutes);
app.use("/students", studentRoutes);
app.use("/classes", classRoutes);
app.use("/fees", feesRoutes);

// Export app for Vercel to use as a serverless function
module.exports = app;
