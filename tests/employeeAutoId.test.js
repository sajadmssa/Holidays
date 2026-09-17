// ============================================================
//  tests/employeeAutoId.test.js
//  Regression & Unit Tests for ADR-025 Auto EmployeeID Generation & JobNumber:
//  1. Add employee without explicit employeeId -> fetches next_employee_id from AppCounters
//  2. Missing AppCounters row -> falls back to MAX(EmployeeID) + 1 and initializes counter
//  3. Monotonic non-decrementing counter after deleting latest employee (no ID reuse)
//  4. Counter conflict between AppCounters and _AppSettings -> picks higher value & synchronizes
//  5. JobNumber is stored as NULL in database when omitted (not empty string, not 'undefined', not EmployeeID)
//  6. Atomic rollback on counter failure -> transaction aborts, no partial employee created
// ============================================================

'use strict';

// Transparent ABI bridge: if run via external Node.js, re-exec via Electron's embedded Node (ABI 110)
if (!process.versions.electron && process.env.ELECTRON_RUN_AS_NODE !== '1') {
  const { spawnSync } = require('child_process');
  const electronPath = require('electron');
  const result = spawnSync(electronPath, [__filename], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  process.exit(result.status ?? 0);
}

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const EmployeeService = require('../src/main/services/EmployeeService');

console.log('🧪 [EmployeeAutoId Unit Tests] Starting ADR-025 test suite...\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  passedTests++;
  console.log(`  ✅ PASS: ${message}`);
}

function assertThrows(fn, expectedSubstr, message) {
  totalTests++;
  try {
    fn();
    console.error(`❌ FAIL: Expected error containing "${expectedSubstr}" was NOT thrown: ${message}`);
    process.exit(1);
  } catch (err) {
    if (expectedSubstr && !err.message.includes(expectedSubstr)) {
      console.error(`❌ FAIL: Error thrown did not contain "${expectedSubstr}". Got: "${err.message}": ${message}`);
      process.exit(1);
    }
    passedTests++;
    console.log(`  ✅ PASS: ${message}`);
  }
}

function createTestDb() {
  const db = new Database(':memory:');
  const migrationsDir = path.join(__dirname, '..', 'src', 'main', 'migrations');
  const files = fs.readdirSync(migrationsDir).sort();
  for (const f of files) {
    if (f.endsWith('.sql')) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      try {
        db.exec(sql);
      } catch (e) {
        if (!e.message.includes('duplicate column')) throw e;
      }
    }
  }

  // Ensure AppCounters table exists (schema must match migration 022: 2 columns only, no UpdatedAt)
  db.exec(`
    CREATE TABLE IF NOT EXISTS AppCounters (
      CounterKey TEXT PRIMARY KEY,
      CounterValue INTEGER NOT NULL
    );
  `);

  return db;
}

const db = createTestDb();

// ── Test 1: Auto generation from AppCounters ───────────────────
console.log('--- Test 1: Auto EmployeeID generation from AppCounters ---');
db.prepare("INSERT OR REPLACE INTO AppCounters (CounterKey, CounterValue) VALUES ('next_employee_id', 10)").run();
db.prepare("INSERT OR REPLACE INTO _AppSettings (Key, Value) VALUES ('next_employee_id', '10')").run();

EmployeeService.addEmployee({
  fullName: 'موظف تجريبي تلقائي 1',
  gender: 'Male',
  hireDate: '2023-01-01',
  jobTitle: 'مبرمج',
  departmentId: 1
}, db);

const emp1 = db.prepare("SELECT * FROM Employees WHERE FullName = 'موظف تجريبي تلقائي 1'").get();
assert(emp1.EmployeeID === 10, 'Employee automatically assigned EmployeeID = 10 from AppCounters');
const counter1 = db.prepare("SELECT CounterValue FROM AppCounters WHERE CounterKey = 'next_employee_id'").get();
assert(Number(counter1.CounterValue) === 11, 'AppCounters.next_employee_id incremented to 11');
const setting1 = db.prepare("SELECT Value FROM _AppSettings WHERE Key = 'next_employee_id'").get();
assert(parseInt(setting1.Value, 10) === 11, '_AppSettings.next_employee_id incremented to 11');

// ── Test 2: Fallback to MAX(EmployeeID) + 1 when AppCounters has no row ─
console.log('\n--- Test 2: Fallback to MAX(EmployeeID)+1 when no counter row exists ---');
db.prepare("DELETE FROM AppCounters WHERE CounterKey = 'next_employee_id'").run();
db.prepare("DELETE FROM _AppSettings WHERE Key = 'next_employee_id'").run();

EmployeeService.addEmployee({
  fullName: 'موظف تجريبي تلقائي 2 بدون عداد',
  gender: 'Female',
  hireDate: '2023-02-01',
  jobTitle: 'مهندسة',
  departmentId: 1
}, db);

const emp2 = db.prepare("SELECT * FROM Employees WHERE FullName = 'موظف تجريبي تلقائي 2 بدون عداد'").get();
assert(emp2.EmployeeID === 11, 'Employee assigned MAX(EmployeeID)+1 = 11 when counter row missing');
const counter2 = db.prepare("SELECT CounterValue FROM AppCounters WHERE CounterKey = 'next_employee_id'").get();
assert(Number(counter2.CounterValue) === 12, 'AppCounters created and incremented to 12');

// ── Test 3: Monotonic non-decrementing check after deletion ─────
console.log('\n--- Test 3: Monotonic non-decrementing counter after deleting latest employee ---');
// Delete employee 11 (latest)
db.prepare('DELETE FROM LeaveBalances WHERE EmployeeID = 11').run();
db.prepare("DELETE FROM AuditLogs WHERE EntityType = 'Employee' AND EntityID = 11").run();
db.prepare('DELETE FROM Employees WHERE EmployeeID = 11').run();

// Next employee must get 12, NOT reuse 11
EmployeeService.addEmployee({
  fullName: 'موظف تجريبي تلقائي 3 بعد الحذف',
  gender: 'Male',
  hireDate: '2023-03-01',
  jobTitle: 'فني',
  departmentId: 1
}, db);

const emp3 = db.prepare("SELECT * FROM Employees WHERE FullName = 'موظف تجريبي تلقائي 3 بعد الحذف'").get();
assert(emp3.EmployeeID === 12, 'Next employee receives 12, never reusing deleted ID 11');
const counter3 = db.prepare("SELECT CounterValue FROM AppCounters WHERE CounterKey = 'next_employee_id'").get();
assert(Number(counter3.CounterValue) === 13, 'AppCounters.next_employee_id monotonically advanced to 13');

// ── Test 4: AppCounters primary authority / _AppSettings fallback ───
console.log('\n--- Test 4: AppCounters primary authority / _AppSettings fallback ---');
// Discrepancy simulation: AppCounters has 50, _AppSettings has 30.
// AppCounters is the primary source of truth and must take precedence.
db.prepare("UPDATE AppCounters SET CounterValue = 50 WHERE CounterKey = 'next_employee_id'").run();
db.prepare("UPDATE _AppSettings SET Value = '30' WHERE Key = 'next_employee_id'").run();

EmployeeService.addEmployee({
  fullName: 'موظف تجريبي تلقائي 4 أولوية العدادات',
  gender: 'Male',
  hireDate: '2023-04-01',
  jobTitle: 'مشرف',
  departmentId: 1
}, db);

const emp4 = db.prepare("SELECT * FROM Employees WHERE FullName = 'موظف تجريبي تلقائي 4 أولوية العدادات'").get();
assert(emp4.EmployeeID === 50, 'AppCounters is the primary source of truth; takes precedence over _AppSettings');
const counter4 = db.prepare("SELECT CounterValue FROM AppCounters WHERE CounterKey = 'next_employee_id'").get();
assert(Number(counter4.CounterValue) === 51, 'AppCounters incremented to 51');
const setting4 = db.prepare("SELECT Value FROM _AppSettings WHERE Key = 'next_employee_id'").get();
assert(parseInt(setting4.Value, 10) === 51, '_AppSettings synchronized to 51');

// ── Test 5: JobNumber is stored strictly as NULL when not provided ─────
console.log('\n--- Test 5: JobNumber is stored as NULL when omitted ---');
const empRowNull = db.prepare("SELECT JobNumber FROM Employees WHERE EmployeeID = 50").get();
assert(empRowNull.JobNumber === null, 'JobNumber is strictly NULL in database when not provided');

EmployeeService.addEmployee({
  fullName: 'موظف مع رقم وظيفي مخصص',
  gender: 'Female',
  hireDate: '2023-05-01',
  jobTitle: 'محاسبة',
  jobNumber: 'JOB-9988',
  departmentId: 1
}, db);

const empRowCustom = db.prepare("SELECT JobNumber FROM Employees WHERE FullName = 'موظف مع رقم وظيفي مخصص'").get();
assert(empRowCustom.JobNumber === 'JOB-9988', 'Custom JobNumber is preserved when provided');

// ── Test 6: Atomic Rollback on Counter Failure ──────────────────
console.log('\n--- Test 6: Atomic Rollback on Counter Failure ---');
// Add a trigger that forces failure when updating AppCounters to simulate disk/DB error
db.exec(`
  CREATE TRIGGER trg_test_force_counter_fail
  BEFORE UPDATE ON AppCounters
  FOR EACH ROW
  WHEN NEW.CounterValue = 999
  BEGIN
    SELECT RAISE(ABORT, 'SIMULATED_COUNTER_DISK_ERROR');
  END;
`);

// Set counter to 998 so nextIdValue will be 999
db.prepare("UPDATE AppCounters SET CounterValue = 998 WHERE CounterKey = 'next_employee_id'").run();

assertThrows(() => {
  EmployeeService.addEmployee({
    fullName: 'موظف يجب أن يفشل بالكامل',
    gender: 'Male',
    hireDate: '2023-06-01',
    jobTitle: 'مهندس فاشل',
    departmentId: 1
  }, db);
}, 'SIMULATED_COUNTER_DISK_ERROR', 'addEmployee throws error and aborts transaction when counter fails');

// Verify atomic rollback: employee must NOT exist in database!
const rolledBackEmp = db.prepare("SELECT * FROM Employees WHERE FullName = 'موظف يجب أن يفشل بالكامل'").get();
assert(rolledBackEmp == null, 'Employee is NOT inserted (atomic rollback succeeded, zero orphan records)');

// ── Test 7: Missing AppCounters table catches 'no such table', logs warning & falls back ──
console.log('\n--- Test 7: Missing AppCounters table graceful degradation ---');
const isolatedDb = new Database(':memory:');
const migDir = path.join(__dirname, '..', 'src', 'main', 'migrations');
const files021 = fs.readdirSync(migDir).filter(f => f.endsWith('.sql') && !f.startsWith('022')).sort();
for (const f of files021) {
  const sql = fs.readFileSync(path.join(migDir, f), 'utf8');
  try { isolatedDb.exec(sql); } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
}

// When AppCounters table is missing, reading from it does NOT throw 'تعذر قراءة عداد الموظفين من AppCounters'.
// It logs a warning, proceeds to fallback, and then fails safely on write with rollback.
assertThrows(() => {
  EmployeeService.addEmployee({
    fullName: 'موظف في قاعدة بيانات بدون جدول عدادات',
    gender: 'Male',
    hireDate: '2023-07-01',
    jobTitle: 'مهندس صيانة',
    departmentId: 1
  }, isolatedDb);
}, 'فشل تحديث عداد AppCounters', 'addEmployee handles missing AppCounters table on read gracefully and fails safely on write');

isolatedDb.close();

console.log(`\n🎉 ALL ${passedTests}/${totalTests} TESTS PASSED FOR EMPLOYEE AUTO ID & JOBNUMBER!`);
