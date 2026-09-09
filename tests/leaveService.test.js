// ============================================================
//  tests/leaveService.test.js
//  Regression & Unit Tests for LeaveService:
//  1. 1-day leave (إجازة يوم واحد)
//  2. EndDate < StartDate error (تاريخ نهاية قبل تاريخ البداية)
//  3. Leap year with Feb 29 (سنة كبيسة تتضمن 29 شباط)
//  4. Overlap between two leaves (تداخل إجازتين لنفس الموظف)
//  5. Negative balance with deficit path (رصيد سالب مع مسار العجز)
//  6. Three-tier sick leave deletion & exact restoration
//     (حذف إجازة مرضية موزّعة على الشرائح الثلاث واسترجاع الرصيد بدقة)
//
//  Zero external testing frameworks. Runs in under a second on in-memory SQLite.
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
const LeaveService = require('../src/main/services/LeaveService');

console.log('🧪 [LeaveService Unit Tests] Starting test suite...\n');

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

// ── Setup in-memory SQLite with migrations 001 - 016 ──────────
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
  return db;
}

const db = createTestDb();

// Setup test employee
// HireDate 1000 days ago so employee has plenty of regular leave days (100 days)
const hireDate = new Date(Date.now() - 1000 * 24 * 3600 * 1000).toISOString().split('T')[0];
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive)
  VALUES (1, 'أحمد محمود', 'Male', ?, 'مهندس أقدم', 1)
`).run(hireDate);

// ── 1. إجازة يوم واحد (1-day leave) ───────────────────────────
console.log('Test 1: Single-day leave calculation and registration');
const res1 = LeaveService.processRegularLeave(1, 1, '2026-05-10', '2026-05-10', db, 'إجازة اعتيادية');
assert(res1 && res1.leaveId > 0, 'Leave registered with valid LeaveID');
assert(res1.requestedDays === 1, 'Requested days equals 1');
assert(res1.finalBalance === 100, 'Initial balance before deduction was 100');
assert(res1.remainingBalance === 99, 'Remaining balance after 1-day deduction is 99');

// ── 2. تاريخ نهاية قبل تاريخ البداية (EndDate < StartDate) ────
console.log('\nTest 2: EndDate earlier than StartDate throws error');
assertThrows(() => {
  LeaveService.processRegularLeave(1, 1, '2026-05-15', '2026-05-14', db, 'إجازة اعتيادية');
}, 'لا يتطابق', 'Throws error when EndDate < StartDate');

// ── 3. سنة كبيسة تتضمن 29 شباط (Leap year including Feb 29) ───
console.log('\nTest 3: Leap year leap-day calculation (2024-02-28 to 2024-03-01 = 3 days)');
const res3 = LeaveService.processRegularLeave(1, 3, '2024-02-28', '2024-03-01', db, 'إجازة اعتيادية');
assert(res3 && res3.leaveId > 0, 'Leap year leave registered across Feb 29');
assert(res3.requestedDays === 3, 'DaysCount correctly spans 3 full calendar days across leap day');

// ── 4. تداخل إجازتين لنفس الموظف (Leave overlap) ──────────────
console.log('\nTest 4: Overlapping leave dates are strictly rejected');
assertThrows(() => {
  // Overlaps with Test 1 ('2026-05-10' to '2026-05-10')
  LeaveService.processRegularLeave(1, 5, '2026-05-08', '2026-05-12', db, 'إجازة اعتيادية');
}, 'تداخل', 'Throws overlap prevention error when dates intersect');

// ── 5. رصيد سالب مع مسار العجز (Negative balance / deficit path) ─
console.log('\nTest 5: Quota deficit / negative balance handling');
// Employee has 30 (100%), 45 (50%), 45 (25%) = 120 days total sick leave
// Request 130 days -> 10 days deficit beyond 120 ceiling
const res5 = LeaveService.processSickLeave(1, 130, '2026-07-01', '2026-11-07', db, 'المدير العام');
assert(res5.quotaExceeded === true, 'quotaExceeded flag is true when exceeding total 120-day quota');
assert(res5.daysAt100 === 30, 'Tier 1 consumed full 30 days @ 100%');
assert(res5.daysAt50 === 45, 'Tier 2 consumed full 45 days @ 50%');
assert(res5.daysAt25 === 55, 'Tier 3 absorbed remaining 55 days (45 available + 10 deficit)');
assert(res5.newBalance25 === -10, '25% bucket recorded negative balance (-10) for deficit');

// Also test regular leave rejection on insufficient balance
assertThrows(() => {
  LeaveService.processRegularLeave(1, 200, '2027-01-01', '2027-07-19', db, 'إجازة اعتيادية');
}, 'غير كافٍ', 'Regular leave strictly rejects requests exceeding available balance');

// ── 6. حذف إجازة مرضية موزّعة على الشرائح الثلاث واسترجاع الرصيد بدقة ─
console.log('\nTest 6: Deleting 3-tier distributed sick leave and exact balance restoration');
// Setup new employee 2 to test clean deletion
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive)
  VALUES (2, 'زينب حسن', 'Female', '2020-01-01', 'باحث أقدم', 1)
`).run();

// Employee 2 registers 90 days sick leave: 30 @ 100%, 45 @ 50%, 15 @ 25% (remaining 25% = 30)
const sickLeave = LeaveService.processSickLeave(2, 90, '2026-01-01', '2026-03-31', db, 'المدير');
assert(sickLeave.daysAt100 === 30, 'Consumed 30 @ 100%');
assert(sickLeave.daysAt50 === 45, 'Consumed 45 @ 50%');
assert(sickLeave.daysAt25 === 15, 'Consumed 15 @ 25%');
assert(sickLeave.newBalance100 === 0, '100% bucket is 0');
assert(sickLeave.newBalance50 === 0, '50% bucket is 0');
assert(sickLeave.newBalance25 === 30, '25% bucket remaining is 30');

// Delete the leave
const delRes = LeaveService.deleteLeave(sickLeave.leaveId, db);
assert(delRes.success === true, 'Delete operation succeeded');

// Verify all 3 buckets are restored to initial capacities (30, 45, 45)
const restoredBalances = db.prepare(`
  SELECT PayPercentage, TotalBalance FROM LeaveBalances WHERE EmployeeID = 2 ORDER BY PayPercentage DESC
`).all();

const bMap = {};
for (const r of restoredBalances) {
  bMap[r.PayPercentage] = r.TotalBalance;
}
assert(bMap[100] === 30, '100% tier restored to 30 days');
assert(bMap[50] === 45, '50% tier restored to 45 days');
assert(bMap[25] === 45, '25% tier restored to 45 days');

console.log(`\n🎉 ALL ${passedTests}/${totalTests} LEAVE SERVICE TESTS PASSED!`);
