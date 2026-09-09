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
const { translateSqliteError } = require('../utils/sqliteErrorTranslator');

function safeHandle(fn) {
  return (_event, ...args) => {
    try {
      const data = fn(...args);
      return { success: true, data };
    } catch (err) {
      LoggerService.error('AuditHandlers', 'IPC Error', err);
      return { success: false, error: translateSqliteError(err) || err.message };
    }
  };
}

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

  console.log('[AuditHandlers] Registered: audit:getLogs');
}

module.exports = { registerAuditHandlers };
