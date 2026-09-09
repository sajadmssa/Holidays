// ============================================================
//  scripts/check_all_syntax.js
//  Performs strict AST/parsing syntax validation on all JS files.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let errorCount = 0;
let fileCount = 0;

function checkSyntax(filePath) {
  fileCount++;
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    if (filePath.includes('renderer') || code.includes('import ') || code.includes('export ')) {
      new vm.SourceTextModule(code, { identifier: filePath });
    } else {
      new vm.Script(code, { filename: filePath });
    }
    console.log(`  ✅ SYNTAX OK: ${path.relative(process.cwd(), filePath)}`);
  } catch (err) {
    errorCount++;
    console.error(`  ❌ SYNTAX ERROR in ${path.relative(process.cwd(), filePath)}:`, err.message);
  }
}

function traverse(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      traverse(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      checkSyntax(fullPath);
    }
  }
}

console.log('════════════════════════════════════════════════════════════');
console.log('  🔍 CHECKING SYNTAX FOR ALL JS FILES IN SRC/');
console.log('════════════════════════════════════════════════════════════\n');

traverse(path.join(__dirname, '../src'));

console.log('\n════════════════════════════════════════════════════════════');
console.log(`  TOTAL: ${fileCount} Files Checked | ${errorCount} Errors Found`);
console.log('════════════════════════════════════════════════════════════\n');

process.exit(errorCount === 0 ? 0 : 1);
