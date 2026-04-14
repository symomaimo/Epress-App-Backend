const mongoose = require("mongoose");

const ExtraPriceSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    uppercase: true,
    index: true
  },

  // ✅ NEW: route/place (used only for TRANSPORT)
  variant: {
    type: String,
    default: null,
    uppercase: true,
    trim: true,
    index: true
  },

  classLabel: {
    type: String,
    default: "ALL",
    index: true
  },

  year: {
    type: Number,
    default: null,
    index: true
  },

  term: {
    type: String,
    enum: ["Term1", "Term2", "Term3", null],
    default: null,
    index: true
  },

  amount: {
    type: Number,
    required: true,
    min: 0
  },

  isActive: {
    type: Boolean,
    default: true
  }

}, { timestamps: true });


// ✅ UPDATED UNIQUE INDEX (includes variant)
ExtraPriceSchema.index(
  { key: 1, variant: 1, classLabel: 1, year: 1, term: 1 },
  { unique: true }
);

module.exports = mongoose.model("ExtraPrice", ExtraPriceSchema);
