const express = require("express");
const router = express.Router();
const ExtraPrice = require("../../models/extraprice/ExtraPrice");

// upsert a price
router.post("/", async (req, res, next) => {
  try {
    const { key, amount, classLabel = "ALL", year = null, term = null, isActive = true } = req.body;
    if (!key || amount == null) return res.status(400).json({ error: "key and amount are required" });

    const doc = await ExtraPrice.findOneAndUpdate(
      { key: String(key).toUpperCase(), classLabel, year, term },
      { $set: { amount: Number(amount), isActive } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ message: "Price saved", data: doc });
  } catch (e) { next(e); }
});
// POST /extraprices/bulk
// Body: { items: [ {key, classLabel?, year?, term?, amount, isActive?}, ... ] }
router.post("/bulk", async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body.items;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Provide items: []" });
    }

    const ops = items.map((row) => {
      const key = String(row.key || "").toUpperCase();
      if (!key || row.amount == null) return null;

      const classLabel = row.classLabel ?? "ALL";
      const year = row.year ?? null;
      const term = row.term ?? null;
      const amount = Number(row.amount);
      const isActive = row.isActive == null ? true : !!row.isActive;

      return {
        updateOne: {
          filter: { key, classLabel, year, term },
          update: { $set: { amount, isActive } },
          upsert: true,
        }
      };
    }).filter(Boolean);

    if (!ops.length) return res.status(400).json({ error: "No valid items" });

    const result = await require("../../models/extraprice/ExtraPrice").bulkWrite(ops, { ordered: false });
    res.json({
      ok: true,
      matched: result.matchedCount,
      upserted: result.upsertedCount,
      modified: result.modifiedCount
    });
  } catch (e) { next(e); }
});

// list prices
router.get("/", async (req, res, next) => {
  try {
    const q = {};
    for (const k of ["key","classLabel","year","term","isActive"]) {
      if (req.query[k] != null) q[k] = k === "key" ? String(req.query[k]).toUpperCase() : req.query[k];
    }
    const rows = await ExtraPrice.find(q).sort({ key: 1, classLabel: 1, year: -1, term: 1 });
    res.json({ data: rows });
  } catch (e) { next(e); }
});

// helper used by statement
async function resolvePrice(key, classLabel, year = null, term = null) {
  key = String(key).toUpperCase();
  const rows = await ExtraPrice.find({ key, isActive: true }).lean();

  function score(r) {
    let s = 0;
    s += (r.classLabel === classLabel) ? 8 : (r.classLabel === "ALL" ? 0 : -999);
    s += (r.year === (year ?? null)) ? 4 : (r.year === null ? 0 : -999);
    s += (r.term === (term ?? null)) ? 2 : (r.term === null ? 0 : -999);
    return s;
  }

  let best = null, bestScore = -Infinity;
  for (const r of rows) {
    const sc = score(r);
    if (sc > bestScore) { best = r; bestScore = sc; }
  }
  return best ? best.amount : 0; // fallback 0 if not set
}
// DELETE /extra-prices/admin/all?confirm=WIPE_ALL
router.delete("/admin/all", async (req, res, next) => {
  try {
    if (req.query.confirm !== "WIPE_ALL") {
      return res.status(400).json({ message: "Add confirm=WIPE_ALL" });
    }
    const r = await ExtraPrice.deleteMany({});
    res.json({ ok: true, deleted: r.deletedCount });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.resolvePrice = resolvePrice;
