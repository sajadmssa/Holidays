// ============================================================
//  scratch/test_phase2_isolated.js
//  Phase 2 Isolated Test Suite
//  Strictly isolated in-memory testing. ZERO modification to live data.
// ============================================================

'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const { validateOrderNumber, normalizeArabicDigits, isOrderNumberValid } = require('../src/main/utils/orderNumberValidator');
const EmployeeService = require('../src/main/services/EmployeeService');
const LeaveService = require('../src/main/services/LeaveService');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    failedTests++;
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
    passedTests++;
  }
}

function assertThrows(fn, expectedSubstring, message) {
  try {
    fn();
    console.error(`❌ FAILED: Expected function to throw, but it did not. (${message})`);
    failedTests++;
  } catch (err) {
    if (expectedSubstring && !err.message.includes(expectedSubstring)) {
      console.error(`❌ FAILED: Threw wrong error message: "${err.message}". Expected substring: "${expectedSubstring}" (${message})`);
      failedTests++;
    } else {
      console.log(`✅ PASSED: Threw expected error: "${err.message}" (${message})`);
      passedTests++;
    }
  }
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('  TEST SUITE: Phase 2 - Database Migration & Numeric Validation');
console.log('═══════════════════════════════════════════════════════════════\n');

// ──────────────────────────────────────────────────────────────
// TEST 1: Unit tests for validateOrderNumber
// ──────────────────────────────────────────────────────────────
console.log('--- TEST 1: validateOrderNumber unit tests ---');

// 1.1 Empty / null / optional
assert(validateOrderNumber(null) === null, 'null returns null');
assert(validateOrderNumber(undefined) === null, 'undefined returns null');
assert(validateOrderNumber('') === null, 'empty string returns null');
assert(validateOrderNumber('   ') === null, 'whitespace returns null');

// 1.2 Pure numeric strings
assert(validateOrderNumber('12345') === '12345', 'Standard ASCII digits returned');
assert(validateOrderNumber(12345) === '12345', 'Integer number converted to string');

// 1.3 Leading zeros preservation
assert(validateOrderNumber('0123') === '0123', 'Leading zero preserved ("0123")');
assert(validateOrderNumber('00450') === '00450', 'Multiple leading zeros preserved ("00450")');

// 1.4 Eastern Arabic digits normalization
assert(validateOrderNumber('١٢٣٤٥') === '12345', 'Arabic-Indic digits normalized to ASCII');
assert(validateOrderNumber('٠١٢٣') === '0123', 'Arabic-Indic digits with leading zero normalized');

// 1.5 Non-numeric rejection & Arabic error messages
assertThrows(
  () => validateOrderNumber('123a'),
  'رقم الأمر الإداري يجب أن يتكون من أرقام فقط.',
  'Rejects Latin letter mixed with digits'
);
assertThrows(
  () => validateOrderNumber('أمر 123'),
  'رقم الأمر الإداري يجب أن يتكون من أرقام فقط.',
  'Rejects Arabic text'
);
assertThrows(
  () => validateOrderNumber('12-34'),
  'رقم الأمر الإداري يجب أن يتكون من أرقام فقط.',
  'Rejects dash/hyphen'
);
assertThrows(
  () => validateOrderNumber('12/34'),
  'رقم الأمر الإداري يجب أن يتكون من أرقام فقط.',
  'Rejects slash'
);
assertThrows(
  () => validateOrderNumber('12.34'),
  'رقم الأمر الإداري يجب أن يتكون من أرقام فقط.',
  'Rejects dot / float'
);
assertThrows(
  () => validateOrderNumber(' 12 34 '),
  'رقم الأمر الإداري يجب أن يتكون من أرقام فقط.',
  'Rejects space in middle'
);
assertThrows(
  () => validateOrderNumber('#456'),
  'رقم الأمر الإداري يجب أن يتكون من أرقام فقط.',
  'Rejects special character #'
);
assertThrows(
  () => validateOrderNumber('abc', 'رقم المذكرة'),
  'رقم المذكرة يجب أن يتكون من أرقام فقط.',
  'Rejects with custom label for memo number'
);

// ──────────────────────────────────────────────────────────────
// TEST 2: Run all migrations up to 015 in an isolated in-memory DB
// ──────────────────────────────────────────────────────────────
console.log('\n--- TEST 2: Migration 015 in isolated SQLite DB ---');

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE _Migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    executedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

const migrationsDir = path.join(__dirname, '..', 'src', 'main', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

console.log(`Found ${migrationFiles.length} migration files.`);
for (const file of migrationFiles) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  db.transaction(() => {
    try {
      db.exec(sql);
    } catch (err) {
      if (err.message.includes('duplicate column name')) {
        // ignore duplicate column
      } else {
        throw err;
      }
    }
    db.prepare('INSERT INTO _Migrations (name) VALUES (?)').run(file);
  })();
}

const lastMigration = db.prepare('SELECT name FROM _Migrations ORDER BY id DESC LIMIT 1').get();
assert(lastMigration.name === '015_add_employee_transfer_fields.sql', 'Migration 015 executed successfully as latest migration');

const empCols = db.prepare('PRAGMA table_info(Employees)').all();
const hasIsTransferred = empCols.some(c => c.name === 'IsTransferred' && c.type === 'INTEGER');
const hasOrderNum = empCols.some(c => c.name === 'TransferOrderNumber' && c.type === 'TEXT');
const hasOrderDate = empCols.some(c => c.name === 'TransferOrderDate' && c.type === 'TEXT');
const hasNotes = empCols.some(c => c.name === 'TransferNotes' && c.type === 'TEXT');

assert(hasIsTransferred, 'Employees table has IsTransferred column (INTEGER)');
assert(hasOrderNum, 'Employees table has TransferOrderNumber column (TEXT)');
assert(hasOrderDate, 'Employees table has TransferOrderDate column (TEXT)');
assert(hasNotes, 'Employees table has TransferNotes column (TEXT)');

// ──────────────────────────────────────────────────────────────
// TEST 3: Mock Employee insertion & default transfer values
// ──────────────────────────────────────────────────────────────
console.log('\n--- TEST 3: Mock Employee insertion & default transfer values ---');

const mockEmpId = EmployeeService.addEmployee({
  employeeId: 9991,
  fullName: 'موظف اختباري معزول',
  gender: 'Male',
  hireDate: '2020-01-01',
  jobTitle: 'مهندس فحص',
  workLocation: 'موقع الاختبار'
}, db);

const freshEmp = EmployeeService.getEmployeeById(mockEmpId, db);
assert(freshEmp.IsActive === 1, 'Mock employee is active (IsActive = 1)');
assert(freshEmp.IsTransferred === 0, 'Mock employee has IsTransferred = 0 by default');
assert(freshEmp.TransferOrderNumber === null, 'Mock employee has TransferOrderNumber = null by default');
assert(freshEmp.TransferOrderDate === null, 'Mock employee has TransferOrderDate = null by default');
assert(freshEmp.TransferNotes === null, 'Mock employee has TransferNotes = null by default');

// ──────────────────────────────────────────────────────────────
// TEST 4: transferEmployee method validation & active status preservation
// ──────────────────────────────────────────────────────────────
console.log('\n--- TEST 4: Employee transfer & active status preservation ---');

// 4.1 Reject non-numeric transfer order number
assertThrows(
  () => EmployeeService.transferEmployee(mockEmpId, { transferOrderNumber: 'امر-444' }, db),
  'رقم الأمر الإداري الخاص بالنقل يجب أن يتكون من أرقام فقط.',
  'Rejects non-numeric transferOrderNumber'
);

// 4.2 Reject invalid transfer order date
assertThrows(
  () => EmployeeService.transferEmployee(mockEmpId, {
    transferOrderNumber: '12345',
    transferOrderDate: '2026-02-30' // invalid date
  }, db),
  'تاريخ أمر النقل الإداري غير صالح',
  'Rejects invalid transfer order date'
);

// 4.3 Successful transfer with leading zero order number
const transferRes = EmployeeService.transferEmployee(mockEmpId, {
  transferOrderNumber: '00789',
  transferOrderDate: '2026-09-01',
  transferNotes: 'نقل إلى مديرية توزيع البصرة'
}, db);

assert(transferRes.success === true, 'transferEmployee succeeded');

const transferredEmp = EmployeeService.getEmployeeById(mockEmpId, db);
assert(transferredEmp.IsTransferred === 1, 'Employee has IsTransferred = 1');
assert(transferredEmp.IsActive === 1, 'CRITICAL: Employee remains active (IsActive = 1)');
assert(transferredEmp.TransferOrderNumber === '00789', 'TransferOrderNumber preserved with leading zero ("00789")');
assert(transferredEmp.TransferOrderDate === '2026-09-01', 'TransferOrderDate saved correctly');
assert(transferredEmp.TransferNotes === 'نقل إلى مديرية توزيع البصرة', 'TransferNotes saved correctly');

// 4.4 Verify AuditLogs entry
const auditLog = db.prepare(`
  SELECT * FROM AuditLogs
  WHERE EntityType = 'Employee' AND EntityID = ? AND ActionType = 'TRANSFER'
  ORDER BY LogID DESC LIMIT 1
`).get(mockEmpId);

assert(auditLog !== undefined, 'AuditLog created for transfer');
const parsedNewVal = JSON.parse(auditLog.NewValue);
assert(parsedNewVal.IsTransferred === 1, 'AuditLog recorded IsTransferred: 1');
assert(parsedNewVal.TransferOrderNumber === '00789', 'AuditLog recorded TransferOrderNumber: "00789"');

// 4.5 Cancel Transfer
const cancelRes = EmployeeService.cancelEmployeeTransfer(mockEmpId, db);
assert(cancelRes.success === true, 'cancelEmployeeTransfer succeeded');

const restoredEmp = EmployeeService.getEmployeeById(mockEmpId, db);
assert(restoredEmp.IsTransferred === 0, 'Employee IsTransferred reset to 0');
assert(restoredEmp.TransferOrderNumber === null, 'TransferOrderNumber reset to null');
assert(restoredEmp.IsActive === 1, 'Employee IsActive remains 1');

// ──────────────────────────────────────────────────────────────
// TEST 5: LeaveService numeric validation on OrderNumber & MemoNumber
// ──────────────────────────────────────────────────────────────
console.log('\n--- TEST 5: LeaveService validation on OrderNumber & MemoNumber ---');

// Re-transfer employee for testing
EmployeeService.transferEmployee(mockEmpId, {
  transferOrderNumber: '998877',
  transferOrderDate: '2026-09-01',
  transferNotes: 'نقل مؤقت'
}, db);

// Register a regular leave with valid numeric order number
const leaveInsertRes = db.prepare(`
  INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, OrderNumber, MemoNumber)
  VALUES (?, 1, '2026-10-01', '2026-10-05', 5, '12345', '67890')
`).run(mockEmpId);

const leaveId = Number(leaveInsertRes.lastInsertRowid);
assert(leaveId > 0, 'Initial leave inserted');

// 5.1 Updating leave with non-numeric orderNumber fails
assertThrows(
  () => LeaveService.updateLeave(leaveId, {
    leaveType: 'إجازة اعتيادية',
    startDate: '2026-10-01',
    endDate: '2026-10-05',
    requestedDays: 5,
    orderNumber: 'Order-XYZ',
    modifierName: 'مدقق الاختبار'
  }, db),
  'رقم الأمر الإداري يجب أن يتكون من أرقام فقط.',
  'LeaveService.updateLeave rejects non-numeric orderNumber'
);

// 5.2 Updating leave with non-numeric memoNumber fails
assertThrows(
  () => LeaveService.updateLeave(leaveId, {
    leaveType: 'إجازة اعتيادية',
    startDate: '2026-10-01',
    endDate: '2026-10-05',
    requestedDays: 5,
    orderNumber: '5544',
    memoNumber: 'مذكرة-1',
    modifierName: 'مدقق الاختبار'
  }, db),
  'رقم المذكرة يجب أن يتكون من أرقام فقط.',
  'LeaveService.updateLeave rejects non-numeric memoNumber'
);

// 5.3 Updating leave with valid numeric numbers (with leading zeros) succeeds
const updateRes = LeaveService.updateLeave(leaveId, {
  leaveType: 'إجازة اعتيادية',
  startDate: '2026-10-01',
  endDate: '2026-10-05',
  requestedDays: 5,
  orderNumber: '00987',
  memoNumber: '00321',
  modifierName: 'مدقق الاختبار'
}, db);

assert(updateRes.success === true, 'LeaveService.updateLeave succeeded with valid numeric strings');
const updatedLeave = db.prepare('SELECT * FROM Leaves WHERE LeaveID = ?').get(leaveId);
assert(updatedLeave.OrderNumber === '00987', 'Leave OrderNumber updated with preserved leading zeros ("00987")');
assert(updatedLeave.MemoNumber === '00321', 'Leave MemoNumber updated with preserved leading zeros ("00321")');

// ──────────────────────────────────────────────────────────────
// TEST 6: getEmployeesPaginated includes transfer metadata
// ──────────────────────────────────────────────────────────────
console.log('\n--- TEST 6: getEmployeesPaginated includes transfer metadata ---');

const paged = EmployeeService.getEmployeesPaginated({ search: 'اختباري' }, db);
assert(paged.data.length === 1, 'Found mock employee in paginated search');
const pagedEmp = paged.data[0];
assert(pagedEmp.IsTransferred === 1, 'Paged employee has IsTransferred = 1');
assert(pagedEmp.TransferOrderNumber === '998877', 'Paged employee has TransferOrderNumber = "998877"');
assert(pagedEmp.IsActive === 1, 'Paged employee is active (IsActive = 1)');

db.close();

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`  ALL TESTS COMPLETED: ${passedTests} passed, ${failedTests} failed.`);
console.log('═══════════════════════════════════════════════════════════════');

if (failedTests > 0) {
  process.exit(1);
}
