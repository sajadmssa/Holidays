-- ============================================================
--  migrations/002_add_employee_fields.sql
--  Adds WorkLocation, LeaveCardNumber, and LeaveApprover columns
--  to the Employees table, along with a partial unique index.
-- ============================================================

-- Add new columns as NULLABLE (preserves existing data safely)
ALTER TABLE Employees ADD COLUMN WorkLocation TEXT DEFAULT NULL;
ALTER TABLE Employees ADD COLUMN LeaveCardNumber TEXT DEFAULT NULL;
ALTER TABLE Employees ADD COLUMN LeaveApprover TEXT DEFAULT NULL;

-- Enforce uniqueness on LeaveCardNumber when provided (ignoring NULL/empty)
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_leave_card_number
ON Employees(LeaveCardNumber)
WHERE LeaveCardNumber IS NOT NULL AND TRIM(LeaveCardNumber) != '';
