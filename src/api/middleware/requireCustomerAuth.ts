import express from "express";
import { getCustomerBySessionId, Customer } from "../../services/customerAuth";

export const SESSION_COOKIE_NAME = "spinhobby_session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      customer?: Customer;
    }
  }
}

// 401s if there's no valid customer session. Use on account/order/wishlist
// routes that require a logged-in customer.
export async function requireCustomerAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  if (!sessionId) {
    return res.status(401).json({ success: false, error: "Not signed in" });
  }
  const customer = await getCustomerBySessionId(sessionId);
  if (!customer) {
    return res.status(401).json({ success: false, error: "Session expired" });
  }
  req.customer = customer;
  next();
}

// Attaches req.customer if a valid session cookie is present, but never
// blocks the request - for routes like checkout that must stay usable by
// guests while still recognizing a logged-in customer when there is one.
export async function attachCustomerIfPresent(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
  if (sessionId) {
    const customer = await getCustomerBySessionId(sessionId);
    if (customer) req.customer = customer;
  }
  next();
}
