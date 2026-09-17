// ============================================================
//  tests/dossierUniqueness.test.js
//  Unit & Integration Tests for ADR-029:
//  منع تكرار رقم الإضبارة بين الموظفين النشطين (Hard Block)
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

console.log('🧪 [Dossier Uniqueness Unit Tests] Starting ADR-029 test suite...\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    process.exit(1);
  }
  passedTests++;
  console.log(`  ✅ PASS: ${message}`);
}

function assertThrows(fn, expectedSubstr, message) {
  totalTests++;
  try {
    fn();
    console.error(`  ❌ FAIL: Expected error containing "${expectedSubstr}" was NOT thrown: ${message}`);
    process.exit(1);
  } catch (err) {
    if (expectedSubstr && !err.message.includes(expectedSubstr)) {
      console.error(`  ❌ FAIL: Error thrown did not contain "${expectedSubstr}". Got: "${err.message}": ${message}`);
      process.exit(1);
    }
    passedTests++;
    console.log(`  ✅ PASS: ${message} (Caught: "${err.message}")`);
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

// ── Test 1: Reject adding employee if dossier matches an active employee ──
console.log('--- Test 1: Hard block duplicate dossier for active employees ---');
const emp1Id = EmployeeService.addEmployee({
  fullName: 'أحمد علي محمد',
  gender: 'Male',
  hireDate: '2020-01-15',
  jobTitle: 'مهندس كهرباء',
  departmentId: 1,
  dossierNumber: 'DOS-101'
}, db);

assert(emp1Id > 0, 'emp1 created successfully with DOS-101');

assertThrows(
  () => {
    EmployeeService.addEmployee({
      fullName: 'خالد عبد الله',
      gender: 'Male',
      hireDate: '2021-02-10',
      jobTitle: 'فني تشغيل',
      departmentId: 1,
      dossierNumber: 'DOS-101' // duplicate of active emp1
    }, db);
  },
  'أحمد علي محمد',
  'Adding duplicate dossier rejected with active employee name'
);

// ── Test 2: Allow reuse if previous owner was transferred externally ──
console.log('\n--- Test 2: Allow reuse if previous owner is transferred externally ---');
EmployeeService.transferEmployee({
  employeeId: emp1Id,
  transferOrderNumber: '9901',
  transferOrderDate: '2023-05-01',
  transferNotes: 'نقل إلى وزارة أخرى'
}, db);

const emp1AfterTransfer = EmployeeService.getEmployeeById(emp1Id, db);
assert(emp1AfterTransfer.IsTransferred === 1, 'emp1 successfully marked as transferred');

const emp2Id = EmployeeService.addEmployee({
  fullName: 'خالد عبد الله',
  gender: 'Male',
  hireDate: '2021-02-10',
  jobTitle: 'فني تشغيل',
  departmentId: 1,
  dossierNumber: 'DOS-101' // Allowed because emp1 is transferred!
}, db);

assert(emp2Id > 0, 'emp2 successfully added with DOS-101 reusing transferred employee dossier');
const emp2 = EmployeeService.getEmployeeById(emp2Id, db);
assert(emp2.DossierNumber === 'DOS-101', 'emp2 has DossierNumber DOS-101');

// ── Test 3: Allow reuse if previous owner is deactivated / retired / frozen ──
console.log('\n--- Test 3: Allow reuse if previous owner is deactivated / frozen / retired ---');
const emp3Id = EmployeeService.addEmployee({
  fullName: 'سارة كريم إبراهيم',
  gender: 'Female',
  hireDate: '2019-03-01',
  jobTitle: 'مبرمجة أقدم',
  departmentId: 1,
  dossierNumber: 'DOS-202'
}, db);

assert(emp3Id > 0, 'emp3 created successfully with DOS-202');

// Deactivate emp3 (Soft delete / retirement)
EmployeeService.deactivateEmployee(emp3Id, db);
const emp3Deactivated = EmployeeService.getEmployeeById(emp3Id, db);
assert(emp3Deactivated.IsActive === 0, 'emp3 successfully deactivated (IsActive = 0)');

// Add emp4 reusing DOS-202
const emp4Id = EmployeeService.addEmployee({
  fullName: 'مريم حسن علوان',
  gender: 'Female',
  hireDate: '2024-01-10',
  jobTitle: 'محاسبة',
  departmentId: 1,
  dossierNumber: 'DOS-202' // Allowed because emp3 is deactivated!
}, db);

assert(emp4Id > 0, 'emp4 successfully added reusing deactivated employee dossier DOS-202');
const emp4 = EmployeeService.getEmployeeById(emp4Id, db);
assert(emp4.DossierNumber === 'DOS-202', 'emp4 has DossierNumber DOS-202');

// ── Test 4: Reject updating employee to a dossier used by another active employee ──
console.log('\n--- Test 4: Reject updating employee to another active employee dossier ---');
// emp2 has DOS-101 (Active), emp4 has DOS-202 (Active)
assertThrows(
  () => {
    EmployeeService.updateEmployee(emp4Id, {
      fullName: 'مريم حسن علوان',
      jobTitle: 'محاسبة',
      dossierNumber: 'DOS-101' // duplicate of active emp2 (خالد عبد الله)
    }, db);
  },
  'خالد عبد الله',
  'Updating employee to taken dossier rejected with active employee name'
);

// ── Test 5: Allow updating employee while keeping the same dossier (do not reject self) ──
console.log('\n--- Test 5: Allow updating employee with same dossier (no self-conflict) ---');
EmployeeService.updateEmployee(emp2Id, {
  fullName: 'خالد عبد الله محمود',
  jobTitle: 'فني تشغيل أقدم',
  dossierNumber: 'DOS-101' // same dossier
}, db);

const emp2Updated = EmployeeService.getEmployeeById(emp2Id, db);
assert(emp2Updated.FullName === 'خالد عبد الله محمود', 'emp2 FullName updated successfully');
assert(emp2Updated.DossierNumber === 'DOS-101', 'emp2 DossierNumber preserved without self-conflict');

// Also verify updating other fields without passing dossierNumber preserves it
EmployeeService.updateEmployee(emp2Id, {
  fullName: 'خالد عبد الله محمود',
  jobTitle: 'فني تشغيل أقدم',
  workLocation: 'المحطة الشمالية'
}, db);
const emp2Preserved = EmployeeService.getEmployeeById(emp2Id, db);
assert(emp2Preserved.DossierNumber === 'DOS-101', 'emp2 DossierNumber preserved when omitted in update');

// ── Test 6: Empty and NULL values are exempt from uniqueness check ──
console.log('\n--- Test 6: Multiple employees can have NULL or empty dossier numbers ---');
const empEmpty1Id = EmployeeService.addEmployee({
  fullName: 'موظف بدون إضبارة 1',
  gender: 'Male',
  hireDate: '2023-01-01',
  jobTitle: 'حارس',
  departmentId: 1
}, db);

const empEmpty2Id = EmployeeService.addEmployee({
  fullName: 'موظف بدون إضبارة 2',
  gender: 'Female',
  hireDate: '2023-02-01',
  jobTitle: 'حارسة',
  departmentId: 1,
  dossierNumber: null
}, db);

const empEmpty3Id = EmployeeService.addEmployee({
  fullName: 'موظف بدون إضبارة 3',
  gender: 'Male',
  hireDate: '2023-03-01',
  jobTitle: 'سائق',
  departmentId: 1,
  dossierNumber: '   ' // whitespace only
}, db);

assert(empEmpty1Id > 0 && empEmpty2Id > 0 && empEmpty3Id > 0, 'Multiple employees with NULL/empty dossier created successfully');
const empEmpty3 = EmployeeService.getEmployeeById(empEmpty3Id, db);
assert(empEmpty3.DossierNumber === null, 'Whitespace dossier stored as null');

// Update empty employee to empty remains allowed
EmployeeService.updateEmployee(empEmpty1Id, {
  fullName: 'موظف بدون إضبارة 1',
  jobTitle: 'حارس أقدم',
  dossierNumber: ''
}, db);
const empEmpty1Updated = EmployeeService.getEmployeeById(empEmpty1Id, db);
assert(empEmpty1Updated.DossierNumber === null, 'Empty string dossier updated to null without error');

// ── Test 7: Protection against reactivating or restoring transfer with conflicting dossier ──
console.log('\n--- Test 7: Block reactivating or cancelling transfer if dossier was reassigned ---');
// emp1 (Transferred) has DOS-101, but emp2 (Active) now owns DOS-101!
assertThrows(
  () => {
    EmployeeService.cancelEmployeeTransfer(emp1Id, db);
  },
  'خالد عبد الله محمود',
  'Cancelling transfer blocked because active emp2 now owns DOS-101'
);

// emp3 (Deactivated) has DOS-202, but emp4 (Active) now owns DOS-202!
assertThrows(
  () => {
    EmployeeService.activateEmployee(emp3Id, db);
  },
  'مريم حسن علوان',
  'Reactivating employee blocked because active emp4 now owns DOS-202'
);

console.log(`\n🎉 [Dossier Uniqueness Unit Tests] All ${passedTests}/${totalTests} tests passed successfully!`);
