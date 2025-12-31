const jwt = require("jsonwebtoken");

function auth(req, res, next) {
  // Dev bypass lets you build without logging in each time
  if (process.env.AUTH_MODE === "dev-bypass") {
    // Allow injecting role via header for testing
    const role = req.header("x-role") || "DIRECTOR";
    req.user = { id: "dev", name: "Dev User", role };
    return next();
  }

  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user?.role || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

module.exports = { auth, allowRoles };
