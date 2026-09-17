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
const { exportAllEmployees, writeNumericOrTextCell } = require('../src/main/services/ReportService');

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
    INSERT OR REPLACE INTO _AppSettings (Key, Value) VALUES ('DepartmentName', 'مديرية التفتيش والمتابعة');
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

  const tempExcelPath = path.join(os.tmpdir(), `test_export_all_${Date.now()}.xlsx`);
  const db = createTestDb();

  try {
    // Seed mock employees covering the 3 distinct cases
    // Emp 1: Pure numeric JobNumber and DossierNumber
    db.prepare(`
      INSERT INTO Employees (FullName, Gender, HireDate, JobTitle, JobNumber, DossierNumber, LeaveCardNumber, WorkLocation, IsActive)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('أحمد علي محمد', 'Male', '2020-01-01', 'مهندس', '1001', '5001', '12', 'المقر الرئيسي', 1);

    // Emp 2: JobNumber numeric, DossierNumber containing symbol (142/أ)
    db.prepare(`
      INSERT INTO Employees (FullName, Gender, HireDate, JobTitle, JobNumber, DossierNumber, LeaveCardNumber, WorkLocation, IsActive)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('سارة حسن إبراهيم', 'Female', '2021-01-01', 'باحثة', '1002', '142/أ', '15', 'فرع البصرة', 1);

    // Emp 3: NULL JobNumber and DossierNumber
    db.prepare(`
      INSERT INTO Employees (FullName, Gender, HireDate, JobTitle, JobNumber, DossierNumber, LeaveCardNumber, WorkLocation, IsActive)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('محمود جاسم كريم', 'Male', '2022-01-01', 'إداري', null, null, '18', 'فرع نينوى', 1);

    // Export to Excel
    await exportAllEmployees(tempExcelPath, db, { search: '' });
    assert(fs.existsSync(tempExcelPath), 'Exported Excel file successfully created on disk');

    // Read back workbook
    const readWorkbook = new ExcelJS.Workbook();
    await readWorkbook.xlsx.readFile(tempExcelPath);
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
    // Cell 2: JobNumber
    const emp1JobCell = rowEmp1.getCell(2);
    assert(emp1JobCell.value === 1001, 'Emp 1 JobNumber is number 1001');
    assert(emp1JobCell.type === ExcelJS.ValueType.Number, 'Emp 1 JobNumber cell type is Number');
    assert(emp1JobCell.numFmt === '0', 'Emp 1 JobNumber numFmt is "0"');

    // Cell 3: DossierNumber
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

    console.log(`\n🎉 [Excel Numeric Formatting] All ${passedTests}/${totalTests} tests passed successfully!`);
  } finally {
    try { db.close(); } catch (_) {}
    try { if (fs.existsSync(tempExcelPath)) fs.unlinkSync(tempExcelPath); } catch (_) {}
  }
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
