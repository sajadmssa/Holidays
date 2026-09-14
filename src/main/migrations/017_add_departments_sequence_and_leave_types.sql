-- ============================================================
--  migrations/017_add_departments_sequence_and_leave_types.sql
--  1. Update LeaveTypes CHECK constraint to allow MaxDaysPerInstance <= 3650
--  2. Add new Leave Types: 'إجازة المعين' and Year-based Leaves (1 to 5 years)
--  3. Create Departments table and seed the 7 default departments
--  4. Add DepartmentID, SequenceNumber, and JobNumber to Employees
--  5. Safely backfill existing employees without losing any records
-- ============================================================

-- 1. Temporarily drop triggers referencing LeaveTypes before table swap
DROP TRIGGER IF EXISTS trg_prevent_female_leave_for_male;
DROP TRIGGER IF EXISTS trg_enforce_order_ref;

-- 2. Recreate LeaveTypes to allow up to 10 years (3650 days) in MaxDaysPerInstance
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS LeaveTypes_new (
    LeaveTypeID          INTEGER PRIMARY KEY AUTOINCREMENT,
    Name                 TEXT    NOT NULL UNIQUE CHECK(LENGTH(TRIM(Name)) > 0),
    MaxDaysPerInstance   INTEGER NOT NULL CHECK(MaxDaysPerInstance > 0 AND MaxDaysPerInstance <= 3650),
    RequiresOrderRef     INTEGER NOT NULL DEFAULT 0 CHECK(RequiresOrderRef IN (0, 1)),
    GenderRestriction    TEXT    DEFAULT NULL CHECK(GenderRestriction IS NULL OR GenderRestriction = 'Female')
);

INSERT OR IGNORE INTO LeaveTypes_new (LeaveTypeID, Name, MaxDaysPerInstance, RequiresOrderRef, GenderRestriction)
SELECT LeaveTypeID, Name, MaxDaysPerInstance, RequiresOrderRef, GenderRestriction
FROM LeaveTypes;

DROP TABLE LeaveTypes;
ALTER TABLE LeaveTypes_new RENAME TO LeaveTypes;

PRAGMA foreign_keys = ON;

-- 3. Recreate the triggers on Leaves referencing LeaveTypes
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

-- 4. Insert new Leave Types
INSERT OR IGNORE INTO LeaveTypes (Name, MaxDaysPerInstance, RequiresOrderRef, GenderRestriction) VALUES
    ('إجازة المعين',      365,  0, NULL),
    ('إجازة السنة',        365,  0, NULL),
    ('إجازة السنتان',      730,  0, NULL),
    ('إجازة ثلاث سنوات',  1095,  0, NULL),
    ('إجازة أربع سنوات',  1460,  0, NULL),
    ('إجازة خمس سنوات',   1825,  0, NULL);

-- 5. Create Departments table and seed 7 standard departments
CREATE TABLE IF NOT EXISTS Departments (
    DepartmentID INTEGER PRIMARY KEY AUTOINCREMENT,
    Name         TEXT    NOT NULL UNIQUE CHECK(LENGTH(TRIM(Name)) > 0),
    CreatedAt    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO Departments (Name) VALUES
    ('قسم الشؤون الإدارية'),
    ('قسم التشغيل'),
    ('قسم الخطوط'),
    ('الصيانات'),
    ('القابلوات'),
    ('شعبة التصاريح الأمنية'),
    ('قسم السلامة والبيئة');

-- 6. Add DepartmentID, SequenceNumber, and JobNumber to Employees
ALTER TABLE Employees ADD COLUMN DepartmentID INTEGER REFERENCES Departments(DepartmentID) ON DELETE RESTRICT DEFAULT NULL;
ALTER TABLE Employees ADD COLUMN SequenceNumber INTEGER DEFAULT NULL;
ALTER TABLE Employees ADD COLUMN JobNumber TEXT DEFAULT NULL;

-- 7. Backfill existing employees safely
UPDATE Employees SET JobNumber = CAST(EmployeeID AS TEXT) WHERE JobNumber IS NULL;

UPDATE Employees
SET SequenceNumber = (
    SELECT seq FROM (
        SELECT EmployeeID, ROW_NUMBER() OVER (ORDER BY EmployeeID) AS seq
        FROM Employees
    ) s
    WHERE s.EmployeeID = Employees.EmployeeID
)
WHERE SequenceNumber IS NULL;

-- 8. High-performance indexes
CREATE INDEX IF NOT EXISTS idx_employees_department ON Employees(DepartmentID);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_sequence ON Employees(SequenceNumber);
CREATE INDEX IF NOT EXISTS idx_employees_job_number ON Employees(JobNumber);
