// ============================================================
//  tests/reportService.test.js
//
//  اختبارات وحدة شاملة لـ ReportService:
//    - التحقق من دقة التوزيع النسبي للإجازات العابرة لحدود السنة (Cross-Year Boundary Allocation)
//    - فحص دالتي getCriticalAndAccumulatedLeaves و getAccumulatedLeavesPaginated
//    - فحص الأرصدة الحرجة وتراكم الإجازات السنوي والإجماليات
// ============================================================

'use strict';

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
const fs      = require('fs');
const path    = require('path');
const { getCriticalAndAccumulatedLeaves, getAccumulatedLeavesPaginated, getCriticalBalancesPaginated } = require('../src/main/services/ReportService');

console.log('📊 [ReportService Unit Tests] Starting test suite...\n');

let passedTests = 0;
let totalTests  = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error('❌ FAIL: ' + message);
    process.exit(1);
  }
  passedTests++;
  console.log('  ✅ PASS: ' + message);
}

function createTestDb() {
  const db = new Database(':memory:');
  const migrationsDir = path.join(__dirname, '..', 'src', 'main', 'migrations');
  const files = fs.readdirSync(migrationsDir).sort();
  for (const f of files) {
    if (f.endsWith('.sql')) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      try { db.exec(sql); } catch (e) {
        if (!e.message.includes('duplicate column')) throw e;
      }
    }
  }
  return db;
}

function seedEmployee(db, id, name) {
  db.prepare(
    "INSERT OR IGNORE INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive) VALUES (?, ?, 'Male', '2020-01-01', 'موظف', 1)"
  ).run(id, name);
}

function seedLeave(db, employeeId, startDate, endDate, leaveTypeName) {
  const leaveType = db.prepare("SELECT LeaveTypeID FROM LeaveTypes WHERE Name = ?").get(leaveTypeName);
  if (!leaveType) throw new Error('LeaveType not found: ' + leaveTypeName);
  const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
  return db.prepare(
    "INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount) VALUES (?, ?, ?, ?, ?)"
  ).run(employeeId, leaveType.LeaveTypeID, startDate, endDate, days).lastInsertRowid;
}

const db = createTestDb();

// Employee 1: إجازة عابرة (2025-12-25 → 2026-01-05) = 12 يوم إجمالي
seedEmployee(db, 1, 'أحمد العابر');
seedLeave(db, 1, '2025-12-25', '2026-01-05', 'إجازة اعتيادية');

// Employee 2: إجازة بالكامل داخل 2025 (10 أيام)
seedEmployee(db, 2, 'سارة الداخلية');
seedLeave(db, 2, '2025-03-01', '2025-03-10', 'إجازة اعتيادية');

// Employee 3: إجازة حد السنة (2025-12-31 → 2026-01-01) = 2 يوم
seedEmployee(db, 3, 'علي الحدودي');
seedLeave(db, 3, '2025-12-31', '2026-01-01', 'إجازة مرضية');

// Employee 4: إجازتان عابرتان
//   A: 2025-12-20 → 2026-01-03  → 2025: 12 يوم, 2026: 3 أيام
//   B: 2025-12-01 → 2025-12-05  → 2025: 5 أيام
seedEmployee(db, 4, 'منى المتعددة');
seedLeave(db, 4, '2025-12-20', '2026-01-03', 'إجازة اعتيادية');
seedLeave(db, 4, '2025-12-01', '2025-12-05', 'إجازة مرضية');

// Employee 5: بدون إجازات
seedEmployee(db, 5, 'فريد بلا إجازة');

// Employee 6: إجازة تبدأ 01-01 بالضبط (5 أيام في 2026)
seedEmployee(db, 6, 'ليلى البداية');
seedLeave(db, 6, '2026-01-01', '2026-01-05', 'إجازة اعتيادية');

// Employee 7: إجازة تنتهي 31-12 بالضبط (5 أيام في 2025)
seedEmployee(db, 7, 'عمر النهاية');
seedLeave(db, 7, '2025-12-27', '2025-12-31', 'إجازة اعتيادية');

// ════════════════════════════════════════════════════
//  Suite 1: getCriticalAndAccumulatedLeaves
// ════════════════════════════════════════════════════
console.log('--- Suite 1: getCriticalAndAccumulatedLeaves (Cross-Year Proportional Allocation) ---');

const report2025 = getCriticalAndAccumulatedLeaves(db, { year: 2025, threshold: 999 });
const report2026 = getCriticalAndAccumulatedLeaves(db, { year: 2026, threshold: 999 });

// Test 1: cross-year leave → 7 days in 2025
console.log('\nTest 1: Cross-year leave (2025-12-25 to 2026-01-05) allocates 7 days to 2025');
const emp1_2025 = report2025.accumulatedLeaves.find(r => r.EmployeeID === 1);
assert(emp1_2025 !== undefined, 'Employee 1 appears in 2025 report');
assert(emp1_2025.TotalDaysCount === 7, 'Cross-year leave: 7 days allocated to 2025 (got ' + (emp1_2025 && emp1_2025.TotalDaysCount) + ')');
assert(emp1_2025.RegularDaysCount === 7, 'Cross-year leave: regular days in 2025 = 7');

// Test 2: cross-year leave → 5 days in 2026
console.log('\nTest 2: Cross-year leave (2025-12-25 to 2026-01-05) allocates 5 days to 2026');
const emp1_2026 = report2026.accumulatedLeaves.find(r => r.EmployeeID === 1);
assert(emp1_2026 !== undefined, 'Employee 1 appears in 2026 report');
assert(emp1_2026.TotalDaysCount === 5, 'Cross-year leave: 5 days allocated to 2026 (got ' + (emp1_2026 && emp1_2026.TotalDaysCount) + ')');
assert(emp1_2026.RegularDaysCount === 5, 'Cross-year leave: regular days in 2026 = 5');

// Test 3: total across both years = 12 (no day lost or double-counted)
console.log('\nTest 3: Total allocated days across 2025+2026 = 12 (7+5, no duplication/loss)');
const totalAllocated = (emp1_2025.TotalDaysCount || 0) + (emp1_2026.TotalDaysCount || 0);
assert(totalAllocated === 12, 'Sum of allocated days 2025+2026 = 12 (got ' + totalAllocated + ')');

// Test 4: leave fully in 2025 → 10 days in 2025, 0 in 2026
console.log('\nTest 4: Leave fully inside 2025 is excluded from 2026 report');
const emp2_2025 = report2025.accumulatedLeaves.find(r => r.EmployeeID === 2);
const emp2_2026 = report2026.accumulatedLeaves.find(r => r.EmployeeID === 2);
assert(emp2_2025.TotalDaysCount === 10, 'Employee 2 has 10 days in 2025 report');
assert(emp2_2026.TotalDaysCount === 0,  'Employee 2 has 0 days in 2026 report');

// Test 5: year-edge leave (Dec31→Jan1) → 1 sick day in each year
console.log('\nTest 5: Year-edge leave (2025-12-31 to 2026-01-01) gives 1 sick day per year');
const emp3_2025 = report2025.accumulatedLeaves.find(r => r.EmployeeID === 3);
const emp3_2026 = report2026.accumulatedLeaves.find(r => r.EmployeeID === 3);
assert(emp3_2025.SickDaysCount === 1, 'Employee 3 sick days in 2025 = 1');
assert(emp3_2026.SickDaysCount === 1, 'Employee 3 sick days in 2026 = 1');

// Test 6: employee with two leaves crossing boundary
// A: Dec20→Jan3 → 2025:12, 2026:3
// B: Dec1→Dec5 → 2025:5
// Total 2025 = 17, Total 2026 = 3
console.log('\nTest 6: Employee with two cross-boundary leaves');
const emp4_2025 = report2025.accumulatedLeaves.find(r => r.EmployeeID === 4);
const emp4_2026 = report2026.accumulatedLeaves.find(r => r.EmployeeID === 4);
assert(emp4_2025.TotalDaysCount === 17, 'Employee 4 total days in 2025 = 17 (got ' + emp4_2025.TotalDaysCount + ')');
assert(emp4_2026.TotalDaysCount === 3,  'Employee 4 total days in 2026 = 3 (got ' + emp4_2026.TotalDaysCount + ')');

// Test 7: employee with no leaves → 0 days
console.log('\nTest 7: Employee with no leaves has TotalDaysCount = 0');
const emp5_2025 = report2025.accumulatedLeaves.find(r => r.EmployeeID === 5);
assert(emp5_2025 !== undefined, 'Employee 5 (no leaves) appears in report');
assert(emp5_2025.TotalDaysCount === 0, 'Employee 5 has 0 total days');

// Test 8: leave starting exactly Jan 1
console.log('\nTest 8: Leave starting exactly 2026-01-01 counts all days in 2026');
const emp6_2026 = report2026.accumulatedLeaves.find(r => r.EmployeeID === 6);
assert(emp6_2026.TotalDaysCount === 5, 'Employee 6 (Jan 1 start) has 5 days in 2026');

// Test 9: leave ending exactly Dec 31
console.log('\nTest 9: Leave ending exactly 2025-12-31 counts all days in 2025');
const emp7_2025 = report2025.accumulatedLeaves.find(r => r.EmployeeID === 7);
assert(emp7_2025.TotalDaysCount === 5, 'Employee 7 (Dec 31 end) has 5 days in 2025');

// ════════════════════════════════════════════════════
//  Suite 2: getAccumulatedLeavesPaginated
// ════════════════════════════════════════════════════
console.log('\n--- Suite 2: getAccumulatedLeavesPaginated ---');

const paged2025 = getAccumulatedLeavesPaginated(db, { year: 2025, pageSize: 100 });
const paged2026 = getAccumulatedLeavesPaginated(db, { year: 2026, pageSize: 100 });

// Test 10: paginated same cross-year proportional allocation
console.log('\nTest 10: Paginated function returns same proportional allocations');
const pEmp1_2025 = paged2025.data.find(r => r.EmployeeID === 1);
const pEmp1_2026 = paged2026.data.find(r => r.EmployeeID === 1);
assert(pEmp1_2025.TotalConsumedDays === 7, 'Paginated: Employee 1 total days 2025 = 7');
assert(pEmp1_2025.RegularDays === 7,       'Paginated: Employee 1 regular days 2025 = 7');
assert(pEmp1_2026.TotalConsumedDays === 5, 'Paginated: Employee 1 total days 2026 = 5');

const pEmp3_2025 = paged2025.data.find(r => r.EmployeeID === 3);
assert(pEmp3_2025.SickDays === 1, 'Paginated: Employee 3 sick days 2025 = 1');

// Test 11: summary.totalDaysThisYear reflects proportional allocation
// 2025: emp1=7, emp2=10, emp3=1, emp4=17, emp5=0, emp6=0, emp7=5 = 40
// 2026: emp1=5, emp2=0,  emp3=1, emp4=3,  emp5=0, emp6=5, emp7=0 = 14
console.log('\nTest 11: summary.totalDaysThisYear is correct after proportional allocation');
assert(
  paged2025.summary.totalDaysThisYear === 40,
  'Summary totalDaysThisYear for 2025 = 40 (got ' + paged2025.summary.totalDaysThisYear + ')'
);
assert(
  paged2026.summary.totalDaysThisYear === 14,
  'Summary totalDaysThisYear for 2026 = 14 (got ' + paged2026.summary.totalDaysThisYear + ')'
);

// Test 12: LeavesCount counts the leave record once per matching year
console.log('\nTest 12: LeavesCount counts each overlapping leave record once');
assert(pEmp1_2025.LeavesCount === 1, 'Employee 1 has 1 leave record in 2025 (not split into 2)');
assert(pEmp1_2026.LeavesCount === 1, 'Employee 1 has 1 leave record in 2026 (not split into 2)');

// Test 13: year with zero leaves for all employees → summary = 0
console.log('\nTest 13: Year with no leaves returns 0 summary totals');
const paged1990 = getAccumulatedLeavesPaginated(db, { year: 1990, pageSize: 100 });
assert(paged1990.summary.totalDaysThisYear === 0, 'Summary for year with no leaves = 0');

console.log('\n🎉 ALL ' + passedTests + '/' + totalTests + ' REPORT SERVICE TESTS PASSED SUCCESSFULLY!\n');
