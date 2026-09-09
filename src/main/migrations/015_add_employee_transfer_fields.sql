-- ============================================================
--  migrations/015_add_employee_transfer_fields.sql
--  Adds external transfer tracking fields to Employees table:
--    • IsTransferred: Flag indicating external transfer (0 or 1, default 0).
--                     Does NOT deactivate the employee (IsActive stays 1).
--    • TransferOrderNumber: Administrative order number for transfer (numeric).
--    • TransferOrderDate: Date of the administrative order.
--    • TransferNotes: Notes/destination for the transfer.
-- ============================================================

ALTER TABLE Employees ADD COLUMN IsTransferred INTEGER NOT NULL DEFAULT 0 CHECK(IsTransferred IN (0, 1));
ALTER TABLE Employees ADD COLUMN TransferOrderNumber TEXT DEFAULT NULL;
ALTER TABLE Employees ADD COLUMN TransferOrderDate TEXT DEFAULT NULL;
ALTER TABLE Employees ADD COLUMN TransferNotes TEXT DEFAULT NULL;

-- Partial or full index for high-performance filtering of transferred employees
CREATE INDEX IF NOT EXISTS idx_employees_is_transferred ON Employees(IsTransferred);
