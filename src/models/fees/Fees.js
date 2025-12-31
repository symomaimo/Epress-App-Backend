// src/models/fees/Fees.js
const mongoose = require("mongoose");

const EditSnapshotSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: String },            // director name/id
    reason: { type: String, trim: true },
    changes: {
      amountPaid: { from: Number, to: Number },
      paymentMethod: { from: String, to: String },
      datePaid: { from: Date, to: Date },
      category: { from: String, to: String },
    },
  },
  { _id: false }
);

const feesSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },

    amountPaid: { type: Number, required: true, min: 0 },
    datePaid: { type: Date, default: Date.now, index: true },

    paymentMethod: {
      type: String,
      enum: ["CASH", "M-Pesa","PAYBILL", "TILL", "TOWER SACCO"],
      required: true,
      index: true,
    },

    year: { type: Number, required: true, index: true },
    term: {
      type: String,
      enum: ["Term1", "Term2", "Term3"],
      required: true,
      index: true,
    },

    // useful for lookups/printing
    receiptNo: { type: String, unique: true, sparse: true, index: true },

    // who recorded the original payment
    recordedBy: { type: String },

    // NEW: categorize what this payment was applied to
    category: { type: String, default: "FEES" }, // e.g. "FEES", "EXTRAS", "EXTRA:UNIFORM"

    // NEW: voiding
    isVoided: { type: Boolean, default: false, index: true },
    void: {
      reason: { type: String, trim: true },
      by: { type: String },       // director name/id
      at: { type: Date },
    },

    // NEW: edit audit trail (director-only changes)
    edits: { type: [EditSnapshotSchema], default: [] },
  },
  { timestamps: true }
);

/* ---------- helpful indexes for reports & lookups ---------- */
feesSchema.index({ datePaid: 1, paymentMethod: 1, isVoided: 1 });
feesSchema.index({ student: 1, year: 1, term: 1, isVoided: 1 });
feesSchema.index({ year: 1, term: 1, paymentMethod: 1, isVoided: 1 });

module.exports = mongoose.model("Fees", feesSchema);
