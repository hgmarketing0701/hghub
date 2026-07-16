// Inventory RPC pack — JS ports of supabase/schema-inventory.sql plpgsql functions.
// Contract (see server/rpc.js): each fn gets ({ args, user, conn }) with conn inside
// an OPEN TRANSACTION — use conn.query only; throw to roll back.
// Table shapes: mysql/modules/05-inventory.sql. No FKs in MySQL, so
// inv_delete_purchase cascades lines + payment allocations itself.

const crypto = require("crypto");

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(v * 100) / 100;
const str = (v) => (v === undefined || v === null ? "" : String(v));

// jsonb defaults '[]'::jsonb — keep the same shape in MySQL JSON columns
const jsonArr = (v) => JSON.stringify(Array.isArray(v) ? v : []);

async function audit(conn, user, action, details) {
  await conn.query(
    "INSERT INTO audit_log (at, user_email, action, details) VALUES (NOW(), ?, ?, ?)",
    [user.email, action, details]
  );
}

// Today in Asia/Kuala_Lumpur as YYYYMMDD (matches plpgsql to_char(... at time zone 'Asia/Kuala_Lumpur'))
function klYyyymmdd() {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" })
    .replace(/-/g, "");
}

module.exports = {

  // ─── inv_save_purchase(payload) → purchase id (uuid string) ───────────────
  // Atomic header + valid lines (skips blank/zero-qty lines).
  // Tool lines auto-increase inv_tools.total_qty.
  inv_save_purchase: async ({ args, user, conn }) => {
    const p = args.payload || {};
    if (!str(p.date) || !str(p.supplierId))
      throw new Error("Date and supplier are required.");
    const lines = Array.isArray(p.lines) ? p.lines : [];
    if (lines.length === 0)
      throw new Error("At least one valid item line required.");

    let paidBy = str(p.paidBy || "company").toLowerCase();
    if (paidBy !== "self") paidBy = "company";

    const id = crypto.randomUUID();
    await conn.query(
      `INSERT INTO inv_purchases
         (id, date, supplier_id, do_number, notes, invoice_url,
          discount, delivery, tax, rounding_adjustment, delivery_photos, paid_by, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, p.date, str(p.supplierId), str(p.doNumber), str(p.notes), str(p.invoiceUrl),
        num(p.discount), num(p.delivery), num(p.tax), num(p.roundingAdjustment),
        jsonArr(p.deliveryPhotos), paidBy, user.email
      ]
    );

    let count = 0;
    for (const line of lines) {
      const qty = num(line.qty);
      const rate = num(line.rate);
      const itemType = str(line.itemType || "material");
      const matId = str(line.materialId);
      if (matId === "" || qty <= 0) continue;

      await conn.query(
        `INSERT INTO inv_purchase_lines
           (id, purchase_id, item_type, material_id, qty, rate, amount, division, requested_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(), id, itemType, matId, qty, rate, round2(qty * rate),
          str(line.division), str(line.requestedBy)
        ]
      );
      count++;

      // Buying a tool auto-increases its owned Total Qty (same as GAS updateToolQty_)
      if (itemType === "tool") {
        await conn.query(
          `UPDATE inv_tools
              SET total_qty  = GREATEST(0, COALESCE(total_qty, 0) + ?),
                  updated_at = NOW(),
                  updated_by = ?
            WHERE id = ?`,
          [qty, user.email, matId]
        );
      }
    }
    if (count === 0) throw new Error("At least one valid item line required.");

    await audit(conn, user, "CREATE Purchase",
      str(p.doNumber) + " · " + count + " item(s)" +
      (str(p.invoiceUrl) !== "" ? " · invoice attached" : "") +
      (paidBy === "self" ? " · paid by SELF (reimbursable)" : ""));
    return id;
  },

  // ─── inv_delete_purchase(p_id) → null ──────────────────────────────────────
  // Reverses tool total_qty for tool lines, then deletes header + lines +
  // payment allocations (Supabase relied on FK cascade — MySQL has no FKs here).
  inv_delete_purchase: async ({ args, user, conn }) => {
    const pId = str(args.p_id);
    if (pId === "") throw new Error("Purchase not found.");

    const [purRows] = await conn.query(
      "SELECT do_number FROM inv_purchases WHERE id = ?", [pId]
    );
    if (purRows.length === 0) throw new Error("Purchase not found.");
    const doNumber = str(purRows[0].do_number);

    const [toolLines] = await conn.query(
      "SELECT material_id, qty FROM inv_purchase_lines WHERE purchase_id = ? AND item_type = 'tool'",
      [pId]
    );
    for (const line of toolLines) {
      await conn.query(
        `UPDATE inv_tools
            SET total_qty  = GREATEST(0, COALESCE(total_qty, 0) - ?),
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [num(line.qty), user.email, str(line.material_id)]
      );
    }

    // cascade (was ON DELETE CASCADE in Supabase)
    await conn.query("DELETE FROM inv_purchase_lines WHERE purchase_id = ?", [pId]);
    await conn.query("DELETE FROM inv_payment_allocations WHERE purchase_id = ?", [pId]);
    await conn.query("DELETE FROM inv_purchases WHERE id = ?", [pId]);

    await audit(conn, user, "DELETE Purchase", doNumber + " (" + pId.slice(0, 8) + ")");
    return null;
  },

  // ─── inv_save_stock_out(payload) → stock-out id (uuid string) ──────────────
  // Atomic header + lines. DN number DN-YYYYMMDD-### serialized via
  // SELECT ... FOR UPDATE on the dn_number unique-index range (InnoDB gap lock
  // blocks concurrent inserts in the prefix range); unique key is the backstop.
  inv_save_stock_out: async ({ args, user, conn }) => {
    const p = args.payload || {};
    if (!str(p.date) || !str(p.division))
      throw new Error("Date and division are required.");
    const lines = Array.isArray(p.lines) ? p.lines : [];
    if (lines.length === 0)
      throw new Error("At least one valid item line required.");

    const prefix = "DN-" + klYyyymmdd() + "-";
    const [dnRows] = await conn.query(
      "SELECT dn_number FROM inv_stock_outs WHERE dn_number LIKE ? FOR UPDATE",
      [prefix + "%"]
    );
    let max = 0;
    for (const r of dnRows) {
      const suffix = String(r.dn_number).slice(prefix.length);
      if (/^[0-9]+$/.test(suffix)) max = Math.max(max, parseInt(suffix, 10));
    }
    const dn = prefix + String(max + 1).padStart(3, "0");

    const id = crypto.randomUUID();
    await conn.query(
      `INSERT INTO inv_stock_outs
         (id, dn_number, date, division, project, notes, requested_by, collection_photos, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, dn, p.date, str(p.division), str(p.project), str(p.notes),
        str(p.requestedBy), jsonArr(p.collectionPhotos), user.email
      ]
    );

    let count = 0;
    for (const line of lines) {
      const qty = num(line.qty);
      const rate = num(line.ratePerUnit);
      const matId = str(line.materialId);
      if (matId === "" || qty <= 0) continue;
      await conn.query(
        `INSERT INTO inv_stock_out_lines
           (id, stock_out_id, material_id, qty, rate_per_unit, amount)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), id, matId, qty, rate, round2(qty * rate)]
      );
      count++;
    }
    if (count === 0) throw new Error("At least one valid item line required.");

    await audit(conn, user, "CREATE StockOut",
      dn + " → " + str(p.division) + " · " + count + " item(s)");
    return id;
  },

  // ─── inv_save_payment(payload) → payment id (uuid string) ──────────────────
  // Insert-or-update header with server-computed total from allocations;
  // replaces inv_payment_allocations rows.
  inv_save_payment: async ({ args, user, conn }) => {
    const p = args.payload || {};
    if (!str(p.paymentDate)) throw new Error("Payment date is required.");

    const type = str(p.payeeType).toLowerCase();
    if (type !== "supplier" && type !== "self")
      throw new Error('payeeType must be "supplier" or "self".');
    const payee = type === "supplier" ? str(p.payeeId) : "";
    if (type === "supplier" && payee === "")
      throw new Error("Supplier is required for supplier payment.");

    // validate allocations + server-computed total
    const allocsIn = Array.isArray(p.allocations) ? p.allocations : [];
    const allocs = [];
    let total = 0;
    for (const a of allocsIn) {
      const amt = num(a.amountApplied);
      const purchaseId = str(a.purchaseId);
      if (purchaseId === "" || amt <= 0) continue;
      allocs.push({ purchaseId, amt });
      total += amt;
    }
    if (allocs.length === 0 || total <= 0)
      throw new Error("Allocate at least one invoice with a positive amount.");
    total = round2(total);

    let id = str(p.id);
    let exists = false;
    if (id !== "") {
      const [rows] = await conn.query("SELECT id FROM inv_payments WHERE id = ?", [id]);
      exists = rows.length > 0;
    }

    if (exists) {
      await conn.query(
        `UPDATE inv_payments
            SET payment_date     = ?,
                payee_type       = ?,
                payee_id         = ?,
                amount           = ?,
                method           = ?,
                reference_number = ?,
                notes            = ?,
                slip_photo_url   = ?,
                updated_at       = NOW(),
                updated_by       = ?
          WHERE id = ?`,
        [
          p.paymentDate, type, payee, total, str(p.method),
          str(p.referenceNumber), str(p.notes), str(p.slipPhotoUrl), user.email, id
        ]
      );
      await conn.query("DELETE FROM inv_payment_allocations WHERE payment_id = ?", [id]);
    } else {
      id = crypto.randomUUID();
      await conn.query(
        `INSERT INTO inv_payments
           (id, payment_date, payee_type, payee_id, amount, method,
            reference_number, notes, slip_photo_url, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, p.paymentDate, type, payee, total, str(p.method),
          str(p.referenceNumber), str(p.notes), str(p.slipPhotoUrl), user.email, user.email
        ]
      );
    }

    for (const a of allocs) {
      await conn.query(
        `INSERT INTO inv_payment_allocations (id, payment_id, purchase_id, amount_applied)
         VALUES (?, ?, ?, ?)`,
        [crypto.randomUUID(), id, a.purchaseId, a.amt]
      );
    }

    await audit(conn, user, exists ? "UPDATE Payment" : "CREATE Payment",
      (type === "self" ? "Self-claim" : "Supplier " + payee) +
      " · RM " + total.toFixed(2) + " · " + allocs.length + " invoice(s)" +
      (str(p.method) !== "" ? " · " + str(p.method) : ""));
    return id;
  }
};
