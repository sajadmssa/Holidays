-- ============================================================
--  migrations/016_add_sick_leave_25_percent_tier.sql
--  Add 3rd tier (25% pay) for Sick Leave (30/45/45 = 120 days total)
--  and update 100% pay tier ceiling from 28 to 30 days.
-- ============================================================

-- 1. Recreate LeaveBalances to update CHECK constraint allowing PayPercentage = 25
CREATE TABLE IF NOT EXISTS LeaveBalances_new (
    EmployeeID     INTEGER NOT NULL REFERENCES Employees(EmployeeID) ON DELETE CASCADE,
    LeaveTypeID    INTEGER NOT NULL REFERENCES LeaveTypes(LeaveTypeID) ON DELETE CASCADE,
    TotalBalance   INTEGER NOT NULL DEFAULT 0,
    PayPercentage  INTEGER NOT NULL DEFAULT 100 CHECK(PayPercentage IN (100, 50, 25)),
    PRIMARY KEY (EmployeeID, LeaveTypeID, PayPercentage)
);

-- 2. Migrate existing records into new table
INSERT OR IGNORE INTO LeaveBalances_new (EmployeeID, LeaveTypeID, TotalBalance, PayPercentage)
SELECT EmployeeID, LeaveTypeID, TotalBalance, PayPercentage
FROM LeaveBalances;

-- 3. Replace old table
DROP TABLE LeaveBalances;
ALTER TABLE LeaveBalances_new RENAME TO LeaveBalances;

-- 4. Adjust 100% sick leave bucket ceiling from 28 to 30 days (+2 days to remaining balance):
-- Preserves consumed days: (30 - consumed) = (28 - consumed) + 2
UPDATE LeaveBalances
SET TotalBalance = TotalBalance + 2
WHERE PayPercentage = 100
  AND LeaveTypeID IN (SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة مرضية');

-- 5. Add 25% pay bucket (45 days) for all employees with sick leave entries
INSERT OR IGNORE INTO LeaveBalances (EmployeeID, LeaveTypeID, TotalBalance, PayPercentage)
SELECT DISTINCT EmployeeID, LeaveTypeID, 45, 25
FROM LeaveBalances
WHERE LeaveTypeID IN (SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة مرضية');

-- 6. Ensure all current employees have full 3-tier sick leave balances initialized
INSERT OR IGNORE INTO LeaveBalances (EmployeeID, LeaveTypeID, TotalBalance, PayPercentage)
SELECT e.EmployeeID, lt.LeaveTypeID, 30, 100
FROM Employees e
CROSS JOIN LeaveTypes lt
WHERE lt.Name = 'إجازة مرضية';

INSERT OR IGNORE INTO LeaveBalances (EmployeeID, LeaveTypeID, TotalBalance, PayPercentage)
SELECT e.EmployeeID, lt.LeaveTypeID, 45, 50
FROM Employees e
CROSS JOIN LeaveTypes lt
WHERE lt.Name = 'إجازة مرضية';

INSERT OR IGNORE INTO LeaveBalances (EmployeeID, LeaveTypeID, TotalBalance, PayPercentage)
SELECT e.EmployeeID, lt.LeaveTypeID, 45, 25
FROM Employees e
CROSS JOIN LeaveTypes lt
WHERE lt.Name = 'إجازة مرضية';
