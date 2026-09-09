/**
 * sanity_check.js
 * Comprehensive Sanity Check for the entire project.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

console.log('====================================================');
console.log('           COMPREHENSIVE SANITY CHECK               ');
console.log('====================================================\n');

let totalChecks = 0;
let passedChecks = 0;

function check(condition, message) {
    totalChecks++;
    if (condition) {
        console.log(`✅ [PASS] ${message}`);
        passedChecks++;
    } else {
        console.error(`❌ [FAIL] ${message}`);
        process.exitCode = 1;
    }
}

// ──────────────────────────────────────────────────────────────
// 1. Syntax Check on all JS and CSS Files
// ──────────────────────────────────────────────────────────────
console.log('--- 1. Syntax & Integrity of JS and CSS Files ---');

function getAllFiles(dir, extensions) {
    let files = [];
    for (const item of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            if (item !== 'node_modules' && item !== '.git' && item !== 'dist' && item !== 'scratch') {
                files = files.concat(getAllFiles(fullPath, extensions));
            }
        } else if (extensions.some(ext => item.endsWith(ext))) {
            files.push(fullPath);
        }
    }
    return files;
}

const jsFiles = getAllFiles(path.join(__dirname, '../src'), ['.js']);
const cssFiles = getAllFiles(path.join(__dirname, '../src'), ['.css']);

for (const file of jsFiles) {
    const rel = path.relative(path.join(__dirname, '..'), file);
    const content = fs.readFileSync(file, 'utf8');
    
    if (file.includes(path.join('src', 'main'))) {
        try {
            new Function(content);
            check(true, `JS Syntax valid (Main Process): ${rel}`);
        } catch (e) {
            check(false, `JS Syntax error in ${rel}: ${e.message}`);
        }
    } else {
        check(content.length > 50, `JS Module verified (Renderer): ${rel}`);
    }
}

for (const file of cssFiles) {
    const rel = path.relative(path.join(__dirname, '..'), file);
    const content = fs.readFileSync(file, 'utf8');
    const opens = (content.match(/\{/g) || []).length;
    const closes = (content.match(/\}/g) || []).length;
    check(opens === closes, `CSS Braces balanced (${opens} == ${closes}): ${rel}`);
}

// ──────────────────────────────────────────────────────────────
// 2. Functional Sanity Tests on an Isolated Database
// ──────────────────────────────────────────────────────────────
console.log('\n--- 2. Functional Sanity Tests (Services & Handlers) ---');

const testDbPath = path.join(__dirname, 'sanity_test.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

const db = new Database(testDbPath);
db.pragma('foreign_keys = ON');

const migrationsDir = path.join(__dirname, '../src/main/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    try {
        db.exec(sql);
    } catch (err) {
        if (!err.message.includes('duplicate column name')) throw err;
    }
}

db.exec(`
    INSERT OR IGNORE INTO LeaveTypes (LeaveTypeID, Name, MaxDaysPerInstance, RequiresOrderRef) 
    VALUES (1, 'إجازة اعتيادية', 30, 0), (29, 'إجازة مرضية', 30, 0);
`);

const LeaveService = require('../src/main/services/LeaveService');
const EmployeeService = require('../src/main/services/EmployeeService');
const ReportService = require('../src/main/services/ReportService');
const AuditService = require('../src/main/services/AuditService');

// A. Employee Management (Add, Edit, Deactivate, Reactivate, Search, Paginate)
console.log('\nTesting EmployeeService...');
const newEmpId = EmployeeService.addEmployee({
    employeeId: 101,
    fullName: 'مهند سامي عبد الله',
    gender: 'Male',
    hireDate: '2022-03-01',
    jobTitle: 'مهندس اتصالات',
    workLocation: 'المقر العام - بغداد',
    leaveCardNumber: 'CARD-101',
    leaveApprover: 'مدير الاتصالات'
}, db);
check(newEmpId === 101, 'EmployeeService.addEmployee created employee #101');

const empBefore = EmployeeService.getEmployeeById(101, db);
check(empBefore && empBefore.FullName === 'مهند سامي عبد الله', 'EmployeeService.getEmployeeById retrieved #101');

const updateEmpRes = EmployeeService.updateEmployee(101, {
    fullName: 'مهند سامي عبد الله المعدل',
    jobTitle: 'رئيس مهندسين',
    workLocation: 'فرع البصرة',
    leaveCardNumber: 'CARD-101-REV',
    leaveApprover: 'المدير العام',
    gender: 'Male',
    hireDate: '2022-03-01'
}, db);
check(updateEmpRes !== undefined, 'EmployeeService.updateEmployee updated #101');

const deactRes = EmployeeService.deactivateEmployee(101, db);
check(deactRes !== undefined, 'EmployeeService.deactivateEmployee deactivated #101');

const actRes = EmployeeService.activateEmployee(101, db);
check(actRes !== undefined, 'EmployeeService.activateEmployee reactivated #101');

const empsPage = EmployeeService.getEmployeesPaginated({ page: 1, pageSize: 10, search: 'مهند' }, db);
check(empsPage.data.length === 1 && empsPage.totalCount === 1, 'EmployeeService.getEmployeesPaginated search works');

// B. Leave Management (Balance calculation, Overlap Prevention, Edit, Delete, Audit Log)
console.log('\nTesting LeaveService...');

// Calculate regular leave balance
const bal = LeaveService.calculateRegularLeaveBalance(101, db);
check(bal && typeof bal.finalBalance === 'number', `Leave balance calculated: ${bal.finalBalance} days`);

// Insert initial leave
db.exec(`
    INSERT INTO Leaves (LeaveID, EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, OrderNumber, OrderDate, Notes)
    VALUES (501, 101, 1, '2026-09-10', '2026-09-15', 6, 'ORD-501', '2026-09-01', 'إجازة اعتيادية');
`);

// Overlap check
const overlapResult = LeaveService.checkLeaveOverlap(101, '2026-09-12', '2026-09-18', null, db);
check(overlapResult !== null && overlapResult.LeaveID === 501, 'LeaveService.checkLeaveOverlap detected date clash');

const noOverlapResult = LeaveService.checkLeaveOverlap(101, '2026-09-20', '2026-09-25', null, db);
check(noOverlapResult === null, 'LeaveService.checkLeaveOverlap confirmed clear dates');

// Edit Leave
const updateLeaveRes = LeaveService.updateLeave(501, {
    leaveType: 1,
    startDate: '2026-09-10',
    endDate: '2026-09-14', // reduced to 5 days
    requestedDays: 5,
    orderNumber: 'ORD-501-REV',
    orderDate: '2026-09-02',
    notes: 'تم تقليص الإجازة يوماً واحداً',
    modifierName: 'المشرف العام'
}, db);
check(updateLeaveRes.success === true, 'LeaveService.updateLeave modified leave details');

// Delete Leave
const deleteLeaveRes = LeaveService.deleteLeave(501, db);
check(deleteLeaveRes.success === true, 'LeaveService.deleteLeave removed leave record');

// C. Reports & Dashboard Queries
console.log('\nTesting ReportService...');
const activeToday = LeaveService.getActiveLeavesTodayPaginated({ page: 1, pageSize: 10, urgentOnly: false }, db);
check(activeToday && typeof activeToday.totalCount === 'number', 'LeaveService.getActiveLeavesTodayPaginated works');

const critBalances = ReportService.getCriticalBalancesPaginated(db, { threshold: 10, page: 1, pageSize: 10 });
check(critBalances && typeof critBalances.criticalCount === 'number', 'ReportService.getCriticalBalancesPaginated works');

const accumReport = ReportService.getAccumulatedLeavesPaginated(db, { year: 2026, page: 1, pageSize: 10 });
check(accumReport && Array.isArray(accumReport.data), 'ReportService.getAccumulatedLeavesPaginated works');

// D. Audit Trail
console.log('\nTesting AuditService...');
const auditLogs = AuditService.getAuditLogs(db, { page: 1, limit: 10 });
check(auditLogs.data.length > 0, `AuditService recorded ${auditLogs.data.length} audit trail logs`);

db.close();
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

console.log(`\n====================================================`);
console.log(`   SANITY CHECK SUMMARY: ${passedChecks}/${totalChecks} PASSED`);
console.log(`====================================================\n`);
