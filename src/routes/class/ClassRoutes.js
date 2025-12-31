const express = require("express");
const router = express.Router();
const Class = require("../../models/class/Class");
const { normalizeClass } = require("../../config/classes");

// Create/Upsert tuition for (class, year, term)
router.post("/", async (req, res, next) => {
  try {
    const { studentclass, year, term, fees } = req.body;
    if (!studentclass || year == null || !term || fees == null) {
      return res
        .status(400)
        .json({ error: "studentclass, year, term, fees are required" });
    }
    const label = normalizeClass(studentclass);
    if (!label) return res.status(400).json({ error: "Invalid class label" });

    const doc = await Class.findOneAndUpdate(
      { studentclass: label, year: Number(year), term },
      { $set: { fees: Number(fees) } },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );
    return res.status(201).json({ message: "Saved", data: doc });
  } catch (err) {
    next(err);
  }
});
// POST /classes/bulk
// Body: { items: [ {studentclass, year, term, fees}, ... ] }  OR an array at root
router.post("/bulk", async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body.items;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Provide items: []" });
    }

    const Class = require("../../models/class/Class");

    const ops = items.map(r => {
      if (!r.studentclass || r.year == null || !r.term || r.fees == null) return null;
      return {
        updateOne: {
          filter: {
            studentclass: String(r.studentclass).trim(),
            year: Number(r.year),
            term: String(r.term).trim()
          },
          update: { $set: { fees: Number(r.fees) } },
          upsert: true
        }
      };
    }).filter(Boolean);

    if (!ops.length) return res.status(400).json({ error: "No valid items" });

    const result = await Class.bulkWrite(ops, { ordered: false });
    res.json({
      ok: true,
      matched: result.matchedCount,
      upserted: result.upsertedCount,
      modified: result.modifiedCount
    });
  } catch (e) { next(e); }
});

// List tuition rows (optional filters)
router.get("/", async (req, res, next) => {
  try {
    const q = {};
    if (req.query.studentclass) {
      const label = normalizeClass(req.query.studentclass);
      if (!label) return res.status(400).json({ error: "Invalid class label" });
      q.studentclass = label;
    }
    if (req.query.year != null) q.year = Number(req.query.year);
    if (req.query.term) q.term = req.query.term;

    const rows = await Class.find(q).sort({
      year: -1,
      term: 1,
      studentclass: 1,
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Quick lookup for a single (class, year, term)
router.get("/lookup", async (req, res, next) => {
  try {
    const { studentclass, year, term } = req.query;
    if (!studentclass || year == null || !term) {
      return res
        .status(400)
        .json({ error: "studentclass, year, term are required" });
    }
    const label = normalizeClass(studentclass);
    if (!label) return res.status(400).json({ error: "Invalid class label" });

    const row = await Class.findOne({
      studentclass: label,
      year: Number(year),
      term,
    });
    if (!row)
      return res
        .status(404)
        .json({ message: "Class fee not set for this term/year" });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// Update fees by id (typically you only change the amount)
router.put("/:id", async (req, res, next) => {
  try {
    if (req.body.fees == null)
      return res.status(400).json({ error: "fees is required" });
    const doc = await Class.findByIdAndUpdate(
      req.params.id,
      { $set: { fees: Number(req.body.fees) } },
      { new: true, runValidators: true }
    );
    if (!doc) return res.status(404).json({ message: "Class not found" });
    res.json({ message: "Updated", data: doc });
  } catch (err) {
    next(err);
  }
});

// Delete a row by id
router.delete("/:id", async (req, res, next) => {
  try {
    const doc = await Class.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: "Class not found" });
    res.json({ message: "Deleted" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
