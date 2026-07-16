// MySQL pool — shared by all routes. DECIMAL/BIGINT arrive as strings; coerce at use-site.
require("dotenv").config();
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL || 10),
  namedPlaceholders: true,
  dateStrings: true,          // keep DATETIME as strings — tools format themselves
  supportBigNumbers: true,
  timezone: "+08:00"          // Asia/Kuala_Lumpur
});

// Read-only pool for the AI text-to-SQL runner (separate MySQL user, SELECT-only grants)
let roPool = null;
if (process.env.DB_RO_USER) {
  roPool = mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_RO_USER,
    password: process.env.DB_RO_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 2,
    dateStrings: true,
    timezone: "+08:00"
  });
}

module.exports = { pool, roPool };
