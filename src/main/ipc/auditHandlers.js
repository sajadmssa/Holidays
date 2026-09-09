// ============================================================
//  ipc/auditHandlers.js  –  Audit Log IPC Handlers
//  Main Process ONLY
//  Responsibilities:
//    • Register audit log query IPC channels
//    • Return uniform { success, data|error } envelopes
// ============================================================

'use strict';

const AuditService = require('../services/AuditService');
const LoggerService = require('../services/LoggerService');
const { createSafeHandler } = require('../utils/ipcHandlerHelper');
const { safeHandle } = createSafeHandler('AuditHandlers');

/**
 * Registers audit-related IPC handlers.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {import('better-sqlite3').Database} db
 */
function registerAuditHandlers(ipcMain, db) {
  ipcMain.handle(
    'audit:getLogs',
    safeHandle((options) => {
      return AuditService.getAuditLogs(db, options || {});
    })
  );

  LoggerService.info('AuditHandlers', 'Registered: audit:getLogs');
}

module.exports = { registerAuditHandlers };
