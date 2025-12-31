const mongoose = require("mongoose");

const classSchema = new mongoose.Schema(
  {
    // keep canonical label like "PP2", "Grade 7" (do NOT lowercase)
    studentclass: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    year: { type: Number, required: true, index: true },
    term: {
      type: String,
      required: true,
      enum: ["Term1", "Term2", "Term3"],
      index: true,
    },
    fees: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

// one row per (class, year, term)
classSchema.index({ studentclass: 1, year: 1, term: 1 }, { unique: true });

module.exports = mongoose.model("Class", classSchema);
