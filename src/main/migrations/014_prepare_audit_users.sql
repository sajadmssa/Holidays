-- ============================================================
--  migrations/014_prepare_audit_users.sql
--  Prepares AuditLogs for future user management & authentication
--  without enforcing any lock or password at this stage.
-- ============================================================

-- Add optional UserID column to link with future Users table
ALTER TABLE AuditLogs ADD COLUMN UserID INTEGER;
