import express from "express";
import { pool } from "../db/pool";
import { requireCustomerAuth } from "./middleware/requireCustomerAuth";

const router = express.Router();

function sendJson(res: express.Response, status: number, data: unknown) {
  res
    .status(status)
    .type("application/json")
    .send(JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? Number(value) : value)));
}

function mapAddressRow(row: any) {
  return {
    id: row.id,
    kind: row.kind,
    fname: row.fname,
    lname: row.lname,
    address1: row.address1,
    address2: row.address2,
    city: row.city,
    province: row.province,
    postalCode: row.postal_code,
    country: row.country,
    phone: row.phone,
    isDefault: row.is_default,
  };
}

// Saved addresses for the account address book - distinct from the
// per-order billing/shipping address snapshots in orders.ts.
router.get("/account/addresses", requireCustomerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at DESC",
      [req.customer!.id]
    );
    sendJson(res, 200, { success: true, addresses: result.rows.map(mapAddressRow) });
  } catch (error: any) {
    console.error("Error fetching addresses:", error);
    sendJson(res, 500, { success: false, error: error.message });
  }
});

router.post("/account/addresses", requireCustomerAuth, async (req, res) => {
  try {
    const { kind, fname, lname, address1, address2, city, province, postalCode, country, phone, isDefault } =
      req.body;
    if (!kind || !fname || !lname || !address1 || !city || !province || !postalCode || !country) {
      return sendJson(res, 400, { success: false, error: "Missing required address fields" });
    }
    const result = await pool.query(
      `INSERT INTO addresses
         (customer_id, kind, fname, lname, address1, address2, city, province, postal_code, country, phone, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        req.customer!.id,
        kind,
        fname,
        lname,
        address1,
        address2 || null,
        city,
        province,
        postalCode,
        country,
        phone || null,
        !!isDefault,
      ]
    );
    sendJson(res, 200, { success: true, address: mapAddressRow(result.rows[0]) });
  } catch (error: any) {
    console.error("Error creating address:", error);
    sendJson(res, 500, { success: false, error: error.message });
  }
});

router.delete("/account/addresses/:id", requireCustomerAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM addresses WHERE id = $1 AND customer_id = $2", [
      req.params.id,
      req.customer!.id,
    ]);
    sendJson(res, 200, { success: true });
  } catch (error: any) {
    console.error("Error deleting address:", error);
    sendJson(res, 500, { success: false, error: error.message });
  }
});

export default router;
