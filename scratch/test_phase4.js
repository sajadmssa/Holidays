'use strict';

const path = require('path');
const fs = require('fs');

const SANDBOX = path.join(__dirname, 'phase4_sandbox');
const MOCK_APPDATA = path.join(SANDBOX, 'mock_appdata');
const SOURCE_DIR = path.join(SANDBOX, 'sources');
const BACKUPS_DIR = path.join(SANDBOX, 'backups');

// Set isolated environment BEFORE importing database or services
process.env.HOLIDAYS_DB_DIR = MOCK_APPDATA;

if (fs.existsSync(SANDBOX)) {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
}
fs.mkdirSync(MOCK_APPDATA, { recursive: true });
fs.mkdirSync(SOURCE_DIR, { recursive: true });
fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const Database = require('better-sqlite3');
const assert = require('assert');
const AdmZip = require('adm-zip');

const database = require('../src/main/database');
const DocumentStorageService = require('../src/main/services/DocumentStorageService');
const DocumentService = require('../src/main/services/DocumentService');
const EmployeeService = require('../src/main/services/EmployeeService');

// Create a valid dummy PDF
const samplePdf = path.join(SOURCE_DIR, 'test_card.pdf');
fs.writeFileSync(samplePdf, Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\nxref\n0 1\n0000000000 65535 f\ntrailer<</Size 1/Root 1 0 R>>\nstartxref\n99\n%%EOF\n'));

console.log('====================================================');
console.log('  TEST SUITE: Phase 4 — Restore with Custom Paths   ');
console.log('====================================================\n');

let testsPassed = 0;
let totalTests = 0;

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    testsPassed++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'main', 'migrations');
function createPopulatedDb(dbPath, customDocPath = null) {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS _Migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      executedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    db.transaction(() => {
      try { db.exec(sql); } catch (e) {
        if (!e.message.includes('duplicate column name')) throw e;
      }
      db.prepare('INSERT INTO _Migrations (name) VALUES (?)').run(f);
    })();
  }

  if (customDocPath) {
    db.prepare(`
      INSERT INTO _AppSettings (Key, Value, UpdatedAt)
      VALUES ('employee_documents_storage_path', ?, datetime('now', 'localtime'))
      ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value
    `).run(customDocPath);
  }

  return db;
}

async function mainTests() {
  // Initialize mock live database
  const liveDbPath = path.join(MOCK_APPDATA, 'leave_management.db');
  const liveInitDb = createPopulatedDb(liveDbPath);
  liveInitDb.close();

  // ─────────────────────────────────────────────────────────────
  // PART 1: Restore backup with Custom Path that is AVAILABLE
  // ─────────────────────────────────────────────────────────────
  console.log('--- TEST PART 1: Restore Backup with Available Custom Path ---');

  const customPathA = path.join(SANDBOX, 'available_custom_docs');
  fs.mkdirSync(customPathA, { recursive: true });

  const tempDbA = path.join(SANDBOX, 'temp_a.db');
  const dbA = createPopulatedDb(tempDbA, customPathA);

  const empIdA = 5001;
  EmployeeService.addEmployee({
    employeeId: empIdA,
    fullName: 'موظف بمسار مخصص متاح',
    gender: 'Male',
    hireDate: '2022-01-01',
    jobTitle: 'مهندس تخزين'
  }, dbA);

  DocumentService.addDocument({
    employeeId: empIdA,
    documentType: 'TIME_CARD',
    sourceFilePath: samplePdf,
    notes: 'كرت بمسار مخصص متاح'
  }, dbA);

  dbA.close();

  // Build a test bundle .hbak
  const bundleAPath = path.join(BACKUPS_DIR, 'backup_available_custom.hbak');
  const zipA = new AdmZip();
  zipA.addLocalFile(tempDbA, '', 'leave_management.db');
  zipA.addLocalFolder(customPathA, 'EmployeeDocuments');
  zipA.addFile('manifest.json', Buffer.from(JSON.stringify({ app: 'Holidays', version: '4.0.0' }), 'utf8'));
  zipA.writeZip(bundleAPath);

  await runAsyncTest('1.1: Restore bundle to an available custom path', async () => {
    const val = database.validateDatabaseBackup(bundleAPath);
    assert.ok(val.valid, 'Backup should be valid');

    const result = await database.restoreDatabase(bundleAPath);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.pathMigrated, false, 'Should not migrate path when custom path is available');
    assert.strictEqual(path.resolve(result.targetDocPath), path.resolve(customPathA));

    // Verify documents exist at customPathA
    const restoredDb = new Database(liveDbPath, { readonly: true });
    const docs = DocumentService.listDocuments({ employeeId: empIdA }, restoredDb);
    assert.strictEqual(docs.length, 1);
    assert.strictEqual(docs[0].fileExists, true, 'Document should exist in restored custom path');
    restoredDb.close();
  });

  // ─────────────────────────────────────────────────────────────
  // PART 2: Restore backup with Custom Path that is UNAVAILABLE
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST PART 2: Restore Backup with Unavailable Custom Path (Auto-Migration) ---');

  const impossiblePath = 'Z:\\NonExistentDrive_99\\Archive\\Documents';
  const tempDbB = path.join(SANDBOX, 'temp_b.db');
  const dbB = createPopulatedDb(tempDbB, impossiblePath);

  const empIdB = 5002;
  dbB.prepare(`
    INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle)
    VALUES (?, 'موظف مسار مفقود', 'Female', '2023-01-01', 'محللة')
  `).run(empIdB);

  const fakeRelPath = `EMP_${empIdB}/leave_cards/LC_2026_fake.pdf`;
  dbB.prepare(`
    INSERT INTO EmployeeDocuments (
      EmployeeID, DocumentType, DocumentYear, OriginalName, FileName, RelativePath, FileExtension, FileSize, MimeType, IsDeleted
    ) VALUES (?, 'LEAVE_CARD', 2026, 'test_card.pdf', 'LC_2026_fake.pdf', ?, '.pdf', 1024, 'application/pdf', 0)
  `).run(empIdB, fakeRelPath);

  dbB.close();

  // Build archive containing the file
  const bundleBPath = path.join(BACKUPS_DIR, 'backup_unavailable_custom.hbak');
  const zipB = new AdmZip();
  zipB.addLocalFile(tempDbB, '', 'leave_management.db');
  zipB.addFile(`EmployeeDocuments/${fakeRelPath}`, Buffer.from('%PDF-1.4 dummy content'), 'test');
  zipB.addFile('manifest.json', Buffer.from(JSON.stringify({ app: 'Holidays' }), 'utf8'));
  zipB.writeZip(bundleBPath);

  await runAsyncTest('2.1: Detect unavailable path, migrate to default root, update _AppSettings', async () => {
    const result = await database.restoreDatabase(bundleBPath);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.pathMigrated, true, 'pathMigrated should be true');
    assert.ok(result.pathMessage && result.pathMessage.includes('المسار الافتراضي'), 'Should have migration warning message');

    const defaultRoot = DocumentStorageService.getDefaultStorageRoot();
    assert.strictEqual(path.resolve(result.targetDocPath), path.resolve(defaultRoot));

    // Verify DB setting was cleared to default
    const restoredDb = new Database(liveDbPath, { readonly: true });
    const settingRow = restoredDb.prepare("SELECT Value FROM _AppSettings WHERE Key = 'employee_documents_storage_path'").get();
    assert.strictEqual(settingRow.Value, '', 'Setting should be reset to empty default');

    // Verify DocumentService can resolve the file in the new default path
    const docs = DocumentService.listDocuments({ employeeId: empIdB }, restoredDb);
    assert.strictEqual(docs.length, 1);
    assert.strictEqual(docs[0].fileExists, true, 'Document should exist in migrated default storage');
    restoredDb.close();
  });

  // ─────────────────────────────────────────────────────────────
  // PART 3: Interrupted Restore with Emergency Rollback
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST PART 3: Interrupted Restore Emergency Rollback ---');

  // Insert known employee into mock live DB before broken restore
  const preRestoreDb = new Database(liveDbPath);
  preRestoreDb.prepare(`
    INSERT OR REPLACE INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle)
    VALUES (7701, 'موظف الأمان قبل التراجع', 'Male', '2020-01-01', 'حارس بيانات')
  `).run();
  preRestoreDb.close();

  // Create broken bundle
  const badBundlePath = path.join(BACKUPS_DIR, 'broken_bundle.hbak');
  const zipBad = new AdmZip();
  const tempDbBad = path.join(SANDBOX, 'temp_bad.db');
  const dbBad = createPopulatedDb(tempDbBad);
  dbBad.prepare(`
    INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle)
    VALUES (9999, 'موظف النسخة التالفة', 'Male', '2025-01-01', 'مخترق')
  `).run();
  dbBad.close();

  zipBad.addLocalFile(tempDbBad, '', 'leave_management.db');
  zipBad.addFile('EmployeeDocuments/EMP_9999/TRIGGER_ERROR.pdf', Buffer.from('broken content'));
  zipBad.addFile('manifest.json', Buffer.from(JSON.stringify({ app: 'Holidays' })));
  zipBad.writeZip(badBundlePath);

  await runAsyncTest('3.1: Automatically roll back to pre-restore state on extraction failure', async () => {
    const origWriteFile = fs.writeFileSync;
    fs.writeFileSync = function (dest, data, opts) {
      if (typeof dest === 'string' && dest.includes('TRIGGER_ERROR')) {
        throw new Error('SIMULATED_DISK_FULL_ENOSPC');
      }
      return origWriteFile.apply(this, arguments);
    };

    let failedAsExpected = false;
    try {
      await database.restoreDatabase(badBundlePath);
    } catch (err) {
      failedAsExpected = true;
      assert.ok(err.message.includes('SIMULATED_DISK_FULL_ENOSPC') || err.message.includes('التراجع التلقائي'), `Unexpected error msg: ${err.message}`);
    } finally {
      fs.writeFileSync = origWriteFile;
    }

    assert.ok(failedAsExpected, 'restoreDatabase should have failed and thrown');

    // Verify system reverted to pre-restore safety state:
    const revertedDb = new Database(liveDbPath, { readonly: true });
    const safeEmp = revertedDb.prepare('SELECT * FROM Employees WHERE EmployeeID = 7701').get();
    assert.ok(safeEmp, 'Employee 7701 must still exist after emergency rollback!');

    const badEmp = revertedDb.prepare('SELECT * FROM Employees WHERE EmployeeID = 9999').get();
    assert.strictEqual(badEmp, undefined, 'Bad employee 9999 must NOT exist in rolled back DB!');
    revertedDb.close();
  });

  // Cleanup sandbox
  if (fs.existsSync(SANDBOX)) {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  }

  console.log(`\n====================================================`);
  console.log(`  RESULT: ${testsPassed} of ${totalTests} tests passed successfully!`);
  console.log(`====================================================\n`);
}

mainTests().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
