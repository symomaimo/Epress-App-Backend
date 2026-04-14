// models/PromotionLog.js
const mongoose = require("mongoose");

const PromotionLogSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    fromYear: { type: Number, required: true, index: true },
    toYear: { type: Number, required: true },
    fromClass: { type: String, required: true },
    toClass: { type: String, required: true },
    term: { type: String, enum: ["Term1", "Term2", "Term3"], required: true },
    promotedBy: { type: String, default: "system" },
  },
  { timestamps: true }
);

// ✅ THE KEY: prevent promoting same student from same year twice
PromotionLogSchema.index({ studentId: 1, fromYear: 1 }, { unique: true });

module.exports = mongoose.model("PromotionLog", PromotionLogSchema);
