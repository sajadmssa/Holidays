-- ============================================================
--  migrations/010_additional_indexes.sql
--  Composite and lookup indexes for leave end-date sorting and
--  employee leave card lookup.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_leaves_end_start ON Leaves(EndDate, StartDate);
CREATE INDEX IF NOT EXISTS idx_employees_card ON Employees(LeaveCardNumber);
