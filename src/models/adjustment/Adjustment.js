const mongoose = require("mongoose");

const AdjustmentSchema = new mongoose.Schema({
  student:   { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
  year:      { type: Number, required: true, index: true },
  term:      { type: String, enum: ["Term1","Term2","Term3"], required: true, index: true },
  type:      { type: String, enum: ["OPENING","ADJUSTMENT"], default: "ADJUSTMENT" },
  amount:    { type: Number, required: true }, // +charge, -credit
  note:      { type: String, trim: true },
  createdBy: { type: String, trim: true } // optional user name/email
}, { timestamps: true });

AdjustmentSchema.index({ student: 1, year: 1, term: 1, createdAt: 1 });

module.exports = mongoose.model("Adjustment", AdjustmentSchema);