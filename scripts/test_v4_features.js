// ============================================================
//  scripts/test_v4_features.js
//  Automated Verification for Holidays System (v4) Features
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

console.log('====================================================');
console.log('🧪 Starting Holidays System v4 Features Test Suite');
console.log('====================================================\n');

// 1. Setup Isolated Test Environment
const testDir = path.join(__dirname, '..', 'scratch', 'test_v4_env');
if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true, force: true });
}
fs.mkdirSync(testDir, { recursive: true });

process.env.APPDATA = testDir;

const db = require('../src/main/database');
const DocumentService = require('../src/main/services/DocumentService');
const DocumentStorageService = require('../src/main/services/DocumentStorageService');
const AutoBackupService = require('../src/main/services/AutoBackupService');
const AuditService = require('../src/main/services/AuditService');

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  try {
    // ── Test 1: Initialize Database & Run Migrations ─────────────
    console.log('📌 Test 1: Database Initialization & Migrations');
    db.initialize();
    const rawDb = db.getDb();

    // Check Migration 014 applied
    const mig014 = rawDb.prepare("SELECT * FROM _Migrations WHERE name = '014_prepare_audit_users.sql'").get();
    assert(!!mig014, 'Migration 014_prepare_audit_users.sql applied successfully');

    // Check AuditLogs table schema has UserID column
    const tableInfo = rawDb.prepare("PRAGMA table_info('AuditLogs')").all();
    const hasUserId = tableInfo.some(col => col.name === 'UserID');
    assert(hasUserId, 'AuditLogs table contains UserID column for future user management');

    // ── Test 2: Create Employee & Add Document Cards ──────────────
    console.log('\n📌 Test 2: Employee Creation & Document Addition');
    const empResult = db.createEmployee({
      fullName: 'أحمد علي حسن الشمري',
      gender: 'Male',
      hireDate: '2020-01-15',
      jobTitle: 'مهندس برمجيات أقدم',
      workLocation: 'المقر العام - تقنية المعلومات',
      leaveCardNumber: 'CRD-2026-99',
      leaveApprover: 'المدير العام',
    });
    const employeeId = empResult.id;
    assert(employeeId > 0, `Employee created with ID: ${employeeId}`);

    // Create dummy PDF and PNG files with valid magic bytes
    const dummyPdfPath = path.join(testDir, 'sample_time_card.pdf');
    const pdfHeader = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    fs.writeFileSync(dummyPdfPath, pdfHeader);

    const dummyPngPath = path.join(testDir, 'sample_leave_card.png');
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    fs.writeFileSync(dummyPngPath, pngHeader);

    const timeCardDoc = DocumentService.addDocument({
      employeeId,
      documentType: 'TIME_CARD',
      sourceFilePath: dummyPdfPath,
      notes: 'كرت زمنية اختباري 2026',
    }, rawDb);
    assert(timeCardDoc.success && timeCardDoc.document.DocumentID > 0, 'Added TIME_CARD document');

    const leaveCardDoc = DocumentService.addDocument({
      employeeId,
      documentType: 'LEAVE_CARD',
      sourceFilePath: dummyPngPath,
      notes: 'كرت إجازة اختباري 2026',
    }, rawDb);
    assert(leaveCardDoc.success && leaveCardDoc.document.DocumentID > 0, 'Added LEAVE_CARD document');

    // ── Test 3: Bundled Backup (.hbak / .zip) ─────────────────────
    console.log('\n📌 Test 3: Bundled Backup Creation (.hbak)');
    const backupBundlePath = path.join(testDir, 'Holidays_Backup_Test.hbak');
    const backupRes = await db.backupDatabase(backupBundlePath);
    assert(backupRes.isBundle === true, 'backupDatabase recognized and created bundle');
    assert(fs.existsSync(backupBundlePath), 'Bundle file exists on disk');

    // Verify Zip Bundle contents
    const zip = new AdmZip(backupBundlePath);
    const entries = zip.getEntries().map(e => e.entryName);
    assert(entries.includes('leave_management.db'), 'Bundle contains leave_management.db');
    assert(entries.includes('manifest.json'), 'Bundle contains manifest.json');
    assert(entries.some(e => e.startsWith('EmployeeDocuments/')), 'Bundle contains EmployeeDocuments folder and files');

    const manifestText = zip.readAsText('manifest.json');
    const manifest = JSON.parse(manifestText);
    assert(manifest.version === '4.0.0' && manifest.documentsCount >= 2, `Manifest valid (version: ${manifest.version}, docs: ${manifest.documentsCount})`);

    // ── Test 4: Validate Backup Bundle ────────────────────────────
    console.log('\n📌 Test 4: Validate Backup Bundle');
    const valResult = db.validateDatabaseBackup(backupBundlePath);
    assert(valResult.valid === true, 'validateDatabaseBackup returns valid: true');
    assert(valResult.isBundle === true, 'validateDatabaseBackup identifies bundle format');
    assert(valResult.employeesCount >= 1, `Employees count in backup: ${valResult.employeesCount}`);
    assert(valResult.documentsCount >= 2, `Documents count in backup: ${valResult.documentsCount}`);

    // ── Test 5: Soft-Deleted Document Stats & Manual Purge ─────────
    console.log('\n📌 Test 5: Soft-Deleted Documents Policy & Purge');
    // Initially 0 deleted docs
    let stats = DocumentService.getDeletedDocumentsStats(rawDb);
    assert(stats.count === 0, 'Initial deleted docs count is 0');

    // Soft delete one document
    DocumentService.softDeleteDocument(timeCardDoc.document.DocumentID, rawDb);
    stats = DocumentService.getDeletedDocumentsStats(rawDb);
    assert(stats.count === 1 && stats.totalBytes > 0, `Deleted docs stats: count=${stats.count}, size=${stats.formattedSize}`);

    // Verify file still exists physically before purge
    const docBeforePurge = DocumentService.getDocumentById(timeCardDoc.document.DocumentID, rawDb);
    assert(docBeforePurge.fileExists === true, 'Soft-deleted file remains on disk before purge');

    // Execute permanent purge
    const purgeRes = DocumentService.purgeDeletedDocuments(rawDb);
    assert(purgeRes.success === true && purgeRes.purgedCount === 1, `Purge executed: purged ${purgeRes.purgedCount} files (${purgeRes.formattedSize})`);

    // Verify file removed physically and record cleaned from DB
    const statsAfter = DocumentService.getDeletedDocumentsStats(rawDb);
    assert(statsAfter.count === 0, 'Deleted docs count is 0 after purge');
    assert(fs.existsSync(docBeforePurge.absolutePath) === false, 'Physical file unlinked from disk');

    // Verify audit log recorded for purge
    const auditLogs = AuditService.getAuditLogs(rawDb, { actionType: 'DELETE', entityType: 'System' });
    assert(auditLogs.totalCount > 0, 'Audit log recorded for purge operation');

    // ── Test 6: Auto-Backup Rotation with .hbak ───────────────────
    console.log('\n📌 Test 6: AutoBackupService .hbak Creation & Rotation');
    const autoRes = await AutoBackupService.checkAndRunAutoBackup(rawDb, { force: true, baseDir: testDir });
    assert(autoRes.performed === true && autoRes.fileName.endsWith('.hbak'), `Auto backup created bundle: ${autoRes.fileName}`);
    assert(fs.existsSync(autoRes.backupPath), 'Auto backup file exists on disk');

    console.log('\n====================================================');
    console.log(`🏁 Test Results: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');

    db.close();

    // Clean up test environment
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (_) {}

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Unexpected Test Error:', err);
    try { db.close(); } catch (_) {}
    process.exit(1);
  }
}

runTests();
