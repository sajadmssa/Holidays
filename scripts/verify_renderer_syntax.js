// ============================================================
//  scripts/verify_renderer_syntax.js
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = [
  'src/renderer/modules/leaveRegistration.js',
  'src/renderer/modules/auditLogTab.js',
  'src/renderer/modules/employeePicker.js',
  'src/renderer/modules/searchModal.js',
  'src/renderer/renderer.js',
  'src/main/services/LeaveService.js',
  'src/main/services/ReportService.js',
  'src/main/ipc/leaveHandlers.js',
];

let allOk = true;
for (const file of files) {
  const filePath = path.join(__dirname, '..', file);
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    if (file.includes('src/main')) {
      require(filePath);
    } else {
      new vm.SourceTextModule(code, { identifier: file });
    }
    console.log(`✅ [OK] ${file}`);
  } catch (err) {
    console.error(`❌ [ERROR] ${file}:`, err.message);
    allOk = false;
  }
}

if (allOk) {
  console.log('\nAll files passed syntax validation!');
} else {
  process.exit(1);
}
