// Create or reset an admin login.
//   node seed-admin.js <email> <password> [full name]
// Safe to re-run — updates the password if the email already exists.
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool } = require("./db");

(async () => {
  const email = (process.argv[2] || "").trim().toLowerCase();
  const password = process.argv[3] || "";
  const name = process.argv[4] || "";
  if (!email || !password) {
    console.error('Usage: node seed-admin.js <email> <password> ["Full Name"]');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 10);
  await pool.query(
    "INSERT INTO users (id,email,password_hash,name,role,active,home_mode) " +
    "VALUES (UUID(),?,?,?,'admin',1,'executive') " +
    "ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role='admin', active=1, name=VALUES(name)",
    [email, hash, name]
  );
  console.log("✓ admin ready:", email);
  process.exit(0);
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
