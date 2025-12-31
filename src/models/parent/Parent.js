const mongoose = require("mongoose");

const ParentSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, unique: true, trim: true }, // use E.164 if possible
  email: { type: String, trim: true, lowercase: true },
  address: { type: String, trim: true }
}, { timestamps: true });

module.exports = mongoose.model("Parent", ParentSchema);
