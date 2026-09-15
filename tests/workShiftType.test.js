// ============================================================
//  tests/workShiftType.test.js
//  Unit & Regression Tests for ADR-026 WorkShiftType (نوع الدوام):
//  1. Default value when workShiftType is omitted -> 'دوام صباحي'
//  2. Successful insertion and retrieval of all three valid work shift types:
//     - 'دوام صباحي'
//     - 'مناوب'
//     - 'مناوب بنظام 400kv'
//  3. Rejection of invalid workShiftType values at Service level
//  4. Rejection of invalid workShiftType values by SQLite CHECK constraint
//  5. Correct updating and retrieval of workShiftType via updateEmployee
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

console.log('🧪 [WorkShiftType Unit Tests] Starting ADR-026 test suite...\n');

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

  // Ensure AppCounters table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS AppCounters (
      CounterKey TEXT PRIMARY KEY,
      CounterValue INTEGER NOT NULL,
      UpdatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  return db;
}

const db = createTestDb();

// ── Test 1: Default value when workShiftType is omitted ───────────
console.log('--- Test 1: Default value when workShiftType is omitted ---');
const emp1Id = EmployeeService.addEmployee({
  fullName: 'موظف تجريبي افتراضي',
  gender: 'Male',
  hireDate: '2024-01-01',
  jobTitle: 'مهندس',
  departmentId: 1
}, db);

assert(typeof emp1Id === 'number' && emp1Id > 0, 'addEmployee returned valid employee ID number');
const emp1 = EmployeeService.getEmployeeById(emp1Id, db);
assert(emp1.WorkShiftType === 'دوام صباحي', `Default WorkShiftType is 'دوام صباحي' (got: '${emp1.WorkShiftType}')`);

// ── Test 2: Successful insertion of all valid workShiftType values ──
console.log('\n--- Test 2: Valid workShiftType values persistence ---');

const emp2Id = EmployeeService.addEmployee({
  fullName: 'موظف مناوب',
  gender: 'Male',
  hireDate: '2024-01-02',
  jobTitle: 'فني تشغيل',
  departmentId: 1,
  workShiftType: 'مناوب'
}, db);
const emp2 = EmployeeService.getEmployeeById(emp2Id, db);
assert(emp2.WorkShiftType === 'مناوب', `WorkShiftType correctly saved as 'مناوب' (got: '${emp2.WorkShiftType}')`);

const emp3Id = EmployeeService.addEmployee({
  fullName: 'موظف مناوب محطة 400',
  gender: 'Male',
  hireDate: '2024-01-03',
  jobTitle: 'مشغل محطة',
  departmentId: 1,
  workShiftType: 'مناوب بنظام 400kv'
}, db);
const emp3 = EmployeeService.getEmployeeById(emp3Id, db);
assert(emp3.WorkShiftType === 'مناوب بنظام 400kv', `WorkShiftType correctly saved as 'مناوب بنظام 400kv' (got: '${emp3.WorkShiftType}')`);

const emp4Id = EmployeeService.addEmployee({
  fullName: 'موظف دوام صباحي صريح',
  gender: 'Female',
  hireDate: '2024-01-04',
  jobTitle: 'محاسبة',
  departmentId: 1,
  workShiftType: 'دوام صباحي'
}, db);
const emp4 = EmployeeService.getEmployeeById(emp4Id, db);
assert(emp4.WorkShiftType === 'دوام صباحي', `WorkShiftType correctly saved as 'دوام صباحي' (got: '${emp4.WorkShiftType}')`);

// ── Test 3: Rejection of invalid workShiftType at Service level ───
console.log('\n--- Test 3: Service-level validation for invalid workShiftType ---');

assertThrows(() => {
  EmployeeService.addEmployee({
    fullName: 'موظف نوع غير صالح',
    gender: 'Male',
    hireDate: '2024-01-05',
    jobTitle: 'فني',
    departmentId: 1,
    workShiftType: 'دوام مسائي'
  }, db);
}, 'نوع الدوام غير صالح', 'addEmployee rejects invalid workShiftType');

assertThrows(() => {
  EmployeeService.updateEmployee(emp1.EmployeeID, {
    fullName: emp1.FullName,
    jobTitle: emp1.JobTitle,
    workShiftType: 'شفت عشوائي'
  }, db);
}, 'نوع الدوام غير صالح', 'updateEmployee rejects invalid workShiftType');

// ── Test 4: SQLite CHECK constraint enforcement ──────────────────
console.log('\n--- Test 4: Database CHECK constraint enforcement ---');

assertThrows(() => {
  db.prepare(`
    INSERT INTO Employees (FullName, Gender, HireDate, JobTitle, DepartmentID, WorkShiftType)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('موظف فحص القيد', 'Male', '2024-01-06', 'فني', 1, 'قيمة_غير_مقبولة');
}, 'CHECK constraint failed', 'Database CHECK constraint rejects invalid WorkShiftType');

// ── Test 5: Update workShiftType via updateEmployee ──────────────
console.log('\n--- Test 5: Updating WorkShiftType via updateEmployee ---');

const updateRes = EmployeeService.updateEmployee(emp1.EmployeeID, {
  fullName: emp1.FullName,
  jobTitle: emp1.JobTitle,
  workShiftType: 'مناوب'
}, db);
assert(updateRes && updateRes.success, 'updateEmployee returned success');

const emp1Updated = EmployeeService.getEmployeeById(emp1.EmployeeID, db);
assert(emp1Updated.WorkShiftType === 'مناوب', `WorkShiftType updated from 'دوام صباحي' to 'مناوب' (got: '${emp1Updated.WorkShiftType}')`);

const updateRes2 = EmployeeService.updateEmployee(emp1.EmployeeID, {
  fullName: emp1.FullName,
  jobTitle: emp1.JobTitle,
  workShiftType: 'مناوب بنظام 400kv'
}, db);
assert(updateRes2 && updateRes2.success, 'updateEmployee returned success for 400kv');

const emp1Updated2 = EmployeeService.getEmployeeById(emp1.EmployeeID, db);
assert(emp1Updated2.WorkShiftType === 'مناوب بنظام 400kv', `WorkShiftType updated to 'مناوب بنظام 400kv' (got: '${emp1Updated2.WorkShiftType}')`);

// Verify omission in update payload leaves WorkShiftType intact
EmployeeService.updateEmployee(emp1.EmployeeID, {
  fullName: 'موظف تجريبي تم تعديل اسمه فقط',
  jobTitle: emp1.JobTitle
}, db);
const emp1Preserved = EmployeeService.getEmployeeById(emp1.EmployeeID, db);
assert(emp1Preserved.WorkShiftType === 'مناوب بنظام 400kv', 'WorkShiftType preserved when omitted from updateEmployee payload');

// ── Summary ───────────────────────────────────────────────────────
console.log(`\n======================================================`);
console.log(`🎉 All ${passedTests}/${totalTests} WorkShiftType tests passed successfully!`);
console.log(`======================================================\n`);
process.exit(0);
