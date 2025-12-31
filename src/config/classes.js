// src/config/classes.js
const CLASS_LABELS = [
  "Playgroup", "PP1", "PP2",
  "Grade 1","Grade 2","Grade 3","Grade 4","Grade 5",
  "Grade 6","Grade 7","Grade 8","Grade 9"
];

function normalizeClass(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();

  if (["playgroup","play group","pg"].includes(s)) return "Playgroup";
  if (["pp1","pp 1","pre primary 1","pre-primary 1"].includes(s)) return "PP1";
  if (["pp2","pp 2","pre primary 2","pre-primary 2"].includes(s)) return "PP2";

  const m = s.match(/^grade\s*(\d+)$/) || s.match(/^g\s*(\d+)$/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 9) return `Grade ${n}`;
  }
  if (CLASS_LABELS.includes(String(input))) return String(input);
  return null;
}

function nextClass(label) {
  const i = CLASS_LABELS.indexOf(label);
  return i >= 0 && i < CLASS_LABELS.length - 1 ? CLASS_LABELS[i + 1] : null;
}

module.exports = { CLASS_LABELS, normalizeClass, nextClass };
