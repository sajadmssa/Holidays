// inspect_project.js
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const rootDir = 'C:\\Users\\3D\\Desktop\\Holidays';

console.log('════════════════════════════════════════════════════════════');
console.log(' AXIS A: ROOT FILES DETAILS & TIMESTAMPS');
console.log('════════════════════════════════════════════════════════════');

const entries = fs.readdirSync(rootDir, { withFileTypes: true });

for (const entry of entries) {
  const fullPath = path.join(rootDir, entry.name);
  const stat = fs.statSync(fullPath);
  const typeStr = entry.isDirectory() ? '[DIR] ' : '[FILE]';
  console.log(
    `${typeStr} ${entry.name.padEnd(65)} | Size: ${String(stat.size).padStart(8)} B | Created: ${stat.birthtime.toISOString()} | Modified: ${stat.mtime.toISOString()}`
  );
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(' DOTFILES CHECK');
console.log('════════════════════════════════════════════════════════════');
const dotfiles = ['.gitignore', '.git', '.env', '.npmignore', '.editorconfig'];
dotfiles.forEach(df => {
  const fullPath = path.join(rootDir, df);
  console.log(`${df.padEnd(15)} : ${fs.existsSync(fullPath) ? 'EXISTS' : 'NOT FOUND'}`);
});

console.log('\n════════════════════════════════════════════════════════════');
console.log(' ROOT .DB FILES CONTENT & METADATA');
console.log('════════════════════════════════════════════════════════════');

const dbFiles = entries.filter(e => e.isFile() && (e.name.endsWith('.db') || e.name.endsWith('.db-wal') || e.name.endsWith('.db-shm')));
for (const dbEntry of dbFiles) {
  if (dbEntry.name.endsWith('.db')) {
    const fullPath = path.join(rootDir, dbEntry.name);
    try {
      const db = new Database(fullPath, { readonly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
      
      let empCount = 'N/A';
      let empSample = [];
      if (tables.includes('Employees')) {
        empCount = db.prepare('SELECT COUNT(*) as c FROM Employees').get().c;
        empSample = db.prepare('SELECT EmployeeID, FullName FROM Employees LIMIT 5').all();
      }
      
      let leaveCount = 'N/A';
      if (tables.includes('Leaves')) {
        leaveCount = db.prepare('SELECT COUNT(*) as c FROM Leaves').get().c;
      }
      
      let auditCount = 'N/A';
      if (tables.includes('AuditLogs')) {
        auditCount = db.prepare('SELECT COUNT(*) as c FROM AuditLogs').get().c;
      }
      
      console.log(`\n📄 DB File: ${dbEntry.name}`);
      console.log(`   - Tables (${tables.length}): ${tables.join(', ')}`);
      console.log(`   - Employees: ${empCount} (${empSample.map(e => `[${e.EmployeeID}: ${e.FullName}]`).join(', ')})`);
      console.log(`   - Leaves: ${leaveCount}`);
      console.log(`   - AuditLogs: ${auditCount}`);
      db.close();
    } catch (err) {
      console.log(`\n📄 DB File: ${dbEntry.name} -> Error reading: ${err.message}`);
    }
  }
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(' TEXT / TEST / JSON SCRATCH FILES IN ROOT');
console.log('════════════════════════════════════════════════════════════');

const textFiles = ['mem_test_result.txt', 'temp_appdata.json', 'temp_dbfiles.json', 'temp_out.txt', 'test.js'];
for (const tf of textFiles) {
  const fullPath = path.join(rootDir, tf);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf8');
    console.log(`\n--- Content of ${tf} (${content.length} chars) ---`);
    console.log(content.slice(0, 500) + (content.length > 500 ? '\n...[truncated]' : ''));
  }
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(' SUBDIRECTORIES CONTENTS: backups, data, scratch, scripts, tests');
console.log('════════════════════════════════════════════════════════════');

const subdirs = ['backups', 'data', 'scratch', 'scripts', 'tests'];
for (const sd of subdirs) {
  const fullPath = path.join(rootDir, sd);
  if (fs.existsSync(fullPath)) {
    console.log(`\n📁 Directory: ${sd}/`);
    const list = fs.readdirSync(fullPath, { withFileTypes: true });
    for (const item of list) {
      const itemStat = fs.statSync(path.join(fullPath, item.name));
      console.log(`   - ${item.isDirectory() ? '[DIR] ' : '[FILE]'} ${item.name.padEnd(45)} | Size: ${itemStat.size} B`);
    }
  } else {
    console.log(`\n📁 Directory: ${sd}/ -> NOT FOUND`);
  }
}
