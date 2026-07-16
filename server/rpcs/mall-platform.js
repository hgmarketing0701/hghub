// mall-platform RPC pack — port of supabase/schema-mall-platform.sql mp_next_version(p_mall, p_lot).
// Same rule as the GAS nextVersion(): max version for that Mall+Lot, +1.
// Case-insensitive match — mp_sketches is utf8mb4_unicode_ci, so a plain WHERE
// already compares case-insensitively (no LOWER() needed, keeps the index usable).
//
// Registered via server/rpc.js — receives ({ args, user, conn }) with conn inside
// an open transaction (commit/rollback handled by the route wrapper).

async function mp_next_version({ args, conn }) {
  const mall = args.p_mall === undefined || args.p_mall === null ? "" : String(args.p_mall);
  const lot  = args.p_lot  === undefined || args.p_lot  === null ? "" : String(args.p_lot);

  const [rows] = await conn.query(
    "SELECT COALESCE(MAX(version), 0) + 1 AS v FROM mp_sketches WHERE mall = ? AND lot_no = ?",
    [mall, lot]
  );
  return Number(rows[0].v); // int, same as the plpgsql function
}

module.exports = { mp_next_version };
