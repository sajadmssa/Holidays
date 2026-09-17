// ============================================================
//  tests/zipSlipProtection.test.js
//  Security Unit & Integration Test for Zip Slip & Path Traversal Protection
// ============================================================

'use strict';

// Transparent ABI bridge: if run via external Node.js, re-exec via Electron's embedded Node
if (!process.versions.electron && process.env.ELECTRON_RUN_AS_NODE !== '1') {
  const { spawnSync } = require('child_process');
  const electronPath = require('electron');
  const result = spawnSync(electronPath, [__filename], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  process.exit(result.status ?? 0);
}

const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');

console.log('🛡️  [ZipSlipProtection Security Tests] Starting test suite...\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    process.exit(1);
  }
  passedTests++;
  console.log(`  ✅ PASS: ${message}`);
}

function assertThrows(fn, expectedSubstr, message) {
  totalTests++;
  try {
    fn();
    console.error(`  ❌ FAIL: Expected error containing "${expectedSubstr}" was NOT thrown: ${message}`);
    process.exit(1);
  } catch (err) {
    if (expectedSubstr && !err.message.includes(expectedSubstr)) {
      console.error(`  ❌ FAIL: Error thrown did not contain "${expectedSubstr}". Got: "${err.message}": ${message}`);
      process.exit(1);
    }
    passedTests++;
    console.log(`  ✅ PASS: ${message}`);
  }
}

// ── Test Section 1: Unit Tests for resolveSafePathWithinRoot ──────────────────
console.log('--- Section 1: Unit tests for resolveSafePathWithinRoot ---');

const { resolveSafePathWithinRoot } = require('../src/main/utils/pathValidator');
const mockRoot = path.join(os.tmpdir(), 'test_storage_root_' + Date.now());

// 1. Valid safe path resolution
const safePath = resolveSafePathWithinRoot(mockRoot, 'EMP_10/time_cards/card.pdf');
assert(
  safePath === path.resolve(mockRoot, 'EMP_10/time_cards/card.pdf'),
  'Safe relative path correctly resolved inside root'
);

// 2. Reject parent directory traversal (Unix style)
assertThrows(
  () => resolveSafePathWithinRoot(mockRoot, '../../evil.txt'),
  'Path Traversal / Zip Slip Detected',
  'Rejects Unix-style parent traversal (../../evil.txt)'
);

// 3. Reject parent directory traversal (Windows style)
assertThrows(
  () => resolveSafePathWithinRoot(mockRoot, '..\\..\\evil.txt'),
  'Path Traversal / Zip Slip Detected',
  'Rejects Windows-style parent traversal (..\\..\\evil.txt)'
);

// 4. Reject null byte injection
assertThrows(
  () => resolveSafePathWithinRoot(mockRoot, 'valid.pdf\0evil.exe'),
  'Path Traversal / Zip Slip Detected',
  'Rejects null byte injection (\\0)'
);

// 5. Reject UNC network paths
assertThrows(
  () => resolveSafePathWithinRoot(mockRoot, '\\\\evil-server\\share\\hack.txt'),
  'Path Traversal / Zip Slip Detected',
  'Rejects UNC path (\\\\evil-server\\share)'
);

// 6. Reject Windows absolute drive letter paths
assertThrows(
  () => resolveSafePathWithinRoot(mockRoot, 'C:\\Windows\\System32\\calc.exe'),
  'Path Traversal / Zip Slip Detected',
  'Rejects Windows drive path (C:\\Windows\\System32)'
);

// ── Test Section 2: Integration Test with Malicious .hbak Package ─────────────
console.log('\n--- Section 2: Integration Test: restoreDatabase with malicious .hbak ---');

const testSandboxDir = path.join(os.tmpdir(), 'holidays_sec_sandbox_' + Date.now());
const testDbDir = path.join(testSandboxDir, 'isolated_db');
const testDocsDir = path.join(testDbDir, 'EmployeeDocuments');
const escapeTargetDir = path.join(testSandboxDir, 'escaped_dir');

fs.mkdirSync(testDbDir, { recursive: true });
fs.mkdirSync(testDocsDir, { recursive: true });
fs.mkdirSync(escapeTargetDir, { recursive: true });

// Point database.js to our isolated test directory
process.env.HOLIDAYS_DB_DIR = testDbDir;

const database = require('../src/main/database');
const LoggerService = require('../src/main/services/LoggerService');

// Initialize isolated DB
database.initialize();

(async () => {
  // 1. Generate a 100% valid .hbak archive via production backupDatabase
  const validBackupPath = path.join(testSandboxDir, 'valid_backup.hbak');
  await database.backupDatabase(validBackupPath);

  // 2. Inject malicious Zip Slip entry into the valid archive
  const maliciousZip = new AdmZip(validBackupPath);
  const escapedEvilFile = path.join(escapeTargetDir, 'evil.txt');
  maliciousZip.addFile(
    'dummy.txt',
    Buffer.from('MALICIOUS CONTENT INJECTED VIA ZIP SLIP')
  );
  const injectedEntry = maliciousZip.getEntry('dummy.txt');
  injectedEntry.entryName = 'EmployeeDocuments/../../escaped_dir/evil.txt';

  const maliciousZipPath = path.join(testSandboxDir, 'malicious_backup.hbak');
  maliciousZip.writeZip(maliciousZipPath);

  // 3. Spy on LoggerService.error to ensure rejection is formally recorded
  let loggedError = null;
  const originalLoggerError = LoggerService.error;
  LoggerService.error = (tag, msg, err) => {
    if (tag === 'DB' && typeof msg === 'string' && msg.includes('[DB Restore Failed]')) {
      loggedError = msg;
    }
    originalLoggerError.call(LoggerService, tag, msg, err);
  };

  let restoreFailed = false;
  try {
    await database.restoreDatabase(maliciousZipPath);
  } catch (err) {
    restoreFailed = true;
    assert(
      err.message.includes('Zip Slip') || err.message.includes('Path Traversal'),
      `Restore rejected with security exception: ${err.message}`
    );
  }

  assert(restoreFailed === true, 'restoreDatabase failed and aborted on malicious archive');

  // 4. CRITICAL: Verify that evil.txt was NOT written to escapeTargetDir!
  assert(
    !fs.existsSync(escapedEvilFile),
    'ZERO file write: evil.txt was NOT created outside target storage directory'
  );

  // 5. Verify that rejection was recorded in LoggerService
  assert(
    loggedError !== null && (loggedError.includes('Zip Slip') || loggedError.includes('Path Traversal')),
    'Rejection was successfully recorded in LoggerService.error'
  );

  // Restore LoggerService
  LoggerService.error = originalLoggerError;

  // Close database and clean up sandbox
  database.close();
  try {
    fs.rmSync(testSandboxDir, { recursive: true, force: true });
  } catch (_) {}

  console.log(`\n🎉 ALL ${passedTests}/${totalTests} SECURITY CHECKS PASSED FOR ZIP SLIP PROTECTION!\n`);
  process.exit(0);
})().catch(err => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
