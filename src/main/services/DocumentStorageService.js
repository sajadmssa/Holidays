// ============================================================
//  services/DocumentStorageService.js – Secure Document Storage Engine
//  Main Process ONLY
//  Responsibilities:
//    • Calculate dynamic storage root from _AppSettings or %APPDATA% default
//    • Build safe folder hierarchy: [StorageRoot]/EMP_[ID]/time_cards|leave_cards
//    • Generate safe unique filenames: [TYPE]_[YEAR]_[TIMESTAMP]_[RANDOM_HEX].[EXT]
//    • Strict Path Traversal prevention (path.resolve + prefix check)
//    • Whitelist extensions (pdf, jpg, jpeg, png, webp)
//    • Magic Bytes header inspection to detect disguised files
//    • File size validation (<= 25MB default)
//    • Copy files for addition / external import (NEVER deletes original file)
//    • Test write/read permissions on storage paths
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const LoggerService = require('./LoggerService');

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

const FOLDER_NAMES = {
  'TIME_CARD': 'time_cards',
  'LEAVE_CARD': 'leave_cards'
};

/**
 * Gets the default storage root folder under userData/APPDATA.
 * @returns {string} Default absolute directory path
 */
function getDefaultStorageRoot() {
  let baseDir = process.env.HOLIDAYS_DB_DIR;
  if (!baseDir) {
    try {
      const { app } = require('electron');
      if (app && typeof app.getPath === 'function') {
        baseDir = app.getPath('userData');
      }
    } catch (_) {}
  }
  if (!baseDir) {
    baseDir = process.env.APPDATA ? path.join(process.env.APPDATA, 'leave-management-system') : '.';
  }

  return path.join(baseDir, 'EmployeeDocuments');
}

/**
 * Resolves the active Storage Root from _AppSettings or fallback default.
 * Ensures the directory exists before returning.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {string} Absolute normalized directory path
 */
function getStorageRoot(db) {
  let storageRoot = null;

  if (db) {
    try {
      const row = db.prepare("SELECT Value FROM _AppSettings WHERE Key = 'employee_documents_storage_path'").get();
      if (row && row.Value && typeof row.Value === 'string' && row.Value.trim().length > 0) {
        storageRoot = path.resolve(row.Value.trim());
      }
    } catch (err) {
      LoggerService.warn('DocumentStorageService', 'Failed to read custom storage path from settings, falling back to default', err);
    }
  }

  if (!storageRoot) {
    storageRoot = getDefaultStorageRoot();
  }

  storageRoot = path.resolve(storageRoot);

  if (!fs.existsSync(storageRoot)) {
    fs.mkdirSync(storageRoot, { recursive: true });
  }

  return storageRoot;
}

/**
 * Validates magic bytes of the file to ensure it matches the claimed extension.
 *
 * @param {string} filePath - Absolute path to file on disk
 * @param {string} ext - Lowercase extension with dot (e.g. '.pdf')
 * @returns {boolean} True if magic bytes match extension
 */
function validateMagicBytes(filePath, ext) {
  let fd = null;
  try {
    const buf = Buffer.alloc(16);
    fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    if (bytesRead < 4) {
      return false;
    }

    if (ext === '.pdf') {
      // PDF: %PDF- (0x25, 0x50, 0x44, 0x46)
      return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
    }

    if (ext === '.png') {
      // PNG: \x89PNG\r\n\x1a\n (0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
      return (
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4E &&
        buf[3] === 0x47 &&
        buf[4] === 0x0D &&
        buf[5] === 0x0A &&
        buf[6] === 0x1A &&
        buf[7] === 0x0A
      );
    }

    if (ext === '.jpg' || ext === '.jpeg') {
      // JPEG: FF D8 FF
      return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    }

    if (ext === '.webp') {
      // WEBP: RIFF at 0..3 and WEBP at 8..11
      const isRiff = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46;
      const isWebp = buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
      return isRiff && isWebp;
    }

    return false;
  } catch (err) {
    LoggerService.error('DocumentStorageService', `Error verifying magic bytes for ${filePath}: ${err.message}`);
    return false;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

/**
 * Resolves a relative path to an absolute path within Storage Root,
 * strictly preventing Path Traversal and sibling prefix matching bypasses.
 *
 * @param {string} relativePath - Relative path stored in DB (e.g. 'EMP_10/time_cards/TC_...')
 * @param {import('better-sqlite3').Database} db
 * @returns {string} Safe absolute path
 */
function resolveAbsolutePath(relativePath, db) {
  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error('مسار المستند غير صالح.');
  }

  // Reject UNC paths, absolute Windows drive paths, explicit parent traversal, or null bytes
  if (
    relativePath.startsWith('\\\\') ||
    relativePath.startsWith('//') ||
    /^[a-zA-Z]:/.test(relativePath) ||
    relativePath.includes('..') ||
    relativePath.includes('\0')
  ) {
    throw new Error('محاولة وصول غير مصرح بها للمسار (Path Traversal Detected).');
  }

  const root = path.resolve(getStorageRoot(db));
  const normalizedRel = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const absolutePath = path.resolve(root, normalizedRel);

  // Enforce true folder boundary (path.sep / slash after root) to prevent sibling prefix bypass
  const normalizedRoot = root.replace(/\\/g, '/');
  const normalizedRootWithSep = normalizedRoot.endsWith('/') ? normalizedRoot : normalizedRoot + '/';
  const normalizedAbs = absolutePath.replace(/\\/g, '/');

  const relativeDiff = path.relative(root, absolutePath);
  const isOutside = relativeDiff.startsWith('..') || path.isAbsolute(relativeDiff);

  if (isOutside || (normalizedAbs !== normalizedRoot && !normalizedAbs.startsWith(normalizedRootWithSep))) {
    throw new Error('المسار المطلوب يقع خارج مجلد تخزين المستندات المصرح به.');
  }

  return absolutePath;
}

/**
 * Saves a source file (add or import) into the structured employee document storage.
 * NEVER deletes the original source file.
 *
 * @param {number} employeeId
 * @param {'TIME_CARD'|'LEAVE_CARD'|string} documentType
 * @param {string} sourceFilePath - Absolute path of the selected source file
 * @param {import('better-sqlite3').Database} db
 * @returns {{
 *   relativePath: string,
 *   fileName: string,
 *   originalName: string,
 *   fileExtension: string,
 *   fileSize: number,
 *   mimeType: string,
 *   absolutePath: string
 * }}
 */
function saveFile(employeeId, documentType, sourceFilePath, db) {
  if (!employeeId || !Number.isInteger(Number(employeeId)) || Number(employeeId) <= 0) {
    throw new Error('الرقم الوظيفي للموظف غير صالح.');
  }

  if (!documentType || typeof documentType !== 'string') {
    throw new Error('نوع المستند غير صالح.');
  }

  if (!sourceFilePath || typeof sourceFilePath !== 'string' || !fs.existsSync(sourceFilePath)) {
    throw new Error('الملف المصدر المحدد غير موجود أو يتعذر الوصول إليه.');
  }

  const stats = fs.statSync(sourceFilePath);
  if (!stats.isFile()) {
    throw new Error('المسار المحدد ليس ملفاً صالحاً.');
  }

  if (stats.size <= 0) {
    throw new Error('الملف المختار فارغ (الحجم 0 بايت).');
  }

  if (stats.size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(`حجم الملف يتجاوز الحد الأقصى المسموح به (${sizeMb} ميغابايت).`);
  }

  // 1. Extension validation
  const originalName = path.basename(sourceFilePath);
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`نوع الملف (${ext}) غير مدعوم. الأنواع المدعومة: PDF, JPG, JPEG, PNG, WEBP.`);
  }

  // 2. Magic Bytes inspection
  const isValidMagic = validateMagicBytes(sourceFilePath, ext);
  if (!isValidMagic) {
    throw new Error(`محتوى الملف لا يطابق امتداده المعلن (${ext}). تم رفض الملف لأسباب أمنية.`);
  }

  // 3. Storage Hierarchy
  const storageRoot = getStorageRoot(db);
  const subFolder = FOLDER_NAMES[documentType] || `${documentType.toLowerCase()}_docs`;
  const empFolder = `EMP_${employeeId}`;
  const targetDir = path.join(storageRoot, empFolder, subFolder);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 4. Safe Unique Filename Generation
  const year = new Date().getFullYear();
  const timestamp = Date.now();
  const randomHex = crypto.randomBytes(4).toString('hex');
  const safeTypePrefix = documentType.replace(/[^a-zA-Z0-9_]/g, '');
  const fileName = `${safeTypePrefix}_${year}_${timestamp}_${randomHex}${ext}`;

  // 5. Relative Path for Database Storage
  const relativePath = `${empFolder}/${subFolder}/${fileName}`;
  const targetAbsolutePath = path.join(targetDir, fileName);

  // 6. Copy File (Source file remains intact)
  fs.copyFileSync(sourceFilePath, targetAbsolutePath);

  LoggerService.info('DocumentStorageService', `Successfully stored document for EMP_${employeeId} at ${relativePath}`);

  return {
    relativePath,
    fileName,
    originalName,
    fileExtension: ext,
    fileSize: stats.size,
    mimeType: MIME_TYPES[ext] || 'application/octet-stream',
    absolutePath: targetAbsolutePath
  };
}

/**
 * Tests write and read permissions on a given directory path.
 *
 * @param {string} targetPath - Directory path to test
 * @returns {{ success: boolean, message: string }}
 */
function testStoragePath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('مسار المجلد المطلوب اختباره غير صالح.');
  }

  const resolved = path.resolve(targetPath.trim());

  try {
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }

    const testFileName = `.test_perm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.tmp`;
    const testFilePath = path.join(resolved, testFileName);

    // Test write
    fs.writeFileSync(testFilePath, 'Storage Write/Read Test OK', 'utf8');

    // Test read
    const content = fs.readFileSync(testFilePath, 'utf8');
    if (content !== 'Storage Write/Read Test OK') {
      throw new Error('فشلت مطابقة محتوى الملف الاختباري بعد كتابته.');
    }

    // Test delete
    fs.unlinkSync(testFilePath);

    return {
      success: true,
      message: 'المسار صالح وقابل للكتابة والقراءة بنجاح.'
    };
  } catch (err) {
    LoggerService.error('DocumentStorageService', `Storage path test failed on ${resolved}: ${err.message}`);
    throw new Error(`تعذر استخدام هذا المسار للتخزين: ${err.message}`);
  }
}

/**
 * Scans the document storage directory and removes unindexed/orphan physical files
 * that do not exist in the EmployeeDocuments table (e.g. caused by abrupt power loss).
 *
 * Safety protections:
 * - Ignores files created/modified within minAgeMs (default 60s) to never touch files currently being saved.
 * - Resolves paths securely to prevent deleting anything outside storage root.
 * - Cleans up empty folders left behind.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ minAgeMs?: number }} [options]
 * @returns {{ scannedCount: number, deletedCount: number, deletedFiles: string[] }}
 */
function reconcileOrphanDocuments(db, options = {}) {
  if (!db) return { scannedCount: 0, deletedCount: 0, deletedFiles: [] };

  const minAgeMs = typeof options.minAgeMs === 'number' ? options.minAgeMs : 60000;
  const now = Date.now();
  const storageRoot = path.resolve(getStorageRoot(db));

  if (!fs.existsSync(storageRoot)) {
    return { scannedCount: 0, deletedCount: 0, deletedFiles: [] };
  }

  // 1. Fetch all registered relative file paths from DB in a single lightweight query
  const rows = db.prepare('SELECT RelativePath FROM EmployeeDocuments').all();
  const registeredPaths = new Set(
    rows.map(r => path.resolve(storageRoot, r.RelativePath.replace(/\\/g, '/')))
  );

  let scannedCount = 0;
  let deletedCount = 0;
  const deletedFiles = [];

  // 2. Recursive scanner
  function scanDir(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scanDir(fullPath);
        // Clean empty directory after scanning children
        try {
          if (fs.readdirSync(fullPath).length === 0 && fullPath !== storageRoot) {
            fs.rmdirSync(fullPath);
          }
        } catch (_) {}
      } else if (entry.isFile()) {
        scannedCount++;
        const resolvedFile = path.resolve(fullPath);

        // If file is not in registeredPaths and older than minAgeMs
        if (!registeredPaths.has(resolvedFile)) {
          try {
            const stat = fs.statSync(resolvedFile);
            const ageMs = now - stat.mtimeMs;
            if (ageMs >= minAgeMs) {
              fs.unlinkSync(resolvedFile);
              deletedCount++;
              deletedFiles.push(resolvedFile);
              LoggerService.info('DocumentStorageService', `Reconciled orphan document: ${entry.name}`);
            }
          } catch (err) {
            LoggerService.warn('DocumentStorageService', `Failed to prune orphan file ${entry.name}: ${err.message}`);
          }
        }
      }
    }
  }

  scanDir(storageRoot);

  return { scannedCount, deletedCount, deletedFiles };
}

module.exports = {
  MAX_FILE_SIZE_BYTES,
  ALLOWED_EXTENSIONS,
  getDefaultStorageRoot,
  getStorageRoot,
  validateMagicBytes,
  resolveAbsolutePath,
  saveFile,
  testStoragePath,
  reconcileOrphanDocuments
};
