-- ============================================================
--  migrations/022_create_app_counters_table.sql
--  ADR-020 & ADR-025: Create AppCounters table for atomic monotonic counters
--
--  Design notes:
--  • AppCounters stores persistent monotonic sequences (e.g. next_employee_id)
--    that never decrement or collide even when records are deleted.
--  • CounterKey is the PRIMARY KEY.
--  • next_employee_id is initialized from MAX(EmployeeID) + 1 of the Employees table.
-- ============================================================

CREATE TABLE IF NOT EXISTS AppCounters (
    CounterKey TEXT PRIMARY KEY,
    CounterValue INTEGER NOT NULL DEFAULT 1,
    UpdatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Seed next_employee_id from existing Employees table if not already present
INSERT OR IGNORE INTO AppCounters (CounterKey, CounterValue, UpdatedAt)
VALUES (
    'next_employee_id',
    (SELECT COALESCE(MAX(EmployeeID), 0) + 1 FROM Employees),
    datetime('now', 'localtime')
);
