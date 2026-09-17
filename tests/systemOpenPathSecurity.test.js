// ============================================================
//  tests/systemOpenPathSecurity.test.js
//  اختبارات تحصين قناة system:openPath ضد فتح الملفات الخطرة أو غير الموجودة
//
//  Responsibilities:
//    • التحقق من قبول الامتدادات الآمنة المصرح بها (.xlsx, .pdf, .jpg, .jpeg, .png, .webp) لملفات حقيقية.
//    • التحقق من الرفض الصارم للامتدادات التنفيذية والخطرة (.exe, .bat, .cmd, .vbs, .ps1, .msi, .lnk).
//    • التحقق من رفض فتح أي مسار لملف غير موجود على القرص حتى لو كان الامتداد مصرحاً به.
//    • التحقق من رفض المجلدات، والمسارات الفارغة أو غير النصية.
//    • التحقق من نص رسائل الخطأ العربية الصريحة.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { registerSystemHandlers } = require('../src/main/ipc/systemHandlers');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`  ✅ PASS: ${message}`);
}

(async () => {
  console.log('\n🛡️  [system:openPath Security Tests] Starting test suite...\n');

  const mockIpc = {
    handlers: {},
    handle(channel, fn) {
      this.handlers[channel] = fn;
    }
  };

  // Register system handlers with mock IPC
  registerSystemHandlers(mockIpc);

  const openPathHandler = mockIpc.handlers['system:openPath'];
  assert(typeof openPathHandler === 'function', 'system:openPath handler is registered');

  // Create a temporary sandbox directory for test files
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpath-sec-test-'));

  try {
    // ── 1. فحص رفض المدخلات الفارغة وغير النصية ────────────────────
    console.log('--- Suite 1: Empty and Non-String Inputs ---');
    const resNull = await openPathHandler({}, null);
    assert(resNull.success === false, 'Rejects null input');
    assert(resNull.error.includes('غير صالح أو فارغ'), 'Error message states invalid or empty path for null');

    const resUndefined = await openPathHandler({}, undefined);
    assert(resUndefined.success === false, 'Rejects undefined input');

    const resEmpty = await openPathHandler({}, '');
    assert(resEmpty.success === false, 'Rejects empty string');

    const resWhitespace = await openPathHandler({}, '   ');
    assert(resWhitespace.success === false, 'Rejects whitespace string');

    const resNumber = await openPathHandler({}, 12345);
    assert(resNumber.success === false, 'Rejects numeric input');

    // ── 2. فحص رفض الملفات غير الموجودة ────────────────────────────
    console.log('\n--- Suite 2: Non-Existent Files ---');
    const nonExistentXlsx = path.join(testDir, 'does_not_exist.xlsx');
    const resNonExistent = await openPathHandler({}, nonExistentXlsx);
    assert(resNonExistent.success === false, 'Rejects non-existent .xlsx file');
    assert(resNonExistent.error.includes('الملف غير موجود في المسار المحدد'), 'Error message clearly states file does not exist');

    const nonExistentPdf = path.join(testDir, 'fake.pdf');
    const resFakePdf = await openPathHandler({}, nonExistentPdf);
    assert(resFakePdf.success === false, 'Rejects non-existent .pdf file');

    // ── 3. فحص رفض المجلدات (Folders/Directories) ───────────────────
    console.log('\n--- Suite 3: Directory Rejection ---');
    const subFolder = path.join(testDir, 'subfolder.xlsx'); // Folder named with .xlsx extension
    fs.mkdirSync(subFolder);
    const resFolder = await openPathHandler({}, subFolder);
    assert(resFolder.success === false, 'Rejects directory path even if named with allowed extension');
    assert(resFolder.error.includes('ليس ملفاً صالحاً للفتح'), 'Error message indicates path is not a valid file');

    // ── 4. فحص رفض الامتدادات الخطرة والتنفيذية ───────────────────
    console.log('\n--- Suite 4: Dangerous and Unauthorized Extensions ---');
    const dangerousExtensions = [
      'test.exe',
      'script.bat',
      'cmdfile.cmd',
      'vbs_script.vbs',
      'powershell.ps1',
      'installer.msi',
      'shortcut.lnk',
      'payload.dll',
      'app.com',
      'file_no_ext',
      'document.docx',
      'plain.txt'
    ];

    for (const dangerousFile of dangerousExtensions) {
      const fullPath = path.join(testDir, dangerousFile);
      fs.writeFileSync(fullPath, 'dummy content');
      const res = await openPathHandler({}, fullPath);
      assert(res.success === false, `Rejects dangerous/unauthorized file: ${dangerousFile}`);
      assert(res.error.includes('غير مصرح بفتحه'), `Error message clearly states extension is unauthorized for ${dangerousFile}`);
    }

    // ── 5. فحص قبول الامتدادات المصرح بها لملفات حقيقية موجودة ───
    console.log('\n--- Suite 5: Allowed Document & Image Extensions ---');
    const allowedExtensions = [
      'report.xlsx',
      'document.pdf',
      'photo.jpg',
      'picture.jpeg',
      'scan.png',
      'image.webp',
      'UPPERCASE.XLSX',
      'MixedCase.Pdf'
    ];

    for (const allowedFile of allowedExtensions) {
      const fullPath = path.join(testDir, allowedFile);
      fs.writeFileSync(fullPath, 'safe content');

      // handler passes existence and extension check, then calls shell.openPath
      // In headless test mode, shell.openPath might resolve or return error if no default app,
      // but it MUST pass the security barrier and NOT throw unauthorized extension or non-existent file error!
      const res = await openPathHandler({}, fullPath);
      
      // If shell.openPath succeeded: res.success === true && res.data.opened === true
      // If host OS has no default app association for dummy file: res.success === false with "تعذر فتح الملف"
      // In all cases: it MUST NOT fail on validation!
      if (res.success) {
        assert(res.data.opened === true && res.data.filePath === fullPath, `Accepted valid file: ${allowedFile}`);
      } else {
        assert(!res.error.includes('غير مصرح') && !res.error.includes('غير موجود'), `Passed security checks for: ${allowedFile} (OS shell message: ${res.error})`);
      }
    }

    console.log(`\n🎉 ALL ${passedTests}/${totalTests} SECURITY CHECKS PASSED FOR system:openPath!`);
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (_) {}
  }
})();
