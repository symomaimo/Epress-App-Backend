const mongoose = require("mongoose");

const FeedingTransactionSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["PAYMENT", "MEAL"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    balanceAfter: {
      type: Number,
      default: 0,
    },

    date: {
      type: Date,
      default: Date.now,
    },

    year: {
      type: Number,
      required: true,
    },

    term: {
      type: String,
      enum: ["Term1", "Term2", "Term3"],
      required: true,
    },

    note: String,

    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "FeedingTransaction",
  FeedingTransactionSchema
);