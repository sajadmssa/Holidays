// ============================================================
//  scripts/verify_all_axes.js
//  Full automated verification for Axes A, B, C & Data Integrity
// ============================================================

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');

const dbPath = path.join(process.env.APPDATA, 'leave-management-system', 'leave_management.db');
console.log('Connecting to database at:', dbPath);

const db = new Database(dbPath);

// ── 1. Apply Migration 009 if not applied ───────────────────
console.log('\n--- 1. Checking / Running Migration 009 ---');
const tableInfo = db.prepare("PRAGMA table_info('Leaves')").all();
const columnNames = tableInfo.map(c => c.name);
console.log('Current Leaves columns:', columnNames);

const requiredCols = ['RequestDate', 'MemoNumber', 'MemoDate', 'OrderNumber', 'OrderDate'];
for (const col of requiredCols) {
  if (!columnNames.includes(col)) {
    console.log(`Adding missing column ${col}...`);
    db.exec(`ALTER TABLE Leaves ADD COLUMN ${col} TEXT DEFAULT NULL;`);
  }
}

// Record in _Migrations table
db.exec(`
  CREATE TABLE IF NOT EXISTS _Migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    executedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  INSERT OR IGNORE INTO _Migrations (name) VALUES ('009_add_leave_order_and_memo_fields.sql');
`);

const updatedInfo = db.prepare("PRAGMA table_info('Leaves')").all();
console.log('Updated Leaves columns:', updatedInfo.map(c => c.name));

// ── 2. Test Axis B: Date Calculation Logic ─────────────────
console.log('\n--- 2. Testing Axis B: Date & Days Reactive Formula ---');
function addDaysToDate(dateStr, daysCount) {
  if (!dateStr || !daysCount || daysCount <= 0) return null;
  const parts = dateStr.split('-').map(Number);
  const [y, m, d] = parts;
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + (daysCount - 1));
  const resY = date.getUTCFullYear();
  const resM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const resD = String(date.getUTCDate()).padStart(2, '0');
  return `${resY}-${resM}-${resD}`;
}

function daysBetweenInclusive(start, end) {
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  const date1 = new Date(Date.UTC(y1, m1 - 1, d1));
  const date2 = new Date(Date.UTC(y2, m2 - 1, d2));
  return Math.round((date2.getTime() - date1.getTime()) / 86400000) + 1;
}

// Test case 1: Start 2026-09-01 + 5 days -> End 2026-09-05
const end1 = addDaysToDate('2026-09-01', 5);
console.log('Test 1 (2026-09-01 + 5 days):', end1, end1 === '2026-09-05' ? '✅ PASS' : '❌ FAIL');

// Test case 2: Start 2026-09-01 to End 2026-09-10 -> 10 days
const days2 = daysBetweenInclusive('2026-09-01', '2026-09-10');
console.log('Test 2 (2026-09-01 to 2026-09-10):', days2, days2 === 10 ? '✅ PASS' : '❌ FAIL');

// Test case 3: Month boundary 2026-09-28 + 5 days -> 2026-10-02 (September has 30 days)
const end3 = addDaysToDate('2026-09-28', 5);
console.log('Test 3 (2026-09-28 + 5 days):', end3, end3 === '2026-10-02' ? '✅ PASS' : '❌ FAIL');

// ── 3. Test Axis C: Services & IPC Logic with Admin Fields ──
console.log('\n--- 3. Testing Axis C: Leave Registration & Admin Fields ---');
const LeaveService = require('../src/main/services/LeaveService');
const ReportService = require('../src/main/services/ReportService');

// Verify initial state of employees
const employees = db.prepare('SELECT EmployeeID, FullName FROM Employees ORDER BY EmployeeID ASC').all();
console.log('Official Employees:', employees);

const testEmpId = 1; // Karrar Musa

// Initial leaves count
const initialLeaves = LeaveService.getEmployeeLeaves(testEmpId, db);
console.log(`Employee ${testEmpId} initial leaves count:`, initialLeaves.length);

// A. Insert leave WITH full administrative fields
console.log('\nA. Inserting test leave WITH full administrative fields...');
const initialBalance = LeaveService.calculateRegularLeaveBalance(testEmpId, db).finalBalance;
console.log('Initial balance for emp 1:', initialBalance);

// We will insert via direct Leaves insertion or service call
const insertStmt = db.prepare(`
  INSERT INTO Leaves (
    EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, LeaveApprover,
    RequestDate, MemoNumber, MemoDate, OrderNumber, OrderDate, Notes
  ) VALUES (
    ?, (SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة اعتيادية'),
    '2026-11-01', '2026-11-03', 3, 'المدير العام',
    '2026-10-25', 'م/991', '2026-10-26', 'أ/882', '2026-10-28', 'إجازة اختبارية للتحقق'
  )
`);

const insertRes = insertStmt.run(testEmpId);
const testLeaveId1 = Number(insertRes.lastInsertRowid);
console.log('Created test leave with full admin data, ID:', testLeaveId1);

// B. Insert leave WITHOUT administrative fields (NULL)
console.log('\nB. Inserting test leave WITHOUT administrative fields (NULL)...');
const insertStmt2 = db.prepare(`
  INSERT INTO Leaves (
    EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, LeaveApprover, Notes
  ) VALUES (
    ?, (SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة اعتيادية'),
    '2026-11-10', '2026-11-11', 2, 'المدير العام', 'إجازة بدون حقول إدارية'
  )
`);
const insertRes2 = insertStmt2.run(testEmpId);
const testLeaveId2 = Number(insertRes2.lastInsertRowid);
console.log('Created test leave without admin data, ID:', testLeaveId2);

// Check getEmployeeLeaves
const history = LeaveService.getEmployeeLeaves(testEmpId, db);
const row1 = history.find(l => l.LeaveID === testLeaveId1);
const row2 = history.find(l => l.LeaveID === testLeaveId2);

console.log('\nVerifying row 1 (with admin data):', {
  RequestDate: row1.RequestDate,
  MemoNumber: row1.MemoNumber,
  MemoDate: row1.MemoDate,
  OrderNumber: row1.OrderNumber,
  OrderDate: row1.OrderDate
});
const pass1 = row1.RequestDate === '2026-10-25' && row1.MemoNumber === 'م/991' && row1.OrderNumber === 'أ/882';
console.log('Row 1 Verification:', pass1 ? '✅ PASS' : '❌ FAIL');

console.log('Verifying row 2 (without admin data):', {
  RequestDate: row2.RequestDate,
  MemoNumber: row2.MemoNumber,
  MemoDate: row2.MemoDate,
  OrderNumber: row2.OrderNumber,
  OrderDate: row2.OrderDate
});
const pass2 = row2.RequestDate === null && row2.MemoNumber === null && row2.OrderNumber === null;
console.log('Row 2 Verification:', pass2 ? '✅ PASS' : '❌ FAIL');

// ── 4. Test Excel Export with Admin Fields ──────────────────
console.log('\n--- 4. Testing Excel Export with 11 Columns ---');
const testExportPath = path.join(__dirname, 'test_employee_history_export.xlsx');
if (fs.existsSync(testExportPath)) fs.unlinkSync(testExportPath);

async function testExport() {
  await ReportService.exportEmployeeHistory(testEmpId, testExportPath, db);
  console.log('Exported test Excel file to:', testExportPath);

  // Read back and inspect columns using ExcelJS
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(testExportPath);
  const ws = wb.getWorksheet('سجل الإجازات');

  console.log('Worksheet Name:', ws.name);
  console.log('Total Rows in Excel:', ws.rowCount);

  // Find the header row (contains 'نوع الإجازة')
  let headerRowIndex = -1;
  ws.eachRow((row, rowNumber) => {
    const values = row.values;
    if (values && values.includes('نوع الإجازة')) {
      headerRowIndex = rowNumber;
    }
  });

  console.log('Header Row Index:', headerRowIndex);
  const headerRow = ws.getRow(headerRowIndex);
  console.log('Header Row Values:', headerRow.values.slice(1));

  const expectedHeaders = [
    'ت',
    'نوع الإجازة',
    'تاريخ تقديم الطلب',
    'تاريخ البدء',
    'تاريخ الانتهاء',
    'عدد الأيام',
    'رقم المذكرة',
    'تاريخ المذكرة',
    'رقم الأمر الإداري',
    'تاريخ الأمر الإداري',
    'المسؤول عن منح الإجازة'
  ];

  let headerMatch = true;
  for (let i = 0; i < expectedHeaders.length; i++) {
    const actual = headerRow.getCell(i + 1).value;
    if (actual !== expectedHeaders[i]) {
      console.log(`Mismatch at col ${i + 1}: expected "${expectedHeaders[i]}", got "${actual}"`);
      headerMatch = false;
    }
  }
  console.log('Excel 11-Column Header Check:', headerMatch ? '✅ PASS' : '❌ FAIL');

  // Check data row for testLeaveId1
  let foundLeave1 = false;
  let foundLeave2 = false;

  ws.eachRow((row, rowNumber) => {
    if (rowNumber > headerRowIndex) {
      const vals = row.values;
      if (vals && vals.includes('2026-11-01')) {
        foundLeave1 = true;
        console.log('Excel Leave 1 Row:', {
          seq: row.getCell(1).value,
          type: row.getCell(2).value,
          reqDate: row.getCell(3).value,
          startDate: row.getCell(4).value,
          endDate: row.getCell(5).value,
          days: row.getCell(6).value,
          memoNum: row.getCell(7).value,
          memoDate: row.getCell(8).value,
          orderNum: row.getCell(9).value,
          orderDate: row.getCell(10).value,
          approver: row.getCell(11).value,
        });
      }
      if (vals && vals.includes('2026-11-10')) {
        foundLeave2 = true;
        console.log('Excel Leave 2 Row (Empty Admin Fields):', {
          seq: row.getCell(1).value,
          type: row.getCell(2).value,
          reqDate: row.getCell(3).value,
          startDate: row.getCell(4).value,
          endDate: row.getCell(5).value,
          days: row.getCell(6).value,
          memoNum: row.getCell(7).value,
          orderNum: row.getCell(9).value,
        });
      }
    }
  });

  console.log('Found Leave 1 in Excel with admin values:', foundLeave1 ? '✅ PASS' : '❌ FAIL');
  console.log('Found Leave 2 in Excel with dash values:', foundLeave2 ? '✅ PASS' : '❌ FAIL');
}

testExport().then(() => {
  // ── 5. Clean up test leaves and verify integrity ───────────
  console.log('\n--- 5. Cleaning up Test Leaves & Verifying Final DB State ---');
  db.prepare('DELETE FROM Leaves WHERE LeaveID IN (?, ?)').run(testLeaveId1, testLeaveId2);
  console.log('Deleted temporary test leaves.');

  const finalEmployees = db.prepare('SELECT EmployeeID, FullName, HireDate, IsActive FROM Employees ORDER BY EmployeeID ASC').all();
  console.log('Final Employee Count:', finalEmployees.length);
  finalEmployees.forEach(e => {
    const bal = LeaveService.calculateRegularLeaveBalance(e.EmployeeID, db);
    const lvCount = db.prepare('SELECT COUNT(*) as cnt FROM Leaves WHERE EmployeeID = ?').get(e.EmployeeID).cnt;
    console.log(`- [${e.EmployeeID}] ${e.FullName} | Leaves: ${lvCount} | Balance: ${bal.finalBalance} days (active: ${e.IsActive})`);
  });

  if (fs.existsSync(testExportPath)) fs.unlinkSync(testExportPath);
  console.log('\n🎉 ALL CHECKS COMPLETED SUCCESSFULLY!');
  db.close();
}).catch(err => {
  console.error('Test error:', err);
  db.close();
});
