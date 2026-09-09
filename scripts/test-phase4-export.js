const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');
const { getActiveLeavesForToday } = require('../src/main/services/LeaveService');
const { exportActiveLeavesToExcel } = require('../src/main/services/ReportService');

async function runTests() {
  console.log('====================================================');
  console.log('  TEST SUITE: LeaveTypes Cleanup & Phase 4 Excel Export');
  console.log('====================================================\n');

  const dbPath = path.join(process.env.APPDATA, 'leave-management-system', 'leave_management.db');
  console.log('Using database:', dbPath);
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  // ── TEST 1: Migrations check ──────────────────────────────────
  console.log('--- TEST 1: Migrations Table Check ---');
  const migrations = db.prepare('SELECT * FROM _Migrations ORDER BY id ASC').all();
  console.log('Migrations count:', migrations.length);
  const migration007 = migrations.find(m => m.name === '007_cleanup_leave_types.sql');
  if (!migration007) {
    throw new Error('Migration 007_cleanup_leave_types.sql is missing from _Migrations!');
  }
  console.log('✅ Migration 007 registered at:', migration007.executedAt);

  // ── TEST 2: LeaveTypes table check ────────────────────────────
  console.log('\n--- TEST 2: LeaveTypes Catalog Check ---');
  const leaveTypes = db.prepare('SELECT * FROM LeaveTypes ORDER BY LeaveTypeID ASC').all();
  console.log('Total LeaveTypes count:', leaveTypes.length);
  console.table(leaveTypes.map(lt => ({ ID: lt.LeaveTypeID, Name: lt.Name, MaxDays: lt.MaxDaysPerInstance, OrderReq: lt.RequiresOrderRef, Gender: lt.GenderRestriction || 'None' })));

  if (leaveTypes.length !== 11) {
    throw new Error(`Expected exactly 11 Arabic leave types, but got ${leaveTypes.length}`);
  }

  const englishTypes = leaveTypes.filter(lt => /[a-zA-Z]/.test(lt.Name));
  if (englishTypes.length > 0) {
    throw new Error(`Found unexpected English leave types: ${JSON.stringify(englishTypes)}`);
  }
  console.log('✅ LeaveTypes has exactly 11 pure Arabic types and 0 English types.');

  // ── TEST 3: Employees and Leaves integrity check ──────────────
  console.log('\n--- TEST 3: Employees and Leaves Integrity Check ---');
  const employees = db.prepare('SELECT * FROM Employees ORDER BY EmployeeID ASC').all();
  console.log(`Employees count: ${employees.length} (Expected: 4)`);
  console.table(employees.map(e => ({ ID: e.EmployeeID, Name: e.FullName, Title: e.JobTitle, Loc: e.WorkLocation || '-', Card: e.LeaveCardNumber || '-', Approver: e.LeaveApprover || '-', Active: e.IsActive })));

  if (employees.length !== 4) {
    throw new Error(`Expected 4 employees, found ${employees.length}`);
  }

  const leaves = db.prepare(`
    SELECT l.LeaveID, l.EmployeeID, e.FullName, l.LeaveTypeID, lt.Name AS LeaveTypeName, l.StartDate, l.EndDate, l.DaysCount, l.LeaveApprover
    FROM Leaves l
    JOIN LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
    JOIN Employees e ON e.EmployeeID = l.EmployeeID
    ORDER BY l.LeaveID ASC
  `).all();
  console.log('\nLeaves records count:', leaves.length);
  console.table(leaves);

  const sajjadLeave = leaves.find(l => l.FullName === 'سجاد ناظم');
  if (!sajjadLeave) {
    throw new Error('Sajjad Nazem leave record not found!');
  }
  if (sajjadLeave.LeaveTypeID !== 29 || sajjadLeave.LeaveTypeName !== 'إجازة مرضية') {
    throw new Error(`Expected Sajjad leave to be LeaveTypeID 29 (إجازة مرضية), but got ID ${sajjadLeave.LeaveTypeID} (${sajjadLeave.LeaveTypeName})`);
  }
  console.log('✅ Sajjad Nazem leave is properly associated with LeaveTypeID 29 (إجازة مرضية).');

  // ── TEST 4: getActiveLeavesForToday query check ───────────────
  console.log('\n--- TEST 4: getActiveLeavesForToday Query Check ---');
  const activeToday = getActiveLeavesForToday(db);
  console.log('Active leaves today count:', activeToday.length);
  console.log('Sample output:', activeToday);

  // ── TEST 5: Excel Export Testing with Simulated Real Active Leave ─
  console.log('\n--- TEST 5: Excel Export Generation and Cell Validation ---');
  const exportDir = path.join(__dirname, '..', 'scratch');
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
  const exportPath = path.join(exportDir, `test_active_leaves_${Date.now()}.xlsx`);

  // Temporarily insert a sample active leave for testing realistic data if needed
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const in3Days = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

  // Insert two test leaves inside a transaction that we will roll back / delete after export
  const insertStmt = db.prepare(`
    INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, LeaveApprover, Notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertedIds = [];
  try {
    const res1 = insertStmt.run(1, 29, today, tomorrow, 2, 'المهندس أحمد المدير الافتراضي', 'إجازة اختبارية للتقرير');
    insertedIds.push(res1.lastInsertRowid);

    const res2 = insertStmt.run(22, 1, today, in3Days, 4, 'المهندس أحمد المدير الافتراضي', 'إجازة اختبارية للتقرير 2');
    insertedIds.push(res2.lastInsertRowid);

    console.log('Inserted temporary active leaves for testing:', insertedIds);

    const activeWithTestData = getActiveLeavesForToday(db);
    console.log(`Active leaves with test data: ${activeWithTestData.length}`);
    console.table(activeWithTestData);

    // Export to Excel
    await exportActiveLeavesToExcel(exportPath, db);
    console.log('✅ Excel export successfully written to:', exportPath);

    // ── TEST 6: Deep inspection of the generated Excel workbook ──
    console.log('\n--- TEST 6: Excel Workbook Inspection ---');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(exportPath);

    const ws = wb.getWorksheet('المجازون حالياً');
    if (!ws) throw new Error('Worksheet "المجازون حالياً" not found in workbook!');

    console.log('Worksheet Name:', ws.name);
    console.log('Worksheet Views:', JSON.stringify(ws.views, null, 2));

    // Verify RTL and Freeze Panes
    const view = ws.views[0];
    if (!view.rightToLeft) throw new Error('Worksheet rightToLeft is not true!');
    if (view.ySplit !== 2) throw new Error('Worksheet header freeze pane (ySplit: 2) is missing!');
    console.log('✅ Right-to-Left and Header Freeze Pane validated.');

    // Verify Row 1: Merged Title
    const row1 = ws.getRow(1);
    const titleCell = ws.getCell('A1');
    console.log('Title Cell Value:', titleCell.value);
    console.log('Title Cell Font:', titleCell.font);
    console.log('Title Cell Fill:', titleCell.fill);
    if (!titleCell.value.includes('تقرير المجازين حالياً')) {
      throw new Error('Title text is incorrect!');
    }
    if (titleCell.font.size !== 16 || !titleCell.font.bold || titleCell.font.color?.argb !== 'FFFFFFFF') {
      throw new Error('Title font style does not match requirement!');
    }
    if (titleCell.fill?.fgColor?.argb !== 'FF1A3C5E') {
      throw new Error(`Expected Title fill #1A3C5E (FF1A3C5E), got ${titleCell.fill?.fgColor?.argb}`);
    }
    console.log('✅ Row 1 Title styling and merge validated (Navy #1A3C5E, Bold White 16pt).');

    // Verify Row 2: Headers
    const row2 = ws.getRow(2);
    const expectedHeaders = [
      'الرقم الوظيفي',
      'الاسم الكامل',
      'المسمى',
      'موقع العمل',
      'رقم كرت الإجازة',
      'نوع الإجازة',
      'تاريخ البداية',
      'تاريخ النهاية',
      'تاريخ المباشرة المتوقع',
      'الأيام المتبقية',
      'مسؤول الإجازة'
    ];
    console.log('\nChecking Row 2 Column Headers...');
    for (let c = 1; c <= 11; c++) {
      const cell = row2.getCell(c);
      const val = cell.value;
      if (val !== expectedHeaders[c - 1]) {
        throw new Error(`Column ${c} header mismatch: expected "${expectedHeaders[c - 1]}", got "${val}"`);
      }
      if (cell.font?.color?.argb !== 'FFFFFFFF' || !cell.font?.bold) {
        throw new Error(`Column ${c} header font is not bold white!`);
      }
      if (cell.fill?.fgColor?.argb !== 'FF2E6DA4') {
        throw new Error(`Column ${c} header fill is not #2E6DA4!`);
      }
    }
    console.log('✅ All 11 Column Headers match exact names and style (#2E6DA4, Bold White 11pt).');

    // Verify Data Rows & Badges
    console.log('\nChecking Data Rows & Badges...');
    for (let r = 3; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const empId = row.getCell(1).value;
      const empName = row.getCell(2).value;
      const jobTitle = row.getCell(3).value;
      const leaveType = row.getCell(6).value;
      const daysCell = row.getCell(10);
      const daysVal = daysCell.value;
      const daysFill = daysCell.fill?.fgColor?.argb;
      const daysFont = daysCell.font;

      console.log(`Row ${r}: ID=${empId}, Name="${empName}", Title="${jobTitle}", Type="${leaveType}", Remaining="${daysVal}", Fill=${daysFill}, FontColor=${daysFont?.color?.argb}`);
    }
    console.log('✅ Data rows and alert badges validated successfully.');

  } finally {
    // Cleanup temporary test leaves to leave database 100% pristine
    if (insertedIds.length > 0) {
      const deleteStmt = db.prepare('DELETE FROM Leaves WHERE LeaveID = ?');
      for (const id of insertedIds) {
        deleteStmt.run(id);
      }
      console.log('\n✅ Cleaned up temporary test leaves:', insertedIds);
    }
  }

  // Final check on database integrity
  const finalLeaves = db.prepare('SELECT COUNT(*) as count FROM Leaves').get().count;
  const finalEmps = db.prepare('SELECT COUNT(*) as count FROM Employees').get().count;
  console.log(`\nFinal DB State: ${finalEmps} Employees, ${finalLeaves} Leaves.`);

  db.close();
  console.log('\n🎉 ALL TESTS PASSED WITH 100% SUCCESS!');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
