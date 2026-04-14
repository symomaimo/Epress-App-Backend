const jwt = require("jsonwebtoken");

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

function auth(req, res, next) {
  // Dev bypass lets you build without logging in each time
  if (process.env.AUTH_MODE === "dev-bypass") {
    // Allow injecting role via header for testing
    const role = normalizeRole(req.header("x-role") || "DIRECTOR");
    req.user = { id: "dev", name: "Dev User", role };
    return next();
  }

  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ normalize role once here
    payload.role = normalizeRole(payload.role);

    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function allowRoles(...roles) {
  const allowed = roles.map(normalizeRole);

  return (req, res, next) => {
    const userRole = normalizeRole(req.user?.role);
    if (!userRole || !allowed.includes(userRole)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

module.exports = { auth, allowRoles };
