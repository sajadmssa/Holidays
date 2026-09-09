// ============================================================
//  services/DocumentService.js – Business Logic for Employee Documents
//  طبقة منطق الأعمال لإدارة وأرشفة مستندات وكروت الموظفين
//
//  Responsibilities / المسؤوليات الأساسية:
//    • حفظ وإصدار النسخ الجديدة للمستندات (كروت الزمنية والإجازات) دون الكتابة فوق النسخ القديمة.
//    • استخراج سنة المستند تلقائياً من وقت الرفع بالنظام.
//    • استعراض النسخ النشطة للموظف مرتبة تنازلياً حسب السنة وتاريخ الإنشاء.
//    • الحذف المنطقي (Soft Delete) مع ترك الملفات الفيزيائية على القرص لحين طلب الإفراغ الصريح.
//    • التنسيق مع DocumentStorageService لتطبيق إجراءات الأمان ومنع Path Traversal.
//    • إدارة إحصائيات وإفراغ المستندات المحذوفة نهائياً وتوفير مساحات التخزين.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const DocumentStorageService = require('./DocumentStorageService');
const AuditService = require('./AuditService');
const LoggerService = require('./LoggerService');

/**
// ──────────────────────────────────────────────────────────────
//  addDocument
//
//  إضافة نسخة مستند جديدة للموظف (كرت زمنية أو كرت إجازة):
//  - لا يستبدل النسخ السابقة مطلقاً لضمان حفظ الأرشيف التاريخي للموظف.
//  - ينسخ ويفحص الملف في طبقة التخزين ويفحص تواقيع Magic Bytes.
//  - يُدرج السجل في حركة ذرية مع توثيق العملية في سجل التدقيق والأمان.
//  - في حال فشل الإدراج بقاعدة البيانات، يتم حذف الملف المنسوخ تلقائياً لمنع الملفات اليتيمة.
// ──────────────────────────────────────────────────────────────
 * Adds a new document version for an employee (never replaces existing versions).
 *
 * @param {{
 *   employeeId: number,
 *   documentType: 'TIME_CARD'|'LEAVE_CARD'|string,
 *   sourceFilePath: string,
 *   notes?: string|null
 * }} payload
 * @param {import('better-sqlite3').Database} db
 * @returns {{ success: boolean, document: object }}
 */
function addDocument({ employeeId, documentType, sourceFilePath, notes = null }, db) {
  if (!db) throw new Error('قاعدة البيانات غير مهيأة.');

  const empId = Number(employeeId);
  if (!empId || !Number.isInteger(empId) || empId <= 0) {
    throw new Error('يرجى تحديد موظف صالح.');
  }

  // Check that employee exists
  const emp = db.prepare('SELECT EmployeeID, FullName FROM Employees WHERE EmployeeID = ?').get(empId);
  if (!emp) {
    throw new Error(`الموظف برقم (${empId}) غير مسجل بالنظام.`);
  }

  const cleanDocType = String(documentType || '').trim().toUpperCase();
  if (cleanDocType !== 'TIME_CARD' && cleanDocType !== 'LEAVE_CARD') {
    throw new Error('نوع المستند المحدد غير مدعوم حالياً.');
  }

  // 1. Copy and validate file in storage layer
  let storageResult = null;
  try {
    storageResult = DocumentStorageService.saveFile(empId, cleanDocType, sourceFilePath, db);

    // 2. Automatically derive document year from current upload date
    const documentYear = new Date().getFullYear();

    // 3. Insert record & AuditLog inside a single atomic DB transaction
    const documentId = db.transaction(() => {
      const insertStmt = db.prepare(`
        INSERT INTO EmployeeDocuments (
          EmployeeID,
          DocumentType,
          DocumentYear,
          OriginalName,
          FileName,
          RelativePath,
          FileExtension,
          FileSize,
          MimeType,
          Notes,
          IsDeleted,
          CreatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now', 'localtime'))
      `);

      const result = insertStmt.run(
        empId,
        cleanDocType,
        documentYear,
        storageResult.originalName,
        storageResult.fileName,
        storageResult.relativePath,
        storageResult.fileExtension,
        storageResult.fileSize,
        storageResult.mimeType,
        notes ? String(notes).trim() : null
      );

      const newDocId = result.lastInsertRowid;

      // 4. Record Audit Log
      const typeArabic = cleanDocType === 'TIME_CARD' ? 'كرت الزمنية' : 'كرت الإجازة';
      AuditService.logAction(db, {
        actionType: 'INSERT',
        entityType: 'EmployeeDocument',
        entityID: Number(newDocId),
        newValue: {
          documentId: Number(newDocId),
          employeeId: empId,
          employeeName: emp.FullName,
          documentType: cleanDocType,
          documentYear,
          originalName: storageResult.originalName,
          fileName: storageResult.fileName,
          relativePath: storageResult.relativePath,
          fileSize: storageResult.fileSize,
          notes: notes || null
        },
        details: `إضافة نسخة ${typeArabic} (${documentYear}) للموظف [${emp.FullName} - الرقم: ${empId}]`
      });

      return newDocId;
    })();

    const insertedDoc = db.prepare('SELECT * FROM EmployeeDocuments WHERE DocumentID = ?').get(documentId);

    return {
      success: true,
      document: {
        ...insertedDoc,
        absolutePath: storageResult.absolutePath,
        fileExists: true
      }
    };
  } catch (err) {
    // If physical file was copied but database insertion or audit log failed, clean up file to avoid orphan
    if (storageResult && storageResult.absolutePath) {
      try {
        if (fs.existsSync(storageResult.absolutePath)) {
          fs.unlinkSync(storageResult.absolutePath);
          LoggerService.warn('DocumentService', `Cleaned up orphaned file after DB failure: ${storageResult.absolutePath}`);
        }
      } catch (unlinkErr) {
        LoggerService.error('DocumentService', `Failed to cleanup orphaned file ${storageResult.absolutePath}: ${unlinkErr.message}`);
      }
    }
    throw err;
  }
}

/**
// ──────────────────────────────────────────────────────────────
//  listDocuments
//
//  استرجاع قائمة المستندات النشطة (غير المحذوفة) لموظف محدد:
//  - مرتبة تنازلياً بحسب سنة المستند وتاريخ الرفع.
//  - يتحقق من الوجود الفعلي للملف على القرص ويحدد مساره المطلق الآمن.
// ──────────────────────────────────────────────────────────────
 * Lists non-deleted document versions for an employee.
 *
 * @param {{ employeeId: number, documentType?: string }} filter
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<object>}
 */
function listDocuments({ employeeId, documentType = null }, db) {
  if (!db) throw new Error('قاعدة البيانات غير مهيأة.');

  const empId = Number(employeeId);
  if (!empId || !Number.isInteger(empId) || empId <= 0) {
    throw new Error('يرجى تحديد موظف صالح.');
  }

  let query = `
    SELECT
      DocumentID,
      EmployeeID,
      DocumentType,
      DocumentYear,
      OriginalName,
      FileName,
      RelativePath,
      FileExtension,
      FileSize,
      MimeType,
      Notes,
      IsDeleted,
      CreatedAt
    FROM EmployeeDocuments
    WHERE EmployeeID = ? AND IsDeleted = 0
  `;

  const params = [empId];

  if (documentType && typeof documentType === 'string' && documentType.trim().length > 0) {
    query += ' AND DocumentType = ?';
    params.push(documentType.trim().toUpperCase());
  }

  query += ' ORDER BY DocumentYear DESC, CreatedAt DESC, DocumentID DESC';

  const rows = db.prepare(query).all(...params);

  // Check physical file presence for each document
  return rows.map((row) => {
    let absolutePath = null;
    let fileExists = false;
    try {
      absolutePath = DocumentStorageService.resolveAbsolutePath(row.RelativePath, db);
      fileExists = fs.existsSync(absolutePath);
    } catch (err) {
      fileExists = false;
    }

    return {
      ...row,
      absolutePath,
      fileExists
    };
  });
}

/**
// ──────────────────────────────────────────────────────────────
//  softDeleteDocument
//
//  الحذف المنطقي لمستند (Soft Delete):
//  - يقوم بتعيين IsDeleted = 1 ويسجل تاريخ الحذف.
//  - يترك الملف الفيزيائي على القرص بأمان دون حذفه فوراً.
//  - يوثق العملية في سجل التدقيق والأمان مع بيانات الموظف والمستند.
// ──────────────────────────────────────────────────────────────
 * Soft deletes a document record and logs the event (leaves physical file on disk).
 *
 * @param {number} documentId
 * @param {import('better-sqlite3').Database} db
 * @returns {{ success: boolean, documentId: number }}
 */
function softDeleteDocument(documentId, db) {
  if (!db) throw new Error('قاعدة البيانات غير مهيأة.');

  const docId = Number(documentId);
  if (!docId || !Number.isInteger(docId) || docId <= 0) {
    throw new Error('رقم المستند غير صالح.');
  }

  const existing = db.prepare(`
    SELECT ed.*, e.FullName as EmployeeName
    FROM EmployeeDocuments ed
    LEFT JOIN Employees e ON e.EmployeeID = ed.EmployeeID
    WHERE ed.DocumentID = ? AND ed.IsDeleted = 0
  `).get(docId);

  if (!existing) {
    throw new Error('المستند المطلوب غير موجود أو تم حذفه مسبقاً.');
  }

  db.prepare(`
    UPDATE EmployeeDocuments
    SET IsDeleted = 1,
        DeletedAt = datetime('now', 'localtime')
    WHERE DocumentID = ?
  `).run(docId);

  const typeArabic = existing.DocumentType === 'TIME_CARD' ? 'كرت الزمنية' : 'كرت الإجازة';

  AuditService.logAction(db, {
    actionType: 'DELETE',
    entityType: 'EmployeeDocument',
    entityID: docId,
    oldValue: {
      documentId: docId,
      employeeId: existing.EmployeeID,
      employeeName: existing.EmployeeName,
      documentType: existing.DocumentType,
      documentYear: existing.DocumentYear,
      fileName: existing.FileName,
      relativePath: existing.RelativePath,
      createdAt: existing.CreatedAt
    },
    details: `حذف نسخة ${typeArabic} (${existing.DocumentYear}) للموظف [${existing.EmployeeName || existing.EmployeeID}]`
  });

  return { success: true, documentId: docId };
}

/**
 * Retrieves a single document by ID including resolved file path.
 *
 * @param {number} documentId
 * @param {import('better-sqlite3').Database} db
 * @returns {object}
 */
function getDocumentById(documentId, db) {
  if (!db) throw new Error('قاعدة البيانات غير مهيأة.');

  const docId = Number(documentId);
  if (!docId || !Number.isInteger(docId) || docId <= 0) {
    throw new Error('رقم المستند غير صالح.');
  }

  const row = db.prepare(`
    SELECT ed.*, e.FullName as EmployeeName
    FROM EmployeeDocuments ed
    LEFT JOIN Employees e ON e.EmployeeID = ed.EmployeeID
    WHERE ed.DocumentID = ?
  `).get(docId);

  if (!row) {
    throw new Error('المستند المطلوب غير موجود.');
  }

  let absolutePath = null;
  let fileExists = false;
  try {
    absolutePath = DocumentStorageService.resolveAbsolutePath(row.RelativePath, db);
    fileExists = fs.existsSync(absolutePath);
  } catch (_) {
    fileExists = false;
  }

  return {
    ...row,
    absolutePath,
    fileExists
  };
}

/**
 * Gets the current document storage root directory.
 * @param {import('better-sqlite3').Database} db
 * @returns {string}
 */
function getStoragePath(db) {
  return DocumentStorageService.getStorageRoot(db);
}

/**
 * Updates the document storage path setting in _AppSettings and logs the change.
 *
 * @param {string} newPath
 * @param {import('better-sqlite3').Database} db
 * @returns {{ success: boolean, storagePath: string }}
 */
function setStoragePath(newPath, db) {
  if (!db) throw new Error('قاعدة البيانات غير مهيأة.');

  const cleanPath = newPath && typeof newPath === 'string' ? newPath.trim() : '';
  if (cleanPath) {
    // Validate that the path is writable before saving
    DocumentStorageService.testStoragePath(cleanPath);
  }

  const oldRow = db.prepare("SELECT Value FROM _AppSettings WHERE Key = 'employee_documents_storage_path'").get();

  db.prepare(`
    INSERT INTO _AppSettings (Key, Value, UpdatedAt)
    VALUES ('employee_documents_storage_path', ?, datetime('now', 'localtime'))
    ON CONFLICT(Key) DO UPDATE SET
      Value = excluded.Value,
      UpdatedAt = excluded.UpdatedAt
  `).run(cleanPath);

  AuditService.logAction(db, {
    actionType: 'UPDATE',
    entityType: 'System',
    entityID: null,
    oldValue: { employee_documents_storage_path: oldRow ? oldRow.Value : '' },
    newValue: { employee_documents_storage_path: cleanPath },
    details: `تحديث مسار تخزين مستندات الموظفين: "${cleanPath || 'الافتراضي'}"`
  });

  return {
    success: true,
    storagePath: DocumentStorageService.getStorageRoot(db)
  };
}

/**
 * Tests if target storage path is writable.
 * @param {string} targetPath
 * @returns {{ success: boolean, message?: string }}
 */
function testStoragePath(targetPath) {
  return DocumentStorageService.testStoragePath(targetPath);
}

/**
 * Formats bytes to human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Calculates count and total file size of soft-deleted documents (IsDeleted = 1).
 * @param {import('better-sqlite3').Database} db
 * @returns {{ count: number, totalBytes: number, formattedSize: string }}
 */
function getDeletedDocumentsStats(db) {
  if (!db) throw new Error('قاعدة البيانات غير مهيأة.');

  const rows = db.prepare('SELECT DocumentID, RelativePath, FileSize FROM EmployeeDocuments WHERE IsDeleted = 1').all();
  const count = rows.length;
  let totalBytes = 0;

  for (const r of rows) {
    if (r.FileSize && Number(r.FileSize) > 0) {
      totalBytes += Number(r.FileSize);
    } else {
      try {
        const absPath = DocumentStorageService.resolveAbsolutePath(r.RelativePath, db);
        if (fs.existsSync(absPath)) {
          totalBytes += fs.statSync(absPath).size;
        }
      } catch (_) {}
    }
  }

  return {
    count,
    totalBytes,
    formattedSize: formatFileSize(totalBytes),
  };
}

/**
// ──────────────────────────────────────────────────────────────
//  purgeDeletedDocuments
//
//  الإفراغ والتنظيف النهائي للمستندات المحذوفة:
//  - يحذف الملفات الفيزيائية للمستندات المعلمة كـ IsDeleted = 1 من القرص نهائياً.
//  - يحذف السجلات المرتبطة بها من جدول EmployeeDocuments.
//  - يحذف المجلدات الفرعية الفارغة لتنظيم مساحة القرص الصلب.
//  - يوثق عدد الملفات المحذوفة والمساحة المحررة في سجل التدقيق والأمان.
// ──────────────────────────────────────────────────────────────
 * Permanently deletes soft-deleted documents (IsDeleted = 1) from disk and database.
 * Logs the operation to AuditLogs.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ success: boolean, purgedCount: number, purgedBytes: number, formattedSize: string, message?: string }}
 */
function purgeDeletedDocuments(db) {
  if (!db) throw new Error('قاعدة البيانات غير مهيأة.');

  const rows = db.prepare('SELECT DocumentID, RelativePath, FileSize, OriginalName, FileName, EmployeeID FROM EmployeeDocuments WHERE IsDeleted = 1').all();
  const count = rows.length;

  if (count === 0) {
    return {
      success: true,
      purgedCount: 0,
      purgedBytes: 0,
      formattedSize: '0 B',
      message: 'لا توجد مستندات محذوفة بانتظار الإفراغ.',
    };
  }

  let purgedBytes = 0;
  let filesDeleted = 0;

  for (const r of rows) {
    try {
      const absPath = DocumentStorageService.resolveAbsolutePath(r.RelativePath, db);
      if (fs.existsSync(absPath)) {
        const stats = fs.statSync(absPath);
        purgedBytes += stats.size;
        fs.unlinkSync(absPath);
        filesDeleted++;

        // Attempt to remove empty parent folder if no other files exist
        const parentDir = path.dirname(absPath);
        try {
          if (fs.existsSync(parentDir) && fs.readdirSync(parentDir).length === 0) {
            fs.rmdirSync(parentDir);
          }
        } catch (_) {}
      }
    } catch (fileErr) {
      LoggerService.warn('DocumentService', `Could not delete physical file for DocumentID ${r.DocumentID}: ${fileErr.message}`);
    }
  }

  // Permanently remove records from EmployeeDocuments
  db.prepare('DELETE FROM EmployeeDocuments WHERE IsDeleted = 1').run();

  const formattedSize = formatFileSize(purgedBytes);

  // Record in AuditLogs
  AuditService.logAction(db, {
    actionType: 'DELETE',
    entityType: 'System',
    entityID: null,
    newValue: { purgedCount: count, filesDeleted, purgedBytes, formattedSize },
    details: `إفراغ وتنظيف المستندات المحذوفة نهائياً من القرص: تم حذف (${count}) مستند وتوفير مساحة (${formattedSize})`,
  });

  LoggerService.info('DocumentService', `Purged ${count} soft-deleted documents, freed ${formattedSize}`);

  return {
    success: true,
    purgedCount: count,
    purgedBytes,
    formattedSize,
  };
}

module.exports = {
  addDocument,
  listDocuments,
  softDeleteDocument,
  getDocumentById,
  getStoragePath,
  setStoragePath,
  testStoragePath,
  getDeletedDocumentsStats,
  purgeDeletedDocuments,
};
