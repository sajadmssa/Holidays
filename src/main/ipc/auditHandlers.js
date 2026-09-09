// ============================================================
//  ipc/auditHandlers.js  –  Audit Log IPC Handlers
//  معالجات قنوات الاتصال لسجل التدقيق الأمني الشامل
//  Main Process ONLY - تعمل حصرياً في العملية الرئيسية لنظام Electron
//
//  المسؤوليات الرئيسية:
//    • تسجيل قناة audit:getLogs لاسترجاع سجلات الرقابة والعمليات بالنظام.
//    • تغليف الاستجابة في ظرف موحد { success: true, data } أو { success: false, error }.
// ============================================================

'use strict';

const AuditService = require('../services/AuditService');
const LoggerService = require('../services/LoggerService');
const { createSafeHandler } = require('../utils/ipcHandlerHelper');
const { safeHandle } = createSafeHandler('AuditHandlers');

/**
 * تسجيل قنوات IPC المرتبطة بسجلات التدقيق الأمني
 * Registers audit-related IPC handlers.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {import('better-sqlite3').Database} db اتصال قاعدة البيانات
 */
function registerAuditHandlers(ipcMain, db) {
  // ── audit:getLogs ───────────────────────────────────────────
  //  استعلام مصفى ومفهرس لسجلات التدقيق والعمليات (إضافة، تعديل، حذف، نسخ، استعادة...)
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'audit:getLogs',
    safeHandle((options) => {
      return AuditService.getAuditLogs(db, options || {});
    })
  );

  LoggerService.info('AuditHandlers', 'Registered: audit:getLogs');
}

module.exports = { registerAuditHandlers };

