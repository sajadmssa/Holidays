-- ============================================================
-- Migration 018: Allow Overlapping & Duplicate Leave Records
-- 1. Rebuild Leaves table without the obsolete UNIQUE constraint:
--    UNIQUE(EmployeeID, LeaveTypeID, StartDate, EndDate)
-- 2. Preserve all existing data, columns, and foreign keys.
-- 3. Re-create high-performance indexes and integrity triggers.
-- ============================================================

CREATE TABLE Leaves_new (
    LeaveID       INTEGER PRIMARY KEY AUTOINCREMENT,
    EmployeeID    INTEGER NOT NULL REFERENCES Employees(EmployeeID) ON DELETE CASCADE,
    LeaveTypeID   INTEGER NOT NULL REFERENCES LeaveTypes(LeaveTypeID) ON DELETE RESTRICT,
    StartDate     TEXT    NOT NULL CHECK(StartDate LIKE '____-__-__'),
    EndDate       TEXT    NOT NULL CHECK(EndDate   LIKE '____-__-__'),
    DaysCount     INTEGER NOT NULL CHECK(DaysCount > 0),
    OrderRef      TEXT    DEFAULT NULL,
    Notes         TEXT    DEFAULT NULL,
    CreatedAt     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    LeaveApprover TEXT    DEFAULT NULL,
    RequestDate   TEXT    DEFAULT NULL,
    MemoNumber    TEXT    DEFAULT NULL,
    MemoDate      TEXT    DEFAULT NULL,
    OrderNumber   TEXT    DEFAULT NULL,
    OrderDate     TEXT    DEFAULT NULL,
    CHECK(EndDate >= StartDate)
);

INSERT INTO Leaves_new (
    LeaveID, EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount,
    OrderRef, Notes, CreatedAt, LeaveApprover, RequestDate,
    MemoNumber, MemoDate, OrderNumber, OrderDate
)
SELECT
    LeaveID, EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount,
    OrderRef, Notes, CreatedAt, LeaveApprover, RequestDate,
    MemoNumber, MemoDate, OrderNumber, OrderDate
FROM Leaves;

DROP TABLE Leaves;

ALTER TABLE Leaves_new RENAME TO Leaves;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_leaves_dates ON Leaves(StartDate, EndDate);
CREATE INDEX IF NOT EXISTS idx_leaves_emp_type ON Leaves(EmployeeID, LeaveTypeID);
CREATE INDEX IF NOT EXISTS idx_leaves_end_start ON Leaves(EndDate, StartDate);

-- Recreate triggers
CREATE TRIGGER IF NOT EXISTS trg_prevent_inactive_employee_leave
BEFORE INSERT ON Leaves
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'INACTIVE_EMPLOYEE: Cannot create a leave record for an inactive employee.')
    WHERE (
        (SELECT IsActive FROM Employees WHERE EmployeeID = NEW.EmployeeID) = 0
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_prevent_female_leave_for_male
BEFORE INSERT ON Leaves
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'GENDER_RESTRICTION: This leave type is exclusively for Female employees.')
    WHERE (
        (SELECT GenderRestriction FROM LeaveTypes WHERE LeaveTypeID = NEW.LeaveTypeID) = 'Female'
        AND
        (SELECT Gender FROM Employees WHERE EmployeeID = NEW.EmployeeID) != 'Female'
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_enforce_order_ref
BEFORE INSERT ON Leaves
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'ORDER_REF_REQUIRED: An administrative order reference is mandatory for this leave type.')
    WHERE (
        (SELECT RequiresOrderRef FROM LeaveTypes WHERE LeaveTypeID = NEW.LeaveTypeID) = 1
        AND
        (NEW.OrderRef IS NULL OR LENGTH(TRIM(NEW.OrderRef)) = 0)
    );
END;
