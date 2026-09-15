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
const EmployeeService = require('../src/main/services/EmployeeService');
const DepartmentService = require('../src/main/services/DepartmentService');
const ExcelJS = require('exceljs');

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
const todayDate = db.prepare("SELECT date('now', 'localtime') AS today").get().today;

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

// ── 18. إنشاء إجازة اعتيادية برصيد سالب عند التأكيد الصريح (BUS-001) ──
console.log('\nTest 18: Regular leave creation with negative balance upon explicit confirmation (BUS-001)');
// Setup Employee 9 with 10 days of earned regular balance
const emp9HireDate = new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString().split('T')[0];
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive)
  VALUES (9, 'مصطفى كريم', 'Male', ?, 'ملاحظ', 1)
`).run(emp9HireDate);

// Case A: Request 20 days without confirmation -> must throw error with 'غير كافٍ'
assertThrows(() => {
  LeaveService.processRegularLeave(9, 20, '2026-08-01', '2026-08-20', db, 'إجازة اعتيادية', { confirmExcess: false });
}, 'غير كافٍ', 'Creation without confirmExcess strictly rejected');

// Case B: Request 20 days with confirmExcess: true -> succeeds and records negative balance
const res18 = LeaveService.processRegularLeave(9, 20, '2026-08-01', '2026-08-20', db, 'إجازة اعتيادية', { confirmExcess: true });
assert(res18 && res18.leaveId > 0, 'Regular leave created with negative balance upon explicit confirmation');
assert(res18.quotaExceeded === true, 'quotaExceeded flag is true');
assert(res18.deficit === 10, 'Deficit is 10 days');
assert(res18.remainingBalance === -10, 'Remaining balance is -10 days');

// Verify balance computation recognizes negative balance
const emp9Balance = LeaveService.calculateRegularLeaveBalance(9, db);
assert(emp9Balance.availableBalance === -10, 'calculateRegularLeaveBalance reflects negative available balance (-10)');

// Verify AuditLog record contains approval details
const auditLog9 = db.prepare(`SELECT * FROM AuditLogs WHERE EntityType = 'Leave' AND EntityID = ? ORDER BY LogID DESC LIMIT 1`).get(res18.leaveId);
assert(auditLog9 && auditLog9.Details.includes('الموافقة والتأكيد الصريح'), 'AuditLog explicitly documents confirmation of excess');
// ── 19. معالجة فشل التعبير النمطي لشرائح الإجازة المرضية وسقوط الاسترجاع الاحتياطي (MNT-001) ──
console.log('\nTest 19: Sick leave tier restoration fallback & warning audit logging on regex mismatch (MNT-001)');
// Setup Employee 10
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive)
  VALUES (10, 'هدى عادل', 'Female', '2024-01-01', 'مهندس', 1)
`).run();

// Case A: Deleting sick leave with corrupted Notes
// 1. Process 15 days sick leave (consumed from 100% tier)
const sickEmp10 = LeaveService.processSickLeave(10, 15, '2026-09-01', '2026-09-15', db, 'المدير العام');
const balEmp10Before = db.prepare('SELECT TotalBalance FROM LeaveBalances WHERE EmployeeID = 10 AND PayPercentage = 100').get();
assert(balEmp10Before.TotalBalance === 15, 'Employee 10 sick 100% balance decreased to 15 days');

// 2. Corrupt Notes in database to simulate legacy or manually malformed data
db.prepare("UPDATE Leaves SET Notes = 'سجل يدوي قديم غير منسق بدون تعبير الشرائح' WHERE LeaveID = ?").run(sickEmp10.leaveId);

// 3. Delete the leave -> fallback should restore to 100% and log warning audit
const delFallbackRes = LeaveService.deleteLeave(sickEmp10.leaveId, db);
assert(delFallbackRes.success === true, 'Delete operation succeeds even with malformed notes');

// Verify balance was restored to 100% tier (15 + 15 = 30)
const balEmp10AfterDel = db.prepare('SELECT TotalBalance FROM LeaveBalances WHERE EmployeeID = 10 AND PayPercentage = 100').get();
assert(balEmp10AfterDel.TotalBalance === 30, 'Fallback correctly restored 15 days to 100% tier');

// Verify WARNING audit log was created for the fallback event
const warningLogDel = db.prepare(`
  SELECT * FROM AuditLogs
  WHERE EntityType = 'Leave' AND EntityID = ? AND ActionType = 'WARNING'
  ORDER BY LogID DESC LIMIT 1
`).get(sickEmp10.leaveId);
assert(warningLogDel !== undefined, 'AuditLog contains WARNING record for deletion fallback');
assert(warningLogDel.Details.includes('تنبيه تدقيق: فشل الاستخراج الآلي'), 'AuditLog warning details describe regex extraction failure');
assert(warningLogDel.Details.includes('Fallback'), 'AuditLog warning details explicitly mention Fallback restoration');

// Case B: Updating sick leave with corrupted Notes (e.g. converting to regular leave)
// 1. Process 10 days sick leave
const sickEmp10_2 = LeaveService.processSickLeave(10, 10, '2026-10-01', '2026-10-10', db, 'المدير العام');
const balEmp10BeforeUpd = db.prepare('SELECT TotalBalance FROM LeaveBalances WHERE EmployeeID = 10 AND PayPercentage = 100').get();
assert(balEmp10BeforeUpd.TotalBalance === 20, 'Employee 10 sick 100% balance is 20 days (30 - 10)');

// 2. Corrupt Notes
db.prepare("UPDATE Leaves SET Notes = 'ملاحظات تالفة' WHERE LeaveID = ?").run(sickEmp10_2.leaveId);

// 3. Update leave to regular -> fallback should restore sick balance and log warning audit
const updFallbackRes = LeaveService.updateLeave(sickEmp10_2.leaveId, {
  leaveType: 'إجازة اعتيادية',
  startDate: '2026-10-01',
  endDate: '2026-10-10',
  requestedDays: 10,
  modifierName: 'مسؤول التدقيق',
}, db);
assert(updFallbackRes.success === true, 'Update operation succeeds with fallback restoration');

const balEmp10AfterUpd = db.prepare('SELECT TotalBalance FROM LeaveBalances WHERE EmployeeID = 10 AND PayPercentage = 100').get();
assert(balEmp10AfterUpd.TotalBalance === 30, 'Fallback in updateLeave restored 10 days to sick 100% tier (20 + 10 = 30)');

const warningLogUpd = db.prepare(`
  SELECT * FROM AuditLogs
  WHERE EntityType = 'Leave' AND EntityID = ? AND ActionType = 'WARNING'
  ORDER BY LogID DESC LIMIT 1
`).get(sickEmp10_2.leaveId);
assert(warningLogUpd !== undefined, 'AuditLog contains WARNING record for updateLeave fallback');
assert(warningLogUpd.Details.includes('Fallback'), 'AuditLog warning for updateLeave explicitly documents Fallback');

// Case C: Direct verification of _restoreSickLeaveBalance return contract
const directMatch = LeaveService._restoreSickLeaveBalance(
  db, 10, 2, 'Sick Leave processed: 10d @ 100% pay, 5d @ 50% pay, 0d @ 25% pay', 15, 999
);
assert(directMatch.matched === true && directMatch.fallback === false, '_restoreSickLeaveBalance returns matched=true on valid notes');
assert(directMatch.tiers.d100 === 10 && directMatch.tiers.d50 === 5, '_restoreSickLeaveBalance extracts tiers accurately');

const directFallback = LeaveService._restoreSickLeaveBalance(
  db, 10, 2, 'malformed string', 7, 1000
);
assert(directFallback.matched === false && directFallback.fallback === true, '_restoreSickLeaveBalance returns fallback=true on invalid notes');

// ── 20. التحقق الصارم من التواريخ التقويمية ومنع الترحيل التلقائي (MNT-005) ──
console.log('\nTest 20: Calendar date validation and auto-rollover prevention (MNT-005)');
const { isValidIsoDate } = require('../src/main/utils/dateValidator');
const { registerLeaveHandlers } = require('../src/main/ipc/leaveHandlers');

// فحص دالة التحقق المشتركة مباشرة:
// 1. التواريخ الكبيسة الصحيحة
assert(isValidIsoDate('2024-02-29') === true, 'Leap year Feb 29 (2024-02-29) is valid');
assert(isValidIsoDate('2000-02-29') === true, 'Leap century Feb 29 (2000-02-29) is valid');

// 2. التواريخ الوهمية في فبراير
assert(isValidIsoDate('2024-02-30') === false, 'Feb 30 in leap year (2024-02-30) is rejected');
assert(isValidIsoDate('2023-02-29') === false, 'Feb 29 in non-leap year (2023-02-29) is rejected');
assert(isValidIsoDate('1900-02-29') === false, 'Feb 29 in non-leap century (1900-02-29) is rejected');

// 3. التواريخ الوهمية في الأشهر ذات الـ 30 يوماً
assert(isValidIsoDate('2024-04-31') === false, 'April 31 (2024-04-31) is rejected');
assert(isValidIsoDate('2024-06-31') === false, 'June 31 (2024-06-31) is rejected');
assert(isValidIsoDate('2024-09-31') === false, 'September 31 (2024-09-31) is rejected');
assert(isValidIsoDate('2024-11-31') === false, 'November 31 (2024-11-31) is rejected');

// 4. التواريخ الصحيحة في نهايات الأشهر
assert(isValidIsoDate('2024-01-31') === true, 'January 31 is valid');
assert(isValidIsoDate('2024-04-30') === true, 'April 30 is valid');
assert(isValidIsoDate('2024-12-31') === true, 'December 31 is valid');

// 5. المدخلات غير الصالحة شكلياً
assert(isValidIsoDate(null) === false, 'null is rejected');
assert(isValidIsoDate('') === false, 'empty string is rejected');
assert(isValidIsoDate('2024-2-2') === false, 'unpadded date string is rejected');
assert(isValidIsoDate('2024/02/29') === false, 'slash-separated date is rejected');

// 6. التحقق من تكامل معالجات IPC مع الرفض الصارم للتواريخ الوهمية
const mockIpc = {
  handlers: {},
  handle(channel, fn) {
    this.handlers[channel] = fn;
  }
};
registerLeaveHandlers(mockIpc, db);

// أ: محاولة تقديم إجازة مرضية بتاريخ وهمي 2024-02-30
const sickFakeDateRes = mockIpc.handlers['leave:submitSickLeave']({}, {
  employeeId: 1,
  requestedDays: 1,
  startDate: '2024-02-30',
  endDate: '2024-02-30'
});
assert(sickFakeDateRes.success === false, 'Sick leave with fake date 2024-02-30 is rejected by IPC handler');
assert(sickFakeDateRes.error.includes('Expected a real calendar date'), 'Sick leave rejection error clearly states invalid calendar date');

// ب: محاولة تقديم إجازة اعتيادية بتاريخ وهمي 2024-04-31
const regFakeDateRes = mockIpc.handlers['leave:submitRegularLeave']({}, {
  employeeId: 1,
  requestedDays: 1,
  startDate: '2024-04-31',
  endDate: '2024-04-31'
});
assert(regFakeDateRes.success === false, 'Regular leave with fake date 2024-04-31 is rejected by IPC handler');
assert(regFakeDateRes.error.includes('يرجى إدخال تاريخ بداية الإجازة بصيغة صحيحة'), 'Regular leave rejection error clearly states invalid calendar date');

// ج: محاولة تحديث إجازة بتاريخ وهمي 2023-02-29
const updateFakeDateRes = mockIpc.handlers['leave:update']({}, {
  leaveId: 1,
  modifierName: 'مسؤول التعديل',
  startDate: '2023-02-29',
  endDate: '2023-02-29',
  requestedDays: 1,
  leaveType: 'إجازة اعتيادية'
});
assert(updateFakeDateRes.success === false, 'Update leave with fake date 2023-02-29 is rejected by IPC handler');
assert(updateFakeDateRes.error.includes('يرجى إدخال تاريخ بداية الإجازة بصيغة صحيحة'), 'Update leave rejection error clearly states invalid calendar date');

// ── Suite 21: Auto SequenceNumber Generation & Immutability ─
console.log('\n--- Suite 21: Auto SequenceNumber Generation & Immutability ---');
EmployeeService.addEmployee({
  employeeId: 1001,
  fullName: 'موظف تجربة تسلسل 1',
  gender: 'Male',
  hireDate: '2020-01-01',
  jobTitle: 'مهندس',
  workLocation: 'المقر',
  jobNumber: 'J-1001',
  departmentId: 1
}, db);
const empSeq1 = EmployeeService.getEmployeeById(1001, db);
assert(empSeq1.SequenceNumber != null && empSeq1.SequenceNumber >= 1, 'First employee receives valid SequenceNumber');

EmployeeService.addEmployee({
  employeeId: 1002,
  fullName: 'موظف تجربة تسلسل 2',
  gender: 'Female',
  hireDate: '2021-01-01',
  jobTitle: 'محلل نظم',
  workLocation: 'المقر',
  jobNumber: 'J-1002',
  departmentId: 2
}, db);
const empSeq2 = EmployeeService.getEmployeeById(1002, db);
assert(empSeq2.SequenceNumber === empSeq1.SequenceNumber + 1, 'Second employee receives strictly incremented SequenceNumber (MAX+1)');

// Try updating employee; SequenceNumber must NOT change
EmployeeService.updateEmployee(1001, {
  fullName: 'موظف تجربة تسلسل 1 معدل',
  jobTitle: 'مهندس أقدم',
  SequenceNumber: 9999 // Should be ignored
}, db);
const fetchedSeq1 = EmployeeService.getEmployeeById(1001, db);
assert(fetchedSeq1.SequenceNumber === empSeq1.SequenceNumber, 'SequenceNumber cannot be altered via updateEmployee');
assert(fetchedSeq1.FullName === 'موظف تجربة تسلسل 1 معدل', 'Other fields are updated successfully');

// Test Hardening: Delete latest employee and verify sequence does not roll back or reuse
const latestSeqBeforeDelete = empSeq2.SequenceNumber;
db.prepare('DELETE FROM LeaveBalances WHERE EmployeeID = 1002').run();
db.prepare("DELETE FROM AuditLogs WHERE EntityType = 'EMPLOYEE' AND EntityID = '1002'").run();
db.prepare('DELETE FROM Employees WHERE EmployeeID = 1002').run();

EmployeeService.addEmployee({
  employeeId: 1003,
  fullName: 'موظف تجربة تسلسل 3 بعد الحذف',
  gender: 'Male',
  hireDate: '2022-01-01',
  jobTitle: 'تقني',
  jobNumber: 'J-1003',
  departmentId: 1
}, db);
const empSeq3 = EmployeeService.getEmployeeById(1003, db);
assert(empSeq3.SequenceNumber === latestSeqBeforeDelete + 1, 'SequenceNumber strictly increments even after deleting the latest employee row (persisted high-water mark)');


// ── Suite 22: JobNumber, Department Association & ON DELETE RESTRICT ─
console.log('\n--- Suite 22: JobNumber, Department Association & ON DELETE RESTRICT ---');
const allDepts = DepartmentService.getAllDepartments(db);
assert(allDepts.length >= 2, 'Default departments exist in seeded database');
assert(allDepts.some(d => d.Name === 'قسم الشؤون الإدارية'), 'قسم الشؤون الإدارية exists');
assert(allDepts.some(d => d.Name === 'قسم التشغيل'), 'قسم التشغيل exists');
assert(fetchedSeq1.DepartmentName != null, 'Employee has populated DepartmentName from join');


// Attempt to delete Department 1 which is linked to empSeq1
assertThrows(() => {
  DepartmentService.deleteDepartment(1, db);
}, 'لا يمكن حذف هذا القسم لأنه مرتبط بـ', 'DepartmentService.deleteDepartment throws ON DELETE RESTRICT when employees are linked');

// Move empSeq1 to Department 2
EmployeeService.updateEmployee(1001, {
  fullName: 'موظف تجربة تسلسل 1 معدل',
  jobTitle: 'مهندس أقدم',
  departmentId: 2,
  jobNumber: 'J-1001-MOD'
}, db);
const updatedSeq1 = EmployeeService.getEmployeeById(1001, db);
assert(updatedSeq1.DepartmentID === 2, 'Employee moved to Department 2 successfully');
assert(updatedSeq1.JobNumber === 'J-1001-MOD', 'Employee JobNumber updated successfully');

// Add and delete a department with no employees (Object signature)
const newDept = DepartmentService.addDepartment({ name: 'قسم اختبار جديد مؤقت' }, db);
assert(newDept.DepartmentID != null, 'Department added successfully with object signature');
assert(newDept.DepartmentName === 'قسم اختبار جديد مؤقت', 'addDepartment returns DepartmentName alias');
const delDeptRes = DepartmentService.deleteDepartment(newDept.DepartmentID, db);
assert(delDeptRes.success === true, 'Deleting unlinked department succeeds');

// Add and update a department using plain string signatures (String signature)
const deptString = DepartmentService.addDepartment('قسم اختبار بالسلسلة النصية', db);
assert(deptString.DepartmentID != null, 'addDepartment accepts plain string');
assert(deptString.DepartmentName === 'قسم اختبار بالسلسلة النصية', 'DepartmentName is populated on plain string insert');
const updatedDept = DepartmentService.updateDepartment(deptString.DepartmentID, 'قسم اختبار بالسلسلة معدل', db);
assert(updatedDept.DepartmentName === 'قسم اختبار بالسلسلة معدل', 'updateDepartment accepts (id, name) signature');
DepartmentService.deleteDepartment(deptString.DepartmentID, db);
assert(allDepts.every(d => d.DepartmentName != null && d.DepartmentName === d.Name), 'getAllDepartments returns DepartmentName on all rows');

// ── Suite 23: New Leave Types (Companion Leave & 1-5 Years Leaves) ─
console.log('\n--- Suite 23: New Leave Types (Companion Leave & 1-5 Years Leaves) ---');
const companionType = db.prepare(`SELECT * FROM LeaveTypes WHERE Name = 'إجازة المعين'`).get();
assert(companionType != null, 'LeaveType "إجازة المعين" exists in database');

const year1Type = db.prepare(`SELECT * FROM LeaveTypes WHERE Name = 'إجازة السنة'`).get();
const year5Type = db.prepare(`SELECT * FROM LeaveTypes WHERE Name = 'إجازة خمس سنوات'`).get();
assert(year1Type != null && year1Type.MaxDaysPerInstance >= 365, '"إجازة السنة" has MaxDaysPerInstance >= 365');
assert(year5Type != null && year5Type.MaxDaysPerInstance >= 1825, '"إجازة خمس سنوات" has MaxDaysPerInstance >= 1825');

// Verify submitting companion leave up to 365 days
const compLeave = LeaveService.processRegularLeave(1001, 365, '2025-01-01', '2025-12-31', db, 'إجازة المعين');
assert(compLeave != null && compLeave.leaveId != null, 'Submitting 365-day companion leave succeeds with updated constraints');

// ── Suite 24: Leave Conflict/Overlap Detection & Excel Matching ─
console.log('\n--- Suite 24: Leave Conflict/Overlap Detection & Excel Matching ---');
const datesRow = db.prepare(`
  SELECT 
    date('now', 'localtime', '-5 days') AS start1,
    date('now', 'localtime', '+5 days') AS end1,
    date('now', 'localtime', '-2 days') AS start2,
    date('now', 'localtime', '+3 days') AS end2
`).get();

const regularType = db.prepare(`SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة اعتيادية'`).get();

// Insert two overlapping active leaves for employee 1001 covering today (simulating legacy data or concurrent record)
db.prepare(`
  INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, Notes)
  VALUES (?, ?, ?, ?, 11, 'إجازة متداخلة 1')
`).run(1001, regularType.LeaveTypeID, datesRow.start1, datesRow.end1);

db.prepare(`
  INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, Notes)
  VALUES (?, ?, ?, ?, 6, 'إجازة متداخلة 2')
`).run(1001, regularType.LeaveTypeID, datesRow.start2, datesRow.end2);

// Query active leaves for employee 1001 during overlap
const activeWithConflict = LeaveService.getActiveLeavesForToday(db);
const emp1001Leaves = activeWithConflict.filter(l => l.EmployeeID === 1001);
assert(emp1001Leaves.length === 2, 'All overlapping active leave records are returned (none hidden)');
assert(emp1001Leaves.every(l => l.HasConflict > 0), 'All overlapping records have HasConflict flag set');

// Query active leaves paginated
const activePaginated = LeaveService.getActiveLeavesTodayPaginated({ page: 1, pageSize: 20 }, db);
const paginatedEmp1001 = activePaginated.data.filter(l => l.EmployeeID === 1001);
assert(paginatedEmp1001.length === 2, 'Paginated active leaves returns all records with HasConflict flag');
assert(paginatedEmp1001[0].HasConflict > 0 && paginatedEmp1001[1].HasConflict > 0, 'Paginated leaves accurately report HasConflict');

// --- Suite 25: Migration Engine FK Safety with Pre-existing Data ---
console.log('\n--- Suite 25: Migration Engine FK Safety with Pre-existing Data ---');
const migTestDb = new Database(':memory:');
migTestDb.pragma('foreign_keys = ON');

const migrationsDir = path.join(__dirname, '..', 'src', 'main', 'migrations');
// Apply migrations 001 - 016
for (let i = 1; i <= 16; i++) {
  const file = fs.readdirSync(migrationsDir).find(f => f.startsWith(String(i).padStart(3, '0') + '_'));
  if (file) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    try {
      migTestDb.exec(sql);
    } catch (e) {
      if (!e.message.includes('duplicate column')) throw e;
    }
  }
}

// Insert an employee and leaves referencing LeaveTypes before migration 017
migTestDb.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive)
  VALUES (99, 'موظف اختبار ترحيل', 'Male', '2020-01-01', 'مهندس', 1)
`).run();

migTestDb.prepare(`
  INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount)
  VALUES (99, 1, '2026-08-01', '2026-08-10', 10)
`).run();

// Now apply migration 017 using database.js pattern
const mig017File = '017_add_departments_sequence_and_leave_types.sql';
const mig017Sql = fs.readFileSync(path.join(migrationsDir, mig017File), 'utf8');

migTestDb.pragma('foreign_keys = OFF');
migTestDb.transaction(() => {
  migTestDb.exec(mig017Sql);
  const violations = migTestDb.pragma('foreign_key_check');
  if (violations.length > 0) {
    throw new Error('FK violations found: ' + JSON.stringify(violations));
  }
})();
migTestDb.pragma('foreign_keys = ON');

assert(migTestDb.pragma('foreign_keys', { simple: true }) === 1, 'foreign_keys remains ON after migration 017');
assert(migTestDb.pragma('foreign_key_check').length === 0, 'No foreign key violations exist after table reconstruction');

const preLeaves = migTestDb.prepare('SELECT * FROM Leaves WHERE EmployeeID = 99').all();
assert(preLeaves.length === 1 && preLeaves[0].LeaveTypeID === 1, 'Existing child records in Leaves are intact');

const preEmp = migTestDb.prepare('SELECT * FROM Employees WHERE EmployeeID = 99').get();
assert(preEmp && preEmp.JobNumber === '99' && preEmp.SequenceNumber === 1, 'Employee migrated with populated JobNumber and SequenceNumber');

migTestDb.close();

// Export active leaves to Excel with matching data
(async () => {
  // ── Suite 26: Overlap Confirmation Flow & Migration 018 Verification ─
  console.log('\n--- Suite 26: Overlap Confirmation Flow & Migration 018 Verification ---');
  
  // Test 1: Service rejects overlap without confirmation
  let rejectedWithoutConfirm = false;
  try {
    LeaveService.processRegularLeave(1001, 11, datesRow.start1, datesRow.end1, db, 'إجازة اعتيادية', { confirmOverlap: false });
  } catch (err) {
    if (err.requiresOverlapConfirmation) {
      rejectedWithoutConfirm = true;
      assert(err.overlap != null, 'Error includes overlap details');
    }
  }
  assert(rejectedWithoutConfirm, 'processRegularLeave rejects overlapping leave when confirmOverlap is false');

  // Test 2: Service saves overlap with explicit confirmation
  const confirmedSave = LeaveService.processRegularLeave(1001, 11, datesRow.start1, datesRow.end1, db, 'إجازة اعتيادية', { confirmOverlap: true });
  assert(confirmedSave && confirmedSave.leaveId > 0, 'processRegularLeave succeeds when confirmOverlap is true');

  // Test 3: getActiveLeavesTodayPaginated default order is LeaveID ASC (entry sequence)
  const defaultPaginated = LeaveService.getActiveLeavesTodayPaginated({ page: 1, pageSize: 50 }, db);
  const leaveIds = defaultPaginated.data.map(l => l.LeaveID);
  const isSortedAsc = leaveIds.every((id, idx) => idx === 0 || id >= leaveIds[idx - 1]);
  assert(isSortedAsc, 'Active leaves today are sorted in ascending entry sequence (LeaveID ASC) by default');

  // Test 4: Migration 018 executes cleanly and allows exact same date records
  const mig18Db = new Database(':memory:');
  mig18Db.pragma('foreign_keys = ON');
  for (let i = 1; i <= 18; i++) {
    const file = fs.readdirSync(migrationsDir).find(f => f.startsWith(String(i).padStart(3, '0') + '_'));
    if (file) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      try { mig18Db.exec(sql); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
    }
  }
  assert(mig18Db.pragma('foreign_key_check').length === 0, 'No foreign key violations after migration 018');

  // Insert two identical date leaves in migrated DB
  mig18Db.prepare(`INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive) VALUES (77, 'موظف تجربة', 'Male', '2020-01-01', 'كاتب', 1)`).run();
  const regTypeId = mig18Db.prepare(`SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة اعتيادية'`).get().LeaveTypeID;
  const ins1 = mig18Db.prepare(`INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount) VALUES (77, ?, '2026-10-01', '2026-10-05', 5)`).run(regTypeId);
  const ins2 = mig18Db.prepare(`INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount) VALUES (77, ?, '2026-10-01', '2026-10-05', 5)`).run(regTypeId);
  assert(ins1.lastInsertRowid > 0 && ins2.lastInsertRowid > 0, 'Exact same date records are saved without UNIQUE error after migration 018');
  mig18Db.close();

  const testExcelPath = path.join(__dirname, 'test_active_leaves.xlsx');
  await ReportService.exportActiveLeavesToExcel(testExcelPath, db);
  assert(fs.existsSync(testExcelPath) && fs.statSync(testExcelPath).size > 0, 'exportActiveLeavesToExcel successfully produces Excel file with conflict badges');
  try { fs.unlinkSync(testExcelPath); } catch (_) {}

  // ── Suite 27: Active & Upcoming Leaves Scope, Status Distinction & Conflict Check ──
  console.log('\n--- Suite 27: Active & Upcoming Leaves Scope, Status Distinction & Conflict Check ---');
  
  // Setup Employee 999
  db.prepare(`
    INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive)
    VALUES (999, 'موظف تجربة النطاق الزمني', 'Male', '2020-01-01', 'مهندس نظم', 1)
  `).run();

  const regType = db.prepare(`SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة اعتيادية'`).get().LeaveTypeID;

  // 1. Finished leave: Ended yesterday (today - 10 to today - 1)
  const pastDates = db.prepare(`
    SELECT date('now', 'localtime', '-10 day') AS s, date('now', 'localtime', '-1 day') AS e
  `).get();
  const pastLeave = db.prepare(`
    INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount)
    VALUES (999, ?, ?, ?, 10)
  `).run(regType, pastDates.s, pastDates.e);
  const pastLeaveId = pastLeave.lastInsertRowid;

  // 2. Ongoing leave: Active today (today - 2 to today + 5)
  const ongoingDates = db.prepare(`
    SELECT date('now', 'localtime', '-2 day') AS s, date('now', 'localtime', '+5 day') AS e
  `).get();
  const ongoingLeave = db.prepare(`
    INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount)
    VALUES (999, ?, ?, ?, 8)
  `).run(regType, ongoingDates.s, ongoingDates.e);
  const ongoingLeaveId = ongoingLeave.lastInsertRowid;

  // 3. Upcoming leave: Starts in 7 days (today + 7 to today + 14)
  const upcomingDates1 = db.prepare(`
    SELECT date('now', 'localtime', '+7 day') AS s, date('now', 'localtime', '+14 day') AS e
  `).get();
  const upcomingLeave1 = db.prepare(`
    INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount)
    VALUES (999, ?, ?, ?, 8)
  `).run(regType, upcomingDates1.s, upcomingDates1.e);
  const upcomingLeaveId1 = upcomingLeave1.lastInsertRowid;

  // 4. Overlapping Upcoming leave: (today + 10 to today + 18)
  const upcomingDates2 = db.prepare(`
    SELECT date('now', 'localtime', '+10 day') AS s, date('now', 'localtime', '+18 day') AS e
  `).get();
  const upcomingLeave2 = db.prepare(`
    INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount)
    VALUES (999, ?, ?, ?, 9)
  `).run(regType, upcomingDates2.s, upcomingDates2.e);
  const upcomingLeaveId2 = upcomingLeave2.lastInsertRowid;

  // Query all active/upcoming leaves
  const allCurrent = LeaveService.getActiveLeavesForToday(db);

  // Assert 1: Past leave is strictly EXCLUDED
  assert(!allCurrent.some(l => l.LeaveID === pastLeaveId), 'Finished leave ended yesterday is strictly EXCLUDED');

  // Assert 2: Ongoing leave is INCLUDED with status "سارية"
  const foundOngoing = allCurrent.find(l => l.LeaveID === ongoingLeaveId);
  assert(foundOngoing != null, 'Ongoing leave active today is INCLUDED in results');
  assert(foundOngoing.LeaveStatus === 'ongoing', 'Ongoing leave has LeaveStatus = "ongoing"');
  assert(foundOngoing.LeaveStatusText === 'سارية', 'Ongoing leave has LeaveStatusText = "سارية"');
  assert(foundOngoing.DaysRemaining >= 0, 'Ongoing leave has valid DaysRemaining');

  // Assert 3: Upcoming leave is INCLUDED with status "قادمة"
  const foundUpcoming1 = allCurrent.find(l => l.LeaveID === upcomingLeaveId1);
  assert(foundUpcoming1 != null, 'Upcoming leave starting in future is INCLUDED in results');
  assert(foundUpcoming1.LeaveStatus === 'upcoming', 'Upcoming leave has LeaveStatus = "upcoming"');
  assert(foundUpcoming1.LeaveStatusText === 'قادمة', 'Upcoming leave has LeaveStatusText = "قادمة"');
  assert(foundUpcoming1.DaysUntilStart === 7, 'Upcoming leave DaysUntilStart accurately reflects 7 days');

  // Assert 4: HasConflict accurately detects overlap between two upcoming leaves
  const foundUpcoming2 = allCurrent.find(l => l.LeaveID === upcomingLeaveId2);
  assert(foundUpcoming1.HasConflict === 1, 'Upcoming leave 1 reports HasConflict = 1 due to overlapping upcoming leave 2');
  assert(foundUpcoming2.HasConflict === 1, 'Upcoming leave 2 reports HasConflict = 1 due to overlapping upcoming leave 1');

  // Assert 5: Paginated query returns both ongoing and upcoming leaves
  const pagedCurrent = LeaveService.getActiveLeavesTodayPaginated({ search: 'موظف تجربة النطاق الزمني' }, db);
  assert(pagedCurrent.totalCount === 3, 'Paginated query totalCount matches exactly 3 (1 ongoing + 2 upcoming, 0 past)');
  assert(!pagedCurrent.data.some(l => l.LeaveID === pastLeaveId), 'Paginated query excludes past leave');

  // Assert 6: Excel export with new status column generates successfully
  const testExcelPath2 = path.join(__dirname, 'test_active_and_upcoming_leaves.xlsx');
  await ReportService.exportActiveLeavesToExcel(testExcelPath2, db);
  assert(fs.existsSync(testExcelPath2) && fs.statSync(testExcelPath2).size > 0, 'Excel export generates successfully with Leave Status column');
  try { fs.unlinkSync(testExcelPath2); } catch (_) {}

  // ── Suite 28: Expired Leaves Scope, Period Filters, Historical Conflict & Excel Export ─
  console.log('\n--- Suite 28: Expired Leaves Scope, Period Filters, Historical Conflict & Excel Export ---');

  // Insert a dedicated test employee for expired leaves
  EmployeeService.addEmployee({
    employeeId: 8888,
    fullName: 'موظف تجربة الإجازات المنتهية',
    gender: 'Male',
    hireDate: '2018-01-01',
    jobTitle: 'مشرف فني',
    workLocation: 'موقع الإنتاج',
    jobNumber: 'J-8888',
    departmentId: 1
  }, db);

  // 1. Leave finished 20 days ago (within current year & within last 3 months)
  const d20Ago = db.prepare(`
    SELECT date('now', 'localtime', '-25 day') AS s, date('now', 'localtime', '-20 day') AS e
  `).get();
  const expLeave1 = db.prepare(`
    INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, Notes)
    VALUES (8888, ?, ?, ?, 6, 'إجازة منتهية حديثاً 1')
  `).run(regType, d20Ago.s, d20Ago.e);
  const expLeaveId1 = expLeave1.lastInsertRowid;

  // 2. Overlapping Leave finished 20 days ago (same dates as leave 1 to test historical conflict)
  const expLeave2 = db.prepare(`
    INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, Notes)
    VALUES (8888, ?, ?, ?, 6, 'إجازة متداخلة تاريخياً 2')
  `).run(regType, d20Ago.s, d20Ago.e);
  const expLeaveId2 = expLeave2.lastInsertRowid;

  // 3. Non-overlapping Leave finished 50 days ago (within last 3 months)
  const d50Ago = db.prepare(`
    SELECT date('now', 'localtime', '-55 day') AS s, date('now', 'localtime', '-50 day') AS e
  `).get();
  const expLeave3 = db.prepare(`
    INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, Notes)
    VALUES (8888, ?, ?, ?, 6, 'إجازة منتهية 3 بدون تعارض')
  `).run(regType, d50Ago.s, d50Ago.e);
  const expLeaveId3 = expLeave3.lastInsertRowid;

  // 4. Leave finished 140 days ago (~5 months, within current year, but > 3 months)
  const d5MonthsAgo = db.prepare(`
    SELECT date('now', 'localtime', '-150 day') AS s, date('now', 'localtime', '-140 day') AS e
  `).get();
  const expLeave4 = db.prepare(`
    INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, Notes)
    VALUES (8888, ?, ?, ?, 10, 'إجازة منتهية قبل 5 أشهر')
  `).run(regType, d5MonthsAgo.s, d5MonthsAgo.e);
  const expLeaveId4 = expLeave4.lastInsertRowid;

  // 5. Leave finished 2 years ago (historical archive, > 1 year)
  const d2YearsAgo = db.prepare(`
    SELECT date('now', 'localtime', '-710 day') AS s, date('now', 'localtime', '-700 day') AS e
  `).get();
  const expLeave5 = db.prepare(`
    INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, Notes)
    VALUES (8888, ?, ?, ?, 15, 'إجازة منتهية قبل سنتين')
  `).run(regType, d2YearsAgo.s, d2YearsAgo.e);
  const expLeaveId5 = expLeave5.lastInsertRowid;

  // Assert 1: Active and Upcoming leaves NEVER appear in getExpiredLeaves
  const expDefault = LeaveService.getExpiredLeaves({ period: 'last3months' }, db);
  assert(!expDefault.some(l => l.LeaveID === ongoingLeaveId), 'Active ongoing leave is NEVER returned in getExpiredLeaves');
  assert(!expDefault.some(l => l.LeaveID === upcomingLeaveId1), 'Upcoming future leave is NEVER returned in getExpiredLeaves');
  assert(!expDefault.some(l => l.LeaveID === upcomingLeaveId2), 'Upcoming overlapping leave is NEVER returned in getExpiredLeaves');

  // Assert 2: Period 'last3months' includes leaves within 90 days, excludes older ones
  assert(expDefault.some(l => l.LeaveID === expLeaveId1), 'Leave finished 20 days ago is INCLUDED in last3months');
  assert(expDefault.some(l => l.LeaveID === expLeaveId2), 'Overlapping leave finished 20 days ago is INCLUDED in last3months');
  assert(expDefault.some(l => l.LeaveID === expLeaveId3), 'Leave finished 50 days ago is INCLUDED in last3months');
  assert(!expDefault.some(l => l.LeaveID === expLeaveId4), 'Leave finished 140 days ago is EXCLUDED from last3months');
  assert(!expDefault.some(l => l.LeaveID === expLeaveId5), 'Leave finished 2 years ago is EXCLUDED from last3months');

  // Assert 3: Period 'currentYear' includes leaves within current calendar year
  const expYear = LeaveService.getExpiredLeaves({ period: 'currentYear' }, db);
  assert(expYear.some(l => l.LeaveID === expLeaveId1), 'Leave 1 is INCLUDED in currentYear');
  assert(expYear.some(l => l.LeaveID === expLeaveId4), 'Leave 4 (140 days ago) is INCLUDED in currentYear');
  assert(!expYear.some(l => l.LeaveID === expLeaveId5), 'Leave 5 (2 years ago) is EXCLUDED from currentYear');
  assert(!expYear.some(l => l.LeaveID === ongoingLeaveId), 'Active ongoing leave is NEVER in currentYear expired leaves');

  // Assert 4: Period 'all' (comprehensive archive) includes all past leaves without exception
  const expAll = LeaveService.getExpiredLeaves({ period: 'all' }, db);
  assert(expAll.some(l => l.LeaveID === expLeaveId1), 'Leave 1 is INCLUDED in archive all');
  assert(expAll.some(l => l.LeaveID === expLeaveId4), 'Leave 4 is INCLUDED in archive all');
  assert(expAll.some(l => l.LeaveID === expLeaveId5), 'Leave 5 (2 years ago) is INCLUDED in archive all');
  assert(!expAll.some(l => l.LeaveID === ongoingLeaveId), 'Active ongoing leave is NEVER in archive all expired leaves');
  assert(!expAll.some(l => l.LeaveID === upcomingLeaveId1), 'Upcoming leave is NEVER in archive all expired leaves');

  // Assert 5: Period 'custom' filters precisely by date range
  const expCustom = LeaveService.getExpiredLeaves({
    period: 'custom',
    customStartDate: d50Ago.s,
    customEndDate: d50Ago.e
  }, db);
  assert(expCustom.some(l => l.LeaveID === expLeaveId3), 'Leave 3 within exact custom range is INCLUDED');
  assert(!expCustom.some(l => l.LeaveID === expLeaveId1), 'Leave 1 outside custom range is EXCLUDED');
  assert(!expCustom.some(l => l.LeaveID === expLeaveId4), 'Leave 4 outside custom range is EXCLUDED');

  // Assert 6: Period 'custom' boundary edge cases (empty result set & future range)
  const expCustomEmpty = LeaveService.getExpiredLeaves({
    period: 'custom',
    customStartDate: '1990-01-01',
    customEndDate: '1990-12-31'
  }, db);
  assert(Array.isArray(expCustomEmpty) && expCustomEmpty.length === 0, 'Custom range with no matching dates returns empty array gracefully');

  const expCustomFuture = LeaveService.getExpiredLeaves({
    period: 'custom',
    customStartDate: d20Ago.s,
    customEndDate: '2099-12-31' // Far future date
  }, db);
  assert(!expCustomFuture.some(l => l.LeaveID === ongoingLeaveId), 'Custom range extending into future strictly stops at EndDate < today');
  assert(!expCustomFuture.some(l => l.LeaveID === upcomingLeaveId1), 'Custom range extending into future strictly excludes upcoming leaves');

  // Assert 7: Historical Overlap Conflict Detection (HasConflict)
  const foundExp1 = expAll.find(l => l.LeaveID === expLeaveId1);
  const foundExp2 = expAll.find(l => l.LeaveID === expLeaveId2);
  const foundExp3 = expAll.find(l => l.LeaveID === expLeaveId3);
  assert(foundExp1.HasConflict === 1, 'Overlapping past leave 1 reports HasConflict = 1 (⚠️ تداخل تاريخي)');
  assert(foundExp2.HasConflict === 1, 'Overlapping past leave 2 reports HasConflict = 1 (⚠️ تداخل تاريخي)');
  assert(foundExp3.HasConflict === 0, 'Non-overlapping past leave 3 reports HasConflict = 0 (سليمة)');

  // Assert 8: Transferred employees are strictly excluded from expired leaves
  const transferredEmpLeave = db.prepare(`
    SELECT l.LeaveID FROM Leaves l
    JOIN Employees e ON e.EmployeeID = l.EmployeeID
    WHERE e.IsTransferred = 1
    LIMIT 1
  `).get();
  if (transferredEmpLeave) {
    assert(!expAll.some(l => l.LeaveID === transferredEmpLeave.LeaveID), 'Transferred employee past leaves are strictly excluded from expired report');
  }

  // Assert 9: Excel export for expired leaves generates valid file with 16 columns & styles
  const testExpiredExcelPath = path.join(__dirname, 'test_expired_leaves.xlsx');
  await ReportService.exportExpiredLeavesToExcel(testExpiredExcelPath, { period: 'last3months' }, db);
  assert(fs.existsSync(testExpiredExcelPath) && fs.statSync(testExpiredExcelPath).size > 0, 'Excel export for last3months generates successfully');

  // Read the workbook back to inspect structure
  const verifyWb = new ExcelJS.Workbook();
  await verifyWb.xlsx.readFile(testExpiredExcelPath);
  const verifyWs = verifyWb.getWorksheet('الإجازات المنتهية');
  assert(verifyWs != null, 'Worksheet "الإجازات المنتهية" exists in Excel file');
  assert(verifyWs.columns.length === 16, 'Worksheet has exactly 16 columns matching specification');

  // Inspect that conflict row in Excel has proper styling
  let conflictRowFound = false;
  verifyWs.eachRow((row, rowNumber) => {
    const col15Val = row.getCell(15).value;
    if (col15Val === '⚠️ تداخل تاريخي') {
      conflictRowFound = true;
      const fill = row.getCell(15).fill;
      assert(fill && fill.fgColor && fill.fgColor.argb === 'FFFFFBEB', 'Conflict badge cell has soft amber background #FFFFFBEB');
    }
  });
  assert(conflictRowFound, 'Excel file contains at least one row with "⚠️ تداخل تاريخي" badge and proper styling');
  try { fs.unlinkSync(testExpiredExcelPath); } catch (_) {}

  // Assert 10: Excel export for empty custom range generates cleanly without error
  const testEmptyExcelPath = path.join(__dirname, 'test_empty_expired_leaves.xlsx');
  await ReportService.exportExpiredLeavesToExcel(testEmptyExcelPath, {
    period: 'custom',
    customStartDate: '1990-01-01',
    customEndDate: '1990-12-31'
  }, db);
  assert(fs.existsSync(testEmptyExcelPath) && fs.statSync(testEmptyExcelPath).size > 0, 'Excel export for empty date range generates successfully with empty placeholder');
  try { fs.unlinkSync(testEmptyExcelPath); } catch (_) {}

  console.log(`\n🎉 ALL ${passedTests}/${totalTests} TESTS PASSED ACROSS 28 TEST SUITES!`);
})();




