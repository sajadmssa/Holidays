// execute_reorganization.js
'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = 'C:\\Users\\3D\\Desktop\\Holidays';

console.log('════════════════════════════════════════════════════════════');
console.log(' 1. Creating Directory Structure for Backups');
console.log('════════════════════════════════════════════════════════════');

const manualArchiveDir = path.join(rootDir, 'backups', 'manual-archive');
const safetyArchiveDir = path.join(rootDir, 'backups', 'safety-archive');

fs.mkdirSync(manualArchiveDir, { recursive: true });
fs.mkdirSync(safetyArchiveDir, { recursive: true });
console.log('✅ Created directories:');
console.log('   - backups/manual-archive/');
console.log('   - backups/safety-archive/');

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 2. Moving Manual Archive Backups');
console.log('════════════════════════════════════════════════════════════');

const manualFiles = [
  'leave_management_backup_2026-09-02.db',
  'leave_management_backup_2026-09-02.db-shm',
  'leave_management_backup_2026-09-02.db-wal',
];

for (const mf of manualFiles) {
  const src = path.join(rootDir, mf);
  const dest = path.join(manualArchiveDir, mf);
  if (fs.existsSync(src)) {
    fs.renameSync(src, dest);
    console.log(`✅ Moved: ${mf} -> backups/manual-archive/${mf}`);
  } else {
    console.log(`⚠️ Source file not found: ${mf}`);
  }
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3. Moving Safety Backup & Deleting Duplicates');
console.log('════════════════════════════════════════════════════════════');

const keepSafety = 'leave_management_backup_before_cleanup_2026-09-05T08-23-39-915Z.db';
const deleteDuplicates = [
  'leave_management_backup_before_cleanup_2026-09-05T08-23-21-902Z.db',
  'leave_management_backup_before_cleanup_2026-09-05T08-23-33-449Z.db',
];

// Move the kept safety backup
const keepSrc = path.join(rootDir, keepSafety);
const keepDest = path.join(safetyArchiveDir, keepSafety);
if (fs.existsSync(keepSrc)) {
  fs.renameSync(keepSrc, keepDest);
  console.log(`✅ Kept & Moved: ${keepSafety} -> backups/safety-archive/${keepSafety}`);
} else {
  console.log(`⚠️ Source file not found: ${keepSafety}`);
}

// Move existing safety backups from backups/ to backups/safety-archive/ if any
const existingBackups = fs.readdirSync(path.join(rootDir, 'backups'), { withFileTypes: true });
for (const eb of existingBackups) {
  if (eb.isFile() && eb.name.startsWith('backup_before_cleanup_')) {
    const srcEb = path.join(rootDir, 'backups', eb.name);
    const destEb = path.join(safetyArchiveDir, eb.name);
    fs.renameSync(srcEb, destEb);
    console.log(`✅ Moved existing safety backup: backups/${eb.name} -> backups/safety-archive/${eb.name}`);
  }
}

// Delete duplicate backups
for (const df of deleteDuplicates) {
  const delPath = path.join(rootDir, df);
  if (fs.existsSync(delPath)) {
    fs.unlinkSync(delPath);
    console.log(`🗑️ Deleted duplicate: ${df}`);
  } else {
    console.log(`ℹ️ File already removed: ${df}`);
  }
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 4. Deleting Temporary & Scratch Files from Root');
console.log('════════════════════════════════════════════════════════════');

const tempFilesToDelete = [
  'check_emps.db-shm',
  'check_emps.db-wal',
  'mem_test_result.txt',
  'temp_appdata.json',
  'temp_dbfiles.json',
  'temp_out.txt',
];

for (const tf of tempFilesToDelete) {
  const tfPath = path.join(rootDir, tf);
  if (fs.existsSync(tfPath)) {
    fs.unlinkSync(tfPath);
    console.log(`🗑️ Deleted: ${tf}`);
  } else {
    console.log(`ℹ️ File already removed: ${tf}`);
  }
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 5. Moving test.js to scripts/');
console.log('════════════════════════════════════════════════════════════');

const testJsSrc = path.join(rootDir, 'test.js');
const testJsDest = path.join(rootDir, 'scripts', 'test.js');
if (fs.existsSync(testJsSrc)) {
  fs.renameSync(testJsSrc, testJsDest);
  console.log(`✅ Moved: test.js -> scripts/test.js`);
} else {
  console.log(`ℹ️ test.js not found at root`);
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 6. Final Root Directory Listing');
console.log('════════════════════════════════════════════════════════════');

const finalRootList = fs.readdirSync(rootDir, { withFileTypes: true });
for (const item of finalRootList) {
  const stat = fs.statSync(path.join(rootDir, item.name));
  const typeStr = item.isDirectory() ? '[DIR] ' : '[FILE]';
  console.log(`${typeStr} ${item.name.padEnd(30)} | Size: ${stat.size} B`);
}

console.log('\n✅ File organization completed successfully!');
