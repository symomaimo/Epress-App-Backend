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
    
function getClassForYear(student, year) {
  if (!student) return "";

  const y = Number(year);
  if (!Number.isFinite(y)) return "";

  const enrollments = Array.isArray(student.enrollments) ? student.enrollments : [];

  // exact match (recommended)
  const hit = enrollments.find((e) => Number(e.year) === y && e.classLabel);
  if (hit?.classLabel) return hit.classLabel;

  // fallback: if no enrollment found, fall back to studentclass
  return student.studentclass || "";
}

function normalizeClassLabel(raw) {
  // keep simple here (don’t over-normalize if you already store clean labels like "PP1", "PP2", "Grade 3")
  return String(raw || "").trim();
}





// ---------- helper: compute due (tuition + extras) ----------
// ---------- helper: compute due (tuition + extras) ----------
async function computeDueBreakdown(student, year, term, classRow, opts = {}) {
  const tuition = Number(classRow.fees);
  const priceCache = opts.priceCache || new Map();

  const previousClass = opts.previousClass || null;
  const demand =
    typeof opts.demand === "string"
      ? opts.demand
          .split(",")
          .map((x) => x.trim().toUpperCase())
          .filter(Boolean)
      : Array.isArray(opts.demand)
      ? opts.demand.map((x) => String(x).trim().toUpperCase()).filter(Boolean)
      : [];

  const perYearAlreadyCharged = opts.perYearAlreadyCharged || new Set();
  const onceAlreadyCharged = opts.onceAlreadyCharged || new Set();

  // Which extras apply (no amounts yet)
  const needed = computeExtras(student, Number(year), term, {
    previousClass,
    demand,
    perYearAlreadyCharged,
    onceAlreadyCharged,
  });

  const effectiveClass = getClassForYear(student, year) || student.studentclass || "";

  // Look up amounts from DB for each extra
  const extras = [];
  for (const item of needed) {
    const isGlobalKey =
      /^TEXTBOOKS_STAGE_/.test(item.key) ||
      item.key === "REAMS_G7_9_T2" ||
      item.key === "GRAD_PP2_T3" ||
      item.key === "TRANSPORT";

    const classLabelForPrice = isGlobalKey ? "ALL" : effectiveClass;

    let safeVariant = item.variant ?? null;

    if (item.key === "TRANSPORT") {
      safeVariant = String(safeVariant || "").trim().toUpperCase();

      if (!["TIPIS", "MAU", "GATIMU"].includes(safeVariant)) {
        console.warn("INVALID TRANSPORT VARIANT - SKIPPING", {
          studentId: String(student?._id || ""),
          rawVariant: item.variant,
          safeVariant,
          year,
          term,
        });
        continue;
      }
    }

    const cacheKey = [
      item.key,
      classLabelForPrice,
      Number(year),
      term,
      safeVariant ?? "",
    ].join("|");

    let amt;
    if (priceCache.has(cacheKey)) {
      amt = priceCache.get(cacheKey);
    } else {
      // eslint-disable-next-line no-await-in-loop
      amt = await resolvePrice(
        item.key,
        classLabelForPrice,
        Number(year),
        term,
        safeVariant
      );
      priceCache.set(cacheKey, amt);
    }

    if (amt > 0) {
      extras.push({
        ...item,
        variant: safeVariant,
        amount: amt,
      });
    }
  }

  const extrasTotal = extras.reduce((a, e) => a + Number(e.amount || 0), 0);
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

/* ------------- classRow finder (CI + normalized + class-for-year) ------------- */
async function findClassRowForStudent(student, year, term) {
  const wanted = getClassForYear(student, year) || student.studentclass || "";
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
  const endUTC = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - 3 * 60 * 60 * 1000);
  return { startUTC, endUTC };
}

async function buildTermMetrics(year, term) {
  // 1) Received = sum of payments for the term (exclude voided)
  const recAgg = await Fees.aggregate([
    { $match: { year, term, isVoided: { $ne: true } } },
    { $group: { _id: null, total: { $sum: "$amountPaid" }, count: { $sum: 1 } } },
  ]);
  const totalReceived = recAgg.length ? Number(recAgg[0].total || 0) : 0;
  const receiptsCount = recAgg.length ? Number(recAgg[0].count || 0) : 0;

  // 2) Students active in this year
  const students = await Student.find({
    status: "active",
    enrollments: { $elemMatch: { year } },
  });

  const studentIds = students.map((s) => s._id);

  // 3) Adjustments for this term
  const adjRows = studentIds.length
    ? await Adjustment.find({
        student: { $in: studentIds },
        year,
        term,
      })
        .select("student amount")
        .lean()
    : [];

  const adjMap = new Map();
  for (const a of adjRows) {
    const sid = String(a.student);
    adjMap.set(sid, (adjMap.get(sid) || 0) + Number(a.amount || 0));
  }

  // 4) Payments by student
  const paymentsAgg = studentIds.length
    ? await Fees.aggregate([
        {
          $match: {
            student: { $in: studentIds },
            year,
            term,
            isVoided: { $ne: true },
          },
        },
        {
          $group: {
            _id: "$student",
            paid: { $sum: "$amountPaid" },
          },
        },
      ])
    : [];

  const paidMap = new Map(
    paymentsAgg.map((r) => [String(r._id), Number(r.paid || 0)])
  );

  // 5) ON_DEMAND keys summary
  const ON_DEMAND_KEYS = [
    "FEEDING_TERMLY",
    "DAMAGE",
    "MEDICAL",
    "TOUR",
    "SET_BOOKS_G7_9",
    "TEXTBOOKS_ON_DEMAND",
    "LOSTBOOKS",
    "REAM_G7_9",
    "TRANSPORT",
  ];
  const onDemandSet = new Set(ON_DEMAND_KEYS.map((k) => String(k).toUpperCase()));

  const optIns = {};
  for (const k of onDemandSet) optIns[k] = { count: 0, total: 0 };

  let missingFeeRows = 0;
  let totalExpected = 0;
  let totalBalance = 0;

  const perStudent = [];
  const classMap = new Map();

  const batchSize = 50;

  for (let i = 0; i < students.length; i += batchSize) {
    const batch = students.slice(i, i + batchSize);

    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(
      batch.map(async (studentDoc) => {
        const student = studentDoc.toObject({ depopulate: true });

        const enr = (student.enrollments || []).find((e) => Number(e.year) === Number(year));
        const classForYear = enr?.classLabel || student.studentclass || "Unassigned";
        student.studentclass = classForYear;

        const { classRow } = await findClassRowForStudent(student, year, term);
        if (!classRow) {
          return {
            ok: false,
            sid: String(student._id),
            name: `${student.firstName || ""} ${student.secondName || ""}`.trim(),
            classLabel: classForYear,
            expected: 0,
            paid: paidMap.get(String(student._id)) || 0,
            balance: 0,
            extras: [],
          };
        }

        const due = await computeDueBreakdown(student, year, term, classRow, {
          onceAlreadyCharged: new Set(),
          perYearAlreadyCharged: new Set(),
          previousClass: null,
          demand: null,
        });

        const sid = String(student._id);
        const adjTotal = adjMap.get(sid) || 0;
        const expected = Number(due.totalDue || 0) + adjTotal;
        const paid = paidMap.get(sid) || 0;
        const balance = Math.max(0, expected - paid);

        return {
          ok: true,
          sid,
          name: `${student.firstName || ""} ${student.secondName || ""}`.trim(),
          classLabel: classForYear,
          expected,
          paid,
          balance,
          extras: Array.isArray(due.extras) ? due.extras : [],
        };
      })
    );

    for (const r of results) {
      if (!r.ok) {
        missingFeeRows += 1;
        continue;
      }

      totalExpected += Number(r.expected || 0);
      totalBalance += Number(r.balance || 0);

      perStudent.push({
        studentId: r.sid,
        name: r.name,
        classLabel: r.classLabel,
        expected: r.expected,
        paid: r.paid,
        balance: r.balance,
      });

      // class breakdown accumulator
      const classKey = r.classLabel || "Unassigned";

      if (!classMap.has(classKey)) {
        classMap.set(classKey, {
          classLabel: classKey,
          studentsCount: 0,
          expected: 0,
          collected: 0,
          balance: 0,
        });
      }

      const classRow = classMap.get(classKey);
      classRow.studentsCount += 1;
      classRow.expected += Number(r.expected || 0);
      classRow.collected += Number(r.paid || 0);
      classRow.balance += Number(r.balance || 0);

      // ON_DEMAND opt-ins summary
      for (const ex of r.extras) {
        const k = String(ex?.key || "").toUpperCase();
        if (!onDemandSet.has(k)) continue;

        optIns[k].count += 1;
        optIns[k].total += Number(ex?.amount || 0);
      }
    }
  }

  const percent =
    totalExpected > 0 ? Math.round((totalReceived / totalExpected) * 100) : 0;

  const optInsNonZero = {};
  for (const [k, v] of Object.entries(optIns)) {
    if ((v.count || 0) > 0 || (v.total || 0) > 0) {
      optInsNonZero[k] = v;
    }
  }

  const topDefaulters = perStudent
    .filter((s) => s.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 10);

  const classBreakdown = Array.from(classMap.values())
    .map((row) => ({
      ...row,
      collectionRate:
        row.expected > 0 ? Math.round((row.collected / row.expected) * 100) : 0,
    }))
    .sort((a, b) => String(a.classLabel).localeCompare(String(b.classLabel)));

  return {
    year,
    term,
    studentsCount: students.length,
    receiptsCount,
    totalExpected,
    totalReceived,
    totalBalance,
    percent,
    optIns: optInsNonZero,
    topDefaulters,
    classBreakdown,
    missingFeeRows,
  };
}



/* ===================== ROUTES ===================== */

router.post("/", async (req, res) => {
  try {
    const {
      studentId,
      amountPaid,
      paymentMethod,
      datePaid,
      year,
      term,
      category,
      previousClass,
      demand,
      receiptNo,
    } = req.body;

    if (!studentId || amountPaid === undefined || amountPaid === null || !paymentMethod || !year || !term) {
      return res.status(400).json({
        message: "studentId, amountPaid, paymentMethod, year, term are required",
      });
    }

    // Normalize date once
    let dateObj;
    if (!datePaid) {
      dateObj = new Date();
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(datePaid)) {
      dateObj = kenyaMidnightUTC(datePaid);
    } else {
      dateObj = new Date(datePaid);
      if (isNaN(dateObj)) {
        return res.status(400).json({ message: "Invalid datePaid format" });
      }
    }

    // Coerce amount
    const paid = Number(amountPaid);
    if (!Number.isFinite(paid) || paid < 0) {
      return res.status(400).json({ message: "amountPaid must be a non-negative number" });
    }

    // Student
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });

    // Class row
    const { classRow, wanted, norm } = await findClassRowForStudent(student, year, term);
    if (!classRow) {
      return res.status(400).json({
        message: `Class fee not set for "${wanted}" (normalized: "${norm}") — year=${year}, term=${term}`,
      });
    }

    // Always compute the full due for the selected term/year.
    const onceAlreadyCharged = new Set();
    const perYearAlreadyCharged = new Set();

    const due = await computeDueBreakdown(student, Number(year), term, classRow, {
      previousClass: previousClass || null,
      demand: demand || null,
      onceAlreadyCharged,
      perYearAlreadyCharged,
      priceCache: new Map(),
    });

    // Total paid so far BEFORE this payment (exclude voided)
    const agg = await Fees.aggregate([
      {
        $match: {
          student: new mongoose.Types.ObjectId(studentId),
          year: Number(year),
          term,
          isVoided: { $ne: true },
        },
      },
      { $group: { _id: null, total: { $sum: "$amountPaid" } } },
    ]);
    const alreadyPaid = agg.length ? agg[0].total : 0;

    // Receipt
    const finalReceiptNo = receiptNo || (await nextReceiptNo(dateObj));

    // Create payment and store due snapshot
    const feesRecord = await Fees.create({
      student: studentId,
      amountPaid: paid,
      paymentMethod,
      datePaid: dateObj,
      year: Number(year),
      term,
      category: category || "FEES",
      receiptNo: finalReceiptNo,
      recordedBy: req.user?.name || "system",
      demand,
      previousClass,
      dueSnapshot: {
        tuition: due.tuition,
        extras: due.extras,
        totalDue: due.totalDue,
      },
    });

    const adjustments = await Adjustment.find({
      student: student._id,
      year: Number(year),
      term,
    }).lean();

    const adjTotal = adjustments.reduce((a, x) => a + Number(x.amount || 0), 0);

    const totalPaid = alreadyPaid + paid;
    const totalWithAdj = Number(due.totalDue || 0) + adjTotal;
    const balance = totalWithAdj - totalPaid;

    return res.status(201).json({
      message: "Payment recorded",
      feesRecord,
      summary: {
        class: getClassForYear(student, year) || student.studentclass,
        year: Number(year),
        term,
        due: {
          tuition: due.tuition,
          extras: due.extras,
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


// -------------------- VOID (DELETE) a payment --------------------
// PATCH /fees/:id/void
router.patch(
  "/:id/void",
  auth,
  allowRoles("DIRECTOR"), // ❗ Director only
  async (req, res, next) => {
    try {
      const { reason = "" } = req.body;

      const payment = await Fees.findById(req.params.id);
      if (!payment) return res.status(404).json({ message: "Payment not found" });
      if (payment.isVoided) return res.status(400).json({ message: "Already voided" });

      if (!String(reason || "").trim()) {
        return res.status(400).json({ message: "Void reason is required" });
      }

      payment.isVoided = true;
      payment.void = {
        reason: String(reason).trim(),
        by: req.user?.name || "USER",
        at: new Date(),
      };

      await payment.save();
      res.json({ ok: true, payment });
    } catch (e) {
      next(e);
    }
  }
);


// PATCH /fees/:id/edit  (Director always, Secretary within 10 minutes)
router.patch(
  "/:id/edit",
  auth,
  allowRoles("DIRECTOR", "SECRETARY"),
  async (req, res, next) => {
    try {
      const { amountPaid, paymentMethod, datePaid, category } = req.body;

      const payment = await Fees.findById(req.params.id);
      if (!payment) return res.status(404).json({ message: "Payment not found" });
      if (payment.isVoided) return res.status(400).json({ message: "Payment is voided" });

      // Secretary time limit (10 mins from createdAt)
      if (req.user?.role === "SECRETARY") {
        const base = payment.createdAt || payment.datePaid;
        const ageMs = Date.now() - new Date(base).getTime();
        if (ageMs > 10 * 60 * 1000) {
          return res.status(403).json({ message: "Edit time window expired" });
        }
      }

      if (amountPaid != null) payment.amountPaid = Number(amountPaid);
      if (paymentMethod) payment.paymentMethod = String(paymentMethod);
      if (datePaid) payment.datePaid = new Date(datePaid);
      if (category) payment.category = String(category);

      payment.edited = {
        by: req.user?.name || "USER",
        role: req.user?.role || "",
        at: new Date(),
      };

      await payment.save();
      res.json({ ok: true, payment });
    } catch (e) {
      next(e);
    }
  }
);

// GET /fees/daily?date=YYYY-MM-DD  (Director only)
router.get("/daily", auth, allowRoles("DIRECTOR"), async (req, res, next) => {
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
});


// GET /fees/daily/details?date=YYYY-MM-DD&method=TILL  (Director only)
router.get("/daily/details", auth, allowRoles("DIRECTOR"), async (req, res, next) => {
  try {
    const { date, method } = req.query;
    if (!date) {
      return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
    }

    const { startUTC, endUTC } = kenyaDayBoundsUTC(date);

    const q = {
      datePaid: { $gte: startUTC, $lte: endUTC },
      isVoided: { $ne: true },
    };
    if (method && method !== "ALL") q.paymentMethod = method;

    const rows = await Fees.find(q)
      .populate({
        path: "student",
        select: "firstName secondName studentclass enrollments currentEnrollmentYear",
      })
      .sort({ datePaid: -1 })
      .lean();

    const list = rows.map((r) => {
      const y = Number(r.year);
      const clsRaw = r.student ? getClassForYear(r.student, y) : "";
      const cls = normalizeClassLabel(clsRaw) || (r.student?.studentclass || "");

      return {
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
          // ✅ class at the time of payment year
          class: cls,
        },
      };
    });

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
});

// GET /fees/statement/:id?year=2026&term=Term1&demand=FEEDING_TERMLY,MEDICAL
router.get("/statement/:id", async (req, res, next) => {
  try {
    const studentId = req.params.id;
    const year = Number(req.query.year);
    const term = String(req.query.term || "").trim();

    const demand = String(req.query.demand || "")
      .split(",")
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);

    console.log("GET /fees/statement START", {
      studentId,
      year,
      term,
      demand,
      at: new Date().toISOString(),
    });

    if (!studentId || !year || !term) {
      return res.status(400).json({
        error: "studentId, year and term are required",
      });
    }

    const student = await Student.findById(studentId).lean();
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    const { classRow, wanted, norm } = await findClassRowForStudent(student, year, term);

    if (!classRow) {
      return res.status(400).json({
        error: `Class fee not set for "${wanted}" (normalized: "${norm}") — year=${year}, term=${term}`,
      });
    }

    const due = await computeDueBreakdown(student, year, term, classRow, {
      previousClass: null,
      demand,
      onceAlreadyCharged: new Set(),
      perYearAlreadyCharged: new Set(),
      priceCache: new Map(),
    });

    const adjustments = await Adjustment.find({
      student: student._id,
      year,
      term,
    }).lean();

    const adjTotal = adjustments.reduce((a, x) => a + Number(x.amount || 0), 0);

    const paymentsAgg = await Fees.aggregate([
      {
        $match: {
          student: new mongoose.Types.ObjectId(studentId),
          year,
          term,
          isVoided: { $ne: true },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amountPaid" },
        },
      },
    ]);

    const totalPaid = paymentsAgg.length ? Number(paymentsAgg[0].total || 0) : 0;

    const total = Number(due.totalDue || 0) + adjTotal;
    const rawBalance = total - totalPaid;
    const balance = rawBalance > 0 ? rawBalance : 0;
    const overpayment = rawBalance < 0 ? Math.abs(rawBalance) : 0;

    const response = {
      student: {
        id: String(student._id),
        name: `${student.firstName || ""} ${student.secondName || ""}`.trim(),
        class: getClassForYear(student, year) || student.studentclass || "",
      },
      year,
      term,
      due: {
        tuition: Number(due.tuition || 0),
        extras: Array.isArray(due.extras) ? due.extras : [],
        adjustments: {
          total: adjTotal,
          items: adjustments,
        },
        total,
      },
      totalPaid,
      balance,
      overpayment,
      currency: "KES",
    };

    console.log("GET /fees/statement END", {
      studentId,
      year,
      term,
      total,
      totalPaid,
      balance,
      overpayment,
    });

    return res.json(response);
  } catch (e) {
    console.error("GET /fees/statement failed");
    console.error("message:", e.message);
    console.error("code:", e.code);
    console.error("stack:", e.stack);
    next(e);
  }
});



// GET /fees/statement/:id?year=2026&term=Term1&demand=FEEDING_TERMLY,MEDICAL
// ✅ TERM SUMMARY (optimized + includes opt-in breakdown for ON_DEMAND)
router.get("/term-summary", auth, allowRoles("DIRECTOR"), async (req, res, next) => {
  try {
    const year = Number(req.query.year);
    const term = String(req.query.term || "").trim();

    if (!year || !term) {
      return res.status(400).json({ error: "year and term are required" });
    }

    const metrics = await buildTermMetrics(year, term);

    res.json({
      school: {
        name: SCHOOL.name,
        address: SCHOOL.address,
        phone: SCHOOL.phone,
        logo: SCHOOL.logo,
      },
      year: metrics.year,
      term: metrics.term,
      studentsCount: metrics.studentsCount,
      receiptsCount: metrics.receiptsCount,
      totalExpected: metrics.totalExpected,
      totalReceived: metrics.totalReceived,
      percent: metrics.percent,
      currency: "KES",
      optIns: metrics.optIns,
      notes: metrics.missingFeeRows
        ? `${metrics.missingFeeRows} students missing fee rows for ${term} ${year}`
        : undefined,
    });
  } catch (e) {
    next(e);
  }
});

// director can also see the status summary (who owes what) for a term, which is used in the FEES DASHBOARD and can be used to trigger reminders or calls to parents of defaulters

router.get(
  "/director-dashboard",
  auth,
  allowRoles("DIRECTOR"),
  async (req, res, next) => {
    try {
      const year = Number(req.query.year);
      const term = String(req.query.term || "").trim();

      if (!year || !term) {
        return res.status(400).json({ error: "year and term are required" });
      }

      const metrics = await buildTermMetrics(year, term);

      return res.json({
        year: metrics.year,
        term: metrics.term,
        summary: {
          studentsCount: metrics.studentsCount,
          totalExpected: metrics.totalExpected,
          totalCollected: metrics.totalReceived,
          totalBalance: metrics.totalBalance,
          collectionRate: metrics.percent,
        },
        topDefaulters: metrics.topDefaulters,
        classBreakdown: metrics.classBreakdown,
      });
    } catch (e) {
      console.error("GET /fees/director-dashboard failed");
      console.error(e);
      next(e);
    }
  }
);


// GET /fees/status-summary?year=2026&term=Term1
router.get("/status-summary", async (req, res, next) => {
  try {
    const year = Number(req.query.year);
    const term = String(req.query.term || "").trim();

    if (!year || !term) {
      return res.status(400).json({ error: "year and term are required" });
    }

    const startedAt = Date.now();

    console.log("GET /fees/status-summary START", {
      year,
      term,
      at: new Date().toISOString(),
    });

    const students = await Student.find({
      status: "active",
      enrollments: { $elemMatch: { year } },
    })
      .select("firstName secondName studentclass enrollments")
      .lean();

    console.log("status-summary students:", students.length);

    if (!students.length) {
      return res.json({ year, term, items: [] });
    }

    const studentIds = students.map((s) => s._id);

    // class fee rows for the term
    const classRows = await Class.find({ year, term }).lean();
    const classFeeMap = new Map(
      classRows.map((r) => [
        normalizeGradeLabel(String(r.studentclass || "").trim()),
        Number(r.fees || 0),
      ])
    );

    // payments aggregate
    const paymentsAgg = await Fees.aggregate([
      {
        $match: {
          student: { $in: studentIds },
          year,
          term,
          isVoided: { $ne: true },
        },
      },
      {
        $group: {
          _id: "$student",
          paid: { $sum: "$amountPaid" },
        },
      },
    ]);

    const paidMap = new Map(
      paymentsAgg.map((r) => [String(r._id), Number(r.paid || 0)])
    );

    // adjustments aggregate
    const adjAgg = await Adjustment.aggregate([
      {
        $match: {
          student: { $in: studentIds },
          year,
          term,
        },
      },
      {
        $group: {
          _id: "$student",
          total: { $sum: "$amount" },
        },
      },
    ]);

    const adjMap = new Map(
      adjAgg.map((r) => [String(r._id), Number(r.total || 0)])
    );

    const priceCache = new Map();
    const items = [];

    for (const student of students) {
      const sid = String(student._id);

      const enr = (student.enrollments || []).find((e) => Number(e.year) === year);
      const classLabel = enr?.classLabel || student.studentclass || "";
      const normalizedClass = normalizeGradeLabel(classLabel);
      const tuition = Number(classFeeMap.get(normalizedClass) || 0);

      const due = await computeDueBreakdown(
        { ...student, studentclass: classLabel },
        year,
        term,
        { fees: tuition },
        {
          previousClass: null,
          demand: null,
          onceAlreadyCharged: new Set(),
          perYearAlreadyCharged: new Set(),
          priceCache,
        }
      );

      const adjustments = adjMap.get(sid) || 0;
      const total = Number(due.totalDue || 0) + adjustments;
      const paid = paidMap.get(sid) || 0;
      const balanceRaw = total - paid;
      const balance = balanceRaw > 0 ? balanceRaw : 0;

      let status = "OWING";
      if (total > 0 && balance <= 0) status = "PAID";
      else if (paid > 0 && paid < total) status = "PART";

      items.push({
        studentId: sid,
        total,
        paid,
        balance,
        status,
      });
    }

    console.log("GET /fees/status-summary END", {
      count: items.length,
      ms: Date.now() - startedAt,
    });

    return res.json({
      year,
      term,
      items,
    });
  } catch (e) {
    console.error("GET /fees/status-summary failed");
    console.error("message:", e.message);
    console.error("code:", e.code);
    console.error("stack:", e.stack);
    next(e);
  }
});

// GET /fees/by-student/:id?year=2026&term=Term1
router.get("/by-student/:id", async (req, res, next) => {
  try {
    console.log("\n---- GET /fees/by-student START ----");
    console.log("params:", req.params);
    console.log("query:", req.query);

    const q = { student: req.params.id };
    if (req.query.year) q.year = Number(req.query.year);
    if (req.query.term) q.term = req.query.term;

    console.log("mongo query:", q);

    const payments = await Fees.find({ ...q, isVoided: { $ne: true } }).sort({ datePaid: -1 });

    console.log("payments found:", payments.length);
    console.log("---- GET /fees/by-student END ----\n");

    res.json({ payments });
  } catch (e) {
    console.error("GET /fees/by-student failed");
    console.error("message:", e.message);
    console.error("code:", e.code);
    console.error("stack:", e.stack);
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

      const studentId = p.student?._id ? String(p.student._id) : String(p.student);
      const student = await Student.findById(studentId);
      if (!student) return res.status(404).json({ message: "Student not found" });

      const { classRow, wanted, norm } = await findClassRowForStudent(student, p.year, p.term);
      if (!classRow) {
        return res.status(400).json({
          message: `Class fee not set for "${wanted}" (normalized: "${norm}") — year=${p.year}, term=${p.term}`,
        });
      }

      const adjustments = await Adjustment.find({
        student: student._id,
        year: Number(p.year),
        term: p.term,
      }).lean();

      const adjTotal = adjustments.reduce((a, x) => a + Number(x.amount || 0), 0);

      // Always recompute using current correct rules
      const due = await computeDueBreakdown(student, Number(p.year), p.term, classRow, {
        previousClass: p.previousClass || null,
        demand: p.demand || null,
        onceAlreadyCharged: new Set(),
        perYearAlreadyCharged: new Set(),
        priceCache: new Map(),
      });

      const tuition = Number(due.tuition || 0);
      const extras = Array.isArray(due.extras)
        ? due.extras.map((x) => ({
            key: x.key,
            label: x.label || x.key,
            amount: Number(x.amount || 0),
            term: x.term || null,
          }))
        : [];

      const baseTotalDue = Number(due.totalDue || tuition);
      const totalWithAdj = Number(baseTotalDue + adjTotal);

      const paidToDateAgg = await Fees.aggregate([
        {
          $match: {
            student: new mongoose.Types.ObjectId(student._id),
            year: Number(p.year),
            term: p.term,
            datePaid: { $lte: new Date(p.datePaid) },
            isVoided: { $ne: true },
          },
        },
        { $group: { _id: null, total: { $sum: "$amountPaid" } } },
      ]);
      const totalPaidToDate = paidToDateAgg.length ? Number(paidToDateAgg[0].total) : 0;

      const balanceAfterRaw = totalWithAdj - totalPaidToDate;
      const balanceAfter = balanceAfterRaw < 0 ? 0 : balanceAfterRaw;
      const overpaymentAfter = balanceAfterRaw < 0 ? Math.abs(balanceAfterRaw) : 0;

      let appliedLabel = "Tuition";
      if (p.category && typeof p.category === "string") {
        const up = p.category.toUpperCase();
        if (up === "FEES") appliedLabel = "Tuition";
        else if (up.startsWith("EXTRA:")) {
          const key = p.category.split(":")[1] || "";
          appliedLabel = `Extra: ${key
            .replaceAll("_", " ")
            .replace(/\b\w/g, (c) => c.toUpperCase())}`;
        } else {
          appliedLabel = p.category;
        }
      }

      return res.json({
        school: {
          name: SCHOOL.name,
          address: SCHOOL.address,
          phone: SCHOOL.phone,
          logo: SCHOOL.logo,
        },
        receiptNo: p.receiptNo,
        datePaid: p.datePaid,
        paymentMethod: p.paymentMethod,
        amountPaid: Number(p.amountPaid || 0),
        appliedTo: { category: p.category || "FEES", label: appliedLabel },

        student: {
          id: studentId,
          name: p.student ? `${p.student.firstName} ${p.student.secondName}` : "",
          class: getClassForYear(student, p.year) || p.student?.studentclass || "",
        },

        year: p.year,
        term: p.term,

        statement: {
          due: {
            tuition,
            extras,
            adjustments: { total: adjTotal, items: adjustments },
            total: totalWithAdj,
          },
          totalPaidToDate,
          balanceAfter,
          overpaymentAfter,
        },

        currency: "KES",
      });
    } catch (e) {
      next(e);
    }
  }
);


// ================== ADMIN NUKE (payments + fee tables + pricing + counters) ==================
router.delete("/admin/wipe", auth, allowRoles("DIRECTOR"), async (req, res, next) => {
  try {
    const confirm = req.query.confirm; // must be 'NUKE'
    const scope = String(req.query.scope || "all"); // 'all' | 'payments' | 'feeTables' | 'pricing' | 'adjustments' | 'counters' | 'students'
    const dryRun = req.query.dryRun === "true"; // optional preview

    if (confirm !== "NUKE") {
      return res.status(400).json({ message: "Add confirm=NUKE to proceed" });
    }

    // Import models here to avoid circulars
    const ReceiptCounter2 = require("../../models/fees/ReceiptCounter");
    const Fees2 = require("../../models/fees/Fees");
    const Class2 = require("../../models/class/Class");
    const Adjustment2 = require("../../models/adjustment/Adjustment");
    const Student2 = require("../../models/student/Student");

    // Your extra pricing model (if exported as a Mongoose model)
    let ExtraPrice = null;
    try {
      ExtraPrice = require("../extraprice/ExtraPrice");
    } catch (_) {}

    const targets = [];
    if (scope === "all" || scope === "payments") targets.push({ name: "payments", model: Fees2 });
    if (scope === "all" || scope === "feeTables") targets.push({ name: "feeTables", model: Class2 });
    if (scope === "all" || scope === "pricing") targets.push({ name: "pricing", model: ExtraPrice });
    if (scope === "all" || scope === "adjustments") targets.push({ name: "adjustments", model: Adjustment2 });
    if (scope === "all" || scope === "counters") targets.push({ name: "counters", model: ReceiptCounter2 });
    if (scope === "students") targets.push({ name: "students", model: Student2 });

    const finalTargets = targets.filter((t) => t.model && t.model.deleteMany);

    if (dryRun) {
      const counts = {};
      for (const t of finalTargets) {
        // eslint-disable-next-line no-await-in-loop
        counts[t.name] = await t.model.countDocuments();
      }
      return res.json({ ok: true, dryRun: true, counts, scope });
    }

    const session = await mongoose.startSession();
    const summary = { deleted: {}, scope };
    await session.withTransaction(async () => {
      for (const t of finalTargets) {
        // eslint-disable-next-line no-await-in-loop
        const c = await t.model.countDocuments({}, { session });
        // eslint-disable-next-line no-await-in-loop
        const r = await t.model.deleteMany({}, { session });
        summary.deleted[t.name] = {
          before: c,
          deleted: r.deletedCount || (r.acknowledged ? c : 0),
        };
      }
    });
    await session.endSession();

    return res.json({ ok: true, ...summary });
  } catch (e) {
    next(e);
  }
});


module.exports = router;
