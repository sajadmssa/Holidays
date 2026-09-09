// ============================================================
//  scripts/test_leave_edit_feature.js
//  Automated Verification Suite for Leave Edit Feature & Audit
// ============================================================

'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');

const LeaveService = require('../src/main/services/LeaveService');
const AuditService = require('../src/main/services/AuditService');

const liveDbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'leave-management-system', 'leave_management.db');
const scratchDir = path.join(__dirname, '..', 'scratch');
if (!fs.existsSync(scratchDir)) {
  fs.mkdirSync(scratchDir, { recursive: true });
}

const testDbPath = path.join(scratchDir, `test_leave_edit_${Date.now()}.db`);
const liveDb = new Database(liveDbPath, { readonly: true });
liveDb.exec(`VACUUM INTO '${testDbPath.replace(/\\/g, '/')}'`);
liveDb.close();

const db = new Database(testDbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');


console.log('════════════════════════════════════════════════════════════');
console.log('  🧪 RUNNING COMPREHENSIVE LEAVE EDIT TEST SUITE');
console.log('════════════════════════════════════════════════════════════\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

// ── Step 1: Baseline Real Data Inspection ───────────────────
let initialEmployees = [];
let initialLeaves = [];

runTest('1. Baseline Check: Verify 4 real employees & existing leaves', () => {
  initialEmployees = db.prepare('SELECT EmployeeID, FullName, IsActive FROM Employees ORDER BY EmployeeID').all();
  initialLeaves = db.prepare('SELECT LeaveID, EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount FROM Leaves ORDER BY LeaveID').all();

  assert.strictEqual(initialEmployees.length, 4, `Expected 4 employees, found ${initialEmployees.length}`);
  console.log(`     Real Employees count: ${initialEmployees.length}`);
  console.log(`     Real Leaves count: ${initialLeaves.length}`);
});

// ── Step 2: Isolated Test Setup ─────────────────────────────
let testEmpId = null;
let testLeaveId = null;

try {
  runTest('2. Setup: Create isolated test employee', () => {
    // Clean any previous test employee
    db.prepare("DELETE FROM Employees WHERE FullName LIKE 'TEST_EMP_EDIT_%'").run();

    const insertEmp = db.prepare(`
      INSERT INTO Employees (FullName, Gender, HireDate, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, IsActive, AdjustmentDays)
      VALUES ('TEST_EMP_EDIT_ISOLATED', 'Male', '2025-01-01', 'مطور اختبار', 'بغداد', '99999', 'مدير الاختبار', 1, 0)
    `).run();

    testEmpId = Number(insertEmp.lastInsertRowid);
    assert(testEmpId > 0, 'Failed to create test employee');
    console.log(`     Created test employee ID: ${testEmpId}`);
  });

  runTest('3. Setup: Create initial regular leave (3 days)', () => {
    const regType = db.prepare("SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة اعتيادية'").get();
    assert(regType, 'Regular leave type not found');

    const insertLeave = db.prepare(`
      INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, LeaveApprover, Notes)
      VALUES (?, ?, '2026-09-01', '2026-09-03', 3, 'مدير الاختبار', 'إجازة اختبار أولية')
    `).run(testEmpId, regType.LeaveTypeID);

    testLeaveId = Number(insertLeave.lastInsertRowid);
    assert(testLeaveId > 0, 'Failed to create test leave');
    console.log(`     Created test leave ID: ${testLeaveId}`);
  });

  // ── Step 3: Test Modifier Name Mandatory Check ─────────────
  runTest('4. Mandatory Check: Rejects update without modifierName (empty or whitespace)', () => {
    assert.throws(() => {
      LeaveService.updateLeave(testLeaveId, {
        startDate: '2026-09-01',
        endDate: '2026-09-04',
        requestedDays: 4,
        modifierName: '',
      }, db);
    }, /اسم القائم بالتعديل إلزامي/);

    assert.throws(() => {
      LeaveService.updateLeave(testLeaveId, {
        startDate: '2026-09-01',
        endDate: '2026-09-04',
        requestedDays: 4,
        modifierName: '    ',
      }, db);
    }, /اسم القائم بالتعديل إلزامي/);
  });

  // ── Step 4: Test Normal Update & Audit Logging ─────────────
  runTest('5. Update: Modify dates from 3 days to 5 days with modifier name', () => {
    const res = LeaveService.updateLeave(testLeaveId, {
      startDate: '2026-09-01',
      endDate: '2026-09-05',
      requestedDays: 5,
      notes: 'تم تمديد الإجازة يومين إضافيين',
      modifierName: 'علي أحمد (شعبة الإجازات)',
      confirmExcess: false,
    }, db);

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.quotaExceeded, false);

    const updated = db.prepare('SELECT * FROM Leaves WHERE LeaveID = ?').get(testLeaveId);
    assert.strictEqual(updated.StartDate, '2026-09-01');
    assert.strictEqual(updated.EndDate, '2026-09-05');
    assert.strictEqual(updated.DaysCount, 5);
    assert.strictEqual(updated.Notes, 'تم تمديد الإجازة يومين إضافيين');

    // Verify AuditLog
    const auditRow = db.prepare(`
      SELECT * FROM AuditLogs
      WHERE EntityType = 'Leave' AND EntityID = ? AND ActionType = 'UPDATE'
      ORDER BY LogID DESC LIMIT 1
    `).get(testLeaveId);

    assert(auditRow, 'Audit log row not found');
    assert(auditRow.Details.includes('علي أحمد (شعبة الإجازات)'), `Modifier name missing from audit details: ${auditRow.Details}`);
    assert(auditRow.Details.includes('5'), `New days count missing from audit details: ${auditRow.Details}`);

    const newSnapshot = JSON.parse(auditRow.NewValue);
    assert.strictEqual(newSnapshot.ModifiedBy, 'علي أحمد (شعبة الإجازات)');
    assert.strictEqual(newSnapshot.DaysCount, 5);
  });

  // ── Step 5: Test Quota Exceeded & Soft Limit Confirmation ──
  runTest('6. Balance Check: Detects quota deficit and returns confirmation requirement', () => {
    // The employee hired 2025-01-01 has ~61 days balance. Let's request 100 days.
    const res = LeaveService.updateLeave(testLeaveId, {
      startDate: '2026-09-01',
      endDate: '2026-12-09',
      requestedDays: 100,
      modifierName: 'علي أحمد',
      confirmExcess: false,
    }, db);

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.requiresConfirmation, true);
    assert.strictEqual(res.quotaExceeded, true);
    assert(res.deficit > 0, `Deficit should be > 0, got ${res.deficit}`);
    assert(res.message.includes('يتجاوز الرصيد'), `Message should mention excess, got ${res.message}`);

    // Verify leaves row was NOT modified yet
    const row = db.prepare('SELECT DaysCount FROM Leaves WHERE LeaveID = ?').get(testLeaveId);
    assert.strictEqual(row.DaysCount, 5, 'DaysCount should remain 5 prior to confirmation');
  });

  runTest('7. Soft Limit Confirmation: Successfully saves with confirmExcess: true', () => {
    const res = LeaveService.updateLeave(testLeaveId, {
      startDate: '2026-09-01',
      endDate: '2026-12-09',
      requestedDays: 100,
      modifierName: 'علي أحمد',
      confirmExcess: true,
    }, db);

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.quotaExceeded, true);

    const row = db.prepare('SELECT DaysCount, EndDate FROM Leaves WHERE LeaveID = ?').get(testLeaveId);
    assert.strictEqual(row.DaysCount, 100);
    assert.strictEqual(row.EndDate, '2026-12-09');
  });

  // ── Step 6: Test getActiveLeavesForToday returns all fields ──
  runTest('8. Active Leaves Query: Includes LeaveID and detail columns', () => {
    const activeLeaves = LeaveService.getActiveLeavesForToday(db);
    assert(Array.isArray(activeLeaves), 'Active leaves should be an array');
    
    // Find our test leave
    const testActive = activeLeaves.find(l => l.LeaveID === testLeaveId);
    assert(testActive, 'Test leave should appear in active leaves today');
    assert.strictEqual(testActive.LeaveID, testLeaveId);
    assert.strictEqual(testActive.DaysCount, 100);
    assert.strictEqual(testActive.EmployeeID, testEmpId);
    assert(testActive.LeaveName, 'LeaveName should be populated');
  });

  // ── Step 7: Test Switching to Sick Leave & Bucket deductions ─
  runTest('9. Type Switch: Switch to Sick Leave and verify balance handling', () => {
    const res = LeaveService.updateLeave(testLeaveId, {
      leaveType: 'إجازة مرضية',
      startDate: '2026-09-01',
      endDate: '2026-09-10',
      requestedDays: 10,
      modifierName: 'سارة خالد (التدقيق)',
      confirmExcess: false,
    }, db);

    assert.strictEqual(res.success, true);
    const updated = db.prepare('SELECT lt.Name as TypeName, l.DaysCount FROM Leaves l JOIN LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID WHERE l.LeaveID = ?').get(testLeaveId);
    assert.strictEqual(updated.TypeName, 'إجازة مرضية');
    assert.strictEqual(updated.DaysCount, 10);

    // Check sick balance deduction in LeaveBalances
    const sickBal = db.prepare('SELECT TotalBalance FROM LeaveBalances WHERE EmployeeID = ? AND PayPercentage = 100').get(testEmpId);
    assert.strictEqual(sickBal.TotalBalance, 18, `Expected 28 - 10 = 18, got ${sickBal.TotalBalance}`);
  });

} finally {
  // ── Step 8: Clean up all isolated test data ────────────────
  console.log('\n  🧹 Cleaning up isolated test data...');
  if (testLeaveId) {
    db.prepare('DELETE FROM Leaves WHERE LeaveID = ?').run(testLeaveId);
    db.prepare("DELETE FROM AuditLogs WHERE EntityType = 'Leave' AND EntityID = ?").run(testLeaveId);
  }
  if (testEmpId) {
    db.prepare('DELETE FROM LeaveBalances WHERE EmployeeID = ?').run(testEmpId);
    db.prepare('DELETE FROM Employees WHERE EmployeeID = ?').run(testEmpId);
    db.prepare("DELETE FROM AuditLogs WHERE EntityType = 'Employee' AND EntityID = ?").run(testEmpId);
  }
  console.log('  ✨ Clean up complete.\n');
}

// ── Step 9: Post-verification of Real Employees & Leaves ────
runTest('10. Integrity Verification: 4 real employees & existing leaves remain 100% intact', () => {
  const currentEmployees = db.prepare('SELECT EmployeeID, FullName, IsActive FROM Employees ORDER BY EmployeeID').all();
  const currentLeaves = db.prepare('SELECT LeaveID, EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount FROM Leaves ORDER BY LeaveID').all();

  assert.strictEqual(currentEmployees.length, initialEmployees.length, `Employee count mismatch: ${currentEmployees.length} vs ${initialEmployees.length}`);
  assert.strictEqual(currentLeaves.length, initialLeaves.length, `Leaves count mismatch: ${currentLeaves.length} vs ${initialLeaves.length}`);

  for (let i = 0; i < initialEmployees.length; i++) {
    assert.strictEqual(currentEmployees[i].EmployeeID, initialEmployees[i].EmployeeID);
    assert.strictEqual(currentEmployees[i].FullName, initialEmployees[i].FullName);
  }

  for (let i = 0; i < initialLeaves.length; i++) {
    assert.strictEqual(currentLeaves[i].LeaveID, initialLeaves[i].LeaveID);
    assert.strictEqual(currentLeaves[i].StartDate, initialLeaves[i].StartDate);
    assert.strictEqual(currentLeaves[i].EndDate, initialLeaves[i].EndDate);
    assert.strictEqual(currentLeaves[i].DaysCount, initialLeaves[i].DaysCount);
  }

  console.log(`     Verified: ${currentEmployees.length} Real Employees & ${currentLeaves.length} Real Leaves fully preserved.`);
});

console.log('\n════════════════════════════════════════════════════════════');
console.log(`  🎉 ALL TESTS PASSED! (${passedTests}/${totalTests})`);
console.log('════════════════════════════════════════════════════════════\n');
