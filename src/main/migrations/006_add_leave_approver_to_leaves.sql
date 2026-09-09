-- ============================================================
--  migrations/006_add_leave_approver_to_leaves.sql
--  Adds LeaveApprover column to Leaves table and backfills
--  historical leave records from Employees.LeaveApprover.
-- ============================================================

ALTER TABLE Leaves ADD COLUMN LeaveApprover TEXT DEFAULT NULL;

-- Backfill historical leaves from current Employees default approver
UPDATE Leaves
SET LeaveApprover = (
    SELECT LeaveApprover
    FROM Employees
    WHERE Employees.EmployeeID = Leaves.EmployeeID
)
WHERE LeaveApprover IS NULL;
