// fees.routes.js (updated)

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Models
const ReceiptCounter = require("../../models/fees/ReceiptCounter");
const Fees = require("../../models/fees/Fees");
const Student = require("../../models/student/Student");
const Class = require("../../models/class/Class");
const Adjustment = require("../../models/adjustment/Adjustment");

// Config & helpers
const { SCHOOL } = require("../../config/Receipt");
const { computeExtras } = require("../../config/Extras");
const Pricing = require("../extraprice/ExtraPrice");
const resolvePrice = Pricing.resolvePrice;

// Auth
const { auth, allowRoles } = require("../../middleware/authMiddleware");

/* ---------------- helpers ---------------- */
function escRegex(s = "") {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeGradeLabel(raw = "") {
  const v = String(raw).trim().toLowerCase();
  if (!v) return "Unassigned";
  if (["playgroup", "play group", "pg"].includes(v)) return "Playgroup";
  if (["pp1", "pp 1", "pp-1"].includes(v)) return "PP1";
  if (["pp2", "pp 2", "pp-2"].includes(v)) return "PP2";
  // Handle GradeN, grade N, class N, std N, etc.
  const m = v.match(/(grade|class|std|standard)\s*[- ]?\s*([1-9])/);
  if (m) return `Grade ${m[2]}`;
  const m2 = v.match(/^grade\s*([1-9])$/);
  if (m2) return `Grade ${m2[1]}`;
  if (v === "grade1" || v === "grade 1") return "Grade 1";
  return raw || "Unassigned";
}

// ---------- helper: compute due (tuition + extras) ----------
async function computeDueBreakdown(student, year, term, classRow, opts = {}) {
  const tuition = Number(classRow.fees);

  const previousClass = opts.previousClass || null; // e.g. "Grade 6" if entering Grade 7
  const demand =
    typeof opts.demand === "string"
      ? opts.demand.split(",").filter(Boolean)
      : opts.demand || [];
  const perYearAlreadyCharged = opts.perYearAlreadyCharged || new Set();

  // Which extras apply (no amounts yet)
  const needed = computeExtras(student, Number(year), term, {
    previousClass,
    demand,
    perYearAlreadyCharged,
  });

  // Look up amounts from DB for each extra
  const extras = [];
  for (const item of needed) {
    const amt = await resolvePrice(
      item.key,
      student.studentclass,
      Number(year),
      term
    );
    if (amt > 0) extras.push({ ...item, amount: amt });
  }

  const extrasTotal = extras.reduce((a, e) => a + e.amount, 0);
  const totalDue = tuition + extrasTotal;

  return { tuition, extras, extrasTotal, totalDue };
}

function yyyymmddLocal(d = new Date()) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}${m}${day}`; // e.g. 20250923
}

async function nextReceiptNo(paidDate) {
  const key = yyyymmddLocal(paidDate);
  const doc = await ReceiptCounter.findOneAndUpdate(
    { date: key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `${key}-${String(doc.seq).padStart(4, "0")}`; // 20250923-0001
}

/* ------------- classRow finder (CI + normalized) ------------- */
async function findClassRowForStudent(student, year, term) {
  const wanted = student.studentclass || "";
  const norm = normalizeGradeLabel(wanted);

  // 1) case-insensitive exact on raw
  let classRow = await Class.findOne({
    year: Number(year),
    term,
    studentclass: { $regex: `^${escRegex(wanted)}$`, $options: "i" },
  });

  // 2) fallback: normalized label
  if (!classRow && norm && norm !== wanted) {
    classRow = await Class.findOne({
      year: Number(year),
      term,
      studentclass: { $regex: `^${escRegex(norm)}$`, $options: "i" },
    });
  }

  return { classRow, wanted, norm };
}

/* ---------------- Timezone helpers (Africa/Nairobi) ---------------- */

// For <input type="date"> "YYYY-MM-DD" → store as 00:00 KE (UTC value)
function kenyaMidnightUTC(dateStr /* "YYYY-MM-DD" */) {
  const [y, m, d] = dateStr.split("-").map(Number);
  // 00:00 in Kenya (UTC+3) = 21:00 previous day UTC
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 3 * 60 * 60 * 1000);
}

// Day bounds for reports (inclusive) in KE, expressed as UTC Date objects
function kenyaDayBoundsUTC(dateStr /* "YYYY-MM-DD" */) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const startUTC = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 3 * 60 * 60 * 1000);
  const endUTC   = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - 3 * 60 * 60 * 1000);
  return { startUTC, endUTC };
}

/* ===================== ROUTES ===================== */

// -------------------- Record a payment --------------------
router.post("/", async (req, res) => {
  try {
    const {
      studentId,
      amountPaid,
      paymentMethod,
      datePaid,   // "YYYY-MM-DD" from <input type="date"> OR ISO with time
      year,
      term,
      category,
      previousClass,
      demand,
      receiptNo,  // optional override
    } = req.body;

    if (!studentId || !amountPaid || !paymentMethod || !year || !term) {
      return res.status(400).json({
        message:
          "studentId, amountPaid, paymentMethod, year, term are required",
      });
    }

    // Normalize date once
    let dateObj;
    if (!datePaid) {
      dateObj = new Date(); // now
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(datePaid)) {
      dateObj = kenyaMidnightUTC(datePaid); // from type="date"
    } else {
      dateObj = new Date(datePaid); // ISO with time
      if (isNaN(dateObj)) {
        return res.status(400).json({ message: "Invalid datePaid format" });
      }
    }

    // Coerce amount
    const paid = Number(amountPaid);
    if (!Number.isFinite(paid) || paid < 0) {
      return res.status(400).json({ message: "amountPaid must be a non-negative number" });
    }

    // Student + class row
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });

    const { classRow, wanted, norm } = await findClassRowForStudent(student, year, term);
    if (!classRow) {
      return res.status(400).json({
        message: `Class fee not set for "${wanted}" (normalized: "${norm}") — year=${year}, term=${term}`,
      });
    }

    // Due (tuition + extras)
    const due = await computeDueBreakdown(student, Number(year), term, classRow, {
      previousClass: previousClass || null,
      demand: demand || null,
    });

    // Total paid so far BEFORE this payment
    const agg = await Fees.aggregate([
      {
        $match: {
          student: new mongoose.Types.ObjectId(studentId),
          year: Number(year),
          term,
        },
      },
      { $group: { _id: null, total: { $sum: "$amountPaid" } } },
    ]);
    const alreadyPaid = agg.length ? agg[0].total : 0;

    // Generate / accept receipt no using normalized date
    const finalReceiptNo = receiptNo || (await nextReceiptNo(dateObj));

    // Create payment
    const feesRecord = await Fees.create({
      student: studentId,
      amountPaid: paid,
      paymentMethod,
      datePaid: dateObj,            // stored in UTC; shows as 00:00 KE (no 03:00)
      year: Number(year),
      term,
      category: category || "FEES",
      receiptNo: finalReceiptNo,
      recordedBy: req.user?.name || "system",
      demand,
      previousClass,
    });

    // Adjustments (opening balances, waivers, etc.)
    const adjustments = await Adjustment.find({
      student: student._id,
      year: Number(year),
      term,
    }).lean();
    const adjTotal = adjustments.reduce((a, x) => a + Number(x.amount || 0), 0);

    const totalPaid = alreadyPaid + paid;
    const totalWithAdj = due.totalDue + adjTotal;
    const balance = totalWithAdj - totalPaid;

    return res.status(201).json({
      message: "Payment recorded",
      feesRecord,
      summary: {
        class: student.studentclass,
        year: Number(year),
        term,
        due: {
          tuition: due.tuition,
          extras: due.extras, // [{ key, label, amount }]
          adjustments: { total: adjTotal },
          total: totalWithAdj,
        },
        totalPaid,
        balance: balance < 0 ? 0 : balance,
        overpayment: balance < 0 ? Math.abs(balance) : 0,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /fees/daily?date=YYYY-MM-DD  (Director only)
router.get(
  "/daily",
  auth,
  allowRoles("DIRECTOR"),
  async (req, res, next) => {
    try {
      const qDate = req.query.date;
      if (!qDate) {
        return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
      }

      const { startUTC, endUTC } = kenyaDayBoundsUTC(qDate);

      const rows = await Fees.aggregate([
        {
          $match: {
            datePaid: { $gte: startUTC, $lte: endUTC },
            isVoided: { $ne: true }, // 👈 exclude voided payments
          },
        },
        {
          $group: {
            _id: "$paymentMethod",
            total: { $sum: "$amountPaid" },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      const grandTotal = rows.reduce((a, r) => a + r.total, 0);
      const count = rows.reduce((a, r) => a + r.count, 0);

      res.json({
        school: {
          name: SCHOOL.name,
          address: SCHOOL.address,
          phone: SCHOOL.phone,
          logo: SCHOOL.logo,
        },
        date: qDate,
        methods: rows.map((r) => ({
          paymentMethod: r._id,
          total: r.total,
          count: r.count,
        })),
        grandTotal,
        count,
        currency: "KES",
      });
    } catch (e) {
      next(e);
    }
  }
);
// GET /fees/daily/details?date=YYYY-MM-DD&method=TILL  (Director only)
// method is optional; omit or set method=ALL to get all methods for that day
router.get(
  "/daily/details",
  auth,
  allowRoles("DIRECTOR"),
  async (req, res, next) => {
    try {
      const { date, method } = req.query;
      if (!date) {
        return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
      }

      const { startUTC, endUTC } = kenyaDayBoundsUTC(date);

      const q = {
        datePaid: { $gte: startUTC, $lte: endUTC },
        isVoided: { $ne: true }, // 👈 exclude voided
      };
      if (method && method !== "ALL") q.paymentMethod = method;

      const rows = await Fees.find(q)
        .populate({ path: "student", select: "firstName secondName studentclass" })
        .sort({ datePaid: -1 })
        .lean();

      const list = rows.map((r) => ({
        _id: String(r._id),
        receiptNo: r.receiptNo || "",
        amountPaid: Number(r.amountPaid || 0),
        paymentMethod: r.paymentMethod,
        datePaid: r.datePaid,
        year: r.year,
        term: r.term,
        category: r.category || "FEES",
        student: {
          id: r.student?._id ? String(r.student._id) : "",
          name: r.student
            ? `${r.student.firstName || ""} ${r.student.secondName || ""}`.trim()
            : "(missing)",
          class: r.student?.studentclass || "",
        },
      }));

      const total = list.reduce((a, x) => a + x.amountPaid, 0);

      res.json({
        date,
        method: method || "ALL",
        count: list.length,
        total,
        payments: list,
        currency: "KES",
      });
    } catch (e) {
      next(e);
    }
  }
);

// GET /fees/term-summary?year=2026&term=Term1  (DIRECTOR only)
router.get(
  "/term-summary",
  auth,
  allowRoles("DIRECTOR"),
  async (req, res, next) => {
    try {
      const year = Number(req.query.year);
      const term = String(req.query.term || "");
      if (!year || !term) {
        return res.status(400).json({ error: "year and term are required" });
      }

      // 1) Received = sum of payments for the term (exclude voided)
      const recAgg = await Fees.aggregate([
        { $match: { year, term, isVoided: { $ne: true } } },
        { $group: { _id: null, total: { $sum: "$amountPaid" }, count: { $sum: 1 } } },
      ]);
      const totalReceived = recAgg.length ? recAgg[0].total : 0;
      const receiptsCount = recAgg.length ? recAgg[0].count : 0;

      // 2) Expected = sum over active students (tuition + extras + adjustments)
      const students = await Student.find({ status: "active" }).lean();

      let totalExpected = 0;
      let missingFeeRows = 0;

      // Small batches to avoid overloading DB
      const batchSize = 50;
      for (let i = 0; i < students.length; i += batchSize) {
        const batch = students.slice(i, i + batchSize);
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(
          batch.map(async (student) => {
            const { classRow } = await findClassRowForStudent(student, year, term);
            if (!classRow) { missingFeeRows += 1; return; }
            const due = await computeDueBreakdown(student, year, term, classRow, {});
            const adjustments = await Adjustment.find({ student: student._id, year, term }).lean();
            const adjTotal = adjustments.reduce((a, x) => a + Number(x.amount || 0), 0);
            totalExpected += Number(due.totalDue || 0) + adjTotal;
          })
        );
      }

      const percent = totalExpected > 0 ? Math.round((totalReceived / totalExpected) * 100) : 0;

      res.json({
        school: { name: SCHOOL.name, address: SCHOOL.address, phone: SCHOOL.phone, logo: SCHOOL.logo },
        year, term,
        studentsCount: students.length,
        receiptsCount,
        totalExpected,
        totalReceived,
        percent,               // 0–100
        currency: "KES",
        notes: missingFeeRows ? `${missingFeeRows} students missing fee rows for ${term} ${year}` : undefined,
      });
    } catch (e) { next(e); }
  }
);


// GET /fees/by-student/:id?year=2026&term=Term1
router.get("/by-student/:id", async (req, res, next) => {
  try {
    const q = { student: req.params.id };
    if (req.query.year) q.year = Number(req.query.year);
    if (req.query.term) q.term = req.query.term;
    const payments = await Fees.find(q).sort({ datePaid: -1 });
    res.json({ payments });
  } catch (e) {
    next(e);
  }
});

// GET /fees/receipt-by-number/:no  (Director only)
router.get(
  "/receipt-by-number/:no",
  auth,
  allowRoles("DIRECTOR"),
  async (req, res, next) => {
    try {
      const p = await Fees.findOne({ receiptNo: req.params.no })
        .populate({ path: "student", select: "firstName secondName studentclass" })
        .lean();

      if (!p) return res.status(404).json({ message: "Receipt not found" });

      // normalize student id from populated doc or raw id
      const studentId = p.student?._id ? String(p.student._id) : String(p.student);
      const student = await Student.findById(studentId);
      if (!student) return res.status(404).json({ message: "Student not found" });

      const classRow = await Class.findOne({
        studentclass: student.studentclass,
        year: Number(p.year),
        term: p.term,
      });
      if (!classRow) {
        return res.status(400).json({ message: "Class fee not set for this term/year" });
      }

      // Due = tuition + extras (labels + amounts)
      const due = await computeDueBreakdown(student, Number(p.year), p.term, classRow, {});

      const extras = Array.isArray(due.extras)
        ? due.extras.map(x => ({
            key: x.key,
            label: x.label || x.key,
            amount: Number(x.amount || 0),
          }))
        : [];

      const tuition = Number(due.tuition || 0);

      // Adjustments
      const adjustments = await Adjustment.find({
        student: student._id,
        year: Number(p.year),
        term: p.term,
      }).lean();

      const adjTotal = adjustments.reduce((a, x) => a + Number(x.amount || 0), 0);
      const extrasTotal = extras.reduce((a, x) => a + x.amount, 0);
      const totalWithAdj = Number(tuition + extrasTotal + adjTotal);

      // Total paid up to and including this receipt
      const paidToDateAgg = await Fees.aggregate([
        {
          $match: {
            student: new mongoose.Types.ObjectId(student._id),
            year: Number(p.year),
            term: p.term,
            datePaid: { $lte: new Date(p.datePaid) },
          },
        },
        { $group: { _id: null, total: { $sum: "$amountPaid" } } },
      ]);
      const totalPaidToDate = paidToDateAgg.length ? Number(paidToDateAgg[0].total) : 0;

      const balanceAfter = totalWithAdj - totalPaidToDate;
      const overpaymentAfter = balanceAfter < 0 ? Math.abs(balanceAfter) : 0;

      // Label for what this payment was for
      let appliedLabel = "Tuition";
      if (p.category && typeof p.category === "string") {
        const up = p.category.toUpperCase();
        if (up === "FEES") appliedLabel = "Tuition";
        else if (up.startsWith("EXTRA:")) {
          const key = p.category.split(":")[1] || "";
          appliedLabel = `Extra: ${key.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase())}`;
        } else {
          appliedLabel = p.category;
        }
      }

      res.json({
        school: {
          name: SCHOOL.name,
          address: SCHOOL.address,
          phone: SCHOOL.phone,
          logo: SCHOOL.logo
        },
        receiptNo: p.receiptNo,
        datePaid: p.datePaid,
        paymentMethod: p.paymentMethod,
        amountPaid: Number(p.amountPaid || 0),
        appliedTo: { category: p.category || "FEES", label: appliedLabel },

        student: {
          id: studentId,
          name: p.student ? `${p.student.firstName} ${p.student.secondName}` : "",
          class: p.student?.studentclass || ""
        },

        year: p.year,
        term: p.term,

        statement: {
          due: {
            tuition,
            extras,
            adjustments: { total: adjTotal, items: adjustments },
            total: totalWithAdj
          },
          totalPaidToDate,
          balanceAfter: balanceAfter < 0 ? 0 : balanceAfter,
          overpaymentAfter,
        },

        currency: "KES"
      });
    } catch (e) { next(e); }
  }
);

// --------------- Student statement (by year+term) ---------------
router.get("/statement/:studentId", async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { year, term, previousClass, demand } = req.query;

    if (!year || !term) {
      return res.status(400).json({ error: "year and term are required" });
    }

    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });

    const { classRow, wanted, norm } = await findClassRowForStudent(
      student,
      year,
      term
    );

    if (!classRow) {
      return res.status(400).json({
        message: `Class fee not set for "${wanted}" (normalized: "${norm}") — year=${year}, term=${term}`,
      });
    }

    // Due = tuition + extras (rules + dynamic prices)
    const due = await computeDueBreakdown(
      student,
      Number(year),
      term,
      classRow,
      {
        previousClass: previousClass || null,
        demand: demand || null,
      }
    );

    // Payments in this term
    const payments = await Fees.find({
      student: studentId,
      year: Number(year),
      term,
    }).sort({ datePaid: 1 });

    const totalPaid = payments.reduce((a, p) => a + p.amountPaid, 0);

    // Adjustments in this term
    const adjustments = await Adjustment.find({
      student: student._id,
      year: Number(year),
      term,
    })
      .sort({ createdAt: 1 })
      .lean();

    const adjTotal = adjustments.reduce((a, x) => a + x.amount, 0);
    const totalWithAdj = due.totalDue + adjTotal;
    const balance = totalWithAdj - totalPaid;

    res.json({
      student: {
        id: student._id,
        firstName: student.firstName,
        secondName: student.secondName,
        class: student.studentclass,
      },
      year: Number(year),
      term,
      due: {
        tuition: due.tuition,
        extras: due.extras,
        adjustments: { total: adjTotal, items: adjustments },
        total: totalWithAdj,
      },
      totalPaid,
      balance: balance < 0 ? 0 : balance,
      overpayment: balance < 0 ? Math.abs(balance) : 0,
      payments,
    });
  } catch (err) {
    next(err);
  }
});

/* ---------- Debug: see which classes lack fee rows ---------- */
// GET /fees/debug/missing-classes?year=20265&term=Term1
router.get("/debug/missing-classes", async (req, res, next) => {
  try {
    const year = Number(req.query.year);
    const term = String(req.query.term || "");
    if (!year || !term) return res.status(400).json({ error: "year and term required" });

    const students = await Student.find({}).select("studentclass").lean();
    const seen = new Set(students.map(s => normalizeGradeLabel(s.studentclass || "")));
    const feeRows = await Class.find({ year, term }).select("studentclass").lean();
    const have = new Set(feeRows.map(r => normalizeGradeLabel(r.studentclass || "")));

    const missing = [...seen].filter(c => c && !have.has(c));
    res.json({ year, term, missing: missing.sort(), have: [...have].sort() });
  } catch (e) { next(e); }
});
// ================== ADMIN NUKE (payments + fee tables + pricing + counters) ==================
router.delete(
  "/admin/wipe",
  auth,
  allowRoles("DIRECTOR"),
  async (req, res, next) => {
    try {
      const confirm = req.query.confirm;              // must be 'NUKE'
      const scope = String(req.query.scope || "all"); // 'all' | 'payments' | 'feeTables' | 'pricing' | 'adjustments' | 'counters' | 'students'
      const dryRun = req.query.dryRun === "true";     // optional preview

      if (confirm !== "NUKE") {
        return res.status(400).json({ message: "Add confirm=NUKE to proceed" });
      }

      // Import models here to avoid circulars
      const ReceiptCounter = require("../../models/fees/ReceiptCounter");
      const Fees           = require("../../models/fees/Fees");
      const Class          = require("../../models/class/Class");        // your fee tables per year/term/class
      const Adjustment     = require("../../models/adjustment/Adjustment");
      const Student        = require("../../models/student/Student");

      // Your extra pricing model (if exported as a Mongoose model)
      let ExtraPrice = null;
      try { ExtraPrice = require("../extraprice/ExtraPrice"); } catch(_) {}

      const targets = [];
      if (scope === "all" || scope === "payments")   targets.push({ name: "payments",   model: Fees });
      if (scope === "all" || scope === "feeTables")  targets.push({ name: "feeTables",  model: Class });
      if (scope === "all" || scope === "pricing")    targets.push({ name: "pricing",    model: ExtraPrice });
      if (scope === "all" || scope === "adjustments")targets.push({ name: "adjustments",model: Adjustment });
      if (scope === "all" || scope === "counters")   targets.push({ name: "counters",   model: ReceiptCounter });
      if (scope === "students")                      targets.push({ name: "students",   model: Student }); // only if you REALLY want to wipe students

      // Filter out anything not available (e.g., pricing model missing)
      const finalTargets = targets.filter(t => t.model && t.model.deleteMany);

      // Dry run — just counts
      if (dryRun) {
        const counts = {};
        for (const t of finalTargets) {
          counts[t.name] = await t.model.countDocuments();
        }
        return res.json({ ok: true, dryRun: true, counts, scope });
      }

      // Real wipe (transaction)
      const session = await mongoose.startSession();
      const summary = { deleted: {}, scope };
      await session.withTransaction(async () => {
        for (const t of finalTargets) {
          const c = await t.model.countDocuments({}, { session });
          const r = await t.model.deleteMany({}, { session });
          summary.deleted[t.name] = { before: c, deleted: r.deletedCount || r.acknowledged ? c : 0 };
        }
      });
      await session.endSession();

      return res.json({ ok: true, ...summary });
    } catch (e) { next(e); }
  }
);

module.exports = router;
