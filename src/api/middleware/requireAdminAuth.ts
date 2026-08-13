import { Request, Response, NextFunction } from "express";

// Gates the /admin dashboard's write/read endpoints (homepage content, ops
// stats) behind a single shared password, sent as a header. Replaces a
// previous client-side-only check whose password was hardcoded in the
// shipped frontend bundle - anyone could read it with devtools regardless
// of what the string was. This is a single-shared-secret gate (matching the
// scale of the tool - one trusted admin, not a multi-user system), not a
// full session/JWT setup.
export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const provided = req.header("x-admin-password");
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || provided !== expected) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
}
