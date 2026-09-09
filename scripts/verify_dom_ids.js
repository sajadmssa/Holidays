const fs = require('fs');
const path = require('path');

const log = [];
function print(msg) {
  console.log(msg);
  log.push(msg);
}

const htmlPath = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Extract all IDs from HTML
const idRegex = /id=["']([^"']+)["']/g;
const htmlIds = new Set();
let match;
while ((match = idRegex.exec(htmlContent)) !== null) {
  htmlIds.add(match[1]);
}

print(`Found ${htmlIds.size} unique IDs in index.html.`);

const modulesDir = path.join(__dirname, '..', 'src', 'renderer');
const moduleFiles = [
  'renderer.js',
  'modules/uiHelpers.js',
  'modules/employeePicker.js',
  'modules/searchModal.js',
  'modules/leaveRegistration.js',
  'modules/dashboardTab.js',
  'modules/addEmployeeTab.js',
  'modules/manageEmployeeTab.js',
  'modules/employeesTab.js',
  'modules/balanceReportTab.js',
  'modules/auditLogTab.js',
  'modules/systemSettings.js'
];

let missingCount = 0;
let matchCount = 0;

for (const relFile of moduleFiles) {
  const filePath = path.join(modulesDir, relFile);
  if (!fs.existsSync(filePath)) {
    print(`[ERROR] Missing file: ${filePath}`);
    missingCount++;
    continue;
  }
  const code = fs.readFileSync(filePath, 'utf8');
  
  // Find all getElementById calls
  const getByIdRegex = /getElementById\(['"]([^'"]+)['"]\)/g;
  let getByIdMatch;
  while ((getByIdMatch = getByIdRegex.exec(code)) !== null) {
    const idName = getByIdMatch[1];
    if (!htmlIds.has(idName)) {
      print(`[ERROR in ${relFile}] ID "${idName}" does NOT exist in index.html!`);
      missingCount++;
    } else {
      matchCount++;
    }
  }
}

print(`Checked ${matchCount} getElementById calls.`);

if (missingCount === 0) {
  print('SUCCESS: All DOM IDs in all modules exist in index.html with 100% precision!');
} else {
  print(`FAILED: Found ${missingCount} mismatched IDs!`);
}

fs.writeFileSync(path.join(__dirname, 'dom_ids_result.txt'), log.join('\n'), 'utf8');
