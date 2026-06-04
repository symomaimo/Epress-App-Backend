const express = require("express");const mongoose = require("mongoose");

const router = express.Router();

const FeedingTransaction = require("../../models/feeding/FeedingTransaction");
const Student = require("../../models/student/Student");

const DAILY_FEEDING_AMOUNT = 30;

async function getFeedingBalance(studentId, year, term) {
  const query = { studentId };

  if (year) query.year = Number(year);
  if (term) query.term = term;

  const rows = await FeedingTransaction.find(query);

  return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

// Parent pays feeding money
router.post("/payment", async (req, res) => {
  try {
    const { studentId, amount, year, term, date, note } = req.body;

    if (!studentId || !amount || !year || !term) {
      return res.status(400).json({ error: "studentId, amount, year and term are required" });
    }

    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ error: "Student not found" });

   const currentBalance = await getFeedingBalance(studentId, year, term);
    const paidAmount = Math.abs(Number(amount));
    const balanceAfter = currentBalance + paidAmount;

    const tx = await FeedingTransaction.create({
      studentId,
      type: "PAYMENT",
      amount: paidAmount,
      balanceAfter,
      year,
      term,
      date: date ? new Date(date) : new Date(),
      note: note || "Feeding payment",
    });

    res.status(201).json({ transaction: tx, balance: balanceAfter });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to record feeding payment" });
  }
});

// Tick student ate today
router.post("/meal", async (req, res) => {
  try {
    const { studentId, year, term, date, amount, note } = req.body;

    if (!studentId || !year || !term) {
      return res.status(400).json({
        error: "studentId, year and term are required",
      });
    }

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // Normalize selected feeding date to start of day
    const mealDate = date ? new Date(date) : new Date();
    mealDate.setHours(0, 0, 0, 0);

    const nextDay = new Date(mealDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Prevent double ticking same student on same date
    const existingMeal = await FeedingTransaction.findOne({
      studentId,
      type: "MEAL",
      date: {
        $gte: mealDate,
        $lt: nextDay,
      },
    });

    if (existingMeal) {
      return res.status(409).json({
        error: "Student already marked as eaten for this date",
        balance: existingMeal.balanceAfter,
      });
    }

    const mealAmount = Math.abs(Number(amount || DAILY_FEEDING_AMOUNT));
   const currentBalance = await getFeedingBalance(studentId, year, term);
    const balanceAfter = currentBalance - mealAmount;

    const tx = await FeedingTransaction.create({
      studentId,
      type: "MEAL",
      amount: -mealAmount,
      balanceAfter,
      year,
      term,
      date: mealDate,
      note: note || "Ate meal",
    });

    res.status(201).json({
      transaction: tx,
      balance: balanceAfter,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message || "Failed to record meal",
    });
  }
});

// Student feeding statement
router.get("/statement/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;

    const transactions = await FeedingTransaction.find({ studentId })
      .sort({ date: 1, createdAt: 1 })
      .populate("studentId", "name fullName admissionNo classLabel");

    const balance = transactions.reduce((sum, row) => sum + Number(row.amount || 0), 0);

    res.json({ transactions, balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to get feeding statement" });
  }
});

router.get("/balance/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    const { year, term } = req.query;

    const balance = await getFeedingBalance(studentId, year, term);

    res.json({ balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message || "Failed to get balance",
    });
  }
});

// Bulk balances for many students at once
router.post("/balances", async (req, res) => {
  try {
    const { studentIds = [], year, term } = req.body;

    if (!Array.isArray(studentIds)) {
      return res.status(400).json({ error: "studentIds must be an array" });
    }

    if (studentIds.length > 1000) {
      return res.status(400).json({ error: "Too many students requested" });
    }

    const match = {
      studentId: {
        $in: studentIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    };

    if (year) match.year = Number(year);
    if (term) match.term = term;

    const rows = await FeedingTransaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$studentId",
          balance: { $sum: "$amount" },
        },
      },
    ]);

    const balances = {};
    for (const row of rows) {
      balances[String(row._id)] = Number(row.balance || 0);
    }

    for (const id of studentIds) {
      if (balances[id] == null) balances[id] = 0;
    }

    res.json({ balances });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to get balances" });
  }
});

// Sync offline meals from laptop/browser
router.post("/sync-meals", async (req, res) => {
  try {
    const { meals = [] } = req.body;

    if (!Array.isArray(meals)) {
      return res.status(400).json({ error: "meals must be an array" });
    }

    const synced = [];
    const skipped = [];

    for (const meal of meals) {
      const { offlineId, studentId, year, term, date, amount } = meal;

      if (!offlineId || !studentId || !year || !term || !date) {
        skipped.push({ offlineId, reason: "Missing required fields" });
        continue;
      }

      const mealDate = new Date(date);
      mealDate.setHours(0, 0, 0, 0);

      const nextDay = new Date(mealDate);
      nextDay.setDate(nextDay.getDate() + 1);

      const existingMeal = await FeedingTransaction.findOne({
        studentId,
        type: "MEAL",
        date: { $gte: mealDate, $lt: nextDay },
      });

      if (existingMeal) {
        synced.push({ offlineId, status: "already_exists" });
        continue;
      }

      const mealAmount = Math.abs(Number(amount || DAILY_FEEDING_AMOUNT));
      const currentBalance = await getFeedingBalance(studentId, year, term);
      const balanceAfter = currentBalance - mealAmount;

      await FeedingTransaction.create({
        studentId,
        type: "MEAL",
        amount: -mealAmount,
        balanceAfter,
        year,
        term,
        date: mealDate,
        note: "Offline meal sync",
      });

      synced.push({ offlineId, status: "synced" });
    }

    res.json({ synced, skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to sync meals" });
  }
});
// Get students already marked as eaten on a selected date
router.get("/meals-on-date", async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: "date is required" });
    }

    const day = new Date(date);
    day.setHours(0, 0, 0, 0);

    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);

    const meals = await FeedingTransaction.find({
      type: "MEAL",
      date: {
        $gte: day,
        $lt: nextDay,
      },
    }).select("studentId date amount");

    const studentIds = meals.map((m) => String(m.studentId));

    res.json({ studentIds, meals });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message || "Failed to get meals on date",
    });
  }
});

module.exports = router;