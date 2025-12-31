const mongoose = require("mongoose");

module.exports = async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.DATABASE_URI;
  if (!uri) {
    console.error("❌ MongoDB connection error: MONGO_URI / DATABASE_URI not set");
    process.exit(1);
  }
  try {
    await mongoose.connect(uri, { maxPoolSize: 10 });
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  }
};
