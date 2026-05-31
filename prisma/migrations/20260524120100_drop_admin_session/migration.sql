-- Drop the orphaned admin_session table left over from the AdminJS-based
-- Admin-Panel. The new Admin-Panel SPA uses cookie-bearer JWT issued by the
-- Backend, so no separate session store is required.
DROP TABLE IF EXISTS "admin_session";
