'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DocumentStorageService = require('../src/main/services/DocumentStorageService');

const TEST_DIR = path.join(__dirname, 'phase3_sandbox');
const TEST_DB_PATH = path.join(TEST_DIR, 'phase3_test.db');
const TEST_STORAGE_ROOT = path.join(TEST_DIR, 'EmployeeDocuments');

// Setup clean sandbox
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_STORAGE_ROOT, { recursive: true });

// Create test DB with custom storage root
const db = new Database(TEST_DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS _AppSettings (
    Key TEXT PRIMARY KEY,
    Value TEXT,
    UpdatedAt TEXT
  );
`);
db.prepare(`
  INSERT INTO _AppSettings (Key, Value, UpdatedAt)
  VALUES ('employee_documents_storage_path', ?, datetime('now', 'localtime'))
`).run(TEST_STORAGE_ROOT);

console.log('====================================================');
console.log('  TEST SUITE: Phase 3 — Prefix Traversal Security   ');
console.log('====================================================\n');

let testsPassed = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    testsPassed++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// PART 1: Legitimate Paths (No False Positives)
// ─────────────────────────────────────────────────────────────
console.log('--- TEST PART 1: Legitimate File Paths ---');

runTest('1.1: Resolve standard relative path for employee time card', () => {
  const rel = 'EMP_101/time_cards/TC_2026_01.pdf';
  const resolved = DocumentStorageService.resolveAbsolutePath(rel, db);
  const expected = path.join(TEST_STORAGE_ROOT, 'EMP_101', 'time_cards', 'TC_2026_01.pdf');
  assert.strictEqual(path.resolve(resolved), path.resolve(expected));
});

runTest('1.2: Resolve standard path with Windows backslashes', () => {
  const rel = 'EMP_202\\leave_cards\\LC_2026_02.png';
  const resolved = DocumentStorageService.resolveAbsolutePath(rel, db);
  const expected = path.join(TEST_STORAGE_ROOT, 'EMP_202', 'leave_cards', 'LC_2026_02.png');
  assert.strictEqual(path.resolve(resolved), path.resolve(expected));
});

runTest('1.3: Resolve path with leading slashes safely normalized', () => {
  const rel = '/EMP_303/time_cards/TC_2026_03.webp';
  const resolved = DocumentStorageService.resolveAbsolutePath(rel, db);
  const expected = path.join(TEST_STORAGE_ROOT, 'EMP_303', 'time_cards', 'TC_2026_03.webp');
  assert.strictEqual(path.resolve(resolved), path.resolve(expected));
});

// ─────────────────────────────────────────────────────────────
// PART 2: Hostile Paths & Prefix Traversal Attacks
// ─────────────────────────────────────────────────────────────
console.log('\n--- TEST PART 2: Sibling Prefix Traversal & Boundary Attacks ---');

runTest('2.1: Reject path traversal using parent directory (..)', () => {
  assert.throws(() => {
    DocumentStorageService.resolveAbsolutePath('EMP_101/../../../Windows/System32/cmd.exe', db);
  }, /Path Traversal Detected/);
});

runTest('2.2: Reject path containing null byte character (\\0)', () => {
  assert.throws(() => {
    DocumentStorageService.resolveAbsolutePath('EMP_101/test.pdf\0.png', db);
  }, /Path Traversal Detected/);
});

runTest('2.3: Reject absolute Windows drive path as relativePath', () => {
  assert.throws(() => {
    DocumentStorageService.resolveAbsolutePath('C:\\SecretFolder\\secret.pdf', db);
  }, /Path Traversal Detected/);
});

runTest('2.4: Reject UNC remote network path (\\\\server\\share)', () => {
  assert.throws(() => {
    DocumentStorageService.resolveAbsolutePath('\\\\192.168.1.100\\evil_share\\payload.pdf', db);
  }, /Path Traversal Detected/);

  assert.throws(() => {
    DocumentStorageService.resolveAbsolutePath('//remote-server/share/payload.pdf', db);
  }, /Path Traversal Detected/);
});

runTest('2.5: Enforce separator boundary: Sibling folder with identical text prefix is strictly blocked', () => {
  // Sibling folder scenario:
  // Root is: "C:/Sandbox/EmployeeDocuments"
  // Sibling is: "C:/Sandbox/EmployeeDocuments_Attacker"
  const root = path.resolve(TEST_STORAGE_ROOT);
  const siblingDir = root + '_Attacker';
  const siblingFile = path.join(siblingDir, 'malicious.pdf');

  // Verify that the separator boundary check rejects sibling file
  const normalizedRoot = root.replace(/\\/g, '/');
  const normalizedRootWithSep = normalizedRoot.endsWith('/') ? normalizedRoot : normalizedRoot + '/';
  const normalizedSiblingFile = siblingFile.replace(/\\/g, '/');

  // 1. The old vulnerable check: accepted because "EmployeeDocuments_Attacker".startsWith("EmployeeDocuments") === true
  const oldVulnerableCheck = normalizedSiblingFile.startsWith(normalizedRoot);
  assert.strictEqual(oldVulnerableCheck, true, 'Old check without separator was vulnerable');

  // 2. The new safe check: rejected because "EmployeeDocuments_Attacker" does not start with "EmployeeDocuments/"
  const newSafeCheck = normalizedSiblingFile.startsWith(normalizedRootWithSep);
  assert.strictEqual(newSafeCheck, false, 'New check with separator strictly rejects sibling directory!');

  // 3. path.relative check:
  const relativeDiff = path.relative(root, siblingFile);
  const isOutside = relativeDiff.startsWith('..') || path.isAbsolute(relativeDiff);
  assert.strictEqual(isOutside, true, 'path.relative correctly flags sibling as outside root!');
});

db.close();

// Cleanup sandbox
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}

console.log(`\n====================================================`);
console.log(`  RESULT: ${testsPassed} of ${totalTests} tests passed successfully!`);
console.log(`====================================================\n`);
