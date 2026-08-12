import express from "express";
import {
  verifyGoogleIdToken,
  verifyDiscordCode,
  findOrCreateCustomer,
  createSession,
  revokeSession,
  getLinkedProviders,
  getCustomerBySessionId,
  OAuthIdentity,
} from "../services/customerAuth";
import { SESSION_COOKIE_NAME, requireCustomerAuth } from "./middleware/requireCustomerAuth";

const router = express.Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: "/",
};

// POST /api/auth/oauth/:provider
// Google:  { idToken }
// Discord: { code, redirectUri }
// If a valid session cookie is already present, links this provider to the
// existing customer instead of finding/creating a separate one.
router.post("/auth/oauth/:provider", async (req, res) => {
  try {
    const provider = req.params.provider;

    let identity: OAuthIdentity;
    if (provider === "google") {
      const { idToken } = req.body;
      if (!idToken) {
        return res.status(400).json({ success: false, error: "idToken is required" });
      }
      identity = await verifyGoogleIdToken(idToken);
    } else if (provider === "discord") {
      const { code, redirectUri } = req.body;
      if (!code || !redirectUri) {
        return res
          .status(400)
          .json({ success: false, error: "code and redirectUri are required" });
      }
      identity = await verifyDiscordCode(code, redirectUri);
    } else {
      return res.status(400).json({ success: false, error: `Unsupported provider: ${provider}` });
    }

    const existingSessionId = req.cookies?.[SESSION_COOKIE_NAME];
    let linkToCustomerId: number | undefined;
    if (existingSessionId) {
      const existing = await getCustomerBySessionId(existingSessionId);
      if (existing) linkToCustomerId = existing.id;
    }

    const customer = await findOrCreateCustomer(provider, identity, linkToCustomerId);
    const { sessionId } = await createSession(customer.id, req.headers["user-agent"]);
    res.cookie(SESSION_COOKIE_NAME, sessionId, COOKIE_OPTIONS);

    res.status(200).json({ success: true, customer });
  } catch (error: any) {
    console.error("Error in OAuth login:", error);
    res.status(500).json({ success: false, error: error.message || "Login failed" });
  }
});

router.post("/auth/logout", async (req, res) => {
  try {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
    if (sessionId) await revokeSession(sessionId);
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("Error logging out:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/auth/me", requireCustomerAuth, async (req, res) => {
  const linkedProviders = await getLinkedProviders(req.customer!.id);
  res.status(200).json({ success: true, customer: req.customer, linkedProviders });
});

export default router;
