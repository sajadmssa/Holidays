// ============================================================
//  tests/dossierNumber.test.js
//  Unit & Integration Tests for ADR-027 DossierNumber (رقم الإضبارة):
//  1. Add employee with dossierNumber -> retrieved correctly
//  2. Add employee without dossierNumber -> defaults to null (nullable)
//  3. Non-uniqueness -> two employees can share the same dossier number
//  4. Update dossierNumber via updateEmployee
//  5. Partial update does not overwrite existing dossierNumber
//  6. Rejection of dossierNumber exceeding 100 characters
//  7. Search by dossierNumber in searchEmployees (Lookup modal)
//  8. Search and pagination by dossierNumber in getEmployeesPaginated
//  9. Audit log records DossierNumber on insert and update
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

console.log('🧪 [DossierNumber Unit Tests] Starting ADR-027 test suite...\n');

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

// ── Test 1: Add employee with dossierNumber ───────────────────────────
console.log('--- Test 1: Add employee with dossierNumber ---');
const emp1Id = EmployeeService.addEmployee({
  fullName: 'أحمد محمود حسن',
  gender: 'Male',
  hireDate: '2020-01-15',
  jobTitle: 'مهندس كهرباء',
  departmentId: 1,
  dossierNumber: 'DOS-2024-001'
}, db);

const emp1 = EmployeeService.getEmployeeById(emp1Id, db);
assert(emp1.DossierNumber === 'DOS-2024-001', 'emp1 has DossierNumber === "DOS-2024-001"');

// ── Test 2: Add employee without dossierNumber (nullable) ─────────────
console.log('--- Test 2: Add employee without dossierNumber (nullable) ---');
const emp2Id = EmployeeService.addEmployee({
  fullName: 'فاطمة علي حسين',
  gender: 'Female',
  hireDate: '2021-03-10',
  jobTitle: 'محققة قانونية',
  departmentId: 1
}, db);

const emp2 = EmployeeService.getEmployeeById(emp2Id, db);
assert(emp2.DossierNumber === null, 'emp2 has DossierNumber === null when omitted');

// ── Test 3: Non-uniqueness (multiple employees can share dossier) ──────
console.log('--- Test 3: Non-uniqueness allowed ---');
const emp3Id = EmployeeService.addEmployee({
  fullName: 'حيدر كريم جاسم',
  gender: 'Male',
  hireDate: '2022-06-01',
  jobTitle: 'مبرمج',
  departmentId: 1,
  dossierNumber: 'DOS-2024-001' // Same dossier number as emp1
}, db);

const emp3 = EmployeeService.getEmployeeById(emp3Id, db);
assert(emp3.DossierNumber === 'DOS-2024-001', 'emp3 shares the same DossierNumber successfully');

// ── Test 4: Update dossierNumber via updateEmployee ───────────────────
console.log('--- Test 4: Update dossierNumber via updateEmployee ---');
EmployeeService.updateEmployee(emp2Id, {
  fullName: emp2.FullName,
  jobTitle: emp2.JobTitle,
  dossierNumber: 'DOS-2024-002'
}, db);

const emp2Updated = EmployeeService.getEmployeeById(emp2Id, db);
assert(emp2Updated.DossierNumber === 'DOS-2024-002', 'emp2 DossierNumber updated to "DOS-2024-002"');

// ── Test 5: Partial update preserves dossierNumber when omitted ────────
console.log('--- Test 5: Partial update preserves dossierNumber ---');
EmployeeService.updateEmployee(emp2Id, {
  fullName: 'فاطمة علي حسين المعدل',
  jobTitle: emp2.JobTitle
  // dossierNumber is omitted
}, db);

const emp2Preserved = EmployeeService.getEmployeeById(emp2Id, db);
assert(emp2Preserved.FullName === 'فاطمة علي حسين المعدل', 'FullName updated');
assert(emp2Preserved.DossierNumber === 'DOS-2024-002', 'DossierNumber preserved as "DOS-2024-002"');

// ── Test 6: Rejection of dossierNumber exceeding 100 characters ────────
console.log('--- Test 6: Length validation (> 100 characters rejected) ---');
const longDossier = 'D'.repeat(101);
assertThrows(() => {
  EmployeeService.addEmployee({
    fullName: 'موظف برقم إضبارة طويل',
    gender: 'Male',
    hireDate: '2023-01-01',
    jobTitle: 'كاتب',
    departmentId: 1,
    dossierNumber: longDossier
  }, db);
}, 'رقم الإضبارة طويل جداً', 'addEmployee rejects dossierNumber > 100 chars');

assertThrows(() => {
  EmployeeService.updateEmployee(emp1Id, {
    fullName: emp1.FullName,
    jobTitle: emp1.JobTitle,
    dossierNumber: longDossier
  }, db);
}, 'رقم الإضبارة طويل جداً', 'updateEmployee rejects dossierNumber > 100 chars');

// ── Test 7: Search by dossierNumber in searchEmployees ────────────────
console.log('--- Test 7: Search by dossierNumber in searchEmployees ---');
const searchRes = EmployeeService.searchEmployees('DOS-2024-002', db);
assert(searchRes.length === 1, 'searchEmployees returns 1 match for "DOS-2024-002"');
assert(searchRes[0].EmployeeID === emp2Id, 'searchEmployees returned emp2');
assert(searchRes[0].DossierNumber === 'DOS-2024-002', 'searchEmployees result includes DossierNumber');

// ── Test 8: Search and paginate by dossierNumber in getEmployeesPaginated ─
console.log('--- Test 8: Search in getEmployeesPaginated ---');
const pageRes = EmployeeService.getEmployeesPaginated({ search: 'DOS-2024-001', page: 1, pageSize: 10 }, db);
assert(pageRes.totalCount === 2, `getEmployeesPaginated found 2 matching employees (got ${pageRes.totalCount})`);
assert(pageRes.data.some(e => e.EmployeeID === emp1Id), 'emp1 present in paginated data');
assert(pageRes.data.some(e => e.EmployeeID === emp3Id), 'emp3 present in paginated data');
assert(pageRes.data[0].DossierNumber === 'DOS-2024-001', 'paginated data contains DossierNumber');

// ── Test 9: Audit log records DossierNumber ───────────────────────────
console.log('--- Test 9: Audit log records DossierNumber ---');
const auditRow = db.prepare(`
  SELECT NewValue FROM AuditLogs 
  WHERE EntityType = 'Employee' AND EntityID = ? AND ActionType = 'INSERT'
`).get(emp1Id);
assert(auditRow !== undefined, 'Audit log exists for emp1 insert');
const parsedAudit = JSON.parse(auditRow.NewValue);
assert(parsedAudit.DossierNumber === 'DOS-2024-001', 'Audit log NewValue contains DossierNumber');

console.log(`\n🎉 [DossierNumber Unit Tests] All ${passedTests}/${totalTests} tests passed successfully!\n`);
