/** Hosts a development database is reached on, from the host machine or the compose network. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', 'db', 'postgres'];

/**
 * Throws unless the connection string targets a local database: the scripts calling it write
 * synthetic data or drop whole databases.
 */
export function assertLocalDatabase(connectionString: string, script: string): void {
  const host = new URL(connectionString).hostname.replace(/^\[|\]$/g, '');
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(`${script} refuses to touch a non-local database (host "${host}").`);
  }
}
