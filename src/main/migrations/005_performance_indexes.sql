-- ============================================================
--  migrations/005_performance_indexes.sql
--  Performance indexes for Leaves date querying, balance calculations,
--  and employee name search.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_leaves_dates ON Leaves(StartDate, EndDate);
CREATE INDEX IF NOT EXISTS idx_leaves_emp_type ON Leaves(EmployeeID, LeaveTypeID);
CREATE INDEX IF NOT EXISTS idx_employees_active_name ON Employees(IsActive, FullName);
