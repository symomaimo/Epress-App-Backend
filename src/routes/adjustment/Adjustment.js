const express = require("express");
const router = express.Router();
const Adjustment = require("../../models/adjustment/Adjustment");
// Create an adjustment (including opening balance)
router.post("/", async (req, res, next) => {
  try {
    const { studentId, year, term, amount, type = "ADJUSTMENT", note, createdBy } = req.body;
    if (!studentId || !year || !term || amount == null) {
      return res.status(400).json({ error: "studentId, year, term, amount are required" });
    }
    const doc = await Adjustment.create({
      student: studentId, year: Number(year), term, amount: Number(amount), type, note, createdBy
    });
    res.status(201).json({ message: "Adjustment saved", data: doc });
  } catch (e) { next(e); }
});

// List adjustments (filter by student/year/term if passed)
router.get("/", async (req, res, next) => {
  try {
    const q = {};
    if (req.query.studentId) q.student = req.query.studentId;
    if (req.query.year) q.year = Number(req.query.year);
    if (req.query.term) q.term = req.query.term;
    const items = await Adjustment.find(q).sort({ createdAt: 1 });
    // Also return the sum to make it easy for UI
    const sum = items.reduce((a, x) => a + x.amount, 0);
    res.json({ totalAdjustments: sum, items });
  } catch (e) { next(e); }
});

module.exports = router;