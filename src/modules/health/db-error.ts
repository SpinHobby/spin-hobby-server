// Turns database connection failures into reasons a person can act on, without ever echoing a
// connection string or password. Used by the health report.

/** First line of a DB error with anything URL- or credential-shaped removed. */
export function safeDetail(message: string) {
  return message
    .split('\n')[0]
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/(password|secret|key|token)=\S+/gi, '$1=<hidden>')
    .slice(0, 200);
}

/** Turns a Postgres/network error into a safe, actionable reason (never echoes the connection string). */
export function explainDbError(error: unknown): { error: string; hint: string; detail?: string } {
  const e = error as { code?: string; message?: string };
  const msg = e?.message ?? '';
  const table: [RegExp | string, string, string][] = [
    [
      'CONFIG_MISSING',
      'not_configured',
      'Set DATABASE_URL to the Supabase Session pooler connection string.',
    ],
    [
      'ENOTFOUND',
      'host_not_found',
      'The host in DATABASE_URL does not exist. Copy the Session pooler string from Supabase > Connect.',
    ],
    [
      'ENETUNREACH',
      'host_unreachable',
      'The host is IPv6-only (Supabase direct connection). Use the Session pooler string (aws-0-<region>.pooler.supabase.com).',
    ],
    [
      'EHOSTUNREACH',
      'host_unreachable',
      'The host is unreachable. Use the Supabase Session pooler string.',
    ],
    [
      'ECONNREFUSED',
      'connection_refused',
      'The port refused the connection. The Session pooler uses port 5432.',
    ],
    [
      'ETIMEDOUT',
      'timeout',
      'Connecting timed out. Check the host/port, or that the Supabase project is not paused.',
    ],
    [
      '28P01',
      'password_rejected',
      'Password rejected. Reset it in Supabase > Project Settings > Database and URL-encode special characters (@ -> %40).',
    ],
    [
      '28000',
      'login_rejected',
      'Login rejected. The pooler username must be postgres.<project-ref>.',
    ],
    ['3D000', 'database_not_found', 'Database name not found. It should be /postgres.'],
    [
      /circuit breaker|too many authentication/i,
      'blocked_after_failed_logins',
      'The Supabase pooler is temporarily blocking this user after repeated failed logins. Fix the password, then wait ~5-15 minutes (or restart the pooler from Supabase > Project Settings > Database).',
    ],
    [
      /max client connections|too many clients|remaining connection slots/i,
      'too_many_connections',
      'Connection limit reached. Lower DATABASE_POOL_SIZE (e.g. 5) or use the Transaction pooler (port 6543).',
    ],
    [
      /tenant or user not found/i,
      'pooler_user_wrong',
      'Pooler rejected the user. The username must be postgres.zmlltsytckexrmybvnof (with the project ref).',
    ],
    [
      /password authentication failed/i,
      'password_rejected',
      'Password rejected. Reset it in Supabase > Project Settings > Database and URL-encode special characters.',
    ],
    [
      /self[- ]signed|certificate/i,
      'ssl_error',
      'SSL certificate error. Remove sslmode from DATABASE_URL (the server enables SSL itself).',
    ],
    [
      /timeout/i,
      'timeout',
      'Connecting timed out. Check the host/port, or that the Supabase project is not paused.',
    ],
    [
      /invalid url|invalid connection string|Invalid URL/i,
      'invalid_url',
      'DATABASE_URL is not a valid postgresql:// URL.',
    ],
  ];
  for (const [match, error, hint] of table) {
    if (typeof match === 'string' ? e?.code === match : match.test(msg)) return { error, hint };
  }
  return {
    error: `unknown${e?.code ? `_${e.code}` : ''}`,
    hint: 'See the service logs for details.',
    detail: safeDetail(msg),
  };
}
