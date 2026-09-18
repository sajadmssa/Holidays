// ============================================================
//  tests/excelNumericFormatting.test.js
//  Unit and Integration Tests for Excel Numeric Cell Formatting
//  التحقق الآلي من تصدير الأرقام الوظيفية والإضبارة كأرقام حقيقية في Excel
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

const fs = require('fs');
const path = require('path');
const os = require('os');
const ExcelJS = require('exceljs');
const Database = require('better-sqlite3');
const {
  exportAllEmployees,
  exportActiveLeavesToExcel,
  exportExpiredLeavesToExcel,
  exportCriticalReportToExcel,
  writeNumericOrTextCell,
} = require('../src/main/services/ReportService');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ PASS: ${message}`);
  passedTests++;
}

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

  // Ensure _AppSettings table has DepartmentName
  db.exec(`
    CREATE TABLE IF NOT EXISTS _AppSettings (
      Key TEXT PRIMARY KEY,
      Value TEXT
    );
    INSERT OR REPLACE INTO _AppSettings (Key, Value) VALUES ('department_name', 'مديرية التفتيش والمتابعة');
  `);

  return db;
}

async function runTests() {
  console.log('🧪 [Excel Numeric Formatting] Starting test suite...\n');

  // -------------------------------------------------------------
  // Part 1: Direct Unit Tests for writeNumericOrTextCell helper
  // -------------------------------------------------------------
  console.log('--- Unit Tests: writeNumericOrTextCell helper ---');

  const mockWorkbook = new ExcelJS.Workbook();
  const mockSheet = mockWorkbook.addWorksheet('Test');

  // Case 1: Pure integer string
  const cell1 = mockSheet.getCell('A1');
  writeNumericOrTextCell(cell1, '  123456  ');
  assert(cell1.value === 123456, 'Pure integer string converted to number 123456');
  assert(typeof cell1.value === 'number', 'cell.value is primitive type number');
  assert(cell1.type === ExcelJS.ValueType.Number, 'cell.type is ExcelJS.ValueType.Number (2)');
  assert(cell1.numFmt === '0', 'cell.numFmt is formatted as "0"');

  // Case 2: String with letters / symbols (e.g., 142/أ or ABC-99)
  const cell2 = mockSheet.getCell('A2');
  writeNumericOrTextCell(cell2, '142/أ');
  assert(cell2.value === '142/أ', 'Symbol string "142/أ" preserved as string');
  assert(typeof cell2.value === 'string', 'cell.value is primitive type string');
  assert(cell2.type === ExcelJS.ValueType.String, 'cell.type is ExcelJS.ValueType.String (5)');

  // Case 3: Null / Undefined
  const cell3 = mockSheet.getCell('A3');
  writeNumericOrTextCell(cell3, null);
  assert(cell3.value === '-', 'Null value converted to placeholder "-"');
  assert(cell3.type === ExcelJS.ValueType.String, 'Null placeholder is ExcelJS.ValueType.String');

  // Case 4: Empty / Whitespace string
  const cell4 = mockSheet.getCell('A4');
  writeNumericOrTextCell(cell4, '   ');
  assert(cell4.value === '-', 'Whitespace string converted to placeholder "-"');

  // Case 5: Already a number primitive
  const cell5 = mockSheet.getCell('A5');
  writeNumericOrTextCell(cell5, 789);
  assert(cell5.value === 789, 'Primitive number 789 handled properly');
  assert(cell5.type === ExcelJS.ValueType.Number, 'Primitive number has ExcelJS.ValueType.Number');
  assert(cell5.numFmt === '0', 'Primitive number receives numFmt "0"');

  // -------------------------------------------------------------
  // Part 2: End-to-End Export Test with exportAllEmployees
  // -------------------------------------------------------------
  console.log('\n--- Integration Tests: exportAllEmployees (.xlsx reading & validation) ---');

  const tempExcelAll = path.join(os.tmpdir(), `test_export_all_${Date.now()}.xlsx`);
  const db = createTestDb();

  try {
    // Seed mock employees covering the 3 distinct cases
    // Emp 1: Pure numeric JobNumber and DossierNumber
    const emp1Id = db.prepare(`
      INSERT INTO Employees (FullName, Gender, HireDate, JobTitle, JobNumber, DossierNumber, LeaveCardNumber, WorkLocation, IsActive)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('أحمد علي محمد', 'Male', '2020-01-01', 'مهندس', '1001', '5001', '12', 'المقر الرئيسي', 1).lastInsertRowid;

    // Emp 2: JobNumber numeric, DossierNumber containing symbol (142/أ)
    const emp2Id = db.prepare(`
      INSERT INTO Employees (FullName, Gender, HireDate, JobTitle, JobNumber, DossierNumber, LeaveCardNumber, WorkLocation, IsActive)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('سارة حسن إبراهيم', 'Female', '2021-01-01', 'باحثة', '1002', '142/أ', '15', 'فرع البصرة', 1).lastInsertRowid;

    // Emp 3: NULL JobNumber and DossierNumber
    const emp3Id = db.prepare(`
      INSERT INTO Employees (FullName, Gender, HireDate, JobTitle, JobNumber, DossierNumber, LeaveCardNumber, WorkLocation, IsActive)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('محمود جاسم كريم', 'Male', '2022-01-01', 'إداري', null, null, '18', 'فرع نينوى', 1).lastInsertRowid;

    // Export to Excel
    await exportAllEmployees(tempExcelAll, db, { search: '' });
    assert(fs.existsSync(tempExcelAll), 'Exported Excel file successfully created on disk');

    // Read back workbook
    const readWorkbook = new ExcelJS.Workbook();
    await readWorkbook.xlsx.readFile(tempExcelAll);
    const ws = readWorkbook.getWorksheet(1);
    assert(ws !== undefined, 'First worksheet exists in exported workbook');

    // Find data rows
    let rowEmp1 = null;
    let rowEmp2 = null;
    let rowEmp3 = null;

    ws.eachRow((row) => {
      const name = row.getCell(4).value;
      if (name === 'أحمد علي محمد') rowEmp1 = row;
      if (name === 'سارة حسن إبراهيم') rowEmp2 = row;
      if (name === 'محمود جاسم كريم') rowEmp3 = row;
    });

    assert(rowEmp1 !== null, 'Employee 1 (أحمد) found in sheet');
    assert(rowEmp2 !== null, 'Employee 2 (سارة) found in sheet');
    assert(rowEmp3 !== null, 'Employee 3 (محمود) found in sheet');

    // --- Emp 1 Validations (Pure numbers) ---
    const emp1JobCell = rowEmp1.getCell(2);
    assert(emp1JobCell.value === 1001, 'Emp 1 JobNumber is number 1001');
    assert(emp1JobCell.type === ExcelJS.ValueType.Number, 'Emp 1 JobNumber cell type is Number');
    assert(emp1JobCell.numFmt === '0', 'Emp 1 JobNumber numFmt is "0"');

    const emp1DosCell = rowEmp1.getCell(3);
    assert(emp1DosCell.value === 5001, 'Emp 1 DossierNumber is number 5001');
    assert(emp1DosCell.type === ExcelJS.ValueType.Number, 'Emp 1 DossierNumber cell type is Number');
    assert(emp1DosCell.numFmt === '0', 'Emp 1 DossierNumber numFmt is "0"');

    // --- Emp 2 Validations (Mixed: Job numeric, Dossier symbol) ---
    const emp2JobCell = rowEmp2.getCell(2);
    assert(emp2JobCell.value === 1002, 'Emp 2 JobNumber is number 1002');
    assert(emp2JobCell.type === ExcelJS.ValueType.Number, 'Emp 2 JobNumber cell type is Number');

    const emp2DosCell = rowEmp2.getCell(3);
    assert(emp2DosCell.value === '142/أ', 'Emp 2 DossierNumber preserved as string "142/أ"');
    assert(emp2DosCell.type === ExcelJS.ValueType.String, 'Emp 2 DossierNumber cell type is String');

    // --- Emp 3 Validations (NULL / empty values) ---
    const emp3JobCell = rowEmp3.getCell(2);
    assert(emp3JobCell.value === '-', 'Emp 3 JobNumber is placeholder "-"');
    assert(emp3JobCell.type === ExcelJS.ValueType.String, 'Emp 3 JobNumber cell type is String');

    const emp3DosCell = rowEmp3.getCell(3);
    assert(emp3DosCell.value === '-', 'Emp 3 DossierNumber is placeholder "-"');
    assert(emp3DosCell.type === ExcelJS.ValueType.String, 'Emp 3 DossierNumber cell type is String');

    // -------------------------------------------------------------
    // Part 3: End-to-End Export Test with exportActiveLeavesToExcel
    // -------------------------------------------------------------
    console.log('\n--- Integration Tests: exportActiveLeavesToExcel ---');

    const tempExcelActive = path.join(os.tmpdir(), `test_export_active_${Date.now()}.xlsx`);

    // Seed active leave for Emp 1 (ongoing) and Emp 2 (upcoming)
    const regLeaveType = db.prepare("SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة اعتيادية'").get();
    const sickLeaveType = db.prepare("SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة مرضية'").get();

    // Active ongoing leave (ends 5 days in future)
    db.prepare(`
      INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, LeaveApprover, Notes)
      VALUES (?, ?, date('now', 'localtime', '-2 days'), date('now', 'localtime', '+5 days'), 8, 'المدير العام', 'إجازة مستمرة')
    `).run(emp1Id, regLeaveType.LeaveTypeID);

    // Upcoming leave for Emp 2
    db.prepare(`
      INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, LeaveApprover, Notes)
      VALUES (?, ?, date('now', 'localtime', '+2 days'), date('now', 'localtime', '+10 days'), 9, 'مسؤول الشعبة', 'إجازة قادمة')
    `).run(emp2Id, sickLeaveType.LeaveTypeID);

    // Active leave for Emp 3 (null job/dossier)
    db.prepare(`
      INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, LeaveApprover, Notes)
      VALUES (?, ?, date('now', 'localtime', '-1 days'), date('now', 'localtime', '+3 days'), 5, 'المدير المساعد', 'إجازة ثالثة')
    `).run(emp3Id, regLeaveType.LeaveTypeID);

    await exportActiveLeavesToExcel(tempExcelActive, db);
    assert(fs.existsSync(tempExcelActive), 'Active leaves Excel file created');

    const readActiveWb = new ExcelJS.Workbook();
    await readActiveWb.xlsx.readFile(tempExcelActive);
    const wsActive = readActiveWb.getWorksheet(1);
    assert(wsActive !== undefined, 'Active leaves worksheet exists');

    // Verify Header columns and order
    let activeHeaderRow = null;
    wsActive.eachRow((row) => {
      if (row.getCell(1).value === 'التسلسل' && row.getCell(2).value === 'الرقم الوظيفي') {
        activeHeaderRow = row;
      }
    });
    assert(activeHeaderRow !== null, 'Active leaves table header row found');
    assert(activeHeaderRow.getCell(1).value === 'التسلسل', 'Active Col 1 is "التسلسل"');
    assert(activeHeaderRow.getCell(2).value === 'الرقم الوظيفي', 'Active Col 2 is "الرقم الوظيفي"');
    assert(activeHeaderRow.getCell(3).value === 'رقم الإضبارة', 'Active Col 3 is "رقم الإضبارة" (correctly positioned)');
    assert(activeHeaderRow.getCell(4).value === 'الاسم الكامل', 'Active Col 4 is "الاسم الكامل" (shifted)');
    assert(activeHeaderRow.getCell(5).value === 'القسم', 'Active Col 5 is "القسم"');
    assert(activeHeaderRow.getCell(6).value === 'المسمى', 'Active Col 6 is "المسمى"');
    assert(activeHeaderRow.getCell(7).value === 'موقع العمل', 'Active Col 7 is "موقع العمل"');
    assert(activeHeaderRow.getCell(8).value === 'رقم كرت الإجازة', 'Active Col 8 is "رقم كرت الإجازة"');
    assert(activeHeaderRow.getCell(9).value === 'نوع الإجازة', 'Active Col 9 is "نوع الإجازة"');
    assert(activeHeaderRow.getCell(10).value === 'حالة الإجازة', 'Active Col 10 is "حالة الإجازة"');
    assert(activeHeaderRow.getCell(11).value === 'تاريخ البداية', 'Active Col 11 is "تاريخ البداية"');
    assert(activeHeaderRow.getCell(12).value === 'تاريخ النهاية', 'Active Col 12 is "تاريخ النهاية"');
    assert(activeHeaderRow.getCell(13).value === 'تاريخ المباشرة المتوقع', 'Active Col 13 is "تاريخ المباشرة المتوقع"');
    assert(activeHeaderRow.getCell(14).value === 'الأيام المتبقية / حتى البدء', 'Active Col 14 is "الأيام المتبقية / حتى البدء"');
    assert(activeHeaderRow.getCell(15).value === 'تنبيهات وتعارضات', 'Active Col 15 is "تنبيهات وتعارضات"');
    assert(activeHeaderRow.getCell(16).value === 'مسؤول الإجازة', 'Active Col 16 is "مسؤول الإجازة"');

    // Verify row data for Emp 1, 2, 3 in Active Leaves
    let actRowEmp1 = null;
    let actRowEmp2 = null;
    let actRowEmp3 = null;
    wsActive.eachRow((row) => {
      const name = row.getCell(4).value;
      if (name === 'أحمد علي محمد') actRowEmp1 = row;
      if (name === 'سارة حسن إبراهيم') actRowEmp2 = row;
      if (name === 'محمود جاسم كريم') actRowEmp3 = row;
    });

    assert(actRowEmp1 !== null, 'Active Leave: Emp 1 found');
    assert(actRowEmp1.getCell(2).value === 1001, 'Active Leave Emp 1 JobNumber is number 1001');
    assert(actRowEmp1.getCell(2).type === ExcelJS.ValueType.Number, 'Active Leave Emp 1 JobNumber is Number type');
    assert(actRowEmp1.getCell(2).numFmt === '0', 'Active Leave Emp 1 JobNumber numFmt is "0"');
    assert(actRowEmp1.getCell(3).value === 5001, 'Active Leave Emp 1 DossierNumber is number 5001');
    assert(actRowEmp1.getCell(3).type === ExcelJS.ValueType.Number, 'Active Leave Emp 1 DossierNumber is Number type');
    assert(actRowEmp1.getCell(3).numFmt === '0', 'Active Leave Emp 1 DossierNumber numFmt is "0"');
    assert(actRowEmp1.getCell(8).value === 12, 'Active Leave Emp 1 Card is 12');
    assert(actRowEmp1.getCell(9).value === 'إجازة اعتيادية', 'Active Leave Emp 1 LeaveType is "إجازة اعتيادية"');
    assert(actRowEmp1.getCell(16).value === 'المدير العام', 'Active Leave Emp 1 Approver is "المدير العام"');

    assert(actRowEmp2 !== null, 'Active Leave: Emp 2 found');
    assert(actRowEmp2.getCell(2).value === 1002, 'Active Leave Emp 2 JobNumber is number 1002');
    assert(actRowEmp2.getCell(3).value === '142/أ', 'Active Leave Emp 2 DossierNumber is string "142/أ"');
    assert(actRowEmp2.getCell(3).type === ExcelJS.ValueType.String, 'Active Leave Emp 2 DossierNumber is String type');

    assert(actRowEmp3 !== null, 'Active Leave: Emp 3 found');
    assert(actRowEmp3.getCell(2).value === emp3Id, 'Active Leave Emp 3 JobNumber falls back to numeric EmployeeID');
    assert(actRowEmp3.getCell(2).type === ExcelJS.ValueType.Number, 'Active Leave Emp 3 JobNumber is Number type');
    assert(actRowEmp3.getCell(2).numFmt === '0', 'Active Leave Emp 3 JobNumber numFmt is "0"');
    assert(actRowEmp3.getCell(3).value === '-', 'Active Leave Emp 3 DossierNumber is "-"');

    // -------------------------------------------------------------
    // Part 4: End-to-End Export Test with exportExpiredLeavesToExcel
    // -------------------------------------------------------------
    console.log('\n--- Integration Tests: exportExpiredLeavesToExcel ---');

    const tempExcelExpired = path.join(os.tmpdir(), `test_export_expired_${Date.now()}.xlsx`);

    // Seed expired leaves
    db.prepare(`
      INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, LeaveApprover, OrderNumber, OrderDate, Notes)
      VALUES (?, ?, date('now', 'localtime', '-30 days'), date('now', 'localtime', '-20 days'), 11, 'مدير الموارد', '105/ق', '2026-02-01', 'ملاحظات منتهية 1')
    `).run(emp1Id, regLeaveType.LeaveTypeID);

    db.prepare(`
      INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, LeaveApprover, OrderNumber, OrderDate, Notes)
      VALUES (?, ?, date('now', 'localtime', '-15 days'), date('now', 'localtime', '-10 days'), 6, 'مسؤول الشعبة', '110/س', '2026-02-15', 'ملاحظات منتهية 2')
    `).run(emp2Id, sickLeaveType.LeaveTypeID);

    db.prepare(`
      INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, LeaveApprover, Notes)
      VALUES (?, ?, date('now', 'localtime', '-40 days'), date('now', 'localtime', '-35 days'), 6, 'المدير العام', 'ملاحظات منتهية 3')
    `).run(emp3Id, regLeaveType.LeaveTypeID);

    await exportExpiredLeavesToExcel(tempExcelExpired, { period: 'all' }, db);
    assert(fs.existsSync(tempExcelExpired), 'Expired leaves Excel file created');

    const readExpWb = new ExcelJS.Workbook();
    await readExpWb.xlsx.readFile(tempExcelExpired);
    const wsExp = readExpWb.getWorksheet(1);
    assert(wsExp !== undefined, 'Expired leaves worksheet exists');

    // Verify Header columns and order (17 columns)
    let expHeaderRow = null;
    wsExp.eachRow((row) => {
      if (row.getCell(1).value === 'ت' && row.getCell(2).value === 'الرقم الوظيفي') {
        expHeaderRow = row;
      }
    });
    assert(expHeaderRow !== null, 'Expired leaves table header row found');
    assert(expHeaderRow.getCell(1).value === 'ت', 'Expired Col 1 is "ت"');
    assert(expHeaderRow.getCell(2).value === 'الرقم الوظيفي', 'Expired Col 2 is "الرقم الوظيفي"');
    assert(expHeaderRow.getCell(3).value === 'رقم الإضبارة', 'Expired Col 3 is "رقم الإضبارة" (correctly positioned)');
    assert(expHeaderRow.getCell(4).value === 'اسم الموظف الرباعي واللقب', 'Expired Col 4 is "اسم الموظف الرباعي واللقب"');
    assert(expHeaderRow.getCell(5).value === 'القسم / الشعبة', 'Expired Col 5 is "القسم / الشعبة"');
    assert(expHeaderRow.getCell(6).value === 'المسمى الوظيفي', 'Expired Col 6 is "المسمى الوظيفي"');
    assert(expHeaderRow.getCell(7).value === 'موقع العمل', 'Expired Col 7 is "موقع العمل"');
    assert(expHeaderRow.getCell(8).value === 'رقم كرت الإجازة', 'Expired Col 8 is "رقم كرت الإجازة"');
    assert(expHeaderRow.getCell(9).value === 'نوع الإجازة', 'Expired Col 9 is "نوع الإجازة"');
    assert(expHeaderRow.getCell(10).value === 'تاريخ البداية', 'Expired Col 10 is "تاريخ البداية"');
    assert(expHeaderRow.getCell(11).value === 'تاريخ النهاية', 'Expired Col 11 is "تاريخ النهاية"');
    assert(expHeaderRow.getCell(12).value === 'عدد الأيام', 'Expired Col 12 is "عدد الأيام"');
    assert(expHeaderRow.getCell(13).value === 'تاريخ المباشرة المفترض', 'Expired Col 13 is "تاريخ المباشرة المفترض"');
    assert(expHeaderRow.getCell(14).value === 'رقم وتاريخ الأمر الإداري', 'Expired Col 14 is "رقم وتاريخ الأمر الإداري"');
    assert(expHeaderRow.getCell(15).value === 'مسؤول الإجازة', 'Expired Col 15 is "مسؤول الإجازة"');
    assert(expHeaderRow.getCell(16).value === 'تنبيهات وتعارضات', 'Expired Col 16 is "تنبيهات وتعارضات"');
    assert(expHeaderRow.getCell(17).value === 'الملاحظات', 'Expired Col 17 is "الملاحظات"');

    // Verify row data for Emp 1, 2, 3 in Expired Leaves
    let expRowEmp1 = null;
    let expRowEmp2 = null;
    let expRowEmp3 = null;
    wsExp.eachRow((row) => {
      const name = row.getCell(4).value;
      if (name === 'أحمد علي محمد') expRowEmp1 = row;
      if (name === 'سارة حسن إبراهيم') expRowEmp2 = row;
      if (name === 'محمود جاسم كريم') expRowEmp3 = row;
    });

    assert(expRowEmp1 !== null, 'Expired Leave: Emp 1 found');
    assert(expRowEmp1.getCell(2).value === 1001, 'Expired Leave Emp 1 JobNumber is number 1001');
    assert(expRowEmp1.getCell(2).type === ExcelJS.ValueType.Number, 'Expired Leave Emp 1 JobNumber is Number type');
    assert(expRowEmp1.getCell(2).numFmt === '0', 'Expired Leave Emp 1 JobNumber numFmt is "0"');
    assert(expRowEmp1.getCell(3).value === 5001, 'Expired Leave Emp 1 DossierNumber is number 5001');
    assert(expRowEmp1.getCell(3).type === ExcelJS.ValueType.Number, 'Expired Leave Emp 1 DossierNumber is Number type');
    assert(expRowEmp1.getCell(3).numFmt === '0', 'Expired Leave Emp 1 DossierNumber numFmt is "0"');
    assert(expRowEmp1.getCell(12).value === 11, 'Expired Leave Emp 1 DaysCount is 11');
    assert(expRowEmp1.getCell(12).numFmt === '0', 'Expired Leave Emp 1 DaysCount numFmt is "0"');
    assert(expRowEmp1.getCell(14).value === '105/ق (2026-02-01)', 'Expired Leave Emp 1 OrderInfo formatted correctly');
    assert(expRowEmp1.getCell(17).value === 'ملاحظات منتهية 1', 'Expired Leave Emp 1 Notes at Column 17');

    assert(expRowEmp2 !== null, 'Expired Leave: Emp 2 found');
    assert(expRowEmp2.getCell(2).value === 1002, 'Expired Leave Emp 2 JobNumber is number 1002');
    assert(expRowEmp2.getCell(3).value === '142/أ', 'Expired Leave Emp 2 DossierNumber is string "142/أ"');
    assert(expRowEmp2.getCell(3).type === ExcelJS.ValueType.String, 'Expired Leave Emp 2 DossierNumber is String type');

    assert(expRowEmp3 !== null, 'Expired Leave: Emp 3 found');
    assert(expRowEmp3.getCell(2).value === emp3Id, 'Expired Leave Emp 3 JobNumber falls back to numeric EmployeeID');
    assert(expRowEmp3.getCell(2).type === ExcelJS.ValueType.Number, 'Expired Leave Emp 3 JobNumber is Number type');
    assert(expRowEmp3.getCell(2).numFmt === '0', 'Expired Leave Emp 3 JobNumber numFmt is "0"');
    assert(expRowEmp3.getCell(3).value === '-', 'Expired Leave Emp 3 DossierNumber is "-"');

    // -------------------------------------------------------------
    // Part 5: End-to-End Export Test with exportCriticalReportToExcel
    // -------------------------------------------------------------
    console.log('\n--- Integration Tests: exportCriticalReportToExcel ---');

    const tempExcelCritical = path.join(os.tmpdir(), `test_export_critical_${Date.now()}.xlsx`);

    await exportCriticalReportToExcel(tempExcelCritical, db, { threshold: 100 });
    assert(fs.existsSync(tempExcelCritical), 'Critical report Excel file created');

    const readCritWb = new ExcelJS.Workbook();
    await readCritWb.xlsx.readFile(tempExcelCritical);
    const wsCritSheet1 = readCritWb.getWorksheet('الأرصدة الحرجة');
    const wsCritSheet2 = readCritWb.getWorksheet(2);
    assert(wsCritSheet1 !== undefined, 'Sheet 1 (الأرصدة الحرجة) exists');
    assert(wsCritSheet2 !== undefined, 'Sheet 2 (تراكم الإجازات) exists');

    // Verify Sheet 1 Header
    let crit1HeaderRow = null;
    wsCritSheet1.eachRow((row) => {
      if (row.getCell(1).value === 'ت' && (row.getCell(2).value === 'الرقم التسلسلي' || row.getCell(2).value === 'الرقم الوظيفي')) {
        crit1HeaderRow = row;
      }
    });
    assert(crit1HeaderRow !== null, 'Critical Report Sheet 1 header row found');
    assert(crit1HeaderRow.getCell(2).value === 'الرقم التسلسلي', 'Critical Report Sheet 1 Col 2 header is correctly renamed to "الرقم التسلسلي"');

    // Verify Sheet 2 Header
    let crit2HeaderRow = null;
    wsCritSheet2.eachRow((row) => {
      if (row.getCell(1).value === 'ت' && (row.getCell(2).value === 'الرقم التسلسلي' || row.getCell(2).value === 'الرقم الوظيفي')) {
        crit2HeaderRow = row;
      }
    });
    assert(crit2HeaderRow !== null, 'Critical Report Sheet 2 header row found');
    assert(crit2HeaderRow.getCell(2).value === 'الرقم التسلسلي', 'Critical Report Sheet 2 Col 2 header is correctly renamed to "الرقم التسلسلي"');

    // Clean up temporary files
    try { if (fs.existsSync(tempExcelActive)) fs.unlinkSync(tempExcelActive); } catch (_) {}
    try { if (fs.existsSync(tempExcelExpired)) fs.unlinkSync(tempExcelExpired); } catch (_) {}
    try { if (fs.existsSync(tempExcelCritical)) fs.unlinkSync(tempExcelCritical); } catch (_) {}

    console.log(`\n🎉 [Excel Numeric Formatting] All ${passedTests}/${totalTests} tests passed successfully!`);
  } finally {
    try { db.close(); } catch (_) {}
    try { if (fs.existsSync(tempExcelAll)) fs.unlinkSync(tempExcelAll); } catch (_) {}
  }
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});

