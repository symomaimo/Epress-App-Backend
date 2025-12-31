const mongoose = require("mongoose");

const ExtraPriceSchema = new mongoose.Schema({
  key:        { type: String, required: true, uppercase: true, index: true },  // e.g. "ADMISSION_FEE"
  classLabel: { type: String, default: "ALL", index: true },                    // e.g. "PP2","Grade 7","ALL"
  year:       { type: Number, default: null, index: true },                     // null = any year
  term:       { type: String, enum: ["Term1","Term2","Term3", null], default: null, index: true },
  amount:     { type: Number, required: true, min: 0 },
  isActive:   { type: Boolean, default: true }
}, { timestamps: true });

ExtraPriceSchema.index({ key: 1, classLabel: 1, year: 1, term: 1 }, { unique: true });

module.exports = mongoose.model("ExtraPrice", ExtraPriceSchema);
