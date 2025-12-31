const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true }, // bcrypt hash
  role: { type: String, enum: ["DIRECTOR", "SECRETARY"], required: true },
}, { timestamps: true });

module.exports = mongoose.model("User", UserSchema);
