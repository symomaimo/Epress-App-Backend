// WHICH items apply (no amounts here)
const RULES = [
  // New-only (first/admission term)
  { key: "ADMISSION_FEE",     when: "ON_ADMISSION", classes: "ALL" },
  { key: "ASSESSMENT_BOOK",   when: "ON_ADMISSION", classes: "ALL" },
  { key: "TEXTBOOKS_ONBOARD", when: "ON_ADMISSION", classes: "ALL" },
  { key: "TRACKSUIT_ONBOARD", when: "ON_ADMISSION", classes: "ALL" },

  // Locker: charge once the first time a learner is in any of G7–G9
  { key: "LOCKER_G7_9", when: "ON_ENTER_JSS", classes: ["Grade 7","Grade 8","Grade 9"] },
  { key: "TRACKSUIT_ENTER_G7",  when: "ON_ENTER_G7", classes: ["Grade 7"] },

 

  // Fixed terms
  { key: "GRAD_PP2_T3",  when: "FIXED_TERM", term: "Term3", classes: ["PP2"] },
  { key: "REAMS_G7_9_T2", when: "FIXED_TERM", term: "Term2", classes: ["Grade 7","Grade 8","Grade 9"] },

  // On-demand (only when asked)
  { key: "DAMAGE",              when: "ON_DEMAND", classes: "ALL" },
  { key: "MEDICAL",              when: "ON_DEMAND", classes: "ALL" },
  { key: "TOUR",                when: "ON_DEMAND", classes: "ALL" },
  { key: "SET_BOOKS_G7_9",      when: "ON_DEMAND", classes: ["Grade 7","Grade 8","Grade 9"] },
  { key: "TEXTBOOKS_ON_DEMAND", when: "ON_DEMAND", classes: "ALL" }
];

const inList = (v, arr) => Array.isArray(arr) && arr.includes(v);
const humanize = s => String(s).replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const keyToLabel = key => humanize(key);

// helper: "Grade 7" -> 7; Playgroup/PP1/PP2 -> null
const gradeNum = (label = "") => {
  const m = String(label).match(/grade\s*([1-9])/i);
  return m ? Number(m[1]) : null;
};

/**
 * Compute which extras apply (keys only; amounts come from resolvePrice)
 *
 * @param {Object} student - must include student.studentclass and admittedYear/admittedTerm
 * @param {number} year
 * @param {string} term - "Term1" | "Term2" | "Term3"
 * @param {Object} opts
 *   - previousClass: optional string like "Grade 6"
 *   - demand: array of keys to force (for ON_DEMAND)
 *   - perYearAlreadyCharged: Set of keys charged earlier in the same year (for PER_YEAR items)
 *   - onceAlreadyCharged: Set of keys that have EVER been charged (prevents duplicates like LOCKER_G7_9)
 *   - assumePromotionIfMissingPrev: boolean, if true treat first seen in G7 (not admission term) as promotion
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
    assumePromotionIfMissingPrev = true
  } = {}
) {
  const cls = student.studentclass;
  const isAdmissionTerm =
    student.admittedYear === Number(year) && student.admittedTerm === term;

  const currG = gradeNum(cls);
  const prevG = gradeNum(previousClass);

  const needs = [];

  for (const r of RULES) {
    if (Array.isArray(r.classes) && !inList(cls, r.classes)) continue;

    switch (r.when) {
      case "ON_ADMISSION": {
        if (!isAdmissionTerm) continue;
        break;
      }

      case "ON_ENTER_G7": {
        // applies when first term in Grade 7 (admission into G7 OR promotion from Grade 6)
        if (cls !== "Grade 7") continue;
        const promotedFromG6 = prevG === 6;
        const firstSeenInG7 = prevG == null && !isAdmissionTerm && assumePromotionIfMissingPrev;
        if (!(isAdmissionTerm || promotedFromG6 || firstSeenInG7)) continue;
        break;
      }

      case "ON_ENTER_JSS": {
        // First time the learner appears in JSS (G7–G9): admission into G7/8/9, or promotion up within JSS,
        // or inferred first term in G7 when previous is unknown (imported cohort).
        if (!(currG && currG >= 7 && currG <= 9)) continue;

        const promoted = prevG != null && prevG < currG; // 6->7, 7->8, 8->9
        const inferredPromotion = prevG == null && currG >= 7 && !isAdmissionTerm && assumePromotionIfMissingPrev;
        const enteringNow = isAdmissionTerm || promoted || inferredPromotion;

        if (!enteringNow) continue;
        if (onceAlreadyCharged.has(r.key)) continue; // hard guard (ever charged)
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
        if (!demand.includes(r.key)) continue;
        break;
      }

      default:
        continue;
    }

    needs.push({ key: r.key, label: r.label || keyToLabel(r.key) });
  }

  return needs;
}

module.exports = { computeExtras };