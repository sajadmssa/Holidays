-- ============================================================
--  migrations/011_cleanup_legacy_audit.sql
--  Drop legacy triggers and legacy AuditLog table (Phase 1 legacy)
--  All audit operations are handled by AuditLogs and AuditService.
-- ============================================================

DROP TRIGGER IF EXISTS trg_audit_leave_insert;
DROP TRIGGER IF EXISTS trg_audit_leave_delete;
DROP TABLE IF EXISTS AuditLog;
