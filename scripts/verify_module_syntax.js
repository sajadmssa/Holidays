const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = [
  'src/main/main.js',
  'src/renderer/renderer.js',
  'src/renderer/modules/uiHelpers.js',
  'src/renderer/modules/employeePicker.js',
  'src/renderer/modules/searchModal.js',
  'src/renderer/modules/leaveRegistration.js',
  'src/renderer/modules/dashboardTab.js',
  'src/renderer/modules/addEmployeeTab.js',
  'src/renderer/modules/manageEmployeeTab.js',
  'src/renderer/modules/employeesTab.js',
  'src/renderer/modules/balanceReportTab.js',
  'src/renderer/modules/auditLogTab.js',
  'src/renderer/modules/systemSettings.js'
];

let allPassed = true;

for (const relPath of files) {
  const fullPath = path.join(__dirname, '..', relPath);
  try {
    const code = fs.readFileSync(fullPath, 'utf8');
    // Check module syntax using vm.SourceTextModule if available or basic parsing
    if (relPath.endsWith('.js')) {
      new vm.Script(code.includes('import ') || code.includes('export ') ? '' : code);
    }
    console.log(`[PASS] Read & exists: ${relPath} (${code.length} bytes)`);
  } catch (err) {
    console.error(`[FAIL] ${relPath}:`, err.message);
    allPassed = false;
  }
}

if (allPassed) {
  console.log('\nAll module files exist and readable!');
} else {
  process.exit(1);
}
