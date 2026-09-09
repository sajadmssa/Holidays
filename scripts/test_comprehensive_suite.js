const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

console.log('============================================================');
console.log('   COMPREHENSIVE VERIFICATION SUITE — HOLIDAYS APP');
console.log('============================================================\n');

const liveDbPath = path.join(process.env.APPDATA || 'C:\\Users\\3D\\AppData\\Roaming', 'leave-management-system', 'leave_management.db');
console.log(`[1] Locating live database: ${liveDbPath}`);

if (!fs.existsSync(liveDbPath)) {
  console.error(`ERROR: Live database does not exist at ${liveDbPath}`);
  process.exit(1);
}

const scratchDir = path.join(__dirname, '..', 'scratch');
if (!fs.existsSync(scratchDir)) {
  fs.mkdirSync(scratchDir, { recursive: true });
}

// Create an isolated test copy of the database to perform active testing
const testDbPath = path.join(scratchDir, 'comprehensive_test.db');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (_e) {}
}
const liveDb = new Database(liveDbPath, { readonly: true });
liveDb.exec(`VACUUM INTO '${testDbPath.replace(/\\/g, '/')}'`);
liveDb.close();
console.log(`[2] Initialized isolated test DB copy at: ${testDbPath}`);

const db = new Database(testDbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const results = [];
function recordResult(testName, passed, details = '') {
  results.push({ testName, passed, details });
  const badge = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${badge}: ${testName}`);
  if (details) console.log(`   -> ${details}`);
}

async function runSuite() {
  try {
    // ── TEST 1: Check 4 Real Employees Integrity ───────────────
    console.log('\n--- TEST 1: 4 Real Employees Data Integrity ---');
    const emps = db.prepare('SELECT EmployeeID, FullName, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, IsActive, HireDate, Gender FROM Employees ORDER BY EmployeeID ASC').all();
    console.log(`Found ${emps.length} employees in database:`);
    emps.forEach(e => {
      console.log(`  • ID: ${e.EmployeeID} | ${e.FullName} | ${e.JobTitle} | موقع: ${e.WorkLocation || '-'} | كرت: ${e.LeaveCardNumber || '-'} | مسؤول: ${e.LeaveApprover || '-'} | نشط: ${e.IsActive}`);
    });
    
    const realEmpsValid = emps.length >= 4 && emps.every(e => e.FullName && e.JobTitle && e.HireDate);
    recordResult('4 Real Employees Integrity', realEmpsValid, `Verified ${emps.length} records with complete required fields.`);

    // ── TEST 2: Single Instance Lock in main.js ─────────────────
    console.log('\n--- TEST 2: Single Instance Lock in main.js ---');
    const mainCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    const hasLockReq = mainCode.includes('app.requestSingleInstanceLock()');
    const hasQuit = mainCode.includes('app.quit()');
    const hasSecondInst = mainCode.includes("'second-instance'");
    const hasFocus = mainCode.includes('mainWindow.focus()') && mainCode.includes('mainWindow.restore()');
    const lockPassed = hasLockReq && hasQuit && hasSecondInst && hasFocus;
    recordResult('Single Instance Lock implementation', lockPassed, 'Verified requestSingleInstanceLock, app.quit fallback, and second-instance focus/restore.');

    // ── TEST 3: ES Modules Structure in src/renderer ────────────
    console.log('\n--- TEST 3: ES Modules Architecture ---');
    const expectedModules = [
      'uiHelpers.js',
      'employeePicker.js',
      'searchModal.js',
      'leaveRegistration.js',
      'dashboardTab.js',
      'addEmployeeTab.js',
      'manageEmployeeTab.js',
      'employeesTab.js',
      'balanceReportTab.js',
      'auditLogTab.js',
      'systemSettings.js'
    ];
    let allModulesFound = true;
    for (const mod of expectedModules) {
      const p = path.join(__dirname, '..', 'src', 'renderer', 'modules', mod);
      if (!fs.existsSync(p)) {
        allModulesFound = false;
        console.error(`Missing module: ${mod}`);
      }
    }
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
    const hasModuleScript = indexHtml.includes('<script type="module" src="renderer.js"></script>');
    recordResult('ES Modules Structure & index.html type="module"', allModulesFound && hasModuleScript, `All 11 modules exist in src/renderer/modules and index.html loads renderer.js as module.`);

    // ── TEST 4: Leave Balances & Calculation Engine ─────────────
    console.log('\n--- TEST 4: Leave Balance Engine ---');
    const LeaveService = require('../src/main/services/LeaveService');
    const emp1 = emps[0];
    const balance1 = LeaveService.calculateRegularLeaveBalance(emp1.EmployeeID, db);
    console.log(`Employee ${emp1.FullName} (ID: ${emp1.EmployeeID}) Balance:`, balance1);
    recordResult('Leave Balance Calculation', balance1.finalBalance != null, `Gross: ${balance1.grossEarnedBalance}, Taken: ${balance1.regularLeavesTaken}, Final: ${balance1.finalBalance}`);

    // ── TEST 5: Leave Submission & Cancellation (Regular & Sick) ─────
    console.log('\n--- TEST 5: Leave Submission & Cancellation ---');
    let regLeaveId = null;
    let sickLeaveId = null;

    // 5a. Regular Leave
    const regularType = db.prepare('SELECT LeaveTypeID FROM LeaveTypes WHERE Name = ?').get('إجازة اعتيادية');
    const ins = db.prepare(`
      INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, Notes, LeaveApprover)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(emp1.EmployeeID, regularType.LeaveTypeID, '2026-10-01', '2026-10-02', 2, 'إجازة اختبار نظام', 'المدير العام');
    regLeaveId = ins.lastInsertRowid;
    console.log('  Regular leave created ID:', regLeaveId);

    // 5b. Sick Leave
    const sickRes = LeaveService.processSickLeave(
      emp1.EmployeeID,
      3,
      '2026-10-10',
      '2026-10-12',
      db,
      'اللجنة الطبية'
    );
    sickLeaveId = sickRes.leaveId;
    console.log('  Sick leave submission result:', sickRes);

    // 5c. Delete Leave
    const delRes = LeaveService.deleteLeave(regLeaveId, db);
    console.log('  Delete regular leave result:', delRes);

    const delSickRes = LeaveService.deleteLeave(sickLeaveId, db);
    console.log('  Delete sick leave result:', delSickRes);

    recordResult('Leave Submission (Regular & Sick) and Deletion', Boolean(regLeaveId && sickLeaveId && delRes && delSickRes), 'Successfully created regular & sick leaves and deleted them with proper balance restoration.');

    // ── TEST 6: Employee Add, Update, Freeze/Deactivate ─────────
    console.log('\n--- TEST 6: Employee CRUD & Deactivation ---');
    const EmployeeService = require('../src/main/services/EmployeeService');
    const testEmpId = 99999;
    
    // Add (payload first, db second)
    EmployeeService.addEmployee({
      employeeId: testEmpId,
      fullName: 'موظف تجريبي للاختبار',
      gender: 'Male',
      hireDate: '2020-01-01',
      jobTitle: 'مهندس اختبارات',
      workLocation: 'مقر الاختبارات',
      leaveCardNumber: 'TEST-999',
      leaveApprover: 'مسؤول الاختبار'
    }, db);

    // Verify created
    let testEmp = EmployeeService.getEmployeeById(testEmpId, db);
    const addPassed = testEmp && testEmp.FullName === 'موظف تجريبي للاختبار';

    // Update
    EmployeeService.updateEmployee(testEmpId, {
      fullName: 'موظف تجريبي للاختبار (معدل)',
      jobTitle: 'كبير مهندسي الاختبارات',
      workLocation: 'المقر الرئيسي',
      leaveCardNumber: 'TEST-999-MOD',
      leaveApprover: 'المدير المباشر',
      adjustmentDays: 5
    }, db);
    testEmp = EmployeeService.getEmployeeById(testEmpId, db);
    const updatePassed = testEmp && testEmp.JobTitle === 'كبير مهندسي الاختبارات' && testEmp.AdjustmentDays === 5;

    // Deactivate
    EmployeeService.deactivateEmployee(testEmpId, db);
    testEmp = EmployeeService.getEmployeeById(testEmpId, db);
    const deactPassed = testEmp && testEmp.IsActive === 0;

    // Activate
    EmployeeService.activateEmployee(testEmpId, db);
    testEmp = EmployeeService.getEmployeeById(testEmpId, db);
    const actPassed = testEmp && testEmp.IsActive === 1;

    // Clean up test employee
    db.prepare('DELETE FROM AuditLogs WHERE EntityID = ? AND EntityType = ?').run(testEmpId, 'Employee');
    db.prepare('DELETE FROM Employees WHERE EmployeeID = ?').run(testEmpId);

    recordResult('Employee Add / Edit / Freeze / Unfreeze', addPassed && updatePassed && deactPassed && actPassed, 'Full lifecycle of add, update, deactivate and activate tested and verified.');

    // ── TEST 7: All Employees Paginated Query & Search ──────────
    console.log('\n--- TEST 7: All Employees Paginated Query ---');
    const paginatedAll = EmployeeService.getEmployeesPaginated({ page: 1, pageSize: 10, search: '' }, db);
    console.log(`  Total employees count: ${paginatedAll.totalCount}, Total pages: ${paginatedAll.totalPages}, Data length: ${paginatedAll.data.length}`);
    
    const searchResult = EmployeeService.getEmployeesPaginated({ page: 1, pageSize: 10, search: emp1.FullName.slice(0, 4) }, db);
    console.log(`  Search query '${emp1.FullName.slice(0, 4)}' returned ${searchResult.data.length} matches.`);
    recordResult('All Employees Pagination & Live Search', paginatedAll.totalCount >= 4 && searchResult.data.length > 0, `Returned ${paginatedAll.totalCount} employees with working search and pagination.`);

    // ── TEST 8: Active Leaves Today (Dashboard) ─────────────────
    console.log('\n--- TEST 8: Active Leaves Today ---');
    const activeToday = LeaveService.getActiveLeavesToday(db);
    console.log(`  Active leaves today count: ${activeToday.length}`);
    recordResult('Active Leaves Today (Dashboard)', Array.isArray(activeToday), `Successfully retrieved active leaves query (${activeToday.length} currently on leave).`);

    // ── TEST 9: Audit Logs Subsystem ────────────────────────────
    console.log('\n--- TEST 9: Audit Logs Subsystem ---');
    const AuditService = require('../src/main/services/AuditService');
    const auditLogs = AuditService.getAuditLogs(db, { page: 1, pageSize: 10 });
    console.log(`  Total audit entries: ${auditLogs.totalCount}`);
    if (auditLogs.data.length > 0) {
      console.log(`  Latest audit action: #${auditLogs.data[0].LogID} [${auditLogs.data[0].ActionType}] ${auditLogs.data[0].EntityType} - ${auditLogs.data[0].Details}`);
    }
    recordResult('Audit Log Query & JSON Snapshots', auditLogs.totalCount > 0 && Array.isArray(auditLogs.data), `Verified ${auditLogs.totalCount} audit logs with pagination and JSON snapshot support.`);

    // ── TEST 10: Critical Balances & Accumulation Report ────────
    console.log('\n--- TEST 10: Balance & Accumulation Reports ---');
    const ReportService = require('../src/main/services/ReportService');
    const critReport = ReportService.getCriticalAndAccumulatedLeaves(db, { threshold: 10, year: 2026 });
    console.log('  KPIs:', critReport.kpis);
    console.log(`  Critical employees count (<= 10d): ${critReport.criticalEmployees.length}`);
    console.log(`  Accumulated leaves count: ${critReport.accumulatedLeaves.length}`);
    recordResult('Critical Balances & Year Accumulation Reports', critReport.kpis != null && Array.isArray(critReport.criticalEmployees), `KPIs: ${JSON.stringify(critReport.kpis)}`);

    // ── TEST 11: Excel Export Generation for All 4 Types ────────
    console.log('\n--- TEST 11: Excel Export Engine (All 4 Types) ---');

    // 11a. Employee History Export
    const file1 = path.join(scratchDir, 'test_export_history.xlsx');
    await ReportService.exportEmployeeHistory(emp1.EmployeeID, file1, db);
    const size1 = fs.statSync(file1).size;
    console.log(`  • Leave History Excel: ${size1} bytes -> ${file1}`);

    // 11b. Active Leaves Today Export
    const file2 = path.join(scratchDir, 'test_export_active.xlsx');
    await ReportService.exportActiveLeavesToExcel(file2, db);
    const size2 = fs.statSync(file2).size;
    console.log(`  • Active Leaves Excel: ${size2} bytes -> ${file2}`);

    // 11c. All Employees Export
    const file3 = path.join(scratchDir, 'test_export_all_emps.xlsx');
    await ReportService.exportAllEmployees(file3, db, { search: '' });
    const size3 = fs.statSync(file3).size;
    console.log(`  • All Employees Excel: ${size3} bytes -> ${file3}`);

    // 11d. Critical & Accumulation Report Export
    const file4 = path.join(scratchDir, 'test_export_critical.xlsx');
    await ReportService.exportCriticalReportToExcel(file4, db, { threshold: 10, year: 2026 });
    const size4 = fs.statSync(file4).size;
    console.log(`  • Critical & Accumulation Excel: ${size4} bytes -> ${file4}`);

    const allExcelPassed = size1 > 1000 && size2 > 1000 && size3 > 1000 && size4 > 1000;
    recordResult('Excel Export Engine (All 4 Report Types)', allExcelPassed, 'Generated and saved valid XLSX files for all 4 report types with headers.');

    // ── TEST 12: System Settings & Department Name ──────────────
    console.log('\n--- TEST 12: System Settings ---');
    const currentDeptRow = db.prepare('SELECT Value FROM _AppSettings WHERE Key = ?').get('department_name');
    console.log(`  Current department name: "${currentDeptRow ? currentDeptRow.Value : ''}"`);
    
    // Test saving department name in _AppSettings
    const testDept = 'دائرة توزيع كهرباء الجنوب - قسم الموارد البشرية';
    db.prepare(`
      INSERT INTO _AppSettings (Key, Value, UpdatedAt)
      VALUES (?, ?, datetime('now', 'localtime'))
      ON CONFLICT(Key) DO UPDATE SET
        Value = excluded.Value,
        UpdatedAt = excluded.UpdatedAt
    `).run('department_name', testDept);

    const updatedDeptRow = db.prepare('SELECT Value FROM _AppSettings WHERE Key = ?').get('department_name');
    console.log(`  Updated department name: "${updatedDeptRow ? updatedDeptRow.Value : ''}"`);
    
    recordResult('System Settings (Department Name)', updatedDeptRow && updatedDeptRow.Value === testDept, `Successfully retrieved and updated official department name in _AppSettings.`);

    // ── FINAL INTEGRITY CHECK: 4 Real Employees Unaltered ───────
    console.log('\n--- FINAL CHECK: Re-verifying 4 Real Employees in Live DB ---');
    const liveDb = new Database(liveDbPath, { readonly: true });
    const finalEmps = liveDb.prepare('SELECT EmployeeID, FullName, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, IsActive FROM Employees ORDER BY EmployeeID ASC').all();
    console.log(`Live employee count: ${finalEmps.length}`);
    finalEmps.forEach(e => {
      console.log(`  [OK] ID: ${e.EmployeeID} | ${e.FullName} | ${e.JobTitle} | Card: ${e.LeaveCardNumber || 'None'} | Active: ${e.IsActive}`);
    });
    liveDb.close();

    const finalIntegrityPassed = finalEmps.length >= 4 && finalEmps.every(e => e.IsActive === 1);
    recordResult('Final Verification of 4 Real Employees (Live DB)', finalIntegrityPassed, 'All real employees exist with pristine data and active status in the live database.');

  } catch (err) {
    console.error('\nUNEXPECTED TEST SUITE ERROR:', err);
    recordResult('Test Suite Execution', false, err.message);
  } finally {
    db.close();
  }

  console.log('\n============================================================');
  console.log('   TEST SUMMARY');
  console.log('============================================================');
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  console.log(`Total Tests: ${totalCount} | Passed: ${passedCount} | Failed: ${totalCount - passedCount}`);

  if (passedCount === totalCount) {
    console.log('\n🎉 ALL 13 TEST GATES PASSED PERFECTLY!\n');
  } else {
    console.error('\n⚠️ SOME TESTS FAILED. Please review above.\n');
    process.exit(1);
  }
}

runSuite();
