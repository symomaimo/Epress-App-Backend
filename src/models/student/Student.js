const mongoose = require("mongoose");

const EnrollmentSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true, index: true },
    classLabel: { type: String, required: true, trim: true },

    // ✅ per-term opt-ins can be boolean OR string (e.g. TRANSPORT: "MAU")
    termOptIns: {
      Term1: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
      Term2: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
      Term3: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    },

    promotedAt: { type: Date },
    promotedBy: { type: String },
  },
  { _id: false }
);

const StudentSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, lowercase: true },
    secondName: { type: String, required: true, trim: true, lowercase: true },

    studentclass: { type: String, required: true, trim: true, index: true },

    currentEnrollmentYear: { type: Number, index: true },

    enrollments: { type: [EnrollmentSchema], default: [] },

    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Parent",
      default: null,
      index: true,
    },

    admittedYear: { type: Number },
    admittedTerm: { type: String, enum: ["Term1", "Term2", "Term3"] },

    status: {
      type: String,
      enum: ["active", "inactive", "left", "graduated"],
      default: "active",
      index: true,
    },

    inactiveMeta: {
      by: { type: String, default: "" },
      role: { type: String, default: "" },
      reason: { type: String, default: "" },
      at: { type: Date },
    },
  },
  { timestamps: true }
);

// indexes
StudentSchema.index({ firstName: 1, secondName: 1, studentclass: 1 }, { unique: false });
StudentSchema.index({ status: 1, "enrollments.year": 1 });
StudentSchema.index({ currentEnrollmentYear: 1, status: 1 });

module.exports = mongoose.model("Student", StudentSchema);