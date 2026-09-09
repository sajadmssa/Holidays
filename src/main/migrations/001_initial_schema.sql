-- ============================================================
--  migrations/001_initial_schema.sql
--  Initial database schema for the Government Leave Management System.
--
--  Design notes:
--  • All PKs use INTEGER PRIMARY KEY (SQLite rowid alias – fastest possible lookup).
--  • WAL mode is enabled at the database level, not here.
--  • Female-specific leave types are enforced via a TRIGGER that
--    cross-checks the requesting employee's Gender, because SQLite
--    CHECK constraints cannot query other tables. A trigger CAN.
--  • LeaveBalances uses a composite PK (EmployeeID, LeaveTypeID).
--  • Audit entries are append-only (no UPDATE/DELETE on AuditLog).
-- ============================================================

-- ════════════════════════════════════════════════════════════
--  PRAGMA – applied at runtime (not in SQL file), listed here
--  as documentation:
--    PRAGMA journal_mode = WAL;
--    PRAGMA foreign_keys = ON;
--    PRAGMA synchronous  = NORMAL;
-- ════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────
--  TABLE: Employees
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Employees (
    EmployeeID  INTEGER PRIMARY KEY,
    FullName    TEXT    NOT NULL CHECK(LENGTH(TRIM(FullName)) > 0),
    Gender      TEXT    NOT NULL CHECK(Gender IN ('Male', 'Female')),
    HireDate    TEXT    NOT NULL CHECK(HireDate LIKE '____-__-__'),  -- ISO-8601
    JobTitle    TEXT    NOT NULL CHECK(LENGTH(TRIM(JobTitle)) > 0),
    WorkLocation TEXT   DEFAULT NULL,
    LeaveCardNumber TEXT DEFAULT NULL,
    LeaveApprover TEXT  DEFAULT NULL,
    IsActive    INTEGER NOT NULL DEFAULT 1 CHECK(IsActive IN (0, 1)),
    AdjustmentDays INTEGER NOT NULL DEFAULT 0
);

-- ──────────────────────────────────────────────────────────────
--  TABLE: LeaveTypes
--  MaxDaysPerInstance: maximum calendar days allowed in a single request.
--  RequiresOrderRef:  1 = an administrative order reference is mandatory.
--  GenderRestriction: NULL = unrestricted, 'Female' = female-only leave.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS LeaveTypes (
    LeaveTypeID          INTEGER PRIMARY KEY AUTOINCREMENT,
    Name                 TEXT    NOT NULL UNIQUE CHECK(LENGTH(TRIM(Name)) > 0),
    MaxDaysPerInstance   INTEGER NOT NULL CHECK(MaxDaysPerInstance > 0 AND MaxDaysPerInstance <= 730),
    RequiresOrderRef     INTEGER NOT NULL DEFAULT 0 CHECK(RequiresOrderRef IN (0, 1)),
    GenderRestriction    TEXT    DEFAULT NULL CHECK(GenderRestriction IS NULL OR GenderRestriction = 'Female')
);

-- ──────────────────────────────────────────────────────────────
--  TABLE: LeaveBalances
--  Composite PK (EmployeeID + LeaveTypeID) — one row per pairing.
--  PayPercentage: government rules allow 100% or 50% salary during leave.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS LeaveBalances (
    EmployeeID     INTEGER NOT NULL REFERENCES Employees(EmployeeID) ON DELETE CASCADE,
    LeaveTypeID    INTEGER NOT NULL REFERENCES LeaveTypes(LeaveTypeID) ON DELETE CASCADE,
    TotalBalance   INTEGER NOT NULL DEFAULT 0,
    PayPercentage  INTEGER NOT NULL DEFAULT 100 CHECK(PayPercentage IN (100, 50)),
    PRIMARY KEY (EmployeeID, LeaveTypeID, PayPercentage)
);

-- ──────────────────────────────────────────────────────────────
--  TABLE: Leaves  (individual leave requests / records)
--  DaysCount: stored explicitly (approved calendar days may differ from
--             raw date diff due to weekends/holidays — handled in app logic).
--  OrderRef:  required when LeaveTypes.RequiresOrderRef = 1.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Leaves (
    LeaveID      INTEGER PRIMARY KEY AUTOINCREMENT,
    EmployeeID   INTEGER NOT NULL REFERENCES Employees(EmployeeID)  ON DELETE CASCADE,
    LeaveTypeID  INTEGER NOT NULL REFERENCES LeaveTypes(LeaveTypeID) ON DELETE RESTRICT,
    StartDate    TEXT    NOT NULL CHECK(StartDate LIKE '____-__-__'),
    EndDate      TEXT    NOT NULL CHECK(EndDate   LIKE '____-__-__'),
    DaysCount    INTEGER NOT NULL CHECK(DaysCount > 0),
    OrderRef     TEXT    DEFAULT NULL,
    Notes        TEXT    DEFAULT NULL,
    CreatedAt    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK(EndDate >= StartDate),
    -- WARN-1 FIX: Hard DB-level guard against duplicate leave bookings.
    -- Even if the application layer fails, the engine rejects a second INSERT
    -- for the same employee + leave type + exact date range.
    UNIQUE(EmployeeID, LeaveTypeID, StartDate, EndDate)
);

-- ──────────────────────────────────────────────────────────────
--  TABLE: AuditLog
--  Append-only record of every significant action in the system.
--  ActionType: a short enum-like string, e.g. 'CREATE_LEAVE', 'UPDATE_EMPLOYEE'.
--  Details:    JSON string with before/after snapshots or relevant context.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS AuditLog (
    LogID       INTEGER PRIMARY KEY AUTOINCREMENT,
    ActionType  TEXT    NOT NULL CHECK(LENGTH(TRIM(ActionType)) > 0),
    Timestamp   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    Details     TEXT    DEFAULT NULL  -- JSON payload
);

-- ════════════════════════════════════════════════════════════
--  TRIGGER: trg_prevent_female_leave_for_male
--
--  PURPOSE: Enforce gender-specific leave rules at the database level.
--  This is the CRITICAL REQUIREMENT:
--    • If a LeaveType has GenderRestriction = 'Female',
--      only female employees may take that leave.
--    • The trigger fires BEFORE INSERT on Leaves.
--    • It looks up the employee's Gender and the leave type's restriction.
--    • If the combination is illegal, it raises an error and aborts.
--
--  Examples of female-restricted leaves (populated in seed data):
--    - Maternity Leave    (72 days)
--    - Widowhood Leave   (130 days)
-- ════════════════════════════════════════════════════════════
CREATE TRIGGER IF NOT EXISTS trg_prevent_female_leave_for_male
BEFORE INSERT ON Leaves
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'GENDER_RESTRICTION: This leave type is exclusively for Female employees.')
    WHERE (
        -- The leave type has a gender restriction
        (SELECT GenderRestriction FROM LeaveTypes WHERE LeaveTypeID = NEW.LeaveTypeID) = 'Female'
        AND
        -- The employee is NOT female
        (SELECT Gender FROM Employees WHERE EmployeeID = NEW.EmployeeID) != 'Female'
    );
END;

-- ════════════════════════════════════════════════════════════
--  TRIGGER: trg_prevent_inactive_employee_leave
--
--  PURPOSE: An inactive (terminated/retired) employee must NOT
--           be granted new leave. Enforced at DB level.
-- ════════════════════════════════════════════════════════════
CREATE TRIGGER IF NOT EXISTS trg_prevent_inactive_employee_leave
BEFORE INSERT ON Leaves
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'INACTIVE_EMPLOYEE: Cannot create a leave record for an inactive employee.')
    WHERE (
        (SELECT IsActive FROM Employees WHERE EmployeeID = NEW.EmployeeID) = 0
    );
END;

-- ════════════════════════════════════════════════════════════
--  TRIGGER: trg_enforce_order_ref
--
--  PURPOSE: If a LeaveType requires an administrative order reference,
--           the OrderRef column on Leaves must not be NULL or empty.
-- ════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════
--  TRIGGER: trg_audit_leave_insert
--
--  PURPOSE: Automatically log every new leave record to AuditLog.
--           'Details' stores a compact JSON snapshot of the new row.
-- ════════════════════════════════════════════════════════════
CREATE TRIGGER IF NOT EXISTS trg_audit_leave_insert
AFTER INSERT ON Leaves
FOR EACH ROW
BEGIN
    INSERT INTO AuditLog (ActionType, Details) VALUES (
        'CREATE_LEAVE',
        json_object(
            'leaveId',     NEW.LeaveID,
            'employeeId',  NEW.EmployeeID,
            'leaveTypeId', NEW.LeaveTypeID,
            'startDate',   NEW.StartDate,
            'endDate',     NEW.EndDate,
            'daysCount',   NEW.DaysCount
        )
    );
END;

-- ════════════════════════════════════════════════════════════
--  TRIGGER: trg_audit_leave_delete
--
--  PURPOSE: Log every leave deletion so the record is never truly lost.
-- ════════════════════════════════════════════════════════════
CREATE TRIGGER IF NOT EXISTS trg_audit_leave_delete
AFTER DELETE ON Leaves
FOR EACH ROW
BEGIN
    INSERT INTO AuditLog (ActionType, Details) VALUES (
        'DELETE_LEAVE',
        json_object(
            'leaveId',     OLD.LeaveID,
            'employeeId',  OLD.EmployeeID,
            'leaveTypeId', OLD.LeaveTypeID,
            'startDate',   OLD.StartDate,
            'endDate',     OLD.EndDate,
            'daysCount',   OLD.DaysCount
        )
    );
END;

-- ════════════════════════════════════════════════════════════
--  SEED DATA: Leave Types (government standard leave catalog)
--
--  GenderRestriction = 'Female' flags leaves that trigger the
--  trg_prevent_female_leave_for_male trigger.
-- ════════════════════════════════════════════════════════════
-- WARN-6 FIX: Names MUST exactly match the Arabic constants in LeaveService.js:
--   ARABIC_NAME_REGULAR = 'إجازة اعتيادية'  (was 'Annual Leave')
--   ARABIC_NAME_UNPAID  = 'إجازة بدون راتب' (was 'Unpaid Leave')
--   LEAVE_NAME_SICK     = 'Sick Leave'       (unchanged — matches JS constant)
INSERT OR IGNORE INTO LeaveTypes (Name, MaxDaysPerInstance, RequiresOrderRef, GenderRestriction) VALUES
    -- Universal leaves
    ('إجازة اعتيادية',         30,  0, NULL),   -- Regular Leave
    ('إجازة مرضية',           30,  0, NULL),   -- Sick Leave
    ('إجازة طارئة',            7,  0, NULL),   -- Emergency Leave
    ('إجازة بدون راتب',        90,  1, NULL),   -- Unpaid Leave
    ('إجازة دراسية',           30,  1, NULL),   -- Study Leave
    ('إجازة حجة',             30,  1, NULL),   -- Hajj Leave
    -- Female-only leaves (GenderRestriction enforced by trigger)
    ('إجازة الأمومة',          72,  1, 'Female'), -- Maternity Leave
    ('إجازة العدة',           130,  1, 'Female'), -- Widowhood Leave
    ('إجازة الرضاعة',          24,  0, 'Female'), -- Nursing Leave
    -- New leave types
    ('دورة تدريبية',         365,  0, NULL),     -- Training Course (Non-balanced)
    ('سبب آخر',               30,  0, NULL);     -- Other Reason (Deducts from Regular Leave)
