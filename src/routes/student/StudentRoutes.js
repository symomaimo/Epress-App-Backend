// src/routes/students/students.routes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const { normalizeClass } = require("../../config/classes");
const Student = require("../../models/student/Student");
const Parent = require("../../models/parent/Parent");

const { auth, allowRoles } = require("../../middleware/authMiddleware");

const validTerm = (t) => ["Term1", "Term2", "Term3"].includes(t);

/* ---------------- Promotion Class Map ---------------- */
const PROMOTE_MAP = {
  Playgroup: "PP1",
  PP1: "PP2",
  PP2: "Grade 1",
  "Grade 1": "Grade 2",
  "Grade 2": "Grade 3",
  "Grade 3": "Grade 4",
  "Grade 4": "Grade 5",
  "Grade 5": "Grade 6",
  "Grade 6": "Grade 7",
  "Grade 7": "Grade 8",
  "Grade 8": "Grade 9",
  "Grade 9": "Grade 9", // unchanged by default
};

/* ---------------- Enrollment Helpers ---------------- */
function getClassForYear(student, year) {
  const y = Number(year);
  const enrollments = Array.isArray(student.enrollments) ? student.enrollments : [];
  const e = enrollments.find((x) => Number(x.year) === y);
  return e?.classLabel || student.studentclass; // fallback
}

function ensureEnrollment(student, year, classLabel) {
  const y = Number(year);
  if (!Number.isFinite(y)) return;

  const arr = Array.isArray(student.enrollments) ? student.enrollments : [];
  const exists = arr.some((e) => Number(e.year) === y);
  if (!exists) {
    student.enrollments = arr;
    student.enrollments.push({
      year: y,
      classLabel: String(classLabel || student.studentclass || "").trim(),
    });
  }
}

function upsertEnrollment(student, year, classLabel, promotedBy = "", setPromotedMeta = true) {
  const y = Number(year);
  if (!Number.isFinite(y)) return;

  student.enrollments = Array.isArray(student.enrollments) ? student.enrollments : [];
  const idx = student.enrollments.findIndex((e) => Number(e.year) === y);

  const promotedAt = setPromotedMeta ? new Date() : undefined;
  const promotedByVal = setPromotedMeta ? (promotedBy || "") : undefined;

  if (idx >= 0) {
    student.enrollments[idx].classLabel = String(classLabel).trim();
    if (setPromotedMeta) {
      student.enrollments[idx].promotedAt = promotedAt;
      student.enrollments[idx].promotedBy = promotedByVal;
    }
  } else {
    student.enrollments.push({
      year: y,
      classLabel: String(classLabel).trim(),
      ...(setPromotedMeta ? { promotedAt, promotedBy: promotedByVal } : {}),
    });
  }
}


/* ===================== ROUTES ===================== */

/* ✅ ADD STUDENT
   - creates enrollment for currentYear (from UI year switcher)
   - admittedYear/Term is informational only (not required)
*/
router.post("/", async (req, res) => {
  try {
    const {
      firstName,
      secondName,
      studentclass,
      parentDetails,
      isNewAdmission,
      admittedYear,
      admittedTerm,

      // ✅ NEW: year where this student should appear (Option B)
      currentYear, // e.g. 2026 (from UI)
    } = req.body;

    if (!firstName || !secondName || !studentclass) {
      return res.status(400).json({ msg: "firstName, secondName, studentclass are required" });
    }

    const classLabel = normalizeClass(studentclass);
    if (!classLabel) {
      return res.status(400).json({ error: "Invalid class. Use Playgroup, PP1, PP2, or Grade 1–9." });
    }

    const normalizedFirstName = firstName.trim().toLowerCase();
    const normalizedSecondName = secondName.trim().toLowerCase();

    // duplicate check (name + class)
    const existingStudent = await Student.findOne({
      firstName: normalizedFirstName,
      secondName: normalizedSecondName,
      studentclass: classLabel,
    });
    if (existingStudent) return res.status(400).json({ msg: "Student already exists" });

    // parent upsert by phone
    let parentId = null;
    if (parentDetails?.phone) {
      const payload = {
        fullName: parentDetails.fullName || parentDetails.name || parentDetails.phone,
        phone: parentDetails.phone,
        email: parentDetails.email ?? undefined,
        address: parentDetails.address || parentDetails.residence || undefined,
      };

      const parent = await Parent.findOneAndUpdate(
        { phone: payload.phone },
        { $set: { fullName: payload.fullName, email: payload.email, address: payload.address } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      parentId = parent._id;
    }

    // admission fields only for new intakes
    let admittedYearNum = undefined;
    if (isNewAdmission) {
      if (!admittedYear || !validTerm(admittedTerm)) {
        return res.status(400).json({
          error: "For new admissions, provide admittedYear (e.g. 2026) and admittedTerm (Term1|Term2|Term3).",
        });
      }
      admittedYearNum = Number(admittedYear);
    }

    // ✅ Determine enrollment year (Option B)
    // Priority: currentYear from UI -> admittedYear -> current calendar year
    const enrollmentYear =
      Number(currentYear) ||
      admittedYearNum ||
      new Date().getFullYear();

    if (!Number.isFinite(enrollmentYear) || enrollmentYear < 2000) {
      return res.status(400).json({ error: "currentYear is required (e.g. 2026)." });
    }

    // build student doc
    const doc = {
      firstName: normalizedFirstName,
      secondName: normalizedSecondName,
      studentclass: classLabel,               // convenience (latest)
      currentEnrollmentYear: enrollmentYear,  // convenience
      enrollments: [{ year: enrollmentYear, classLabel }],

      parent: parentId,
      status: "active",

      // informational only
      admittedYear: admittedYearNum,
      admittedTerm: admittedTerm || undefined,
    };

    const newStudent = await Student.create(doc);
    const populatedStudent = await Student.findById(newStudent._id).populate("parent");
    res.status(201).json(populatedStudent);
  } catch (error) {
    console.error(error);
    if (error?.code === 11000) return res.status(400).json({ msg: "Duplicate key (DB constraint)" });
    res.status(500).json({ msg: "Server error" });
  }
});

// ✅ Tick/untick ON-DEMAND services per term (FEEDING_TERMLY, DAMAGE, MEDICAL, TOUR, TRANSPORT, etc.)
router.patch(
  "/:id/term-optin",
  auth,
  allowRoles("DIRECTOR", "SECRETARY", "BURSAR"),
  async (req, res) => {
    try {
      console.log("\n==== PATCH /students/:id/term-optin START ====");
      console.log("params:", req.params);
      console.log("body:", req.body);

      const { id } = req.params;
      const { year, term, key, enabled, value } = req.body;

      if (year == null || !term || !key) {
        return res.status(400).json({ error: "year, term, key are required" });
      }

      const y = Number(year);
      if (!Number.isFinite(y) || y < 2000) {
        return res.status(400).json({ error: "Invalid year" });
      }

      const t = String(term).trim();
      if (!validTerm(t)) {
        return res.status(400).json({ error: "term must be Term1|Term2|Term3" });
      }

      const k = String(key).trim().toUpperCase();
      const on = Boolean(enabled);

      console.log("normalized:", { y, t, k, on, value });

      const student = await Student.findById(id);
      console.log("student found:", !!student);

      if (!student) {
        return res.status(404).json({ error: "Student not found" });
      }

      ensureEnrollment(student, y, student.studentclass);

      const idx = student.enrollments.findIndex((e) => Number(e.year) === y);
      console.log("enrollment index:", idx);

      if (idx < 0) {
        return res.status(400).json({ error: `Enrollment year ${y} not found` });
      }

      if (!student.enrollments[idx].termOptIns) {
        student.enrollments[idx].termOptIns = {};
      }
      if (!student.enrollments[idx].termOptIns[t]) {
        student.enrollments[idx].termOptIns[t] = new Map();
      }

      let holder = student.enrollments[idx].termOptIns[t];

      if (!(holder instanceof Map) && typeof holder?.set !== "function") {
        holder = new Map(Object.entries(holder || {}));
        student.enrollments[idx].termOptIns[t] = holder;
      }

      const beforeObj = holder instanceof Map ? Object.fromEntries(holder) : holder;
      console.log("before change termOptIns:", JSON.stringify(beforeObj, null, 2));

      // clean old invalid transport values
      const rawTransport = typeof holder.get === "function" ? holder.get("TRANSPORT") : holder?.TRANSPORT;
      if (rawTransport === true || String(rawTransport || "").toUpperCase() === "TRUE") {
        if (typeof holder.delete === "function") holder.delete("TRANSPORT");
        else delete holder.TRANSPORT;
        console.log("cleaned old invalid TRANSPORT value");
      }

      if (k === "TRANSPORT") {
        if (!on) {
          holder.delete("TRANSPORT");
          console.log("transport removed");
        } else {
          const place = String(value || "").trim().toUpperCase();
          const allowed = ["TIPIS", "MAU", "GATIMU"];

          if (!allowed.includes(place)) {
            return res.status(400).json({
              error: `TRANSPORT value must be one of: ${allowed.join(", ")}`,
            });
          }

          holder.set("TRANSPORT", place);
          console.log("transport set to:", place);
        }

        student.markModified("enrollments");
        await student.save();

        const updated = await Student.findById(id).populate("parent");
        const updatedEnrollment = (updated.enrollments || []).find((e) => Number(e.year) === y);
        const updatedHolder = updatedEnrollment?.termOptIns?.[t];
        const afterObj =
          updatedHolder && typeof updatedHolder.get === "function"
            ? Object.fromEntries(updatedHolder)
            : updatedHolder || {};

        console.log("after save termOptIns:", JSON.stringify(afterObj, null, 2));
        console.log("==== PATCH /students/:id/term-optin END ====\n");

        return res.json({ ok: true, student: updated.toObject() });
      }

      if (!on) {
        holder.delete(k);
        console.log(`removed key: ${k}`);
      } else {
        holder.set(k, true);
        console.log(`set key true: ${k}`);
      }

      student.markModified("enrollments");
      await student.save();

      const updated = await Student.findById(id).populate("parent");
      const updatedEnrollment = (updated.enrollments || []).find((e) => Number(e.year) === y);
      const updatedHolder = updatedEnrollment?.termOptIns?.[t];
      const afterObj =
        updatedHolder && typeof updatedHolder.get === "function"
          ? Object.fromEntries(updatedHolder)
          : updatedHolder || {};

      console.log("after save termOptIns:", JSON.stringify(afterObj, null, 2));
      console.log("==== PATCH /students/:id/term-optin END ====\n");

      return res.json({ ok: true, student: updated.toObject() });
    } catch (e) {
      console.error("PATCH /students/:id/term-optin failed");
      console.error("message:", e.message);
      console.error("code:", e.code);
      console.error("stack:", e.stack);
      console.error("==== PATCH /students/:id/term-optin ERROR ====\n");

      return res.status(500).json({ error: e.message || "Server error" });
    }
  }
);

/* ✅ UPDATE STUDENT
   - if `year` is provided, updates enrollment for that year (Option B)
   - otherwise updates global studentclass (not recommended)
*/
router.put("/", async (req, res) => {
  // (kept empty on purpose to avoid accidental wrong route)
  return res.status(404).json({ error: "Use PUT /students/:id" });
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      firstName,
      secondName,
      studentclass,
      parentDetails,
      admittedYear,
      admittedTerm,

      // ✅ NEW: which year you are editing in the UI
      year,
    } = req.body;

    const student = await Student.findById(id);
    if (!student) return res.status(404).json({ message: "Student not found." });

    if (firstName) student.firstName = firstName.trim().toLowerCase();
    if (secondName) student.secondName = secondName.trim().toLowerCase();

    if (studentclass) {
      const classLabel = normalizeClass(studentclass);
      if (!classLabel) {
        return res.status(400).json({ error: "Invalid class. Use Playgroup, PP1, PP2, or Grade 1–9." });
      }

      // ✅ If UI passed a year, update that year's enrollment
      if (year != null) {
        const y = Number(year);
        if (!Number.isFinite(y) || y < 2000) {
          return res.status(400).json({ error: "Invalid year" });
        }

        upsertEnrollment(student, y, classLabel, "", false);

        // optional convenience: if editing currentEnrollmentYear, keep studentclass too
        if (Number(student.currentEnrollmentYear) === y) {
          student.studentclass = classLabel;
        }
      } else {
        // fallback: global class (not ideal for Option B)
        student.studentclass = classLabel;
      }
    }

    // admission fields optional (informational)
    if (admittedYear != null || admittedTerm != null) {
      if (admittedYear != null) student.admittedYear = Number(admittedYear);
      if (admittedTerm != null) {
        if (!validTerm(admittedTerm)) return res.status(400).json({ error: "admittedTerm must be Term1|Term2|Term3" });
        student.admittedTerm = admittedTerm;
      }
    }

    // parent update / attach
    if (parentDetails) {
      if (student.parent) {
        const parent = await Parent.findById(student.parent);
        if (parent) {
          if (parentDetails.fullName || parentDetails.name) parent.fullName = parentDetails.fullName || parentDetails.name;
          if (parentDetails.phone) parent.phone = parentDetails.phone;
          if (parentDetails.email !== undefined) parent.email = parentDetails.email;
          if (parentDetails.address || parentDetails.residence) parent.address = parentDetails.address || parentDetails.residence;
          await parent.save();
        }
      } else if (parentDetails.phone) {
        const payload = {
          fullName: parentDetails.fullName || parentDetails.name || parentDetails.phone,
          phone: parentDetails.phone,
          email: parentDetails.email ?? undefined,
          address: parentDetails.address || parentDetails.residence || undefined,
        };
        const parent = await Parent.findOneAndUpdate(
          { phone: payload.phone },
          { $set: { fullName: payload.fullName, email: payload.email, address: payload.address } },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        student.parent = parent._id;
      }
    }

    await student.save();
    const updatedStudent = await Student.findById(id).populate("parent");
    res.status(200).json({ message: "Student updated successfully.", student: updatedStudent });
  } catch (error) {
    console.error(error);
    if (error?.code === 11000 && error?.keyPattern?.phone) {
      return res.status(409).json({ error: "A parent with that phone already exists." });
    }
    res.status(500).json({ error: error.message });
  }
});

/* ✅ GET STUDENTS (Option B)
   - /students?year=2026&onlyEnrolled=true  => only those enrolled in 2026
*/




async function runStudentsQuery(filter) {
  return await Student.find(filter).populate("parent").lean();
}

router.get("/", async (req, res) => {
  try {
    const rawYear = req.query.year;
    const year = rawYear != null && rawYear !== "" ? Number(rawYear) : null;
    const onlyEnrolled = String(req.query.onlyEnrolled || "false") === "true";

    console.log("\n==== GET /students START ====");
    console.log("query:", req.query);
    console.log("parsed:", {
      year,
      onlyEnrolled,
      mongoReadyState: mongoose.connection.readyState,
      at: new Date().toISOString(),
    });

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: "Database temporarily unavailable. Please retry.",
        error: "MongoDB not connected",
        readyState: mongoose.connection.readyState,
      });
    }

    if (rawYear != null && rawYear !== "" && !Number.isFinite(year)) {
      return res.status(400).json({ error: "Invalid year query parameter." });
    }

    let filter = { status: "active" };
    if (year && onlyEnrolled) {
      filter["enrollments.year"] = year;
    }

    console.log("mongo filter:", filter);

    let students;
    try {
      students = await runStudentsQuery(filter);
    } catch (error) {
      if (error?.code === "ECONNRESET") {
        console.warn("GET /students first query ECONNRESET, retrying once...");
        students = await runStudentsQuery(filter);
      } else {
        throw error;
      }
    }

    console.log("students fetched:", students.length);

    if (!year) {
      console.log("==== GET /students END (no year filter) ====\n");
      return res.status(200).json(students);
    }

    const enriched = students
      .map((s) => {
        const enrollments = Array.isArray(s.enrollments) ? s.enrollments : [];
        const e = enrollments.find((x) => Number(x.year) === year);

        return {
          ...s,
          classForYear: e?.classLabel || s.studentclass || "",
          hasEnrollmentForYear: !!e,
        };
      })
      .filter((s) => (onlyEnrolled ? s.hasEnrollmentForYear : true));

    console.log("students returned:", enriched.length);
    console.log("==== GET /students END ====\n");

    return res.status(200).json(enriched);
  } catch (error) {
    console.error("GET /students FAILED");
    console.error("message:", error?.message);
    console.error("code:", error?.code);
    console.error("name:", error?.name);
    console.error("stack:", error?.stack);
    console.error("==== GET /students ERROR ====\n");

    if (error?.code === "ECONNRESET") {
      return res.status(503).json({
        message: "Database connection was reset. Please retry.",
        error: error.message,
      });
    }

    return res.status(500).json({
      message: "Failed to load students",
      error: error?.message || "Server error",
    });
  }
});

/* ✅ GET ONE STUDENT */
// router.get("/:id", async (req, res) => {
//   try {
//     const student = await Student.findById(req.params.id).populate("parent");
//     if (!student) return res.status(404).json({ msg: "Student not found" });
//     res.status(200).json(student);
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ msg: "Server error" });
//   }
// });

/* ✅ DELETE (SOFT) — DIRECTOR + SECRETARY */
router.delete(
  "/:id",
  auth,
  allowRoles("DIRECTOR", "SECRETARY"),
  async (req, res) => {
    try {
      const reason = String(req.body?.reason || "Deleted by user");
      const student = await Student.findById(req.params.id);
      if (!student) return res.status(404).json({ msg: "Student not found" });

      student.status = "inactive";
      student.inactiveMeta = {
        by: req.user?.name || "",
        role: req.user?.role || "",
        reason,
        at: new Date(),
      };

      await student.save();
      res.status(200).json({ ok: true, msg: "Student deactivated successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ msg: "Server error" });
    }
  }
);

/* =========================================================
   ✅ PROMOTE ALL ACTIVE STUDENTS — DIRECTOR + SECRETARY
   - requires fromYear + term (Term3 only)
   - keeps old year enrollment
   - adds next year enrollment
   ========================================================= */
router.post(
  "/promote",
  auth,
  allowRoles("DIRECTOR", "SECRETARY"),
  async (req, res) => {
    try {
      const fromYear = Number(req.body?.fromYear);
      const term = String(req.body?.term || "");

      if (term !== "Term3") {
        return res.status(403).json({ error: "Promotion is only allowed in Term 3." });
      }
      if (!Number.isFinite(fromYear) || fromYear < 2000) {
        return res.status(400).json({ error: "fromYear is required (e.g. 2026)." });
      }

      const onlyActive = req.body.onlyActive !== false;
      const filter = onlyActive ? { status: "active" } : {};

      const students = await Student.find(filter).select(
        "_id studentclass status enrollments currentEnrollmentYear"
      );

      const promoter = req.user?.name || "system";
      const nextYear = fromYear + 1;

      let promoted = 0;
      let skippedGrade9 = 0;

      for (const student of students) {
        // ✅ IMPORTANT: base promotion on class in fromYear
        const fromClassRaw = getClassForYear(student, fromYear);
        const current = normalizeClass(fromClassRaw);

        const next = PROMOTE_MAP[current];
        if (!next) continue;

        if (current === "Grade 9") {
          skippedGrade9++;
          continue;
        }

        // keep old year visible
        ensureEnrollment(student, fromYear, current);

        // create next year enrollment (promoted meta)
        upsertEnrollment(student, nextYear, next, promoter, true);

        // convenience fields
        student.studentclass = next;
        student.currentEnrollmentYear = nextYear;

        await student.save();
        promoted++;
      }

      return res.json({
        ok: true,
        fromYear,
        toYear: nextYear,
        promoted,
        skippedGrade9,
        note: "Promotion applied using enrollments (history preserved).",
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Server error" });
    }
  }
);
 

/* =========================================================
   ✅ PROMOTE ONE STUDENT — DIRECTOR + SECRETARY
   ========================================================= */


const PromotionLog = require("../../models/promotionlog/PromotionLog");   

router.post(
  "/promote-one/:id",
  auth,
  allowRoles("DIRECTOR", "SECRETARY"),
  async (req, res) => {
    try {
      const fromYear = Number(req.body?.fromYear);
      const term = String(req.body?.term || "");

      if (term !== "Term3") {
        return res.status(403).json({ error: "Promotion is only allowed in Term 3." });
      }
      if (!Number.isFinite(fromYear) || fromYear < 2000) {
        return res.status(400).json({ error: "fromYear is required (e.g. 2026)." });
      }

      const student = await Student.findById(req.params.id).select(
        "_id firstName secondName status studentclass enrollments currentEnrollmentYear"
      );
      if (!student) return res.status(404).json({ error: "Student not found" });

      if (student.status !== "active") {
        return res.status(400).json({ error: "Only active students can be promoted." });
      }

      const fromClassRaw = getClassForYear(student, fromYear);
      const current = normalizeClass(fromClassRaw);

      const next = PROMOTE_MAP[current];
      if (!next) return res.status(400).json({ error: `Cannot promote class "${current}"` });

      if (current === "Grade 9") {
        return res.json({ ok: true, promoted: false, note: "Grade 9 not promoted by default." });
      }

      const promoter = req.user?.name || "system";
      const nextYear = fromYear + 1;

      // ✅ 1) Try to create a promotion log (idempotency lock)
      // If already exists, Mongo will NOT insert, and we detect it.
      const log = await PromotionLog.findOneAndUpdate(
        { studentId: student._id, fromYear },
        {
          $setOnInsert: {
            studentId: student._id,
            fromYear,
            toYear: nextYear,
            fromClass: current,
            toClass: next,
            term,
            promotedBy: promoter,
          },
        },
        { upsert: true, new: true, rawResult: true } // rawResult gives us "updatedExisting"
      );

      const alreadyDone = log?.lastErrorObject?.updatedExisting === true;
      if (alreadyDone) {
        // ✅ Already promoted (safe even under double-click / multi-PC)
        return res.json({
          ok: true,
          promoted: false,
          note: `Already promoted from ${fromYear}.`,
        });
      }

      // ✅ 2) Now do the actual promotion updates
      ensureEnrollment(student, fromYear, current);
      upsertEnrollment(student, nextYear, next, promoter);

      student.studentclass = next;
      student.currentEnrollmentYear = nextYear;

      await student.save();

      return res.json({
        ok: true,
        promoted: true,
        student: {
          id: String(student._id),
          fromYear,
          toYear: nextYear,
          from: current,
          to: next,
        },
      });
    } catch (e) {
      // If duplicate key happens (race), treat it as already promoted
      if (e?.code === 11000) {
        return res.json({ ok: true, promoted: false, note: "Already promoted (duplicate request)." });
      }
      console.error(e);
      return res.status(500).json({ error: "Server error" });
    }
  }
);


module.exports = router;
