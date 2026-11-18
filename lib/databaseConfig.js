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
    // Dashboard/MIS endpoints deliberately run several independent
    // aggregates in parallel. Two connections caused healthy requests to
    // wait behind those scans and hit the acquisition timeout. Five stays
    // conservative for Supabase's transaction pooler while allowing one
    // complete dashboard request to make progress without starving the
    // rest of the app.
    max: 5,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 30000,
    // Avoid reconnecting to the remote pooler every minute; establishing a
    // fresh connection is comparatively expensive from the app's region.
    maxLifetimeSeconds: 300,
    allowExitOnIdle: true,
  };
}
