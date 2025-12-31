const mongoose = require("mongoose");

const StudentSchema = new mongoose.Schema({
  firstName:    { type: String, required: true, trim: true, lowercase: true },
  secondName:   { type: String, required: true, trim: true, lowercase: true },

  // IMPORTANT: don't lowercase this; we store canonical labels like "PP2", "Grade 7"
  studentclass: { type: String, required: true, trim: true, index: true },

  parent:       { type: mongoose.Schema.Types.ObjectId, ref: "Parent", default: null, index: true },

  // New (optional) — only set for new intakes going forward
  admittedYear: { type: Number }, // e.g., 2026
  admittedTerm: { type: String, enum: ["Term1","Term2","Term3"] },

  status:       { type: String, enum: ["active","left","graduated"], default: "active" }
}, { timestamps: true });

// Optional: enforce no duplicates by (firstName, secondName, class)
StudentSchema.index({ firstName: 1, secondName: 1, studentclass: 1 }, { unique: false });

module.exports = mongoose.model("Student", StudentSchema);
