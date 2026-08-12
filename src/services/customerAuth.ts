import { randomUUID } from "crypto";
import { OAuth2Client } from "google-auth-library";
import { pool } from "../db/pool";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type OAuthProvider = "google" | "apple" | "discord";

export interface OAuthIdentity {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  fname?: string;
  lname?: string;
  avatarUrl?: string;
}

export interface Customer {
  id: number;
  email: string;
  emailVerified: boolean;
  fname: string | null;
  lname: string | null;
  avatarUrl: string | null;
}

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export async function verifyGoogleIdToken(idToken: string): Promise<OAuthIdentity> {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error("Invalid Google ID token payload");
  }
  return {
    providerUserId: payload.sub,
    email: payload.email,
    emailVerified: !!payload.email_verified,
    fname: payload.given_name,
    lname: payload.family_name,
    avatarUrl: payload.picture,
  };
}

// Exchanges a Discord OAuth authorization code for an identity. `redirectUri`
// must exactly match the one used to obtain the code (Discord requires this)
// and one already registered in the Discord application's OAuth2 settings.
export async function verifyDiscordCode(
  code: string,
  redirectUri: string
): Promise<OAuthIdentity> {
  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID || "",
      client_secret: process.env.DISCORD_CLIENT_SECRET || "",
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenData: any = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || "Discord token exchange failed");
  }

  const userResponse = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` },
  });
  const user: any = await userResponse.json();
  if (!userResponse.ok || !user.id) {
    throw new Error("Failed to fetch Discord user profile");
  }
  if (!user.email) {
    throw new Error("Discord account has no verified email - add one in Discord settings");
  }

  return {
    providerUserId: user.id,
    email: user.email,
    emailVerified: !!user.verified,
    fname: user.global_name || user.username,
    avatarUrl: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
      : undefined,
  };
}

// Finds the customer already linked to this provider identity, otherwise
// matches by verified email (lets a customer link a second provider to the
// same account later), otherwise creates a brand-new customer + identity.
export async function findOrCreateCustomer(
  provider: OAuthProvider,
  identity: OAuthIdentity,
  linkToCustomerId?: number
): Promise<Customer> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (linkToCustomerId) {
      await client.query(
        `INSERT INTO customer_oauth_identities (customer_id, provider, provider_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (provider, provider_user_id) DO NOTHING`,
        [linkToCustomerId, provider, identity.providerUserId]
      );
      const result = await client.query("SELECT * FROM customers WHERE id = $1", [
        linkToCustomerId,
      ]);
      await client.query("COMMIT");
      return mapCustomerRow(result.rows[0]);
    }

    const existingIdentity = await client.query(
      `SELECT customer_id FROM customer_oauth_identities WHERE provider = $1 AND provider_user_id = $2`,
      [provider, identity.providerUserId]
    );
    if (existingIdentity.rows.length > 0) {
      const result = await client.query("SELECT * FROM customers WHERE id = $1", [
        existingIdentity.rows[0].customer_id,
      ]);
      await client.query("COMMIT");
      return mapCustomerRow(result.rows[0]);
    }

    if (identity.emailVerified) {
      const existingCustomer = await client.query(
        "SELECT * FROM customers WHERE email = $1 AND email_verified = true",
        [identity.email]
      );
      if (existingCustomer.rows.length > 0) {
        await client.query(
          `INSERT INTO customer_oauth_identities (customer_id, provider, provider_user_id)
           VALUES ($1, $2, $3)`,
          [existingCustomer.rows[0].id, provider, identity.providerUserId]
        );
        await client.query("COMMIT");
        return mapCustomerRow(existingCustomer.rows[0]);
      }
    }

    const created = await client.query(
      `INSERT INTO customers (email, email_verified, fname, lname, avatar_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [identity.email, identity.emailVerified, identity.fname, identity.lname, identity.avatarUrl]
    );
    await client.query(
      `INSERT INTO customer_oauth_identities (customer_id, provider, provider_user_id)
       VALUES ($1, $2, $3)`,
      [created.rows[0].id, provider, identity.providerUserId]
    );
    await client.query("COMMIT");
    return mapCustomerRow(created.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createSession(
  customerId: number,
  userAgent?: string
): Promise<{ sessionId: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const result = await pool.query(
    `INSERT INTO customer_sessions (id, customer_id, expires_at, user_agent)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [randomUUID(), customerId, expiresAt, userAgent || null]
  );
  return { sessionId: result.rows[0].id, expiresAt };
}

export async function getCustomerBySessionId(sessionId: string): Promise<Customer | null> {
  const result = await pool.query(
    `SELECT c.* FROM customer_sessions s
     JOIN customers c ON c.id = s.customer_id
     WHERE s.id = $1 AND s.expires_at > now() AND s.revoked_at IS NULL`,
    [sessionId]
  );
  return result.rows[0] ? mapCustomerRow(result.rows[0]) : null;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await pool.query(
    "UPDATE customer_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL",
    [sessionId]
  );
}

export async function getLinkedProviders(customerId: number): Promise<OAuthProvider[]> {
  const result = await pool.query(
    "SELECT provider FROM customer_oauth_identities WHERE customer_id = $1",
    [customerId]
  );
  return result.rows.map((row) => row.provider);
}

function mapCustomerRow(row: any): Customer {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    fname: row.fname,
    lname: row.lname,
    avatarUrl: row.avatar_url,
  };
}
