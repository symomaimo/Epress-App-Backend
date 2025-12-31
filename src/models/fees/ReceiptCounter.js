const mongoose = require("mongoose");

const ReceiptCounterSchema = new mongoose.Schema({
  // e.g. "20260923" (YYYYMMDD)
  date: { type: String, required: true, unique: true },
  seq:  { type: Number, required: true, default: 0 }
});

module.exports = mongoose.model("ReceiptCounter", ReceiptCounterSchema);
