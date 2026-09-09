// ============================================================
//  ipc/reportHandlers.js  –  Report IPC Handlers (Phase 7)
//
//  Responsibilities:
//    • Open a native Save dialog (main-process privilege)
//    • Delegate Excel generation to ReportService
//    • Return a uniform { success, data|error|canceled } envelope
//
//  Why dialog lives here and NOT in ReportService:
//    dialog is an Electron API; ReportService must stay
//    framework-agnostic so it can be unit-tested without Electron.
// ============================================================

'use strict';

const { BrowserWindow, dialog } = require('electron');
const {
  exportEmployeeHistory,
  exportActiveLeavesToExcel,
} = require('../services/ReportService');
const LoggerService = require('../services/LoggerService');
const { createSafeHandler } = require('../utils/ipcHandlerHelper');
const { safeHandleAsync } = createSafeHandler('ReportHandlers');

// ──────────────────────────────────────────────────────────────
//  registerReportHandlers(ipcMain, db)
//
//  Call this ONCE after db.initialize() in main.js.
//
//  @param {Electron.IpcMain} ipcMain
//  @param {import('better-sqlite3').Database} db
// ──────────────────────────────────────────────────────────────
function registerReportHandlers(ipcMain, db) {

  // ── report:exportHistory ──────────────────────────────────────
  //
  //  Opens a native Save dialog, then exports a styled Excel report
  //  of the given employee's full leave history.
  //
  //  Renderer payload: { employeeId: number }
  //
  //  Response data variants:
  //    { canceled: true }          – user dismissed the dialog
  //    { filePath: string }        – file written successfully
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'report:exportHistory',
    safeHandleAsync(async (payload) => {

      // ── 1. Validate payload ─────────────────────────────────
      if (!payload || typeof payload !== 'object') {
        throw new Error('report:exportHistory: payload must be a non-null object.');
      }

      const employeeId = Number(payload.employeeId);

      if (!Number.isInteger(employeeId) || employeeId <= 0) {
        throw new Error(
          `report:exportHistory: employeeId must be a positive integer ` +
          `(received: "${payload.employeeId}").`
        );
      }

      // ── 2. Open native Save dialog ──────────────────────────
      //  Must run in the main process — Renderer has no dialog access.
      //  getFocusedWindow() is the safest parent ref: works even if the
      //  window reference was garbage-collected and re-created.
      const win    = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win, {
        title       : 'حفظ التقرير',
        defaultPath : `سجل_اجازات_${employeeId}.xlsx`,
        filters     : [
          { name: 'Excel Workbook', extensions: ['xlsx'] },
          { name: 'All Files',      extensions: ['*']    },
        ],
        properties  : ['createDirectory', 'showOverwriteConfirmation'],
      });

      // ── 3. Handle cancellation ──────────────────────────────
      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      // ── 4. Generate and write the Excel file ────────────────
      const filePath = result.filePath;
      await exportEmployeeHistory(employeeId, filePath, db);

      return { filePath };
    })
  );

  // ── report:exportActiveLeaves ─────────────────────────────────
  //
  //  Opens a native Save dialog, then exports a styled Excel report
  //  of all employees currently on leave today.
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'report:exportActiveLeaves',
    safeHandleAsync(async () => {
      const now = new Date();
      const localDateStr = now.toISOString().slice(0, 10);
      const defaultFilename = `تقرير_المجازين_حالياً_${localDateStr}.xlsx`;

      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win, {
        title: 'تصدير تقرير المجازين حالياً إلى Excel',
        defaultPath: defaultFilename,
        filters: [
          { name: 'Excel Workbook (*.xlsx)', extensions: ['xlsx'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });

      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      await exportActiveLeavesToExcel(result.filePath, db);
      return { canceled: false, filePath: result.filePath };
    })
  );

  // ── report:getCriticalReport ──────────────────────────────────
  //
  //  Returns critical balance alerts (balance <= threshold) and
  //  yearly accumulated leave summary.
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'report:getCriticalReport',
    safeHandleAsync(async (options = {}) => {
      const { threshold = 5, year = new Date().getFullYear() } = options || {};
      const { getCriticalAndAccumulatedLeaves } = require('../services/ReportService');
      return getCriticalAndAccumulatedLeaves(db, { threshold, year });
    })
  );

  // ── report:exportCriticalReport ───────────────────────────────
  //
  //  Opens a native Save dialog and exports the critical balance and
  //  accumulated leaves report to Excel.
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'report:exportCriticalReport',
    safeHandleAsync(async (options = {}) => {
      const { threshold = 5, year = new Date().getFullYear() } = options || {};
      const { exportCriticalReportToExcel } = require('../services/ReportService');

      const now = new Date();
      const localDateStr = now.toISOString().slice(0, 10);
      const defaultFilename = `تقرير_الارصدة_الحرجة_والتراكم_${year}_${localDateStr}.xlsx`;

      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win, {
        title: 'تصدير تقرير الأرصدة الحرجة وتراكم الإجازات إلى Excel',
        defaultPath: defaultFilename,
        filters: [
          { name: 'Excel Workbook (*.xlsx)', extensions: ['xlsx'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });

      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      await exportCriticalReportToExcel(result.filePath, db, { threshold, year });
      return { canceled: false, filePath: result.filePath };
    })
  );

  // ── report:getCriticalBalancesPaginated ────────────────────────
  ipcMain.handle(
    'report:getCriticalBalancesPaginated',
    safeHandleAsync(async (options = {}) => {
      const { getCriticalBalancesPaginated } = require('../services/ReportService');
      return getCriticalBalancesPaginated(db, options);
    })
  );

  // ── report:getAccumulatedPaginated ────────────────────────────
  ipcMain.handle(
    'report:getAccumulatedPaginated',
    safeHandleAsync(async (options = {}) => {
      const { getAccumulatedLeavesPaginated } = require('../services/ReportService');
      return getAccumulatedLeavesPaginated(db, options);
    })
  );

  // ── report:exportTransferredEmployees ─────────────────────────
  //
  //  Opens a native Save dialog, then exports a styled official Excel
  //  report of all externally transferred employees.
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'report:exportTransferredEmployees',
    safeHandleAsync(async () => {
      const now = new Date();
      const localDateStr = now.toISOString().slice(0, 10);
      const defaultFilename = `كشف_الموظفين_المنقولين_خارجيا_${localDateStr}.xlsx`;

      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win, {
        title: 'تصدير كشف الموظفين المنقولين إلى Excel',
        defaultPath: defaultFilename,
        filters: [
          { name: 'Excel Workbook (*.xlsx)', extensions: ['xlsx'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });

      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      const { exportTransferredEmployeesToExcel } = require('../services/ReportService');
      await exportTransferredEmployeesToExcel(result.filePath, db);
      return { canceled: false, filePath: result.filePath };
    })
  );

  LoggerService.info('ReportHandlers', 'Registered: report:exportHistory, report:exportActiveLeaves, report:getCriticalReport, report:exportCriticalReport, report:getCriticalBalancesPaginated, report:getAccumulatedPaginated, report:exportTransferredEmployees');
}

module.exports = { registerReportHandlers };

