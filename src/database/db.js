// src/database/db.js
const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const uri = process.env.DATABASE_URI; // e.g. mongodb://localhost:27017/school?replicaSet=rs0
    if (!uri) throw new Error("DATABASE_URI not set");
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 20 });
    console.log("MongoDB connected:", mongoose.connection.name);
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    process.exit(1);
  }

  mongoose.connection.on("error", (e) => console.error("Mongo error:", e));
  process.on("SIGINT", async () => {
    await mongoose.connection.close();
    process.exit(0);
  });
};

module.exports = connectDB;
