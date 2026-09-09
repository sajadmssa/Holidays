// ============================================================
//  services/ReportService.js  –  Excel Export & Reporting Engine
//  Responsibilities:
//    • Fetch employee header data and leave records from SQLite
//    • Apply official custom department headers & 3-box approval footers
//    • Generate styled, RTL ExcelJS workbooks for all reports
//    • Compute critical leave balances & yearly accumulated leave metrics
// ============================================================

'use strict';

const ExcelJS = require('exceljs');
const { getActiveLeavesForToday, calculateRegularLeaveBalance } = require('./LeaveService');

// ──────────────────────────────────────────────────────────────
//  Style Constants
// ──────────────────────────────────────────────────────────────
const STYLE = {
  title: {
    font     : { name: 'Calibri', size: 17, bold: true, color: { argb: 'FFFFFFFF' } },
    fill     : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF142E4D' } },
    alignment: { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' },
    border   : borderThin(),
  },
  header: {
    font     : { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } },
    fill     : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6F8B' } },
    alignment: { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' },
    border   : borderThin(),
  },
  rowEven: {
    font     : { name: 'Calibri', size: 12 },
    fill     : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F7FA' } },
    alignment: { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' },
    border   : borderThin(),
  },
  rowOdd: {
    font     : { name: 'Calibri', size: 12 },
    fill     : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' },
    border   : borderThin(),
  },
};

function borderThin() {
  const side = { style: 'thin', color: { argb: 'FFC9D6E3' } };
  return { top: side, left: side, bottom: side, right: side };
}

function borderBox() {
  const side = { style: 'medium', color: { argb: 'FF1A3C5E' } };
  return { top: side, left: side, bottom: side, right: side };
}

function applyRowStyle(row, style, colCount) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    if (style.font)      cell.font      = style.font;
    if (style.fill)      cell.fill      = style.fill;
    if (style.alignment) cell.alignment = style.alignment;
    if (style.border)    cell.border    = style.border;
  }
}

/**
 * Retrieves the department/division official name from _AppSettings.
 * @param {import('better-sqlite3').Database} db
 * @returns {string|null}
 */
function getDepartmentName(db) {
  try {
    if (!db) return null;
    const row = db.prepare("SELECT Value FROM _AppSettings WHERE Key = 'department_name'").get();
    return row && row.Value && row.Value.trim().length > 0 ? row.Value.trim() : null;
  } catch (_) {
    return null;
  }
}

/**
 * Generates an automatic reference number for the report.
 * @returns {string}
 */
function generateReferenceNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `REF-${y}${m}${d}-${rand}`;
}

/**
 * Formats current date and time in Arabic format.
 * @returns {string}
 */
function getExportDateTimeString() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ar-IQ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeStr = now.toLocaleTimeString('ar-IQ', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${dateStr}  الساعة  ${timeStr}`;
}

/**
 * Applies the official top header (Department, Title, Reference Number & Timestamp, and optional MetaInfo).
 *
 * @param {import('exceljs').Worksheet} ws
 * @param {{
 *   title: string,
 *   metaInfo?: string | null,
 *   db: import('better-sqlite3').Database,
 *   colCount: number
 * }} params
 * @returns {number} The next row number where the table headers should start.
 */
function applyOfficialHeader(ws, { title, metaInfo = null, db, colCount }) {
  const deptName = getDepartmentName(db);
  const refNo = generateReferenceNumber();
  const exportDateTime = getExportDateTimeString();
  let currentRow = 1;

  // 1. Official Department Header (Only if configured)
  if (deptName) {
    ws.mergeCells(currentRow, 1, currentRow, colCount);
    const deptCell = ws.getCell(`A${currentRow}`);
    deptCell.value = `جمهورية العراق  |  ${deptName}`;
    deptCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF142E4D' } };
    deptCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    deptCell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
    deptCell.border = borderThin();
    ws.getRow(currentRow).height = 24;
    currentRow++;
  }

  // 2. Report Main Title
  ws.mergeCells(currentRow, 1, currentRow, colCount);
  const titleCell = ws.getCell(`A${currentRow}`);
  titleCell.value = title;
  titleCell.font = STYLE.title.font;
  titleCell.fill = STYLE.title.fill;
  titleCell.alignment = STYLE.title.alignment;
  titleCell.border = STYLE.title.border;
  ws.getRow(currentRow).height = 36;
  currentRow++;

  // 3. Metadata Bar (Reference Number + Export Date/Time)
  ws.mergeCells(currentRow, 1, currentRow, colCount);
  const metaCell = ws.getCell(`A${currentRow}`);
  metaCell.value = `رقم الإشارة: ${refNo}   |   تاريخ ووقت الاستخراج: ${exportDateTime}`;
  metaCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FFFFFFFF' } };
  metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6F8B' } };
  metaCell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
  metaCell.border = borderThin();
  ws.getRow(currentRow).height = 20;
  currentRow++;

  // 4. Specific Meta Info (e.g. Employee details)
  if (metaInfo) {
    ws.mergeCells(currentRow, 1, currentRow, colCount);
    const infoCell = ws.getCell(`A${currentRow}`);
    infoCell.value = metaInfo;
    infoCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E293B' } };
    infoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    infoCell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
    infoCell.border = borderThin();
    ws.getRow(currentRow).height = 22;
    currentRow++;
  }

  return currentRow;
}

/**
 * Applies the official 3-box signature approval block at the bottom of the worksheet.
 *
 * @param {import('exceljs').Worksheet} ws
 * @param {number} colCount
 */
function applyOfficialFooterApprovals(ws, colCount) {
  // Add 2 empty spacer rows
  ws.addRow([]);
  ws.addRow([]);

  const c1 = Math.max(1, Math.floor(colCount / 3));
  const c2 = Math.max(1, Math.floor((colCount - c1) / 2));

  const box1Start = 1;
  const box1End = c1;
  const box2Start = c1 + 1;
  const box2End = c1 + c2;
  const box3Start = c1 + c2 + 1;
  const box3End = colCount;

  const currentLastRow = ws.lastRow ? ws.lastRow.number : 10;
  const headerRowNum = currentLastRow + 1;
  const r1Num = headerRowNum + 1;
  const r2Num = headerRowNum + 2;
  const r3Num = headerRowNum + 3;
  const r4Num = headerRowNum + 4;

  const boxes = [
    {
      start: box1Start,
      end: box1End,
      header: '1. إعداد وتنظيم الكشف',
      role: 'الموظف المختص:',
      name: 'الاسم: .......................................',
      sig: 'التوقيع: ....................................',
      date: 'التاريخ:      /      / 2026 م',
    },
    {
      start: box2Start,
      end: box2End,
      header: '2. تدقيق ومراجعة الكشف',
      role: 'مسؤول الشعبة / التدقيق:',
      name: 'الاسم: .......................................',
      sig: 'التوقيع: ....................................',
      date: 'التاريخ:      /      / 2026 م',
    },
    {
      start: box3Start,
      end: box3End,
      header: '3. مصادقة واعتماد نهائي',
      role: 'المدير العام / المسؤول المخول:',
      name: 'الاسم: .......................................',
      sig: 'التوقيع: ....................................',
      date: 'الختم الرسمي:',
    },
  ];

  // Helper to merge and style box cells
  function setBoxRow(rowNum, field, isHeader = false) {
    ws.getRow(rowNum).height = isHeader ? 22 : 18;
    for (const b of boxes) {
      if (b.start <= b.end) {
        ws.mergeCells(rowNum, b.start, rowNum, b.end);
        const cell = ws.getCell(rowNum, b.start);
        cell.value = b[field];
        cell.alignment = { horizontal: isHeader ? 'center' : 'right', vertical: 'middle', readingOrder: 'rtl' };
        if (isHeader) {
          cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF142E4D' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        } else {
          cell.font = { name: 'Calibri', size: 11, bold: field === 'role' };
        }
        for (let c = b.start; c <= b.end; c++) {
          ws.getCell(rowNum, c).border = borderThin();
        }
      }
    }
  }

  setBoxRow(headerRowNum, 'header', true);
  setBoxRow(r1Num, 'role');
  setBoxRow(r2Num, 'name');
  setBoxRow(r3Num, 'sig');
  setBoxRow(r4Num, 'date');
}

// ══════════════════════════════════════════════════════════════
//  exportEmployeeHistory
// ══════════════════════════════════════════════════════════════
async function exportEmployeeHistory(employeeId, filePath, db) {
  const employee = db
    .prepare(`
      SELECT FullName, JobTitle, HireDate, WorkLocation, LeaveCardNumber, LeaveApprover
      FROM   Employees
      WHERE  EmployeeID = ?
    `)
    .get(employeeId);

  if (!employee) {
    throw new Error(`تعذر العثور على الموظف برقم (${employeeId}) في قاعدة البيانات.`);
  }

  const leaves = db
    .prepare(`
      SELECT
        lt.Name  AS LeaveName,
        l.LeaveApprover,
        l.StartDate,
        l.EndDate,
        l.DaysCount,
        l.RequestDate,
        l.MemoNumber,
        l.MemoDate,
        l.OrderNumber,
        l.OrderDate
      FROM   Leaves      l
      JOIN   LeaveTypes  lt ON lt.LeaveTypeID = l.LeaveTypeID
      WHERE  l.EmployeeID = ?
      ORDER  BY l.StartDate DESC
    `)
    .all(employeeId);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'نظام إدارة الإجازات';
  workbook.created = new Date();
  workbook.modified = new Date();

  const ws = workbook.addWorksheet('سجل الإجازات', {
    views: [{ rightToLeft: true }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  const COLUMNS = [
    { key: 'seq',         width: 6  },   // ت
    { key: 'leaveType',   width: 20 },   // نوع الإجازة
    { key: 'requestDate', width: 16 },   // تاريخ تقديم الطلب
    { key: 'startDate',   width: 15 },   // تاريخ البدء
    { key: 'endDate',     width: 15 },   // تاريخ الانتهاء
    { key: 'days',        width: 12 },   // عدد الأيام
    { key: 'memoNumber',  width: 16 },   // رقم المذكرة
    { key: 'memoDate',    width: 15 },   // تاريخ المذكرة
    { key: 'orderNumber', width: 16 },   // رقم الأمر الإداري
    { key: 'orderDate',   width: 15 },   // تاريخ الأمر الإداري
    { key: 'approver',    width: 24 },   // المسؤول عن منح الإجازة
  ];
  const COL_COUNT = COLUMNS.length;
  ws.columns = COLUMNS;

  // Metadata parts
  const metaParts = [`الموظف: ${employee.FullName}`, `المسمى: ${employee.JobTitle}`];
  if (employee.WorkLocation) metaParts.push(`موقع العمل: ${employee.WorkLocation}`);
  if (employee.LeaveCardNumber) metaParts.push(`رقم كرت الإجازة: ${employee.LeaveCardNumber}`);
  metaParts.push(`تاريخ التعيين: ${employee.HireDate}`);

  // Apply Official Top Header
  const headerStartRow = applyOfficialHeader(ws, {
    title: `سجل الإجازات الرسمي - ${employee.FullName}`,
    metaInfo: metaParts.join('   |   '),
    db,
    colCount: COL_COUNT,
  });

  // Table Column Headers
  const headerRow = ws.addRow([
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
  ]);
  applyRowStyle(headerRow, STYLE.header, COL_COUNT);
  headerRow.height = 24;

  // Data Rows
  if (leaves.length === 0) {
    const emptyRowNum = headerStartRow + 1;
    ws.mergeCells(emptyRowNum, 1, emptyRowNum, COL_COUNT);
    const emptyCell = ws.getCell(`A${emptyRowNum}`);
    emptyCell.value = 'لا توجد إجازات مسجلة لهذا الموظف';
    emptyCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF888888' } };
    emptyCell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
    ws.getRow(emptyRowNum).height = 20;
  } else {
    leaves.forEach((leave, index) => {
      const dataRow = ws.addRow([
        index + 1,
        leave.LeaveName || '-',
        leave.RequestDate || '-',
        leave.StartDate || '-',
        leave.EndDate || '-',
        Number(leave.DaysCount) || leave.DaysCount,
        leave.MemoNumber || '-',
        leave.MemoDate || '-',
        leave.OrderNumber || '-',
        leave.OrderDate || '-',
        leave.LeaveApprover || '-',
      ]);
      applyRowStyle(dataRow, index % 2 === 0 ? STYLE.rowEven : STYLE.rowOdd, COL_COUNT);
      dataRow.height = 18;
      dataRow.getCell(1).numFmt = '0';
      dataRow.getCell(6).numFmt = '0';
    });

    const totalDays = leaves.reduce((sum, l) => sum + Number(l.DaysCount || 0), 0);
    const summaryRow = ws.addRow([
      '',
      'الإجمالي الكلي للأيام المستهلكة',
      '',
      '',
      '',
      totalDays,
      '',
      '',
      '',
      '',
      ''
    ]);
    applyRowStyle(summaryRow, STYLE.header, COL_COUNT);
    summaryRow.height = 20;
    summaryRow.getCell(6).numFmt = '0';
  }

  // Apply 3-Box Official Approvals Footer
  applyOfficialFooterApprovals(ws, COL_COUNT);

  await workbook.xlsx.writeFile(filePath);
}

// ══════════════════════════════════════════════════════════════
//  exportAllEmployees
// ══════════════════════════════════════════════════════════════
async function exportAllEmployees(arg1, arg2, arg3) {
  let search = '';
  let filePath = '';
  let db = null;

  if (typeof arg1 === 'string') {
    filePath = arg1;
    db = arg2;
    search = arg3?.search || '';
  } else {
    search = arg1?.search || '';
    filePath = arg2;
    db = arg3;
  }

  const trimmedSearch = (search || '').trim();
  let whereClause = '';
  const params = [];

  if (trimmedSearch.length > 0) {
    const pattern = `%${trimmedSearch}%`;
    whereClause = `
      WHERE (
        FullName LIKE ? OR
        LeaveCardNumber LIKE ? OR
        WorkLocation LIKE ? OR
        CAST(EmployeeID AS TEXT) LIKE ?
      )
    `;
    params.push(pattern, pattern, pattern, pattern);
  }

  const query = `
    WITH MatchedEmps AS (
      SELECT
        EmployeeID,
        FullName,
        JobTitle,
        WorkLocation,
        LeaveCardNumber,
        LeaveApprover,
        IsActive
      FROM Employees
      ${whereClause}
      ORDER BY IsActive DESC, FullName ASC
    )
    SELECT
      me.*,
      (
        SELECT l.StartDate FROM Leaves l
        WHERE l.EmployeeID = me.EmployeeID
        ORDER BY l.StartDate DESC, l.LeaveID DESC
        LIMIT 1
      ) AS LastLeaveStartDate,
      (
        SELECT l.EndDate FROM Leaves l
        WHERE l.EmployeeID = me.EmployeeID
        ORDER BY l.StartDate DESC, l.LeaveID DESC
        LIMIT 1
      ) AS LastLeaveEndDate,
      (
        SELECT lt.Name FROM Leaves l
        JOIN LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
        WHERE l.EmployeeID = me.EmployeeID
        ORDER BY l.StartDate DESC, l.LeaveID DESC
        LIMIT 1
      ) AS LastLeaveTypeName
    FROM MatchedEmps me
    ORDER BY me.IsActive DESC, me.FullName ASC
  `;

  const rows = db.prepare(query).all(...params);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'نظام إدارة الإجازات';
  workbook.created = new Date();
  workbook.modified = new Date();

  const ws = workbook.addWorksheet('قائمة الموظفين', {
    views: [{ rightToLeft: true }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  const COLUMNS = [
    { key: 'seq',        width: 8  },
    { key: 'empId',      width: 14 },
    { key: 'name',       width: 26 },
    { key: 'jobTitle',   width: 22 },
    { key: 'location',   width: 20 },
    { key: 'card',       width: 16 },
    { key: 'approver',   width: 22 },
    { key: 'status',     width: 12 },
    { key: 'lastLeave',  width: 24 },
    { key: 'leaveType',  width: 20 },
  ];
  const COL_COUNT = COLUMNS.length;
  ws.columns = COLUMNS;

  // Apply Official Top Header
  const headerStartRow = applyOfficialHeader(ws, {
    title: 'كشف الموظفين العام وسجل إجازاتهم',
    db,
    colCount: COL_COUNT,
  });

  // Header Row
  const headerRow = ws.addRow([
    'ت',
    'الرقم الوظيفي',
    'الاسم الكامل',
    'المسمى الوظيفي',
    'موقع العمل',
    'رقم كرت الإجازة',
    'المسؤول الافتراضي',
    'الحالة',
    'تاريخ آخر إجازة',
    'نوع آخر إجازة'
  ]);
  applyRowStyle(headerRow, STYLE.header, COL_COUNT);
  headerRow.height = 22;

  // Data Rows
  if (rows.length === 0) {
    const emptyRowNum = headerStartRow + 1;
    ws.mergeCells(emptyRowNum, 1, emptyRowNum, COL_COUNT);
    const emptyCell = ws.getCell(`A${emptyRowNum}`);
    emptyCell.value = 'لا توجد بيانات موظفين مطابقة للبحث';
    emptyCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF888888' } };
    emptyCell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
    ws.getRow(emptyRowNum).height = 20;
  } else {
    rows.forEach((emp, index) => {
      const lastLeaveText = emp.LastLeaveStartDate
        ? `${emp.LastLeaveStartDate} إلى ${emp.LastLeaveEndDate || ''}`
        : 'لا توجد إجازات';

      const cardVal = (emp.LeaveCardNumber !== null && emp.LeaveCardNumber !== undefined && emp.LeaveCardNumber !== '' && !isNaN(Number(emp.LeaveCardNumber)))
        ? Number(emp.LeaveCardNumber)
        : (emp.LeaveCardNumber || '-');

      const dataRow = ws.addRow([
        index + 1,
        Number(emp.EmployeeID) || emp.EmployeeID,
        emp.FullName,
        emp.JobTitle || '-',
        emp.WorkLocation || '-',
        cardVal,
        emp.LeaveApprover || '-',
        emp.IsActive === 1 ? 'نشط' : 'مجمّد',
        lastLeaveText,
        emp.LastLeaveTypeName || '-',
      ]);

      applyRowStyle(dataRow, index % 2 === 0 ? STYLE.rowEven : STYLE.rowOdd, COL_COUNT);
      dataRow.height = 18;

      // Numeric formatting for ID and Card columns
      dataRow.getCell(1).numFmt = '0';
      dataRow.getCell(2).numFmt = '0';
      if (typeof cardVal === 'number') {
        dataRow.getCell(6).numFmt = '0';
      }
    });
  }

  // Apply 3-Box Official Approvals Footer
  applyOfficialFooterApprovals(ws, COL_COUNT);

  await workbook.xlsx.writeFile(filePath);
}

// ══════════════════════════════════════════════════════════════
//  exportActiveLeavesToExcel
// ══════════════════════════════════════════════════════════════
async function exportActiveLeavesToExcel(filePath, db) {
  const activeLeaves = getActiveLeavesForToday(db);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'نظام إدارة الإجازات';
  workbook.created = new Date();
  workbook.modified = new Date();

  const ws = workbook.addWorksheet('المجازون حالياً', {
    views: [{ rightToLeft: true }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  const COLUMNS = [
    { key: 'empId',          width: 15 }, // الرقم الوظيفي
    { key: 'fullName',       width: 26 }, // الاسم الكامل
    { key: 'jobTitle',       width: 20 }, // المسمى
    { key: 'workLocation',   width: 18 }, // موقع العمل
    { key: 'cardNum',        width: 16 }, // رقم كرت الإجازة
    { key: 'leaveType',      width: 20 }, // نوع الإجازة
    { key: 'startDate',      width: 15 }, // تاريخ البداية
    { key: 'endDate',        width: 15 }, // تاريخ النهاية
    { key: 'resumptionDate', width: 22 }, // تاريخ المباشرة المتوقع
    { key: 'daysRemaining',  width: 22 }, // الأيام المتبقية
    { key: 'leaveApprover',  width: 26 }, // مسؤول الإجازة
  ];
  const COL_COUNT = COLUMNS.length;
  ws.columns = COLUMNS;

  // Apply Official Top Header
  const headerStartRow = applyOfficialHeader(ws, {
    title: 'كشف الموظفين المجازين حالياً ومواعيد مباشرتهم',
    db,
    colCount: COL_COUNT,
  });

  // Header Row
  const headerRow = ws.addRow([
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
  ]);
  applyRowStyle(headerRow, STYLE.header, COL_COUNT);
  headerRow.height = 24;

  // Data Rows
  if (activeLeaves.length === 0) {
    const emptyRowNum = headerStartRow + 1;
    ws.mergeCells(emptyRowNum, 1, emptyRowNum, COL_COUNT);
    const emptyCell = ws.getCell(`A${emptyRowNum}`);
    emptyCell.value = 'لا يوجد موظفون في إجازة حالياً (تاريخ اليوم)';
    emptyCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FF888888' } };
    emptyCell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
    emptyCell.border = borderThin();
    ws.getRow(emptyRowNum).height = 24;
  } else {
    activeLeaves.forEach((item, index) => {
      const days = item.DaysRemaining != null ? Number(item.DaysRemaining) : 0;
      let daysRemainingText = `${days} يوم`;
      if (days === 0) {
        daysRemainingText = 'المباشرة غداً (آخر يوم إجازة)';
      } else if (days === 1) {
        daysRemainingText = 'المباشرة غداً (يوم متبقٍ)';
      } else if (days <= 3) {
        daysRemainingText = `المباشرة خلال ${days + 1} أيام (${days} متبقية)`;
      }

      const cardVal = (item.LeaveCardNumber !== null && item.LeaveCardNumber !== undefined && item.LeaveCardNumber !== '' && !isNaN(Number(item.LeaveCardNumber)))
        ? Number(item.LeaveCardNumber)
        : (item.LeaveCardNumber || '-');

      const row = ws.addRow([
        Number(item.EmployeeID) || item.EmployeeID,
        item.FullName,
        item.JobTitle || '-',
        item.WorkLocation || '-',
        cardVal,
        item.LeaveName || '-',
        item.StartDate,
        item.EndDate,
        item.ResumptionDate || '-',
        daysRemainingText,
        item.LeaveApprover || '-',
      ]);

      const baseStyle = index % 2 === 0 ? STYLE.rowEven : STYLE.rowOdd;
      applyRowStyle(row, baseStyle, COL_COUNT);
      row.height = 20;

      // Numeric formatting for ID and Card columns
      row.getCell(1).numFmt = '0';
      if (typeof cardVal === 'number') {
        row.getCell(5).numFmt = '0';
      }

      // Highlight Badges for DaysRemaining
      const cellRemaining = row.getCell(10);
      if (days <= 1) {
        cellRemaining.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        cellRemaining.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF991B1B' } };
      } else if (days <= 3) {
        cellRemaining.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        cellRemaining.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF92400E' } };
      }
    });
  }

  // Apply 3-Box Official Approvals Footer
  applyOfficialFooterApprovals(ws, COL_COUNT);

  await workbook.xlsx.writeFile(filePath);
}

// ──────────────────────────────────────────────────────────────
//  CRITICAL_BALANCE_CTE: Vectorized SQL query for regular leave balances
//  Replaces 30,000+ N+1 sequential loops with a single instant query.
// ──────────────────────────────────────────────────────────────
const CRITICAL_BALANCE_CTE = `
WITH AggregatedLeaves AS (
  SELECT 
    l.EmployeeID,
    COALESCE(SUM(CASE WHEN lt.Name = 'إجازة بدون راتب' THEN l.DaysCount ELSE 0 END), 0) AS UnpaidDays,
    COALESCE(SUM(CASE WHEN lt.Name IN ('إجازة اعتيادية', 'سبب آخر') THEN l.DaysCount ELSE 0 END), 0) AS RegularLeavesTaken
  FROM Leaves l
  JOIN LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
  GROUP BY l.EmployeeID
),
EmployeeCalculations AS (
  SELECT
    e.EmployeeID,
    e.FullName,
    e.JobTitle,
    e.WorkLocation,
    e.LeaveCardNumber,
    e.HireDate,
    COALESCE(e.AdjustmentDays, 0) AS AdjustmentDays,
    COALESCE(al.UnpaidDays, 0) AS UnpaidDays,
    COALESCE(al.RegularLeavesTaken, 0) AS RegularLeavesTaken,
    CAST(ROUND(julianday(date('now', 'localtime')) - julianday(e.HireDate)) AS INTEGER) AS TotalDays,
    MAX(0, CAST(ROUND(julianday(date('now', 'localtime')) - julianday(e.HireDate)) AS INTEGER) - COALESCE(al.UnpaidDays, 0)) AS NetServiceDays,
    (MAX(0, CAST(ROUND(julianday(date('now', 'localtime')) - julianday(e.HireDate)) AS INTEGER) - COALESCE(al.UnpaidDays, 0)) / 10) AS GrossEarnedBalance,
    ((MAX(0, CAST(ROUND(julianday(date('now', 'localtime')) - julianday(e.HireDate)) AS INTEGER) - COALESCE(al.UnpaidDays, 0)) / 10) + COALESCE(e.AdjustmentDays, 0) - COALESCE(al.RegularLeavesTaken, 0)) AS AvailableBalance,
    MIN(MAX(((MAX(0, CAST(ROUND(julianday(date('now', 'localtime')) - julianday(e.HireDate)) AS INTEGER) - COALESCE(al.UnpaidDays, 0)) / 10) + COALESCE(e.AdjustmentDays, 0) - COALESCE(al.RegularLeavesTaken, 0)), 0), 180) AS FinalBalance
  FROM Employees e
  LEFT JOIN AggregatedLeaves al ON al.EmployeeID = e.EmployeeID
  WHERE e.IsActive = 1
)
`;

// ══════════════════════════════════════════════════════════════
//  getCriticalAndAccumulatedLeaves
//
//  Computes:
//    1. Critical balances: active employees with final regular balance <= threshold (Single Query)
//    2. Accumulated leave metrics for the specified year (Aggregated Query)
// ══════════════════════════════════════════════════════════════
function getCriticalAndAccumulatedLeaves(db, { threshold = 5, year = new Date().getFullYear() } = {}) {
  const safeThreshold = Number.isInteger(Number(threshold)) ? Number(threshold) : 5;
  const targetYear = Number.isInteger(Number(year)) ? Number(year) : new Date().getFullYear();
  const yearStr = String(targetYear);

  // 1. Total Active Employees Count
  const totalActiveRow = db.prepare('SELECT COUNT(*) as count FROM Employees WHERE IsActive = 1').get();
  const totalActiveEmployees = totalActiveRow ? Number(totalActiveRow.count) : 0;

  // 2. Critical Employees (Single Vectorized SQL Query)
  const criticalQuery = `
    ${CRITICAL_BALANCE_CTE}
    SELECT
      EmployeeID,
      FullName,
      JobTitle,
      WorkLocation,
      LeaveCardNumber,
      HireDate,
      FinalBalance,
      FinalBalance AS RemainingBalance,
      RegularLeavesTaken,
      GrossEarnedBalance,
      NetServiceDays
    FROM EmployeeCalculations
    WHERE FinalBalance <= ?
    ORDER BY FinalBalance ASC, FullName ASC
  `;
  const criticalEmployees = db.prepare(criticalQuery).all(safeThreshold);

  // 3. Query Year-to-Date Accumulated Leaves
  const rawAccumulatedLeaves = db
    .prepare(`
      SELECT
        e.EmployeeID,
        e.FullName,
        e.JobTitle,
        e.WorkLocation,
        e.LeaveCardNumber,
        e.HireDate,
        COUNT(l.LeaveID) AS TotalLeavesCount,
        COALESCE(SUM(l.DaysCount), 0) AS TotalDaysCount,
        COALESCE(SUM(CASE WHEN lt.Name = 'إجازة اعتيادية' THEN l.DaysCount ELSE 0 END), 0) AS RegularDaysCount,
        COALESCE(SUM(CASE WHEN lt.Name = 'إجازة مرضية' THEN l.DaysCount ELSE 0 END), 0) AS SickDaysCount,
        COALESCE(SUM(CASE WHEN lt.Name NOT IN ('إجازة اعتيادية', 'إجازة مرضية') THEN l.DaysCount ELSE 0 END), 0) AS OtherDaysCount
      FROM Employees e
      LEFT JOIN Leaves l ON l.EmployeeID = e.EmployeeID AND strftime('%Y', l.StartDate) = ?
      LEFT JOIN LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
      WHERE e.IsActive = 1
      GROUP BY e.EmployeeID
      ORDER BY TotalDaysCount DESC, e.FullName ASC
    `)
    .all(yearStr);

  const accumulatedLeaves = rawAccumulatedLeaves.map((r) => ({
    ...r,
    TotalConsumedDays: Number(r.TotalDaysCount || 0),
    RegularDays: Number(r.RegularDaysCount || 0),
    SickDays: Number(r.SickDaysCount || 0),
    OtherDays: Number(r.OtherDaysCount || 0),
    LeavesCount: Number(r.TotalLeavesCount || 0),
  }));

  const totalLeavesThisYear = accumulatedLeaves.reduce((sum, r) => sum + Number(r.TotalLeavesCount || 0), 0);
  const totalDaysThisYear = accumulatedLeaves.reduce((sum, r) => sum + Number(r.TotalDaysCount || 0), 0);

  return {
    threshold: safeThreshold,
    year: targetYear,
    totalActiveEmployees,
    criticalCount: criticalEmployees.length,
    totalLeavesThisYear,
    totalDaysThisYear,
    kpis: {
      criticalEmployeesCount: criticalEmployees.length,
      totalLeavesCountInYear: totalLeavesThisYear,
      totalDaysConsumedInYear: totalDaysThisYear,
    },
    criticalEmployees,
    accumulatedLeaves,
  };
}

/**
 * Retrieves paginated critical leave balances (<= threshold) with single vectorized SQL query.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{
 *   threshold?: number,
 *   page?: number,
 *   pageSize?: number,
 *   search?: string
 * }} options
 * @returns {{
 *   data: Array<any>,
 *   totalCount: number,
 *   page: number,
 *   pageSize: number,
 *   totalPages: number,
 *   criticalCount: number,
 *   totalActiveEmployees: number,
 *   threshold: number
 * }}
 */
function getCriticalBalancesPaginated(db, { threshold = 5, page = 1, pageSize = 15, search = '' } = {}) {
  const safeThreshold = Number.isInteger(Number(threshold)) ? Number(threshold) : 5;
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePageSize = Math.max(1, Math.min(200, parseInt(pageSize, 10) || 15));
  const offset = (safePage - 1) * safePageSize;
  const trimmedSearch = (search || '').trim();

  let searchClause = '';
  const countParams = [safeThreshold];
  const dataParams = [safeThreshold];

  if (trimmedSearch.length > 0) {
    const pattern = `%${trimmedSearch}%`;
    searchClause = `
      AND (
        FullName LIKE ? OR
        LeaveCardNumber LIKE ? OR
        WorkLocation LIKE ? OR
        JobTitle LIKE ? OR
        CAST(EmployeeID AS TEXT) LIKE ?
      )
    `;
    countParams.push(pattern, pattern, pattern, pattern, pattern);
    dataParams.push(pattern, pattern, pattern, pattern, pattern);
  }

  // 1. Total Active Employees Count
  const totalActiveRow = db.prepare('SELECT COUNT(*) as count FROM Employees WHERE IsActive = 1').get();
  const totalActiveEmployees = totalActiveRow ? Number(totalActiveRow.count) : 0;

  // 2. Critical count (matching search if provided)
  const countQuery = `
    ${CRITICAL_BALANCE_CTE}
    SELECT COUNT(*) as total FROM EmployeeCalculations
    WHERE FinalBalance <= ?
    ${searchClause}
  `;
  const countRow = db.prepare(countQuery).get(...countParams);
  const totalCount = countRow ? Number(countRow.total) : 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));

  // 3. Unfiltered total critical count for KPI badge
  const unfiltCriticalRow = db.prepare(`
    ${CRITICAL_BALANCE_CTE}
    SELECT COUNT(*) as total FROM EmployeeCalculations
    WHERE FinalBalance <= ?
  `).get(safeThreshold);
  const criticalCount = unfiltCriticalRow ? Number(unfiltCriticalRow.total) : 0;

  // 4. Paginated data query
  const dataQuery = `
    ${CRITICAL_BALANCE_CTE}
    SELECT
      EmployeeID,
      FullName,
      JobTitle,
      WorkLocation,
      LeaveCardNumber,
      HireDate,
      FinalBalance,
      FinalBalance AS RemainingBalance,
      RegularLeavesTaken,
      GrossEarnedBalance,
      NetServiceDays
    FROM EmployeeCalculations
    WHERE FinalBalance <= ?
    ${searchClause}
    ORDER BY FinalBalance ASC, FullName ASC
    LIMIT ? OFFSET ?
  `;
  dataParams.push(safePageSize, offset);
  const data = db.prepare(dataQuery).all(...dataParams);

  return {
    data,
    totalCount,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    criticalCount,
    totalActiveEmployees,
    threshold: safeThreshold,
  };
}

/**
 * Retrieves paginated yearly accumulated leaves summary.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{
 *   year?: number,
 *   page?: number,
 *   pageSize?: number,
 *   search?: string
 * }} options
 * @returns {{
 *   data: Array<any>,
 *   totalCount: number,
 *   page: number,
 *   pageSize: number,
 *   totalPages: number,
 *   year: number,
 *   summary: { totalDaysThisYear: number, totalLeavesThisYear: number }
 * }}
 */
function getAccumulatedLeavesPaginated(db, { year = new Date().getFullYear(), page = 1, pageSize = 15, search = '' } = {}) {
  const targetYear = Number.isInteger(Number(year)) ? Number(year) : new Date().getFullYear();
  const yearStr = String(targetYear);
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePageSize = Math.max(1, Math.min(200, parseInt(pageSize, 10) || 15));
  const offset = (safePage - 1) * safePageSize;
  const trimmedSearch = (search || '').trim();

  let searchClause = '';
  const params = [yearStr];
  const countParams = [];

  if (trimmedSearch.length > 0) {
    const pattern = `%${trimmedSearch}%`;
    searchClause = `
      AND (
        e.FullName LIKE ? OR
        e.LeaveCardNumber LIKE ? OR
        e.WorkLocation LIKE ? OR
        e.JobTitle LIKE ? OR
        CAST(e.EmployeeID AS TEXT) LIKE ?
      )
    `;
    params.push(pattern, pattern, pattern, pattern, pattern);
    countParams.push(pattern, pattern, pattern, pattern, pattern);
  }

  // 1. Total matching active employees count
  const countRow = db.prepare(`SELECT COUNT(*) AS total FROM Employees e WHERE e.IsActive = 1 ${searchClause}`).get(...countParams);
  const totalCount = countRow ? countRow.total : 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));

  // 2. Paginated data query
  const query = `
    SELECT
      e.EmployeeID,
      e.FullName,
      e.JobTitle,
      e.WorkLocation,
      e.LeaveCardNumber,
      e.HireDate,
      COUNT(l.LeaveID) AS TotalLeavesCount,
      COALESCE(SUM(l.DaysCount), 0) AS TotalDaysCount,
      COALESCE(SUM(CASE WHEN lt.Name = 'إجازة اعتيادية' THEN l.DaysCount ELSE 0 END), 0) AS RegularDaysCount,
      COALESCE(SUM(CASE WHEN lt.Name = 'إجازة مرضية' THEN l.DaysCount ELSE 0 END), 0) AS SickDaysCount,
      COALESCE(SUM(CASE WHEN lt.Name NOT IN ('إجازة اعتيادية', 'إجازة مرضية') THEN l.DaysCount ELSE 0 END), 0) AS OtherDaysCount
    FROM Employees e
    LEFT JOIN Leaves l ON l.EmployeeID = e.EmployeeID AND strftime('%Y', l.StartDate) = ?
    LEFT JOIN LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
    WHERE e.IsActive = 1
    ${searchClause}
    GROUP BY e.EmployeeID
    ORDER BY TotalDaysCount DESC, e.FullName ASC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(query).all(...params, safePageSize, offset);

  const pagedData = rows.map((r) => ({
    ...r,
    TotalConsumedDays: Number(r.TotalDaysCount || 0),
    RegularDays: Number(r.RegularDaysCount || 0),
    SickDays: Number(r.SickDaysCount || 0),
    OtherDays: Number(r.OtherDaysCount || 0),
    LeavesCount: Number(r.TotalLeavesCount || 0),
  }));

  // 3. Overall Year Summary Totals
  const overallTotals = db.prepare(`
    SELECT
      COUNT(l.LeaveID) AS totalLeavesThisYear,
      COALESCE(SUM(l.DaysCount), 0) AS totalDaysThisYear
    FROM Leaves l
    JOIN Employees e ON e.EmployeeID = l.EmployeeID
    WHERE e.IsActive = 1 AND strftime('%Y', l.StartDate) = ?
  `).get(yearStr);

  return {
    data: pagedData,
    totalCount,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    year: targetYear,
    summary: {
      totalDaysThisYear: Number(overallTotals?.totalDaysThisYear || 0),
      totalLeavesThisYear: Number(overallTotals?.totalLeavesThisYear || 0),
    },
  };
}

// ══════════════════════════════════════════════════════════════
//  exportCriticalReportToExcel
//
//  Exports a multi-sheet Excel report:
//    • Sheet 1: Critical Balance Alerts (<= threshold)
//    • Sheet 2: Yearly Leave Accumulation Summary
// ══════════════════════════════════════════════════════════════
async function exportCriticalReportToExcel(filePath, db, { threshold = 5, year = new Date().getFullYear() } = {}) {
  const reportData = getCriticalAndAccumulatedLeaves(db, { threshold, year });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'نظام إدارة الإجازات';
  workbook.created = new Date();
  workbook.modified = new Date();

  // ════════════════════════════════════════════════════════════
  //  SHEET 1: الأرصدة الحرجة (Critical Balances)
  // ════════════════════════════════════════════════════════════
  const wsCritical = workbook.addWorksheet('الأرصدة الحرجة', {
    views: [{ rightToLeft: true }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  const CRIT_COLS = [
    { key: 'seq',       width: 8  },
    { key: 'empId',     width: 14 },
    { key: 'name',      width: 26 },
    { key: 'jobTitle',  width: 20 },
    { key: 'location',  width: 18 },
    { key: 'card',      width: 16 },
    { key: 'balance',   width: 20 }, // الرصيد المتبقي
    { key: 'taken',     width: 18 }, // المستهلك
    { key: 'gross',     width: 18 }, // إجمالي المستحق
    { key: 'hireDate',  width: 16 }, // تاريخ التعيين
  ];
  const CRIT_COL_COUNT = CRIT_COLS.length;
  wsCritical.columns = CRIT_COLS;

  const critStartRow = applyOfficialHeader(wsCritical, {
    title: `كشف تنبيهات الأرصدة الاعتيادية الحرجة (المتبقي ${reportData.threshold} أيام أو أقل)`,
    metaInfo: `إجمالي الموظفين ذوي الأرصدة الحرجة: ${reportData.criticalCount} موظف من أصل ${reportData.totalActiveEmployees} موظف نشط`,
    db,
    colCount: CRIT_COL_COUNT,
  });

  const critHeaderRow = wsCritical.addRow([
    'ت',
    'الرقم الوظيفي',
    'الاسم الكامل',
    'المسمى الوظيفي',
    'موقع العمل',
    'رقم كرت الإجازة',
    'الرصيد المتبقي (يوم)',
    'الإجازات المستهلكة',
    'إجمالي المستحق الكلي',
    'تاريخ التعيين'
  ]);
  applyRowStyle(critHeaderRow, STYLE.header, CRIT_COL_COUNT);
  critHeaderRow.height = 24;

  if (reportData.criticalEmployees.length === 0) {
    const emptyRowNum = critStartRow + 1;
    wsCritical.mergeCells(emptyRowNum, 1, emptyRowNum, CRIT_COL_COUNT);
    const emptyCell = wsCritical.getCell(`A${emptyRowNum}`);
    emptyCell.value = `ممتاز! لا يوجد أي موظف برصيد اعتيادي حرج (≤ ${reportData.threshold} أيام)`;
    emptyCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF047857' } };
    emptyCell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
    wsCritical.getRow(emptyRowNum).height = 24;
  } else {
    reportData.criticalEmployees.forEach((emp, idx) => {
      const cardVal = (emp.LeaveCardNumber !== null && emp.LeaveCardNumber !== undefined && emp.LeaveCardNumber !== '' && !isNaN(Number(emp.LeaveCardNumber)))
        ? Number(emp.LeaveCardNumber)
        : (emp.LeaveCardNumber || '-');

      const dataRow = wsCritical.addRow([
        idx + 1,
        Number(emp.EmployeeID) || emp.EmployeeID,
        emp.FullName,
        emp.JobTitle || '-',
        emp.WorkLocation || '-',
        cardVal,
        Number(emp.FinalBalance),
        Number(emp.RegularLeavesTaken),
        Number(emp.GrossEarnedBalance),
        emp.HireDate,
      ]);

      applyRowStyle(dataRow, idx % 2 === 0 ? STYLE.rowEven : STYLE.rowOdd, CRIT_COL_COUNT);
      dataRow.height = 20;

      dataRow.getCell(1).numFmt = '0';
      dataRow.getCell(2).numFmt = '0';
      if (typeof cardVal === 'number') dataRow.getCell(6).numFmt = '0';
      dataRow.getCell(7).numFmt = '0';
      dataRow.getCell(8).numFmt = '0';
      dataRow.getCell(9).numFmt = '0';

      // Highlight critical balance cell in red / amber
      const balCell = dataRow.getCell(7);
      if (emp.FinalBalance <= 1) {
        balCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        balCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF991B1B' } };
      } else {
        balCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        balCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF92400E' } };
      }
    });
  }

  applyOfficialFooterApprovals(wsCritical, CRIT_COL_COUNT);

  // ════════════════════════════════════════════════════════════
  //  SHEET 2: تراكم الإجازات السنوي (Yearly Leave Accumulation)
  // ════════════════════════════════════════════════════════════
  const wsAccum = workbook.addWorksheet(`تراكم الإجازات (${reportData.year})`, {
    views: [{ rightToLeft: true }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  const ACCUM_COLS = [
    { key: 'seq',         width: 8  },
    { key: 'empId',       width: 14 },
    { key: 'name',        width: 26 },
    { key: 'jobTitle',    width: 20 },
    { key: 'location',    width: 18 },
    { key: 'card',        width: 16 },
    { key: 'totalDays',   width: 20 }, // إجمالي الأيام المستهلكة
    { key: 'regularDays', width: 18 }, // اعتيادية
    { key: 'sickDays',    width: 18 }, // مرضية
    { key: 'otherDays',   width: 18 }, // أخرى
    { key: 'leavesCount', width: 16 }, // عدد الإجازات
  ];
  const ACCUM_COL_COUNT = ACCUM_COLS.length;
  wsAccum.columns = ACCUM_COLS;

  const accumStartRow = applyOfficialHeader(wsAccum, {
    title: `كشف تراكم الإجازات المستهلكة لعام ${reportData.year}`,
    metaInfo: `إجمالي الأيام المستهلكة بالدائرة لعام ${reportData.year}: ${reportData.totalDaysThisYear} يوم   |   إجمالي حركات الإجازات: ${reportData.totalLeavesThisYear} إجازة`,
    db,
    colCount: ACCUM_COL_COUNT,
  });

  const accumHeaderRow = wsAccum.addRow([
    'ت',
    'الرقم الوظيفي',
    'الاسم الكامل',
    'المسمى الوظيفي',
    'موقع العمل',
    'رقم كرت الإجازة',
    'إجمالي الأيام المستهلكة',
    'أيام الاعتيادية',
    'أيام المرضية',
    'أيام أخرى / بلا راتب',
    'عدد الحركات'
  ]);
  applyRowStyle(accumHeaderRow, STYLE.header, ACCUM_COL_COUNT);
  accumHeaderRow.height = 24;

  reportData.accumulatedLeaves.forEach((emp, idx) => {
    const cardVal = (emp.LeaveCardNumber !== null && emp.LeaveCardNumber !== undefined && emp.LeaveCardNumber !== '' && !isNaN(Number(emp.LeaveCardNumber)))
      ? Number(emp.LeaveCardNumber)
      : (emp.LeaveCardNumber || '-');

    const dataRow = wsAccum.addRow([
      idx + 1,
      Number(emp.EmployeeID) || emp.EmployeeID,
      emp.FullName,
      emp.JobTitle || '-',
      emp.WorkLocation || '-',
      cardVal,
      Number(emp.TotalDaysCount),
      Number(emp.RegularDaysCount),
      Number(emp.SickDaysCount),
      Number(emp.OtherDaysCount),
      Number(emp.TotalLeavesCount),
    ]);

    applyRowStyle(dataRow, idx % 2 === 0 ? STYLE.rowEven : STYLE.rowOdd, ACCUM_COL_COUNT);
    dataRow.height = 18;

    dataRow.getCell(1).numFmt = '0';
    dataRow.getCell(2).numFmt = '0';
    if (typeof cardVal === 'number') dataRow.getCell(6).numFmt = '0';
    dataRow.getCell(7).numFmt = '0';
    dataRow.getCell(8).numFmt = '0';
    dataRow.getCell(9).numFmt = '0';
    dataRow.getCell(10).numFmt = '0';
    dataRow.getCell(11).numFmt = '0';
  });

  // Summary Row
  const totalDays = reportData.accumulatedLeaves.reduce((sum, r) => sum + Number(r.TotalDaysCount || 0), 0);
  const totalReg = reportData.accumulatedLeaves.reduce((sum, r) => sum + Number(r.RegularDaysCount || 0), 0);
  const totalSick = reportData.accumulatedLeaves.reduce((sum, r) => sum + Number(r.SickDaysCount || 0), 0);
  const totalOther = reportData.accumulatedLeaves.reduce((sum, r) => sum + Number(r.OtherDaysCount || 0), 0);
  const totalCounts = reportData.accumulatedLeaves.reduce((sum, r) => sum + Number(r.TotalLeavesCount || 0), 0);

  const accumSummaryRow = wsAccum.addRow([
    '',
    '',
    'الإجمالي الكلي لكافة الموظفين',
    '',
    '',
    '',
    totalDays,
    totalReg,
    totalSick,
    totalOther,
    totalCounts
  ]);
  applyRowStyle(accumSummaryRow, STYLE.header, ACCUM_COL_COUNT);
  accumSummaryRow.height = 22;
  accumSummaryRow.getCell(7).numFmt = '0';
  accumSummaryRow.getCell(8).numFmt = '0';
  accumSummaryRow.getCell(9).numFmt = '0';
  accumSummaryRow.getCell(10).numFmt = '0';
  accumSummaryRow.getCell(11).numFmt = '0';

  applyOfficialFooterApprovals(wsAccum, ACCUM_COL_COUNT);

  await workbook.xlsx.writeFile(filePath);
}

// ══════════════════════════════════════════════════════════════
//  exportTransferredEmployeesToExcel
//
//  Exports an official styled Excel report of all employees
//  flagged as externally transferred (IsTransferred = 1).
//
//  @param {string} filePath
//  @param {import('better-sqlite3').Database} db
// ══════════════════════════════════════════════════════════════
async function exportTransferredEmployeesToExcel(filePath, db) {
  if (!db) {
    throw new Error('قاعدة البيانات غير مهيأة لتصدير التقرير.');
  }
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('مسار حفظ التقرير غير صالح.');
  }

  const query = `
    SELECT
      EmployeeID,
      FullName,
      JobTitle,
      WorkLocation,
      LeaveCardNumber,
      LeaveApprover,
      IsActive,
      IsTransferred,
      TransferOrderNumber,
      TransferOrderDate,
      TransferNotes
    FROM Employees
    WHERE IsTransferred = 1
    ORDER BY FullName ASC
  `;

  const rows = db.prepare(query).all();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'نظام إدارة الإجازات';
  workbook.created = new Date();
  workbook.modified = new Date();

  const ws = workbook.addWorksheet('الموظفون المنقولون', {
    views: [{ rightToLeft: true }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  const COLUMNS = [
    { key: 'seq',         width: 8  }, // ت
    { key: 'empId',       width: 14 }, // الرقم الوظيفي
    { key: 'name',        width: 26 }, // اسم الموظف الرباعي واللقب
    { key: 'jobTitle',    width: 22 }, // العنوان / المسمى الوظيفي
    { key: 'location',    width: 20 }, // موقع العمل
    { key: 'card',        width: 16 }, // رقم كرت الإجازة
    { key: 'orderNumber', width: 22 }, // رقم أمر النقل الإداري
    { key: 'orderDate',   width: 18 }, // تاريخ أمر النقل
    { key: 'notes',       width: 34 }, // جهة النقل وملاحظات الانفكاك
    { key: 'status',      width: 16 }, // حالة القيد بالنظام
  ];
  const COL_COUNT = COLUMNS.length;
  ws.columns = COLUMNS;

  // Apply Official Top Header
  const headerStartRow = applyOfficialHeader(ws, {
    title: 'كشف الموظفين الصادر بحقهم أمر نقل خارجي',
    metaInfo: `إجمالي عدد الموظفين المنقولين: ${rows.length} موظف`,
    db,
    colCount: COL_COUNT,
  });

  // Header Row
  const headerRow = ws.addRow([
    'ت',
    'الرقم الوظيفي',
    'اسم الموظف',
    'المسمى الوظيفي',
    'موقع العمل',
    'رقم كرت الإجازة',
    'رقم أمر النقل الإداري',
    'تاريخ أمر النقل',
    'جهة النقل والملاحظات',
    'حالة القيد بالنظام'
  ]);
  applyRowStyle(headerRow, STYLE.header, COL_COUNT);
  headerRow.height = 24;

  // Data Rows
  if (rows.length === 0) {
    const emptyRowNum = headerStartRow + 1;
    ws.mergeCells(emptyRowNum, 1, emptyRowNum, COL_COUNT);
    const emptyCell = ws.getCell(`A${emptyRowNum}`);
    emptyCell.value = 'لا يوجد موظفون مسجلون في قائمة النقل الخارجي حالياً';
    emptyCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FF888888' } };
    emptyCell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
    ws.getRow(emptyRowNum).height = 24;
    for (let c = 1; c <= COL_COUNT; c++) {
      ws.getCell(emptyRowNum, c).border = borderThin();
    }
  } else {
    rows.forEach((emp, index) => {
      const cardVal = (emp.LeaveCardNumber !== null && emp.LeaveCardNumber !== undefined && emp.LeaveCardNumber !== '' && !isNaN(Number(emp.LeaveCardNumber)))
        ? Number(emp.LeaveCardNumber)
        : (emp.LeaveCardNumber || '-');

      const dataRow = ws.addRow([
        index + 1,
        Number(emp.EmployeeID) || emp.EmployeeID,
        emp.FullName,
        emp.JobTitle || '-',
        emp.WorkLocation || '-',
        cardVal,
        emp.TransferOrderNumber || '-',
        emp.TransferOrderDate || '-',
        emp.TransferNotes || '-',
        emp.IsActive === 1 ? 'نشط' : 'غير نشط',
      ]);

      applyRowStyle(dataRow, index % 2 === 0 ? STYLE.rowEven : STYLE.rowOdd, COL_COUNT);
      dataRow.height = 20;

      // Numeric formatting for ID, sequence, card, and order number if numeric
      dataRow.getCell(1).numFmt = '0';
      dataRow.getCell(2).numFmt = '0';
      if (typeof cardVal === 'number') {
        dataRow.getCell(6).numFmt = '0';
      }
      if (emp.TransferOrderNumber && !isNaN(Number(emp.TransferOrderNumber))) {
        dataRow.getCell(7).numFmt = '0';
      }
    });

    // Summary row
    const summaryRow = ws.addRow([
      '',
      '',
      `العدد الإجمالي للمنقولين: ${rows.length}`,
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ]);
    summaryRow.height = 22;
    applyRowStyle(summaryRow, {
      font: { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF142E4D' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } },
      alignment: { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' },
      border: borderThin(),
    }, COL_COUNT);
    ws.mergeCells(summaryRow.number, 3, summaryRow.number, 5);
  }

  // Apply 3-Box Official Approvals Footer
  applyOfficialFooterApprovals(ws, COL_COUNT);

  await workbook.xlsx.writeFile(filePath);
}

// ──────────────────────────────────────────────────────────────
//  Exports
// ──────────────────────────────────────────────────────────────
module.exports = {
  exportEmployeeHistory,
  exportAllEmployees,
  exportActiveLeavesToExcel,
  getCriticalAndAccumulatedLeaves,
  getCriticalBalancesPaginated,
  getAccumulatedLeavesPaginated,
  exportCriticalReportToExcel,
  exportTransferredEmployeesToExcel,
  getDepartmentName,
};

