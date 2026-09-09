-- ============================================================
--  migrations/008_create_audit_and_settings.sql
--  Creates the AuditLogs and _AppSettings tables for tracking
--  system changes, audit trails, and automatic scheduled tasks.
-- ============================================================

-- 1. AuditLogs Table
CREATE TABLE IF NOT EXISTS AuditLogs (
    LogID INTEGER PRIMARY KEY AUTOINCREMENT,
    Timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    ActionType TEXT NOT NULL,     -- 'INSERT', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'BACKUP', 'RESTORE'
    EntityType TEXT NOT NULL,     -- 'Employee', 'Leave', 'System'
    EntityID INTEGER,             -- ID of the affected record
    OldValue TEXT,                -- JSON snapshot of previous state (if applicable)
    NewValue TEXT,                -- JSON snapshot of new state (if applicable)
    Details TEXT                  -- Human-readable Arabic summary
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON AuditLogs(Timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON AuditLogs(EntityType, EntityID);
CREATE INDEX IF NOT EXISTS idx_audit_action ON AuditLogs(ActionType);

-- 2. _AppSettings Table (Key-Value configuration storage)
CREATE TABLE IF NOT EXISTS _AppSettings (
    Key TEXT PRIMARY KEY,
    Value TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
