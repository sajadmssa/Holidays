/**
 * verify_all_axes.js
 * Comprehensive automated verification script for axes A, B, C, D, E.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

console.log('====================================================');
console.log('   COMPREHENSIVE VERIFICATION SUITE (AXES A - E)   ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
    totalTests++;
    if (condition) {
        console.log(`✅ PASS: ${message}`);
        passedTests++;
    } else {
        console.error(`❌ FAIL: ${message}`);
        process.exitCode = 1;
    }
}

// ──────────────────────────────────────────────────────────────
// 1. Check Axis B Fix (Typo correction)
// ──────────────────────────────────────────────────────────────
console.log('--- 1. Checking Axis B Fix (dashboardTab.js Typo Correction) ---');
const dashboardTabContent = fs.readFileSync(path.join(__dirname, '../src/renderer/modules/dashboardTab.js'), 'utf8');
assert(!dashboardTabContent.includes('editLeaveOrderDateDateEl'), 'No reference to erroneous "editLeaveOrderDateDateEl" exists');
assert(dashboardTabContent.includes('editLeaveOrderDateEl'), 'Correct reference to "editLeaveOrderDateEl" is present');
assert(dashboardTabContent.includes('btn-filter-urgent-resumption'), 'Urgent resumption filter is wired in dashboardTab.js');
assert(dashboardTabContent.includes('dashboard-sort-select'), 'Dashboard sort select is wired in dashboardTab.js');

// ──────────────────────────────────────────────────────────────
// 2. Check Axis A Fix (All Employees Auto-load & Callbacks)
// ──────────────────────────────────────────────────────────────
console.log('\n--- 2. Checking Axis A Fix (All Employees Auto-load & Callbacks) ---');
const rendererContent = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
assert(rendererContent.includes("loadAllEmployees(1)"), 'loadAllEmployees(1) is called when switching to tab-all-employees');
assert(rendererContent.includes("onEmployeeAdded"), 'onEmployeeAdded callback connected in renderer.js');
assert(rendererContent.includes("onEmployeeUpdated"), 'onEmployeeUpdated callback connected in renderer.js');

const addEmployeeContent = fs.readFileSync(path.join(__dirname, '../src/renderer/modules/addEmployeeTab.js'), 'utf8');
assert(addEmployeeContent.includes("onEmployeeAdded(payload.employeeId)"), 'addEmployeeTab calls onEmployeeAdded(payload.employeeId) on success');

const manageEmployeeContent = fs.readFileSync(path.join(__dirname, '../src/renderer/modules/manageEmployeeTab.js'), 'utf8');
assert(manageEmployeeContent.includes("onEmployeeUpdated(currentManagingEmpId)"), 'manageEmployeeTab calls onEmployeeUpdated(currentManagingEmpId) on update/toggle');

// ──────────────────────────────────────────────────────────────
// 3. Check Axis C Text Renaming in index.html & renderer.js
// ──────────────────────────────────────────────────────────────
console.log('\n--- 3. Checking Axis C Fix (Renaming to "الإجازات حالياً") ---');
const indexHtmlContent = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
assert(indexHtmlContent.includes('<span class="tab-label">الإجازات حالياً</span>'), 'Sidebar tab button text updated to "الإجازات حالياً"');
assert(indexHtmlContent.includes('<h3>الإجازات حالياً</h3>'), 'Card panel header updated to "الإجازات حالياً"');
assert(indexHtmlContent.includes('<span>تصدير الإجازات حالياً إلى Excel</span>'), 'Export button text updated to "تصدير الإجازات حالياً إلى Excel"');
assert(rendererContent.includes("'tab-dashboard': 'الإجازات حالياً'"), 'VIEW_TITLES for tab-dashboard set to "الإجازات حالياً"');
assert(!indexHtmlContent.includes('المجازون اليوم'), 'Zero occurrences of legacy "المجازون اليوم" in index.html');
assert(!dashboardTabContent.includes('المجازون اليوم'), 'Zero occurrences of legacy "المجازون اليوم" in dashboardTab.js');

// ──────────────────────────────────────────────────────────────
// 4. Test LeaveService & Audit Logs with Official Migrations
// ──────────────────────────────────────────────────────────────
console.log('\n--- 4. Testing LeaveService & Audit Logs with Official Migrations ---');
const testDbPath = path.join(__dirname, 'test_isolated.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

const db = new Database(testDbPath);
db.pragma('foreign_keys = ON');

// Apply all official migrations safely (like database.js does)
const migrationsDir = path.join(__dirname, '../src/main/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    try {
        db.exec(sql);
    } catch (err) {
        if (err.message.includes('duplicate column name')) {
            // expected when column was already added in initial schema
        } else {
            throw err;
        }
    }
}

// Ensure standard leave types
db.exec(`
    INSERT OR IGNORE INTO LeaveTypes (LeaveTypeID, Name, MaxDaysPerInstance, RequiresOrderRef) 
    VALUES (1, 'إجازة اعتيادية', 30, 0), (29, 'إجازة مرضية', 30, 0);
`);

const regularType = db.prepare("SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة اعتيادية'").get();
const sickType = db.prepare("SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة مرضية'").get();
const regularTypeId = regularType.LeaveTypeID;
const sickTypeId = sickType.LeaveTypeID;

// Insert test employees matching schema
db.exec(`
    INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, AdjustmentDays, IsActive) VALUES 
        (1, 'أحمد محمود', 'Male', '2020-01-01', 'مهندس برمجيات', 'بغداد', 'CARD-001', 'المدير العام', 0, 1),
        (2, 'سارة خالد', 'Female', '2021-01-01', 'محاسب مالي', 'البصرة', 'CARD-002', 'المدير العام', 0, 1),
        (3, 'بلال عثمان', 'Male', '2019-01-01', 'إداري موارد', 'أربيل', 'CARD-003', 'مدير الموارد', 0, 1),
        (4, 'جمال يوسف', 'Male', '2018-01-01', 'مشرف تشغيل', 'الموصل', 'CARD-004', 'مدير العمليات', 0, 1);
`);

// Insert leaves with relative dates to test proximity and sorting
const today = new Date();
function formatDate(d) {
    return d.toISOString().split('T')[0];
}
function addDays(d, n) {
    const res = new Date(d);
    res.setDate(res.getDate() + n);
    return res;
}

const startPast = formatDate(addDays(today, -5));
const end1Day = formatDate(addDays(today, 1));   // 1 day left (urgent)
const end2Days = formatDate(addDays(today, 2));  // 2 days left (urgent)
const end10Days = formatDate(addDays(today, 10)); // 10 days left (not urgent)
const end15Days = formatDate(addDays(today, 15)); // 15 days left (not urgent)

db.exec(`
    INSERT INTO Leaves (LeaveID, EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, OrderNumber, OrderDate, Notes) VALUES
        (1, 1, ${regularTypeId}, '${startPast}', '${end2Days}', 8, 'ORD-101', '2026-09-01', 'ملاحظة 1'),
        (2, 2, ${regularTypeId}, '${startPast}', '${end1Day}', 7, 'ORD-102', '2026-09-01', 'ملاحظة 2'),
        (3, 3, ${regularTypeId}, '${startPast}', '${end15Days}', 21, 'ORD-103', '2026-09-01', 'ملاحظة 3'),
        (4, 4, ${sickTypeId}, '${startPast}', '${end10Days}', 16, 'ORD-104', '2026-09-01', 'ملاحظة 4');
`);

const LeaveService = require('../src/main/services/LeaveService');

// Test A: Normal query (all active leaves)
const allActive = LeaveService.getActiveLeavesTodayPaginated({ page: 1, pageSize: 10, sortBy: 'resumption_asc' }, db);
assert(allActive && allActive.data && allActive.data.length === 4, `Found 4 active leaves total (got ${allActive && allActive.data ? allActive.data.length : 0})`);
assert(allActive.data[0].FullName === 'سارة خالد', `Default sort (resumption_asc) puts earliest return first: ${allActive.data[0].FullName}`);
assert(allActive.data[3].FullName === 'بلال عثمان', `Default sort puts latest return last: ${allActive.data[3].FullName}`);

// Test B: Filter Urgent Only (<= 3 days)
const urgentOnly = LeaveService.getActiveLeavesTodayPaginated({ page: 1, pageSize: 10, urgentOnly: true, sortBy: 'resumption_asc' }, db);
assert(urgentOnly && urgentOnly.data && urgentOnly.data.length === 2, `Urgent filter returned exactly 2 leaves (<= 3 days remaining)`);
assert(urgentOnly.data.every(l => l.DaysRemaining <= 3), 'All returned leaves have DaysRemaining <= 3');

// Test C: Sort Descending (resumption_desc)
const sortDesc = LeaveService.getActiveLeavesTodayPaginated({ page: 1, pageSize: 10, sortBy: 'resumption_desc' }, db);
assert(sortDesc.data[0].FullName === 'بلال عثمان', `Sort resumption_desc puts furthest return first: ${sortDesc.data[0].FullName}`);

// Test D: Sort Alphabetical (name_asc)
const sortName = LeaveService.getActiveLeavesTodayPaginated({ page: 1, pageSize: 10, sortBy: 'name_asc' }, db);
assert(sortName.data[0].FullName === 'أحمد محمود', `Sort name_asc puts أحمد محمود first: ${sortName.data[0].FullName}`);
assert(sortName.data[1].FullName === 'بلال عثمان', `Sort name_asc puts بلال عثمان second: ${sortName.data[1].FullName}`);

// Test E: Update Leave & Verify Audit Log Entry
const updateResult = LeaveService.updateLeave(1, {
    leaveType: regularTypeId,
    startDate: startPast,
    endDate: end2Days,
    requestedDays: 8,
    orderNumber: 'ORD-101-UPDATED',
    orderDate: '2026-09-05',
    notes: 'تم تحديث البيانات للتجربة',
    modifierName: 'المسؤول التجريبي'
}, db);

assert(updateResult.success, 'Leave updated successfully without errors');

// Verify DB values
const updatedLeave = db.prepare('SELECT * FROM Leaves WHERE LeaveID = 1').get();
assert(updatedLeave.OrderNumber === 'ORD-101-UPDATED', 'OrderNumber updated in Leaves table');
assert(updatedLeave.Notes === 'تم تحديث البيانات للتجربة', 'Notes updated in Leaves table');

// Verify Audit Log entry
const auditEntry = db.prepare('SELECT * FROM AuditLogs WHERE EntityID = 1 ORDER BY LogID DESC LIMIT 1').get();
assert(auditEntry !== undefined, 'Audit log entry created for leave update');
assert(auditEntry.ActionType === 'UPDATE', `Audit log ActionType is UPDATE (got ${auditEntry ? auditEntry.ActionType : 'none'})`);
assert(auditEntry.EntityType === 'Leave', `Audit log EntityType is Leave (got ${auditEntry ? auditEntry.EntityType : 'none'})`);
assert(auditEntry.Details.includes('المسؤول التجريبي'), `Audit log Details includes modifier name: ${auditEntry.Details}`);

// Clean up test DB
db.close();
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

// ──────────────────────────────────────────────────────────────
// 5. Verify Production Real Database Integrity
// ──────────────────────────────────────────────────────────────
console.log('\n--- 5. Verifying Production Database Integrity ---');
const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
const realDbPath = path.join(appData, 'leave-management-system', 'leave_management.db');

if (fs.existsSync(realDbPath)) {
    try {
        const realDb = new Database(realDbPath);
        const empCount = realDb.prepare('SELECT COUNT(*) as cnt FROM Employees WHERE IsActive = 1').get().cnt;
        const leaveCount = realDb.prepare('SELECT COUNT(*) as cnt FROM Leaves').get().cnt;
        const emps = realDb.prepare('SELECT EmployeeID, FullName FROM Employees WHERE IsActive = 1').all();
        console.log('Real active employees in production DB:', emps.map(e => `#${e.EmployeeID} ${e.FullName}`).join(', '));
        assert(empCount === 4, `Real database has exactly 4 active employees (found ${empCount})`);
        assert(leaveCount >= 4, `Real database has original leaves intact (found ${leaveCount} leaves)`);
        realDb.close();
    } catch (e) {
        console.log('Real DB access note:', e.message);
    }
} else {
    console.log(`Note: Real DB path not found at ${realDbPath}`);
}

// ──────────────────────────────────────────────────────────────
// 6. Verify CSS Styles & Tokens (Axis E)
// ──────────────────────────────────────────────────────────────
console.log('\n--- 6. Checking Axis E (CSS Styles, Tokens & Heights) ---');
const stylesContent = fs.readFileSync(path.join(__dirname, '../src/renderer/styles.css'), 'utf8');
assert(!stylesContent.includes('--bg-surface'), 'No bogus CSS variable --bg-surface in styles.css');
assert(!stylesContent.includes('--border-color'), 'No bogus CSS variable --border-color in styles.css');
assert(!stylesContent.includes('--text-primary'), 'No bogus CSS variable --text-primary in styles.css');
assert(stylesContent.includes('.btn-search-trigger'), '.btn-search-trigger is defined');
assert(stylesContent.includes('min-height: 42px'), '42px height constraint applied');
assert(stylesContent.includes(':root:not([data-theme="light"]):not([data-theme="dark"])'), 'Safe dark mode media query fallback scoped');

console.log(`\n====================================================`);
console.log(`   SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log(`====================================================\n`);
if (passedTests === totalTests) {
    console.log('🎉 ALL CHECKS AND REQUIREMENTS PASSED PERFECTLY!');
}
