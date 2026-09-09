// ============================================================
//  scratch/test_phase3_e2e_isolated.js
//  End-to-End Simulation of Phase 3 External Transfer flow
//  against a temporary isolated in-memory database.
// ============================================================

'use strict';

const Database = require('better-sqlite3');
const {
  addEmployee,
  transferEmployee,
  cancelEmployeeTransfer,
  getEmployeeById,
  getEmployeesPaginated,
  searchEmployees,
} = require('../src/main/services/EmployeeService');

let passed = 0;
let total = 0;

function assert(cond, msg) {
  total++;
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ PASS: ${msg}`);
    passed++;
  }
}

// 1. Setup in-memory DB with schema migrations up to 015
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE Employees (
    EmployeeID INTEGER PRIMARY KEY AUTOINCREMENT,
    FullName TEXT NOT NULL,
    Gender TEXT NOT NULL,
    HireDate TEXT NOT NULL,
    JobTitle TEXT NOT NULL,
    IsActive INTEGER NOT NULL DEFAULT 1,
    WorkLocation TEXT NULL,
    LeaveCardNumber TEXT NULL,
    LeaveApprover TEXT NULL,
    AdjustmentDays INTEGER NOT NULL DEFAULT 0,
    IsTransferred INTEGER NOT NULL DEFAULT 0 CHECK(IsTransferred IN (0, 1)),
    TransferOrderNumber TEXT DEFAULT NULL,
    TransferOrderDate TEXT DEFAULT NULL,
    TransferNotes TEXT DEFAULT NULL
  );

  CREATE TABLE Leaves (
    LeaveID INTEGER PRIMARY KEY AUTOINCREMENT,
    EmployeeID INTEGER NOT NULL,
    LeaveTypeID INTEGER NOT NULL,
    StartDate TEXT NOT NULL,
    EndDate TEXT NOT NULL,
    DaysCount INTEGER NOT NULL,
    Notes TEXT NULL,
    CreatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    LeaveApprover TEXT NULL,
    RequestDate TEXT NULL,
    MemoNumber TEXT NULL,
    MemoDate TEXT NULL,
    OrderNumber TEXT NULL,
    OrderDate TEXT NULL,
    OrderRef TEXT NULL
  );

  CREATE TABLE LeaveTypes (
    LeaveTypeID INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT NOT NULL UNIQUE,
    DefaultBalance INTEGER NOT NULL,
    RequiresApproval INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE LeaveBalances (
    BalanceID INTEGER PRIMARY KEY AUTOINCREMENT,
    EmployeeID INTEGER NOT NULL,
    LeaveTypeID INTEGER NOT NULL,
    TotalBalance INTEGER NOT NULL,
    RemainingBalance REAL NOT NULL,
    FiscalYear INTEGER,
    PayPercentage INTEGER DEFAULT 100,
    UNIQUE(EmployeeID, LeaveTypeID, PayPercentage)
  );

  CREATE TABLE AuditLogs (
    LogID INTEGER PRIMARY KEY AUTOINCREMENT,
    Timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    ActionType TEXT NOT NULL,
    EntityType TEXT NOT NULL,
    EntityID INTEGER,
    OldValue TEXT,
    NewValue TEXT,
    Details TEXT
  );

  INSERT INTO LeaveTypes (Name, DefaultBalance) VALUES ('إجازة اعتيادية', 30), ('إجازة مرضية', 28);
`);

console.log('--- TEST SUITE: Phase 3 E2E Isolated DB Flow ---');

// 2. Add a dummy test employee
const dummyEmpId = addEmployee({
  employeeId: 99999,
  fullName: 'موظف تجريبي للاختبار',
  gender: 'Male',
  hireDate: '2023-01-01',
  jobTitle: 'مهندس برمجيات',
  workLocation: 'المقر العام',
  leaveCardNumber: 'CARD-TEST-99'
}, db);

assert(Number.isInteger(dummyEmpId) && dummyEmpId > 0, 'Created dummy employee');

// 3. Verify initial state: IsActive = 1, IsTransferred = 0
let emp = getEmployeeById(dummyEmpId, db);
assert(emp.IsActive === 1, 'Initial IsActive is 1');
assert(emp.IsTransferred === 0, 'Initial IsTransferred is 0');
assert(emp.TransferOrderNumber === null, 'Initial TransferOrderNumber is null');

// 4. Perform External Transfer
const transferRes = transferEmployee(dummyEmpId, {
  transferOrderNumber: '045210',
  transferOrderDate: '2026-09-01',
  transferNotes: 'نُقل إلى قسم المشاريع'
}, db);

assert(transferRes.success === true, 'transferEmployee succeeded');

// 5. Verify Employee remains Active, but IsTransferred = 1 with correct fields
emp = getEmployeeById(dummyEmpId, db);
assert(emp.IsActive === 1, 'Employee REMAINS ACTIVE (IsActive = 1)');
assert(emp.IsTransferred === 1, 'Employee IsTransferred = 1');
assert(emp.TransferOrderNumber === '045210', 'TransferOrderNumber preserved with leading zero');
assert(emp.TransferOrderDate === '2026-09-01', 'TransferOrderDate matches');
assert(emp.TransferNotes === 'نُقل إلى قسم المشاريع', 'TransferNotes matches');

// 6. Verify Search Query returns transfer flags
const searchResults = searchEmployees('موظف تجريبي', db);
assert(searchResults.length === 1, 'searchEmployees found transferred employee');
assert(searchResults[0].IsTransferred === 1, 'searchEmployees returned IsTransferred = 1');
assert(searchResults[0].TransferOrderNumber === '045210', 'searchEmployees returned TransferOrderNumber');

// 7. Verify Paginated Table query returns transfer fields
const paged = getEmployeesPaginated({ page: 1, pageSize: 10, search: 'تجريبي' }, db);
assert(paged.data.length === 1, 'getEmployeesPaginated found transferred employee');
assert(paged.data[0].IsTransferred === 1, 'getEmployeesPaginated returned IsTransferred = 1');
assert(paged.data[0].TransferOrderNumber === '045210', 'getEmployeesPaginated returned TransferOrderNumber');

// 8. Verify AuditLogs recorded the transfer
const auditLogs = db.prepare('SELECT * FROM AuditLogs WHERE EntityID = ? ORDER BY LogID DESC').all(dummyEmpId);
assert(auditLogs.length >= 2, 'Audit logs recorded transfer event');
const lastLog = auditLogs[0];
assert(lastLog.ActionType === 'TRANSFER', 'Audit ActionType is TRANSFER');
assert(lastLog.Details.includes('نقل خارجي'), 'Audit Details mentions نقل خارجي');

// 9. Cancel External Transfer
const cancelRes = cancelEmployeeTransfer(dummyEmpId, db);
assert(cancelRes.success === true, 'cancelEmployeeTransfer succeeded');

emp = getEmployeeById(dummyEmpId, db);
assert(emp.IsActive === 1, 'Employee remains active after transfer cancellation');
assert(emp.IsTransferred === 0, 'IsTransferred reset to 0');
assert(emp.TransferOrderNumber === null, 'TransferOrderNumber reset to null');
assert(emp.TransferOrderDate === null, 'TransferOrderDate reset to null');
assert(emp.TransferNotes === null, 'TransferNotes reset to null');

db.close();

console.log(`\n========================================`);
console.log(`E2E Results: ${passed}/${total} assertions passed.`);
console.log(`========================================`);
