// Runtime connections use transaction pooling. Migrations still use DIRECT_URL.
export function runtimeDatabaseUrl(connectionString) {
  if (!connectionString) return connectionString;
  const url = new URL(connectionString);
  if (url.hostname.endsWith(".pooler.supabase.com") && (!url.port || url.port === "5432")) {
    url.port = "6543";
    return url.toString();
  }
  return connectionString;
}

export function databasePoolConfig(connectionString) {
  return {
    connectionString: runtimeDatabaseUrl(connectionString),
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    maxLifetimeSeconds: 60,
    allowExitOnIdle: true,
  };
}
