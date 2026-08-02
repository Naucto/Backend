-- Refresh tokens are now stored hashed with bcrypt.
-- Any rows created before this change contain plaintext JWTs and cannot be
-- verified by bcrypt.compare(), which would silently break token refresh.
-- Clearing the table forces all users to log in once after this deploy.
DELETE FROM "RefreshToken";
