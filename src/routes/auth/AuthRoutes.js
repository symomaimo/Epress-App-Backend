const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../../models/user/User");

const router = express.Router();

// POST /auth/login  { email, password }
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: "email and password required" });
    }

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { sub: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || "7d" }
    );

    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (e) { next(e); }
});

/**
 * TEMP seeder to create initial users.
 * Remove or disable after first run!
 * Call: POST /auth/seed?key=YOUR_SETUP_KEY
 */
router.post("/seed", async (req, res, next) => {
  try {
    const setupKey = req.query.key;
    if (setupKey !== (process.env.SETUP_KEY || "SET_ME_ONCE")) {
      return res.status(403).json({ message: "Invalid setup key" });
    }

 const users = [
  {
    name: "School Director",
    email: "madamgrace255@gmail.com",
    password: "5030",
    role: "DIRECTOR",
  },
  {
    name: "Front Desk",
    email: "secretary27@gmail.com",   // <- no spaces in emails
    // If you really want the misspelling: "secetary27@gmail.com"
    password: "12345",
    role: "SECRETARY",
  },
];

    const out = [];
    for (const u of users) {
      const existing = await User.findOne({ email: u.email });
      if (existing) {
        out.push({ email: u.email, status: "exists" });
        continue;
      }
      const hash = await bcrypt.hash(u.password, 10);
      const doc = await User.create({
        name: u.name,
        email: u.email,
        passwordHash: hash,
        role: u.role,
      });
      out.push({ email: u.email, status: "created", id: doc._id });
    }
    res.json({ created: out });
  } catch (e) { next(e); }
});

module.exports = router;
