// computeExtras.js

// WHICH items apply (no amounts here)
const RULES = [
  // Admission items (only in admission term)
  // ✅ Admission fee is handled dynamically (banded) below, so we DO NOT keep ADMISSION_FEE here.

  // ✅ Ensure correct key spelling/case (match your ExtraPrices keys)
  {
    key: "ASSESSMENT_BOOK",
    when: "ON_ADMISSION",
    classes: [
      "Playgroup", "PP1", "PP2",
      "Grade 1", "Grade 2", "Grade 3",
      "Grade 4", "Grade 5", "Grade 6"
    ]
  },
  { key: "TRACKSUIT_ONBOARD", when: "ON_ADMISSION", classes: "ALL" },

  // Locker: once ever, with JSS entry logic
  { key: "LOCKER_G7_9", when: "ON_ENTER_JSS", classes: ["Grade 7", "Grade 8", "Grade 9"] },

  // Tracksuit entering G7
  { key: "TRACKSUIT_ENTER_G7", when: "ON_ENTER_G7", classes: ["Grade 7"] },

  // Fixed terms
  { key: "GRAD_PP2_T3", when: "FIXED_TERM", term: "Term3", classes: ["PP2"] },
  { key: "REAMS_G7_9_T1", when: "FIXED_TERM", term: "Term1", classes: ["Grade 7", "Grade 8", "Grade 9"] },

  // On-demand (only when asked)
  { key: "FEEDING_TERMLY", when: "ON_DEMAND", classes: "ALL" }, // ✅ feeding is optional (termly only)
  { key: "DAMAGE", when: "ON_DEMAND", classes: "ALL" },
  { key: "MEDICAL", when: "ON_DEMAND", classes: "ALL" },
  { key: "TOUR", when: "ON_DEMAND", classes: "ALL" },
  { key: "SET_BOOKS_G7_9", when: "ON_DEMAND", classes: ["Grade 7", "Grade 8", "Grade 9"] },
  { key: "TEXTBOOKS_ON_DEMAND", when: "ON_DEMAND", classes: "ALL" },
  { key: "LOSTBOOKS", when: "ON_DEMAND", classes: "ALL" },
  { key: "REAM", when: "ON_DEMAND", classes: ["Grade 7","Grade 8","Grade 9"] },

  // ✅ TRANSPORT is ON_DEMAND but value-based (place)
  { key: "TRANSPORT", when: "ON_DEMAND", classes: "ALL" },
];

const inList = (v, arr) => Array.isArray(arr) && arr.includes(v);
const humanize = (s) =>
  String(s).replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const keyToLabel = (key) => humanize(key);

// =========================
// TERM OPT-INS HELPERS
// Supports:
// - boolean opt-ins: { FEEDING_TERMLY: true }
// - value opt-ins (TRANSPORT): { TRANSPORT: "TIPIS" | "MAU" | "GATIMU" }
// =========================
const getTermOptIns = (student, year, term) => {
  const enr = (student.enrollments || []).find((e) => Number(e.year) === Number(year));
  if (!enr) return null;

  const t = String(term).trim();
  const holder = enr.termOptIns?.[t];
  if (!holder) return null;

  // If mongoose Map
  if (typeof holder.get === "function") return holder;

  // If plain object
  if (holder && typeof holder === "object" && !Array.isArray(holder)) return holder;

  // If array of pairs
  if (Array.isArray(holder)) return Object.fromEntries(holder);

  return null;
};

const getOptValue = (student, year, term, key) => {
  const holder = getTermOptIns(student, year, term);
  if (!holder) return null;

  const k = String(key).toUpperCase();

  if (typeof holder.get === "function") return holder.get(k) ?? null;
  return holder[k] ?? null;
};

const isOptedIn = (student, year, term, key) => {
  const v = getOptValue(student, year, term, key);

  // normal ON_DEMAND items
  if (v === true) return true;

  // ✅ TRANSPORT: any non-empty string means opted in
  if (String(key).toUpperCase() === "TRANSPORT" && typeof v === "string" && v.trim()) return true;

  return false;
};

// helper: "Grade 7" -> 7; Playgroup/PP1/PP2 -> null
const gradeNum = (label = "") => {
  const m = String(label).match(/grade\s*([1-9])/i);
  return m ? Number(m[1]) : null;
};

const isPrePrimary = (cls) => ["Playgroup", "PP1", "PP2"].includes(cls);

const stageFor = (cls) => {
  const g = gradeNum(cls);
  if (g == null) return null;
  if (g >= 1 && g <= 3) return "1_3";
  if (g >= 4 && g <= 6) return "4_6";
  if (g >= 7 && g <= 9) return "7_9";
  return null;
};

const entryGradeForStage = (stage) => {
  if (stage === "1_3") return 1;
  if (stage === "4_6") return 4;
  if (stage === "7_9") return 7;
  return null;
};

// ✅ Admission fee band key based on current class
const admissionFeeKeyFor = (cls) => {
  if (isPrePrimary(cls)) return "ADMISSION_FEE_PREPRIMARY";
  const g = gradeNum(cls);
  if (g >= 1 && g <= 3) return "ADMISSION_FEE_G1_3";
  if (g >= 4 && g <= 6) return "ADMISSION_FEE_G4_6";
  if (g >= 7 && g <= 9) return "ADMISSION_FEE_G7_9";
  return "ADMISSION_FEE_G1_3";
};

/**
 * Compute which extras apply (keys only; amounts come from resolvePrice)
 *
 * NOTE:
 * - For TRANSPORT we return an object like:
 *   { key:"TRANSPORT", variant:"TIPIS", label:"Transport - TIPIS" }
 *   so your resolvePrice must accept `variant`.
 */
function computeExtras(
  student,
  year,
  term,
  {
    previousClass = null,
    demand = [],
    perYearAlreadyCharged = new Set(),
    onceAlreadyCharged = new Set(),
    assumePromotionIfMissingPrev = true,
  } = {}
) {
  const cls = student.studentclass;

  const isAdmissionTerm =
    student.admittedYear === Number(year) && student.admittedTerm === term;

  const currG = gradeNum(cls);
  const prevG = gradeNum(previousClass);

  const needs = [];

  // =========================
  // ADMISSION FEE (banded)
  // =========================
  
  if (isAdmissionTerm) {
    const admKey = admissionFeeKeyFor(cls);

    const anyAdmissionAlready =
      onceAlreadyCharged.has("ADMISSION_FEE_PREPRIMARY") ||
      onceAlreadyCharged.has("ADMISSION_FEE_G1_3") ||
      onceAlreadyCharged.has("ADMISSION_FEE_G4_6") ||
      onceAlreadyCharged.has("ADMISSION_FEE_G7_9");

    if (!anyAdmissionAlready) {
      needs.push({ key: admKey, label: keyToLabel(admKey) });
    }
  }

  // =========================
  // TEXTBOOKS (stage-based)
  // =========================
  if (!isPrePrimary(cls)) {
    const stage = stageFor(cls);
    if (stage) {
      const entryG = entryGradeForStage(stage);

      const isExternal = isAdmissionTerm;

      const isInternalStageEntry =
        !isAdmissionTerm &&
        currG === entryG &&
        (prevG === entryG - 1 || (prevG == null && assumePromotionIfMissingPrev));

      const shouldChargeTextbooks = isExternal || isInternalStageEntry;

      const base = `TEXTBOOKS_STAGE_${stage}`;
      const alreadyChargedThisStage =
        onceAlreadyCharged.has(`${base}_INTERNAL`) ||
        onceAlreadyCharged.has(`${base}_EXTERNAL`);

      if (shouldChargeTextbooks && !alreadyChargedThisStage) {
        const variant = isExternal ? "EXTERNAL" : "INTERNAL";
        needs.push({
          key: `${base}_${variant}`,
          label: `Textbooks (Stage ${stage.replace("_", "-")} - ${variant})`,
        });
      }
    }
  }

  // =========================
  // Other RULES
  // =========================
  for (const r of RULES) {
    if (Array.isArray(r.classes) && !inList(cls, r.classes)) continue;

    switch (r.when) {
      case "ON_ADMISSION": {
        if (!isAdmissionTerm) continue;
        break;
      }

      case "ON_ENTER_G7": {
        if (cls !== "Grade 7") continue;
        const promotedFromG6 = prevG === 6;
        const firstSeenInG7 = prevG == null && !isAdmissionTerm && assumePromotionIfMissingPrev;
        if (!(isAdmissionTerm || promotedFromG6 || firstSeenInG7)) continue;
        break;
      }

      case "ON_ENTER_JSS": {
        if (!(currG && currG >= 7 && currG <= 9)) continue;

        const isNewAdmissionIntoJSS = isAdmissionTerm;
        const enteringG7FromG6 = cls === "Grade 7" && prevG === 6;
        const inferredEnterG7 =
          cls === "Grade 7" && prevG == null && !isAdmissionTerm && assumePromotionIfMissingPrev;

        const shouldCharge = isNewAdmissionIntoJSS || enteringG7FromG6 || inferredEnterG7;
        if (!shouldCharge) continue;

        if (onceAlreadyCharged.has(r.key)) continue; // once ever
        break;
      }

      case "PER_YEAR": {
        if (perYearAlreadyCharged.has(r.key)) continue;
        break;
      }

      case "FIXED_TERM": {
        if (r.term !== term) continue;
        break;
      }

      case "ON_DEMAND": {
        const forced = Array.isArray(demand) && demand.includes(r.key);
        const opted = isOptedIn(student, year, term, r.key);
        if (!(forced || opted)) continue;

        // ✅ TRANSPORT (place-based)
        if (r.key === "TRANSPORT") {
          const place = String(getOptValue(student, year, term, "TRANSPORT") || "")
            .trim()
            .toUpperCase();

          // If no place, don't charge transport
          if (!place) continue;

          needs.push({
            key: "TRANSPORT",
            variant: place, // TIPIS | MAU | GATIMU
            label: `Transport - ${place}`,
          });

          continue; // important: avoid adding default push later
        }

        break;
      }

      default:
        continue;
    }

    // default push for non-transport rules
    needs.push({ key: r.key, label: r.label || keyToLabel(r.key) });
  }

  return needs;
}

module.exports = { computeExtras };
