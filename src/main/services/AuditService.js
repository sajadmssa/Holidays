// ============================================================
//  services/AuditService.js  –  System Audit Trail Logger
//  خدمة توثيق وأرشفة سجل التدقيق والأمان للنظام (Audit Trail Service)
//
//  Responsibilities / المسؤوليات الأساسية:
//    • تسجيل وتوثيق كافة العمليات الجوهرية (إضافة، تعديل، حذف، تغيير حالة، نقل خارجي، نسخ احتياطي).
//    • حفظ لقطات دقيقة للحالة السابقة (OldValue) والجديدة (NewValue) بصيغة JSON.
//    • واجهة استعلام مفلترة ومقسمة لصفحات لجدول سجل التدقيق في واجهة المستخدم.
//    • الأرشفة التلقائية الذكية: عند تجاوز السجلات 150 سجلاً، يتم ترحيل السجلات الأقدم
//      إلى ملفات أرشيف سنوية JSONL على القرص لمنع تضخم قاعدة البيانات.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const LoggerService = require('./LoggerService');

const MAX_AUDIT_LOGS = 150;

/**
 * Gets or creates the local audit archive directory under userData.
 * @returns {string} Directory path
 */
function _getArchiveDir() {
  let baseDir = process.env.APPDATA ? path.join(process.env.APPDATA, 'leave-management-system') : '.';
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      baseDir = app.getPath('userData');
    }
  } catch (_) {}

  const archiveDir = path.join(baseDir, 'audit_archives');
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }
  return archiveDir;
}

/**
// ──────────────────────────────────────────────────────────────
//  _archiveAndPruneLogs
//
//  آلية الأرشفة والتقليم التلقائي لسجل التدقيق:
//  تضمن بقاء جدول AuditLogs خفيفاً وسريعاً عبر الاحتفاظ بأحدث 150 سجلاً فقط،
//  وترحيل السجلات الأقدم الزائدة تلقائياً إلى ملفات JSONL مقسمة بحسب السنة
//  في مجلد audit_archives بمسار بيانات التطبيق.
// ──────────────────────────────────────────────────────────────
 * Archives older audit logs exceeding MAX_AUDIT_LOGS into JSONL files
 * and deletes them from the active AuditLogs table.
 *
 * @param {import('better-sqlite3').Database} db
 */
function _archiveAndPruneLogs(db) {
  try {
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM AuditLogs').get();
    const currentCount = countRow ? Number(countRow.cnt) : 0;
    if (currentCount <= MAX_AUDIT_LOGS) {
      return;
    }

    // Retrieve oldest excess records to archive
    const oldestLogs = db.prepare(`
      SELECT LogID, Timestamp, ActionType, EntityType, EntityID, OldValue, NewValue, Details
      FROM AuditLogs
      WHERE LogID NOT IN (
        SELECT LogID FROM AuditLogs ORDER BY LogID DESC LIMIT ?
      )
      ORDER BY LogID ASC
    `).all(MAX_AUDIT_LOGS);

    if (!oldestLogs || oldestLogs.length === 0) return;

    const archiveDir = _getArchiveDir();

    // Group records by year
    const logsByYear = new Map();
    for (const log of oldestLogs) {
      let year = new Date().getFullYear();
      if (log.Timestamp && typeof log.Timestamp === 'string' && log.Timestamp.length >= 4) {
        const parsedYear = parseInt(log.Timestamp.slice(0, 4), 10);
        if (!isNaN(parsedYear) && parsedYear > 2000 && parsedYear < 2100) {
          year = parsedYear;
        }
      }
      if (!logsByYear.has(year)) {
        logsByYear.set(year, []);
      }
      logsByYear.get(year).push(log);
    }

    // Append records to corresponding yearly JSONL archive file
    for (const [year, logs] of logsByYear.entries()) {
      const filePath = path.join(archiveDir, `audit_history_${year}.jsonl`);
      const lines = logs.map((l) => JSON.stringify(l)).join('\n') + '\n';
      fs.appendFileSync(filePath, lines, 'utf8');
    }

    // Prune archived records from AuditLogs
    const logIdsToDelete = oldestLogs.map((l) => l.LogID);
    if (logIdsToDelete.length > 0) {
      const placeholders = logIdsToDelete.map(() => '?').join(',');
      db.prepare(`DELETE FROM AuditLogs WHERE LogID IN (${placeholders})`).run(...logIdsToDelete);
      LoggerService.info('AuditService', `Archived and pruned ${logIdsToDelete.length} audit logs. Active count: ${MAX_AUDIT_LOGS}`);
    }
  } catch (err) {
    LoggerService.error('AuditService', 'Failed during audit log archiving/pruning', err);
  }
}

/**
// ──────────────────────────────────────────────────────────────
//  logAction
//
//  تسجيل عملية جديدة في سجل التدقيق والأمان:
//  - يحفظ نوع العملية، الكيان المتأثر، رقمه المعرف، اللقطة السابقة والجديدة.
//  - يستدعي محرك الفحص والتقليم التلقائي فوراً بعد الإدراج.
// ──────────────────────────────────────────────────────────────
 * Records an audit log entry into the AuditLogs table and enforces the 150-record limit.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{
 *   actionType: 'INSERT' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE' | 'BACKUP' | 'RESTORE',
 *   entityType: 'Employee' | 'Leave' | 'System',
 *   entityID?: number | null,
 *   oldValue?: object | string | null,
 *   newValue?: object | string | null,
 *   details?: string | null
 * }} params
 * @returns {{ success: boolean, logId: number | null, error?: string }}
 */
function logAction(db, { actionType, entityType, entityID = null, oldValue = null, newValue = null, details = null }) {
  if (!db) {
    LoggerService.error('AuditService', 'Cannot log action: db instance is null or undefined.');
    return { success: false, logId: null, error: 'قاعدة البيانات غير مهيأة لتسجيل التدقيق' };
  }

  try {
    const oldValStr = oldValue && typeof oldValue === 'object' ? JSON.stringify(oldValue) : (oldValue ? String(oldValue) : null);
    const newValStr = newValue && typeof newValue === 'object' ? JSON.stringify(newValue) : (newValue ? String(newValue) : null);

    const result = db.prepare(`
      INSERT INTO AuditLogs (ActionType, EntityType, EntityID, OldValue, NewValue, Details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      actionType,
      entityType,
      entityID != null ? Number(entityID) : null,
      oldValStr,
      newValStr,
      details || null
    );

    // Instant check and archive-prune if total records exceed 150
    _archiveAndPruneLogs(db);

    LoggerService.info('AuditService', `Recorded ${actionType} for ${entityType} ID: ${entityID}`);
    return { success: true, logId: result.lastInsertRowid };
  } catch (err) {
    LoggerService.error('AuditService', 'Failed to insert audit log', err);
    return { success: false, logId: null, error: err.message };
  }
}

/**
// ──────────────────────────────────────────────────────────────
//  getAuditLogs
//
//  استرجاع سجلات التدقيق مقسمة لصفحات مع فلاتر التاريخ والنوع والبحث:
//  - يستفيد من الفهرس idx_audit_timestamp لتسريع استعلامات النطاق الزمني.
//  - يفك شفرة لقطات JSON التلقائية لتسهيل قراءتها وعرضها في واجهة المستخدم.
// ──────────────────────────────────────────────────────────────
 * Retrieves paginated audit logs based on search criteria.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{
 *   startDate?: string,
 *   endDate?: string,
 *   actionType?: string,
 *   entityType?: string,
 *   search?: string,
 *   page?: number,
 *   pageSize?: number
 * }} options
 * @returns {{
 *   data: Array<object>,
 *   totalCount: number,
 *   page: number,
 *   pageSize: number,
 *   totalPages: number
 * }}
 */
function getAuditLogs(db, {
  startDate = '',
  endDate = '',
  actionType = '',
  entityType = '',
  search = '',
  page = 1,
  pageSize = 15
} = {}) {
  const conditions = [];
  const params = [];

  // Optimized string range comparison leveraging idx_audit_timestamp index
  if (startDate) {
    conditions.push("Timestamp >= ?");
    params.push(`${startDate} 00:00:00`);
  }

  if (endDate) {
    conditions.push("Timestamp <= ?");
    params.push(`${endDate} 23:59:59`);
  }

  if (actionType && actionType !== 'ALL') {
    conditions.push("ActionType = ?");
    params.push(actionType);
  }

  if (entityType && entityType !== 'ALL') {
    conditions.push("EntityType = ?");
    params.push(entityType);
  }

  if (search && search.trim().length > 0) {
    const searchPattern = `%${search.trim()}%`;
    conditions.push("(Details LIKE ? OR CAST(EntityID AS TEXT) LIKE ?)");
    params.push(searchPattern, searchPattern);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // 1. Total count
  const countRow = db.prepare(`SELECT COUNT(*) as count FROM AuditLogs ${whereClause}`).get(...params);
  const totalCount = countRow ? Number(countRow.count) : 0;

  // 2. Pagination calculation
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePageSize = Math.max(1, Math.min(200, parseInt(pageSize, 10) || 15));
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));
  const offset = (safePage - 1) * safePageSize;

  // 3. Query records
  const query = `
    SELECT
      LogID,
      Timestamp,
      ActionType,
      EntityType,
      EntityID,
      OldValue,
      NewValue,
      Details
    FROM AuditLogs
    ${whereClause}
    ORDER BY LogID DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(query).all(...params, safePageSize, offset);

  // Parse JSON snapshots if present
  const parsedRows = rows.map((r) => {
    let parsedOld = null;
    let parsedNew = null;
    try { if (r.OldValue) parsedOld = JSON.parse(r.OldValue); } catch (_) { parsedOld = r.OldValue; }
    try { if (r.NewValue) parsedNew = JSON.parse(r.NewValue); } catch (_) { parsedNew = r.NewValue; }

    return {
      ...r,
      OldValueParsed: parsedOld,
      NewValueParsed: parsedNew,
    };
  });

  return {
    data: parsedRows,
    totalCount,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
  };
}

module.exports = {
  logAction,
  getAuditLogs,
  _archiveAndPruneLogs,
};
