const mongoose = require("mongoose");

module.exports = async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.DATABASE_URI;

  if (!uri) {
    console.error("❌ MongoDB connection error: URI not set");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 1,
      retryWrites: true,
    });

    console.log("✅ MongoDB connected");

    mongoose.connection.on("connected", () => {
      console.log("Mongo connected event");
    });

    mongoose.connection.on("error", (err) => {
      console.error("Mongo error:", err.message);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("Mongo disconnected");
    });

    mongoose.connection.on("reconnected", () => {
      console.log("Mongo reconnected");
    });

    mongoose.connection.on("close", () => {
      console.warn("Mongo connection closed");
    });

  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  }
};