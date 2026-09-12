// ============================================================
//  scripts/reset-db.js  –  Development Database Reset Utility
//  أداة إعادة ضبط وتصفير قاعدة بيانات التطوير
//
//  PURPOSE / الغرض:
//    Deletes the live SQLite database and its WAL / SHM companion
//    files so that the next `npm run dev` starts with a perfectly
//    clean schema and the corrected Arabic seed data.
//    (حذف ملف قاعدة بيانات SQLite وملفات WAL/SHM المرافقة للبدء بقاعدة بيانات نظيفة ومحدثة).
//
//  USAGE / طريقة الاستخدام:
//    npm run db:reset          → delete only
//    npm run dev:clean         → delete, then launch Electron
//
//  SAFETY RULES / قواعد الأمان:
//    • Runs ONLY outside the Electron process (plain Node.js).
//    • Never touches anything outside the resolved userData directory.
//    • Each file deletion is attempted independently; a missing file
//      is logged as INFO (not an error) so the script stays idempotent.
//    • Any unexpected OS error (permissions, locks) is caught, reported
//      clearly, and causes the process to exit with code 1 so that
//      `npm run dev:clean` aborts before launching Electron.
//
//  PATH RESOLUTION (mirrors Electron's app.getPath('userData')):
//    Windows  : %APPDATA%\<app-name>\
//    macOS    : ~/Library/Application Support/<app-name>/
//    Linux    : $XDG_CONFIG_HOME/<app-name>/  or  ~/.config/<app-name>/
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ──────────────────────────────────────────────────────────────
//  Configuration  (must stay in sync with package.json "name"
//  and database.js DB_PATH)
// ──────────────────────────────────────────────────────────────
const APP_NAME = 'leave-management-system'; // package.json → "name"
const DB_FILE  = 'leave_management.db';     // database.js  → DB_PATH

// ──────────────────────────────────────────────────────────────
//  Resolve the OS-specific userData directory
//  This replicates Electron's app.getPath('userData') exactly,
//  allowing the script to run without Electron being present.
//  استكشاف وتحديد مجلد بيانات المستخدم (userData) بحسب نظام التشغيل
// ──────────────────────────────────────────────────────────────
function resolveUserDataDir() {
  switch (process.platform) {
    case 'win32':
      // %APPDATA% is always set on Windows; fall back to USERPROFILE if not
      return path.join(
        process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        APP_NAME
      );

    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);

    default: // linux and other POSIX
      return path.join(
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
        APP_NAME
      );
  }
}

// ──────────────────────────────────────────────────────────────
//  Logging helpers
// ──────────────────────────────────────────────────────────────
const log = {
  info  : (msg) => console.log(`  [INFO]  ${msg}`),
  ok    : (msg) => console.log(`  [ OK ]  ${msg}`),
  skip  : (msg) => console.log(`  [SKIP]  ${msg}`),
  error : (msg) => console.error(`  [FAIL]  ${msg}`),
  banner: (msg) => console.log(`\n${'─'.repeat(60)}\n  ${msg}\n${'─'.repeat(60)}`),
};

// ──────────────────────────────────────────────────────────────
//  deleteFile(filePath)
//  Deletes a single file.
//  • Missing file  → logs SKIP  (idempotent; not an error)
//  • Deleted OK    → logs OK
//  • OS error      → logs FAIL, re-throws so the caller can exit(1)
//  حذف ملف فردي بأمان مع تسجيل النتيجة ومعالجة حالات القفل
// ──────────────────────────────────────────────────────────────
function deleteFile(filePath) {
  try {
    fs.unlinkSync(filePath);
    log.ok(`Deleted: ${filePath}`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      log.skip(`Not found (already clean): ${path.basename(filePath)}`);
    } else {
      // EACCES → file is locked (Electron still running?)
      // EPERM  → permissions problem
      log.error(`Could not delete ${filePath}`);
      log.error(`  → ${err.code}: ${err.message}`);
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        log.error('  → Is the application still running? Close it and retry.');
      }
      throw err; // propagate to main() so process exits with code 1
    }
  }
}

// ──────────────────────────────────────────────────────────────
//  main()
//  الدالة الرئيسية لحذف ملفات قاعدة البيانات الثلاثة (db و wal و shm)
// ──────────────────────────────────────────────────────────────
function main() {
  log.banner('Leave Management System — DB Reset Utility');

  const userDataDir = resolveUserDataDir();
  const dbPath      = path.join(userDataDir, DB_FILE);

  // The three files SQLite creates for a WAL-mode database.
  // ALL THREE must be removed to prevent SQLite from replaying
  // ghost transactions from a stale write-ahead log on next boot.
  const targets = [
    { label: 'Main database',  file: dbPath           },
    { label: 'WAL journal',    file: dbPath + '-wal'  },
    { label: 'Shared memory',  file: dbPath + '-shm'  },
  ];

  log.info(`App name   : ${APP_NAME}`);
  log.info(`userData   : ${userDataDir}`);
  log.info(`Target DB  : ${dbPath}`);
  console.log('');

  let anyDeleted = false;

  for (const { label, file } of targets) {
    process.stdout.write(`  Removing ${label.padEnd(16)} → `);
    try {
      fs.unlinkSync(file);
      console.log(`DELETED  (${file})`);
      anyDeleted = true;
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log(`skipped  (file not present)`);
      } else {
        console.log(`FAILED`);
        log.error(`Cannot delete: ${file}`);
        log.error(`  ${err.code}: ${err.message}`);
        if (err.code === 'EACCES' || err.code === 'EPERM') {
          log.error('  → Close the application first, then re-run: npm run db:reset');
        }
        // Exit immediately so `dev:clean` does not launch a dirty Electron
        process.exit(1);
      }
    }
  }

  console.log('');

  if (anyDeleted) {
    log.ok('Database reset complete.');
    log.ok('The next launch will create a fresh DB with the corrected schema and Arabic seed data.');
  } else {
    log.ok('Nothing to delete — database was already clean.');
  }

  console.log('');
}

main();
