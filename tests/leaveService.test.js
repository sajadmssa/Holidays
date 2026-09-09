// ============================================================
//  tests/leaveService.test.js
//  Regression & Unit Tests for LeaveService:
//  1. Single-day leave calculation and registration (إجازة يوم واحد)
//  2. EndDate < StartDate error (تاريخ نهاية قبل تاريخ البداية)
//  3. Leap year with Feb 29 (سنة كبيسة تتضمن 29 شباط)
//  4. Overlap between two leaves (تداخل إجازتين لنفس الموظف)
//  5. Regular leave deficit rejection (رفض الإجازة الاعتيادية عند نقص الرصيد)
//  6. Sick leave quota deficit & negative balance handling (مسار العجز والرصيد السالب)
//  7. Sick leave 3-tier cascade consumption (توزيع الإجازة المرضية على الشرائح الثلاث)
//  8. Sick leave deletion & exact 3-tier restoration (حذف الإجازة المرضية واسترجاع الأرصدة بدقة)
//  9. Date calculation across month & year boundaries (عبور شهر/سنة في حساب الأيام)
//  10. Bidirectional leave type conversion via updateLeave (تعديل نوع الإجازة: مرضية ↔ اعتيادية)
//  11. New employee auto-provisioning on first sick leave request (موظف جديد بدون رصيد مسبق)
//  12. Transferred employee active leaves behavior (فحص استعلام الإجازات النشطة والموظف المنقول)
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
const ReportService = require('../src/main/services/ReportService');

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

// ── 5. رفض الإجازة الاعتيادية عند عدم كفاية الرصيد ────────────
console.log('\nTest 5: Regular leave deficit rejection on insufficient balance');
assertThrows(() => {
  LeaveService.processRegularLeave(1, 200, '2027-01-01', '2027-07-19', db, 'إجازة اعتيادية');
}, 'غير كافٍ', 'Regular leave strictly rejects requests exceeding available balance');

// ── 6. رصيد سالب مع مسار العجز للإجازة المرضية ─────────────────
console.log('\nTest 6: Sick leave quota deficit & negative balance handling');
// Employee has 30 (100%), 45 (50%), 45 (25%) = 120 days total sick leave
// Request 130 days -> 10 days deficit beyond 120 ceiling
const res6 = LeaveService.processSickLeave(1, 130, '2026-07-01', '2026-11-07', db, 'المدير العام');
assert(res6.quotaExceeded === true, 'quotaExceeded flag is true when exceeding total 120-day quota');
assert(res6.daysAt100 === 30, 'Tier 1 consumed full 30 days @ 100%');
assert(res6.daysAt50 === 45, 'Tier 2 consumed full 45 days @ 50%');
assert(res6.daysAt25 === 55, 'Tier 3 absorbed remaining 55 days (45 available + 10 deficit)');
assert(res6.newBalance25 === -10, '25% bucket recorded negative balance (-10) for deficit');

// ── 7. توزيع الإجازة المرضية هرمياً على الشرائح الثلاث ──────────
console.log('\nTest 7: Sick leave 3-tier cascade consumption (100% -> 50% -> 25%)');
// Setup Employee 2 for clean sick leave cascade test
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive)
  VALUES (2, 'زينب حسن', 'Female', '2020-01-01', 'باحث أقدم', 1)
`).run();

// Employee 2 registers 90 days sick leave: 30 @ 100%, 45 @ 50%, 15 @ 25% (remaining 25% = 30)
const sickLeave = LeaveService.processSickLeave(2, 90, '2026-01-01', '2026-03-31', db, 'المدير');
assert(sickLeave.daysAt100 === 30, 'Consumed 30 @ 100%');
assert(sickLeave.daysAt50 === 45, 'Consumed 45 @ 50%');
assert(sickLeave.daysAt25 === 15, 'Consumed 15 @ 25%');

// ── 8. حذف إجازة مرضية موزّعة على الشرائح الثلاث واسترجاع الرصيد بدقة ─
console.log('\nTest 8: Deleting 3-tier distributed sick leave and exact balance restoration');
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

// ── 9. عبور شهر/سنة في حساب الأيام (Month & Year boundary crossing) ──
console.log('\nTest 9: Calendar days calculation across month and year boundaries (_daysBetween)');
// A: Month boundary crossing: 2026-01-30 to 2026-02-02 (Jan 30, Jan 31, Feb 1, Feb 2 = 4 calendar days)
const res9_month = LeaveService.processRegularLeave(1, 4, '2026-01-30', '2026-02-02', db, 'إجازة اعتيادية');
assert(res9_month && res9_month.leaveId > 0, 'Leave registered successfully across month boundary (Jan 30 to Feb 02)');
assert(res9_month.requestedDays === 4, 'Month-crossing calculation correctly spans exactly 4 calendar days (+1 inclusive)');
assertThrows(() => {
  LeaveService.processRegularLeave(1, 3, '2026-01-30', '2026-02-02', db, 'إجازة اعتيادية');
}, 'لا يتطابق', 'Strictly rejects off-by-one requestedDays (3 instead of 4) across month boundary');

// B: Year boundary crossing: 2025-12-30 to 2026-01-02 (Dec 30, Dec 31, Jan 1, Jan 2 = 4 calendar days)
const res9_year = LeaveService.processRegularLeave(1, 4, '2025-12-30', '2026-01-02', db, 'إجازة اعتيادية');
assert(res9_year && res9_year.leaveId > 0, 'Leave registered successfully across year boundary (Dec 30 to Jan 02)');
assert(res9_year.requestedDays === 4, 'Year-crossing calculation correctly spans exactly 4 calendar days (+1 inclusive)');
assertThrows(() => {
  LeaveService.processRegularLeave(1, 5, '2025-12-30', '2026-01-02', db, 'إجازة اعتيادية');
}, 'لا يتطابق', 'Strictly rejects off-by-one requestedDays (5 instead of 4) across year boundary');

// ── 10. تعديل نوع الإجازة: مرضية ↔ اعتيادية (Leave type conversion) ──
console.log('\nTest 10: Bidirectional leave type conversion via updateLeave (Sick <-> Regular)');
// Setup Employee 3 with 100 days earned regular balance
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive)
  VALUES (3, 'سارة خالد', 'Female', ?, 'محاسب', 1)
`).run(hireDate);

// Step 1: Register 10 days sick leave (deducted from 100% tier)
const sick10 = LeaveService.processSickLeave(3, 10, '2025-04-01', '2025-04-10', db, 'المدير العام');
assert(sick10.daysAt100 === 10, 'Initial sick leave consumed 10 days @ 100%');
assert(sick10.newBalance100 === 20, '100% bucket decreased to 20 days');

// Step 2: Convert from Sick to Regular leave via updateLeave
const updateToRegular = LeaveService.updateLeave(sick10.leaveId, {
  leaveType: 'إجازة اعتيادية',
  startDate: '2025-04-01',
  endDate: '2025-04-10',
  requestedDays: 10,
  modifierName: 'أدمن النظام',
}, db);
assert(updateToRegular.success === true, 'Converted sick leave to regular leave successfully');

// Verify sick balance was fully restored to 30/45/45
const restoredSickBalances = db.prepare(`
  SELECT PayPercentage, TotalBalance FROM LeaveBalances WHERE EmployeeID = 3 ORDER BY PayPercentage DESC
`).all();
const restoredSickMap = {};
for (const r of restoredSickBalances) restoredSickMap[r.PayPercentage] = r.TotalBalance;
assert(restoredSickMap[100] === 30, 'Sick 100% tier fully restored to 30 days upon conversion to regular');
assert(restoredSickMap[50] === 45, 'Sick 50% tier remains intact at 45 days');
assert(restoredSickMap[25] === 45, 'Sick 25% tier remains intact at 45 days');

// Verify regular balance has deducted 10 days (100 earned - 10 consumed = 90 available)
const regBalanceAfterConversion = LeaveService.calculateRegularLeaveBalance(3, db);
assert(regBalanceAfterConversion.availableBalance === 90, 'Regular leave available balance correctly deducted 10 days (from 100 to 90)');

// Step 3: Convert BACK from Regular to Sick leave via updateLeave
const updateBackToSick = LeaveService.updateLeave(sick10.leaveId, {
  leaveType: 'إجازة مرضية',
  startDate: '2025-04-01',
  endDate: '2025-04-10',
  requestedDays: 10,
  modifierName: 'أدمن النظام',
}, db);
assert(updateBackToSick.success === true, 'Converted regular leave back to sick leave successfully');

// Verify regular balance restored back to 100
const regBalanceRestored = LeaveService.calculateRegularLeaveBalance(3, db);
assert(regBalanceRestored.availableBalance === 100, 'Regular leave balance restored back to 100 days');

// Verify sick balance 100% tier is re-deducted to 20
const reDeductedSick = db.prepare(`
  SELECT TotalBalance FROM LeaveBalances WHERE EmployeeID = 3 AND PayPercentage = 100
`).get();
assert(reDeductedSick.TotalBalance === 20, 'Sick 100% tier re-deducted back to 20 days upon returning to sick type');

// ── 11. موظف جديد بدون رصيد مسبق يطلب أول إجازة مرضية (processSickLeave auto-init) ──
console.log('\nTest 11: New employee auto-provisioning on first sick leave request (processSickLeave)');
// Setup Employee 4 with NO prior LeaveBalances records
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive)
  VALUES (4, 'عمر طارق', 'Male', '2023-01-01', 'كاتب', 1)
`).run();

const initialRowsCount = db.prepare('SELECT COUNT(*) AS cnt FROM LeaveBalances WHERE EmployeeID = 4').get().cnt;
assert(initialRowsCount === 0, 'New employee initially has zero LeaveBalances rows');

// Request 5 days sick leave directly
const newEmpSick = LeaveService.processSickLeave(4, 5, '2026-02-10', '2026-02-14', db, 'المدير');
assert(newEmpSick && newEmpSick.leaveId > 0, 'First sick leave processed successfully for new employee');
assert(newEmpSick.daysAt100 === 5, 'Deducted 5 days from auto-provisioned 100% tier');
assert(newEmpSick.daysAt50 === 0, 'Zero days deducted from 50% tier');
assert(newEmpSick.daysAt25 === 0, 'Zero days deducted from 25% tier');

// Verify default 3 tiers (30, 45, 45) were created and 100% tier now has 25
const emp4Balances = db.prepare(`
  SELECT PayPercentage, TotalBalance FROM LeaveBalances WHERE EmployeeID = 4 ORDER BY PayPercentage DESC
`).all();
const emp4Map = {};
for (const r of emp4Balances) emp4Map[r.PayPercentage] = r.TotalBalance;
assert(emp4Balances.length === 3, 'Exactly 3 tiers (100, 50, 25) auto-provisioned');
assert(emp4Map[100] === 25, '100% tier balance is 25 (30 - 5)');
assert(emp4Map[50] === 45, '50% tier balance is 45 (full capacity)');
assert(emp4Map[25] === 45, '25% tier balance is 45 (full capacity)');

// ── 12. استعلام الإجازات السارية وفحص حالة الموظف المنقول (getActiveLeavesForToday) ──
console.log('\nTest 12: Active leaves query and transferred employee exclusion audit (getActiveLeavesForToday)');
const todayDate = new Date().toISOString().split('T')[0];

db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive, IsTransferred)
  VALUES (5, 'محمد فاضل (نشط)', 'Male', '2021-01-01', 'مبرمج', 1, 0),
         (6, 'علي كاظم (منقول)', 'Male', '2021-01-01', 'مدقق', 1, 1)
`).run();

// Register active leave for today for both employees
db.prepare(`
  INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount)
  VALUES (5, 1, ?, ?, 1),
         (6, 1, ?, ?, 1)
`).run(todayDate, todayDate, todayDate, todayDate);

const activeLeaves = LeaveService.getActiveLeavesForToday(db);
assert(activeLeaves.some(l => l.EmployeeID === 5), 'Active non-transferred employee (5) is returned by getActiveLeavesForToday');

// Verify that transferred employee (IsTransferred=1) is strictly excluded
assert(
  !activeLeaves.some(l => l.EmployeeID === 6),
  'Transferred employee (IsTransferred=1) is strictly excluded from getActiveLeavesForToday'
);

// ── 13. استعلام الإجازات السارية المقسّمة (getActiveLeavesTodayPaginated) ──
console.log('\nTest 13: Paginated active leaves query excludes transferred employee (getActiveLeavesTodayPaginated)');
const pagedLeaves = LeaveService.getActiveLeavesTodayPaginated({ page: 1, pageSize: 15 }, db);
assert(pagedLeaves.data.some(l => l.EmployeeID === 5), 'Active non-transferred employee (5) is present in paginated active leaves');
assert(!pagedLeaves.data.some(l => l.EmployeeID === 6), 'Transferred employee (6) is strictly excluded from paginated active leaves');
assert(pagedLeaves.totalCount === pagedLeaves.data.length, 'Paginated active leaves totalCount matches data length (transferred excluded)');

// ── 14. رصد الإجازات التي أوشكت على الانتهاء (getApproachingResumptions) ──
console.log('\nTest 14: Approaching resumptions alerts exclude transferred employee (getApproachingResumptions)');
const approaching = LeaveService.getApproachingResumptions(db, 3);
assert(approaching.some(l => l.EmployeeID === 5), 'Active non-transferred employee (5) is present in approaching resumptions');
assert(!approaching.some(l => l.EmployeeID === 6), 'Transferred employee (6) is strictly excluded from approaching resumptions alerts');

// ── 15. استعلام الأرصدة الحرجة واستثناء المنقولين (ReportService critical balances) ──
console.log('\nTest 15: Critical balances query strictly excludes transferred employees (CRITICAL_BALANCE_CTE)');
// Setup:
// Employee 7: Active non-transferred (IsActive=1, IsTransferred=0)
// HireDate: 80 days ago -> 8 days gross balance, takes 6 days leave -> remaining balance = 2 (<= 5, critical)
// Employee 8: Active transferred (IsActive=1, IsTransferred=1)
// HireDate: 80 days ago -> 8 days gross balance, takes 6 days leave -> remaining balance = 2 (<= 5, critical)
const hireDateCritical = new Date(Date.now() - 80 * 24 * 3600 * 1000).toISOString().split('T')[0];

db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive, IsTransferred)
  VALUES (7, 'حسين نشط (رصيد حرج)', 'Male', ?, 'مهندس', 1, 0),
         (8, 'موسى منقول (رصيد حرج)', 'Male', ?, 'مهندس', 1, 1)
`).run(hireDateCritical, hireDateCritical);

// Register 6 days leave for each to make balance critical (2 days remaining)
db.prepare(`
  INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount)
  VALUES (7, 1, '2026-06-01', '2026-06-06', 6),
         (8, 1, '2026-06-01', '2026-06-06', 6)
`).run();

// A: Test getCriticalAndAccumulatedLeaves
const repStats = ReportService.getCriticalAndAccumulatedLeaves(db, { threshold: 5 });
assert(repStats.criticalEmployees.some(e => e.EmployeeID === 7), 'Critical active non-transferred employee (7) is present in critical list');
assert(!repStats.criticalEmployees.some(e => e.EmployeeID === 8), 'Critical transferred employee (8) is strictly excluded from critical list');

// B: Test getCriticalBalancesPaginated
const critPaged = ReportService.getCriticalBalancesPaginated(db, { threshold: 5, page: 1, pageSize: 15 });
assert(critPaged.data.some(e => e.EmployeeID === 7), 'Critical active non-transferred employee (7) is present in paginated critical data');
assert(!critPaged.data.some(e => e.EmployeeID === 8), 'Critical transferred employee (8) is strictly excluded from paginated critical data');

// ── 16. استعلام التراكم السنوي للإجازات واستثناء المنقولين (ReportService accumulated leaves) ──
console.log('\nTest 16: Accumulated leaves query strictly excludes transferred employees (rawAccumulatedLeaves)');
// A: In getCriticalAndAccumulatedLeaves
assert(repStats.accumulatedLeaves.some(e => e.EmployeeID === 7), 'Active non-transferred employee (7) is present in accumulated leaves list');
assert(!repStats.accumulatedLeaves.some(e => e.EmployeeID === 8), 'Transferred employee (8) is strictly excluded from accumulated leaves list');

// B: In getAccumulatedLeavesPaginated
const accumPaged = ReportService.getAccumulatedLeavesPaginated(db, { page: 1, pageSize: 15 });
assert(accumPaged.data.some(e => e.EmployeeID === 7), 'Active non-transferred employee (7) is present in paginated accumulated data');
assert(!accumPaged.data.some(e => e.EmployeeID === 8), 'Transferred employee (8) is strictly excluded from paginated accumulated data');

// ── 17. استعلام ملخص الإجماليات السنوية واستثناء المنقولين (ReportService overallTotals) ──
console.log('\nTest 17: Overall totals query in accumulated leaves strictly excludes transferred employees (overallTotals)');
const currentYear = new Date().getFullYear();
const currentYearStr = String(currentYear);

// Get total days and leaves count strictly for non-transferred active employees
const expectedNonTransferred = db.prepare(`
  SELECT
    COALESCE(SUM(l.DaysCount), 0) AS totalDays,
    COUNT(l.LeaveID) AS totalLeaves
  FROM Leaves l
  JOIN Employees e ON e.EmployeeID = l.EmployeeID
  WHERE e.IsActive = 1 AND e.IsTransferred = 0 AND strftime('%Y', l.StartDate) = ?
`).get(currentYearStr);

// Get total days and leaves including transferred employees
const withTransferred = db.prepare(`
  SELECT
    COALESCE(SUM(l.DaysCount), 0) AS totalDays,
    COUNT(l.LeaveID) AS totalLeaves
  FROM Leaves l
  JOIN Employees e ON e.EmployeeID = l.EmployeeID
  WHERE e.IsActive = 1 AND strftime('%Y', l.StartDate) = ?
`).get(currentYearStr);

// Transferred employees (Employee 6 and Employee 8) have registered leaves in current year
assert(withTransferred.totalDays > expectedNonTransferred.totalDays, 'Transferred employees contribute days when not filtered');
assert(withTransferred.totalLeaves > expectedNonTransferred.totalLeaves, 'Transferred employees contribute leaves count when not filtered');

// Call ReportService.getAccumulatedLeavesPaginated to get overallTotals summary
const pagedWithSummary = ReportService.getAccumulatedLeavesPaginated(db, { year: currentYear, page: 1, pageSize: 15 });
assert(
  pagedWithSummary.summary.totalDaysThisYear === expectedNonTransferred.totalDays,
  'Summary grandTotalDays (totalDaysThisYear) strictly matches non-transferred employees sum'
);
assert(
  pagedWithSummary.summary.totalLeavesThisYear === expectedNonTransferred.totalLeaves,
  'Summary totalLeavesThisYear strictly matches non-transferred employees leaves count'
);
assert(
  pagedWithSummary.summary.totalDaysThisYear < withTransferred.totalDays,
  'Summary totalDaysThisYear strictly excludes transferred employees leave days (e.g. Employee 8)'
);
assert(
  pagedWithSummary.summary.totalLeavesThisYear < withTransferred.totalLeaves,
  'Summary totalLeavesThisYear strictly excludes transferred employees leave records'
);

console.log(`\n🎉 ALL ${passedTests}/${totalTests} TESTS PASSED ACROSS 17 TEST SUITES!`);

