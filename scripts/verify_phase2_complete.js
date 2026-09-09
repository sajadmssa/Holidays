const path = require('path');
const fs = require('fs');
const exceljs = require('exceljs');

const dataDir = path.join(__dirname, '..', 'data');
const appDataDir = path.join(dataDir, 'leave-management-system');
if (!fs.existsSync(appDataDir)) {
  fs.mkdirSync(appDataDir, { recursive: true });
}
process.env.APPDATA = dataDir;

const dbModule = require('../src/main/database');
dbModule.initialize();
const db = dbModule.getDb();
console.log('Testing against isolated database initialized via database.js in data folder');

// Import Services
const { getDepartmentName, setDepartmentName } = require('../src/main/ipc/systemHandlers');
const ReportService = require('../src/main/services/ReportService');
const AuditService = require('../src/main/services/AuditService');
const EmployeeService = require('../src/main/services/EmployeeService');
const LeaveService = require('../src/main/services/LeaveService');

const testOutputDir = path.join(__dirname, '..', 'data', 'test_exports');
if (!fs.existsSync(testOutputDir)) {
  fs.mkdirSync(testOutputDir, { recursive: true });
}

// Ensure 4 real employees exist for tests
const empCount = db.prepare('SELECT COUNT(*) as count FROM Employees').get().count;
if (empCount === 0) {
  const insertEmp = db.prepare(`
    INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, IsActive, AdjustmentDays)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
  `);
  insertEmp.run(1, 'كرار موسى', 'Male', '2018-01-01', 'مهندس برمجيات', 'البصرة', '101', 'المدير العام');
  insertEmp.run(2, 'سجاد ناظم', 'Male', '2019-03-15', 'فني شبكات', 'البصرة', '102', 'مدير القسم');
  insertEmp.run(3, 'محمد علي', 'Male', '2020-05-10', 'مسؤول شؤون إدارية', 'الناصرية', '103', 'مدير الموارد');
  insertEmp.run(22, 'باسم', 'Male', '2021-01-01', 'محاسب', 'العمارة', '104', 'المدير المالي');

  // Add sample leaves
  const insertLeave = db.prepare(`
    INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, LeaveApprover)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  // Regular leave for Karrar
  insertLeave.run(1, 1, '2026-03-01', '2026-03-05', 5, 'المدير العام');
  // Sick leave for Sajjad
  insertLeave.run(2, 2, '2026-04-01', '2026-04-04', 4, 'مدير القسم');
}

async function runTests() {
  console.log('\n==================================================');
  console.log('  PHASE 2 COMPREHENSIVE VERIFICATION SUITE');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 1. Test _AppSettings & Department Name CRUD + Fallbacks
  // ─────────────────────────────────────────────────────────────
  console.log('--- 1. Testing _AppSettings & Department Name Handling ---');
  
  // Set custom department name
  const sampleDept = 'دائرة توزيع كهرباء الجنوب - قسم الموارد البشرية';
  const stmtUpsert = db.prepare(`
    INSERT INTO _AppSettings (Key, Value, UpdatedAt)
    VALUES ('department_name', ?, datetime('now', 'localtime'))
    ON CONFLICT(Key) DO UPDATE SET
      Value = excluded.Value,
      UpdatedAt = excluded.UpdatedAt
  `);
  stmtUpsert.run(sampleDept);

  const savedDept = db.prepare(`SELECT Value FROM _AppSettings WHERE Key = 'department_name'`).get();
  assert(savedDept && savedDept.Value === sampleDept, 'Setting department_name is saved in _AppSettings');

  // Verify ReportService.getDepartmentName
  const deptRetrieved = ReportService.getDepartmentName(db);
  assert(deptRetrieved === sampleDept, `ReportService retrieved department name: "${deptRetrieved}"`);

  // ─────────────────────────────────────────────────────────────
  // 2. Test Excel Exports with Custom Department Name
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 2. Testing Excel Exports (With Department Name Set) ---');

  const fileActiveWithDept = path.join(testOutputDir, 'test_active_with_dept.xlsx');
  const fileAllWithDept = path.join(testOutputDir, 'test_all_with_dept.xlsx');
  const fileHistWithDept = path.join(testOutputDir, 'test_hist_with_dept.xlsx');
  const fileCritWithDept = path.join(testOutputDir, 'test_crit_with_dept.xlsx');

  await ReportService.exportActiveLeavesToExcel(fileActiveWithDept, db);
  await ReportService.exportAllEmployees(fileAllWithDept, db, {});
  await ReportService.exportEmployeeHistory(1, fileHistWithDept, db);
  await ReportService.exportCriticalReportToExcel(fileCritWithDept, db, { threshold: 5, year: 2026 });

  assert(fs.existsSync(fileActiveWithDept), 'exportActiveLeavesToExcel produced file');
  assert(fs.existsSync(fileAllWithDept), 'exportAllEmployees produced file');
  assert(fs.existsSync(fileHistWithDept), 'exportEmployeeHistory produced file');
  assert(fs.existsSync(fileCritWithDept), 'exportCriticalReportToExcel produced file');

  // Inspect generated workbook for official header & 3-box approval footer
  const wbWithDept = new exceljs.Workbook();
  await wbWithDept.xlsx.readFile(fileActiveWithDept);
  const wsActive = wbWithDept.worksheets[0];

  assert(wsActive.views && (wsActive.views[0].rtl === true || wsActive.views[0].rightToLeft === true), 'Worksheet is Right-to-Left (RTL)');
  
  const r1WithDept = String(wsActive.getCell('A1').value || '');
  const r2WithDept = String(wsActive.getCell('A2').value || '');
  const r3WithDept = String(wsActive.getCell('A3').value || '');

  assert(r1WithDept.includes(sampleDept), `Row 1 contains official Department Name: "${r1WithDept}"`);
  assert(r2WithDept.includes('كشف الموظفين المجازين'), `Row 2 contains Report Title: "${r2WithDept}"`);
  assert(r3WithDept.includes('رقم الإشارة') && r3WithDept.includes('REF-') && r3WithDept.includes('تاريخ ووقت الاستخراج'), `Row 3 contains Reference Number and Arabic timestamp: "${r3WithDept}"`);

  // Verify 3-Box Approval Footer in wsActive
  let hasBox1 = false;
  let hasBox2 = false;
  let hasBox3 = false;
  wsActive.eachRow((row) => {
    row.eachCell((cell) => {
      const val = String(cell.value || '');
      if (val.includes('إعداد')) hasBox1 = true;
      if (val.includes('تدقيق')) hasBox2 = true;
      if (val.includes('مصادقة')) hasBox3 = true;
    });
  });
  assert(hasBox1 && hasBox2 && hasBox3, '3-box approval footer (إعداد | تدقيق | مصادقة) is properly embedded in active leaves export');

  // ─────────────────────────────────────────────────────────────
  // 3. Test Excel Exports with EMPTY Department Name (Omission Fallback)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 3. Testing Excel Exports (With EMPTY Department Name) ---');

  // Clear department name
  stmtUpsert.run('');
  const emptyDept = ReportService.getDepartmentName(db);
  assert(emptyDept === null, 'ReportService returns null when department_name is empty');

  const fileActiveNoDept = path.join(testOutputDir, 'test_active_no_dept.xlsx');
  const fileCritNoDept = path.join(testOutputDir, 'test_crit_no_dept.xlsx');

  await ReportService.exportActiveLeavesToExcel(fileActiveNoDept, db);
  await ReportService.exportCriticalReportToExcel(fileCritNoDept, db, { threshold: 5, year: 2026 });

  const wbNoDept = new exceljs.Workbook();
  await wbNoDept.xlsx.readFile(fileActiveNoDept);
  const wsNoDept = wbNoDept.worksheets[0];

  const row1Val = String(wsNoDept.getCell('A1').value || '');
  const row2Val = String(wsNoDept.getCell('A2').value || '');

  assert(row1Val.includes('كشف الموظفين المجازين'), `Row 1 starts directly with Report Title (no empty gap): "${row1Val}"`);
  assert(row2Val.includes('رقم الإشارة') && row2Val.includes('REF-') && row2Val.includes('تاريخ ووقت الاستخراج'), `Row 2 is Reference/Timestamp when Dept is omitted: "${row2Val}"`);

  // Verify 3-box approval footer in Critical Multi-sheet Report
  const wbCrit = new exceljs.Workbook();
  await wbCrit.xlsx.readFile(fileCritNoDept);
  const wsCrit1 = wbCrit.getWorksheet('الأرصدة الحرجة');
  const wsCrit2 = wbCrit.getWorksheet('تراكم الإجازات (2026)');

  assert(wsCrit1 !== undefined && wsCrit2 !== undefined, 'Critical report contains both sheets ("الأرصدة الحرجة" & "تراكم الإجازات (2026)")');

  let critBox1 = false, critBox2 = false, critBox3 = false;
  wsCrit1.eachRow((row) => {
    row.eachCell((cell) => {
      const val = String(cell.value || '');
      if (val.includes('إعداد')) critBox1 = true;
      if (val.includes('تدقيق')) critBox2 = true;
      if (val.includes('مصادقة')) critBox3 = true;
    });
  });
  assert(critBox1 && critBox2 && critBox3, 'Critical sheet contains 3-box approval footer');

  // Restore sample department name for final system state
  stmtUpsert.run(sampleDept);

  // ─────────────────────────────────────────────────────────────
  // 4. Test Critical Balances & Yearly Accumulation Calculations
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 4. Testing Critical Balances & Leave Accumulation Queries ---');

  // Adjust Employee 22 (باسم) to have 0 days balance (critical)
  db.prepare('UPDATE Employees SET AdjustmentDays = -300 WHERE EmployeeID = 22').run();

  const critData = ReportService.getCriticalAndAccumulatedLeaves(db, { threshold: 5, year: 2026 });
  assert(critData && critData.kpis, 'Report data structure returned with KPIs');
  console.log(`  KPIs: Critical count=${critData.kpis.criticalEmployeesCount}, Leaves in year=${critData.kpis.totalLeavesCountInYear}, Days consumed=${critData.kpis.totalDaysConsumedInYear}`);
  console.log(`  Critical employees count (<= 5d): ${critData.criticalEmployees.length}`);
  console.log(`  Accumulated leave records: ${critData.accumulatedLeaves.length}`);

  assert(critData.criticalEmployees.length >= 1, 'At least 1 employee found with critical balance (<= 5d)');
  const emp22 = critData.criticalEmployees.find(e => e.EmployeeID === 22);
  assert(emp22 && emp22.RemainingBalance <= 5, `Employee 22 (باسم) detected as critical with balance: ${emp22?.RemainingBalance} days`);
  assert(Array.isArray(critData.accumulatedLeaves), 'accumulatedLeaves is an array');

  // Reset AdjustmentDays for clean state
  db.prepare('UPDATE Employees SET AdjustmentDays = 0 WHERE EmployeeID = 22').run();

  // ─────────────────────────────────────────────────────────────
  // 5. Test Audit Logs Service & Filtering
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 5. Testing Audit Service & Logging Integrity ---');

  // Log a test action
  AuditService.logAction(db, {
    actionType: 'UPDATE',
    entityType: 'Employee',
    entityID: 1,
    oldValue: { FullName: 'كرار موسى', WorkLocation: 'الفرع القديم' },
    newValue: { FullName: 'كرار موسى', WorkLocation: 'الإدارة العامة' },
    details: 'تعديل موقع العمل لاختبار التدقيق'
  });

  const auditRes = AuditService.getAuditLogs(db, {
    page: 1,
    pageSize: 10,
    entityType: 'Employee'
  });

  assert(auditRes && auditRes.data.length > 0, `Audit logs returned ${auditRes.data.length} records (Total: ${auditRes.totalCount})`);
  const latestLog = auditRes.data[0];
  assert(latestLog.ActionType === 'UPDATE' && latestLog.EntityType === 'Employee', 'Latest audit log matches logged action');
  assert(latestLog.OldValue.includes('الفرع القديم') && latestLog.NewValue.includes('الإدارة العامة'), 'OldValues and NewValues JSON snapshots preserved');

  console.log('\n==================================================');
  console.log(`  SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
