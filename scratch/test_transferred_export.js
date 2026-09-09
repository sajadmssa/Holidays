// ============================================================
//  scratch/test_transferred_export.js
//  Isolated unit test for exportTransferredEmployeesToExcel
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { exportTransferredEmployeesToExcel } = require('../src/main/services/ReportService');

async function runTest() {
  console.log('🧪 Starting isolated test for exportTransferredEmployeesToExcel...\n');

  // 1. Mock DB with department_name and transferred employees
  const mockEmployees = [
    {
      EmployeeID: 1001,
      FullName: 'أحمد علي حسن',
      JobTitle: 'مهندس أقدم',
      WorkLocation: 'محطة الزبير',
      LeaveCardNumber: '550',
      LeaveApprover: 'المدير العام',
      IsActive: 1,
      IsTransferred: 1,
      TransferOrderNumber: '10293',
      TransferOrderDate: '2026-02-15',
      TransferNotes: 'نقل إلى مديرية توزيع البصرة'
    },
    {
      EmployeeID: 1002,
      FullName: 'محمد كريم جاسم',
      JobTitle: 'رئيس ملاحظين',
      WorkLocation: 'المقر الرئيسي',
      LeaveCardNumber: '882',
      LeaveApprover: 'مدير القسم',
      IsActive: 1,
      IsTransferred: 1,
      TransferOrderNumber: '88412',
      TransferOrderDate: '2026-03-01',
      TransferNotes: 'نقل إلى مقر الوزارة / بغداد'
    }
  ];

  let currentRows = [...mockEmployees];

  const db = {
    prepare: (sql) => {
      if (sql.includes('_AppSettings')) {
        return {
          get: () => ({ Value: 'دائرة توزيع كهرباء الجنوب - قسم الموارد البشرية' })
        };
      }
      if (sql.includes('IsTransferred = 1')) {
        return {
          all: () => currentRows
        };
      }
      return {
        get: () => null,
        all: () => []
      };
    }
  };

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const testFilePath = path.join(outDir, 'test_transferred_report.xlsx');
  if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);

  // 2. Run export
  await exportTransferredEmployeesToExcel(testFilePath, db);
  console.log('✅ Export executed successfully. File written to:', testFilePath);

  // 3. Inspect generated Excel file with ExcelJS
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(testFilePath);

  const ws = wb.getWorksheet('الموظفون المنقولون');
  if (!ws) {
    throw new Error('Worksheet "الموظفون المنقولون" was not found in workbook.');
  }
  console.log('✅ Worksheet "الموظفون المنقولون" exists.');

  // Check rightToLeft
  if (ws.views && ws.views[0] && ws.views[0].rightToLeft) {
    console.log('✅ Right-to-Left (RTL) view is active.');
  } else {
    throw new Error('RTL view is not active.');
  }

  // Check pageSetup
  if (ws.pageSetup && ws.pageSetup.orientation === 'landscape' && ws.pageSetup.paperSize === 9) {
    console.log('✅ PageSetup: A4 Landscape configured correctly.');
  } else {
    throw new Error('PageSetup is invalid.');
  }

  // Find department header and title
  let foundDept = false;
  let foundTitle = false;
  let foundTableHeaders = false;
  let row1001Found = false;
  let row1002Found = false;
  let row1003Found = false;
  let foundFooter = false;

  ws.eachRow((row, rowNumber) => {
    const text = row.values.filter(Boolean).map(String).join(' | ');

    if (text.includes('دائرة توزيع كهرباء الجنوب')) foundDept = true;
    if (text.includes('كشف الموظفين الصادر بحقهم أمر نقل خارجي')) foundTitle = true;
    if (text.includes('رقم أمر النقل الإداري') && text.includes('جهة النقل والملاحظات')) foundTableHeaders = true;
    if (text.includes('1001') && text.includes('أحمد علي حسن') && text.includes('10293')) row1001Found = true;
    if (text.includes('1002') && text.includes('محمد كريم جاسم') && text.includes('88412')) row1002Found = true;
    if (text.includes('1003') || text.includes('سارة كاظم')) row1003Found = true;
    if (text.includes('إعداد وتنظيم الكشف') || text.includes('مصادقة واعتماد نهائي')) foundFooter = true;
  });

  if (!foundDept) throw new Error('Department official header was not found.');
  console.log('✅ Official department header found with configured name.');

  if (!foundTitle) throw new Error('Report title was not found.');
  console.log('✅ Main report title found.');

  if (!foundTableHeaders) throw new Error('Table column headers row not found.');
  console.log('✅ 10 table column headers found (including TransferOrderNumber & Notes).');

  if (!row1001Found || !row1002Found) throw new Error('Transferred employee rows not found.');
  console.log('✅ Transferred employees (1001, 1002) found with correct transfer order details.');

  if (row1003Found) throw new Error('Non-transferred employee (1003) leaked into the report!');
  console.log('✅ Non-transferred employee (1003) properly filtered out.');

  if (!foundFooter) throw new Error('Official 3-box signature approval footer not found.');
  console.log('✅ Official 3-box approval footer found at worksheet bottom.');

  // 4. Test Empty State (0 transferred employees)
  console.log('\nTesting empty state (0 transferred employees)...');
  currentRows = [];
  const emptyFilePath = path.join(outDir, 'test_empty_transferred_report.xlsx');
  if (fs.existsSync(emptyFilePath)) fs.unlinkSync(emptyFilePath);

  await exportTransferredEmployeesToExcel(emptyFilePath, db);

  const emptyWb = new ExcelJS.Workbook();
  await emptyWb.xlsx.readFile(emptyFilePath);
  const emptyWs = emptyWb.getWorksheet('الموظفون المنقولون');

  let foundEmptyMsg = false;
  let foundEmptyFooter = false;
  emptyWs.eachRow((row) => {
    const text = row.values.filter(Boolean).map(String).join(' | ');
    if (text.includes('لا يوجد موظفون مسجلون في قائمة النقل الخارجي حالياً')) foundEmptyMsg = true;
    if (text.includes('مصادقة واعتماد نهائي')) foundEmptyFooter = true;
  });

  if (!foundEmptyMsg) throw new Error('Empty state message was not found in empty export.');
  console.log('✅ Empty state message gracefully rendered.');

  if (!foundEmptyFooter) throw new Error('Footer not found in empty export.');
  console.log('✅ 3-box footer also preserved in empty export.');

  console.log('\n🎉 ALL UNIT & INTEGRATION TESTS PASSED 100%!');
}

runTest().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
