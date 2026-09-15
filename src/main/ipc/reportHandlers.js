// ============================================================
//  ipc/reportHandlers.js  –  Report IPC Handlers
//  طبقة معالجة قنوات الاتصال الداخلي (IPC) للتقارير وتصدير Excel
//
//  Responsibilities / المسؤوليات الأساسية:
//    • فتح نوافذ حفظ الملفات الأصلية (Native Save Dialog) في بيئة نظام التشغيل.
//    • تفويض توليد مصنفات Excel الرسمية إلى ReportService.
//    • فرض غلاف استجابة موحد { success: true, data } أو { success: false, error }.
//    • توفير قنوات تصدير سجل الموظف، المجازين حالياً، الأرصدة الحرجة، والتراكم السنوي، والمنقولين.
//
//  Why dialog lives here and NOT in ReportService:
//  (نافذة الحوار dialog تعتمد على واجهات Electron الحصرية للعملية الرئيسية Main Process،
//  لذا تم إبقاؤها هنا للحفاظ على استقلالية ReportService وإمكانية اختبارها دون تشغيل Electron).
// ============================================================

'use strict';

const { BrowserWindow, dialog } = require('electron');
const {
  exportEmployeeHistory,
  exportActiveLeavesToExcel,
  exportExpiredLeavesToExcel,
} = require('../services/ReportService');
const LoggerService = require('../services/LoggerService');
const { createSafeHandler } = require('../utils/ipcHandlerHelper');
const { safeHandleAsync } = createSafeHandler('ReportHandlers');

// ──────────────────────────────────────────────────────────────
//  registerReportHandlers(ipcMain, db)
//
//  تسجيل قنوات IPC الخاصة بالتقارير وتصدير Excel:
//  تُستدعى مرة واحدة فقط عند إقلاع التطبيق في main.js بعد تهيئة db.
//
//  Call this ONCE after db.initialize() in main.js.
//
//  @param {Electron.IpcMain} ipcMain
//  @param {import('better-sqlite3').Database} db
// ──────────────────────────────────────────────────────────────
function registerReportHandlers(ipcMain, db) {

  // ── report:exportHistory ──────────────────────────────────────
  //
  //  تصدير السجل التاريخي الكامل لموظف محدد إلى Excel:
  //  يفتح نافذة حفظ الملف، ثم يولد التقرير الرسمي.
  //
  //  Renderer payload: { employeeId: number }
  //  Response data:    { canceled: boolean, filePath?: string }
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'report:exportHistory',
    safeHandleAsync(async (payload) => {

      // ── 1. Validate payload / التحقق من المدخلات ─────────────
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

      // ── 2. Open native Save dialog / فتح نافذة حفظ الملف الأصلية ──
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

      // ── 3. Handle cancellation / معالجة إلغاء المستخدم للنافذة ─
      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      // ── 4. Generate and write the Excel file / كتابة التقرير ─
      const filePath = result.filePath;
      await exportEmployeeHistory(employeeId, filePath, db);

      return { filePath };
    })
  );

  // ── report:exportActiveLeaves ─────────────────────────────────
  //
  //  تصدير تقرير الموظفين المجازين حالياً (في تاريخ اليوم) إلى Excel.
  //
  //  Response data: { canceled: boolean, filePath?: string }
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

  // ── report:exportExpiredLeaves ────────────────────────────────
  //
  //  تصدير تقرير الإجازات المنتهية فقط إلى Excel بحسب الفترة المحددة:
  //  - 'last3months' (افتراضي)
  //  - 'currentMonth'
  //  - 'currentYear'
  //  - 'custom' (customStartDate / customEndDate)
  //  - 'all' (أرشيف شامل)
  //
  //  Renderer payload: { period?: string, customStartDate?: string, customEndDate?: string }
  //  Response data:    { canceled: boolean, filePath?: string }
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'report:exportExpiredLeaves',
    safeHandleAsync(async (options = {}) => {
      const { period = 'last3months', customStartDate = null, customEndDate = null } = options || {};
      const now = new Date();
      const localDateStr = now.toISOString().slice(0, 10);

      let periodLabel = 'آخر_3_أشهر';
      if (period === 'currentMonth') {
        periodLabel = 'الشهر_الحالي';
      } else if (period === 'currentYear') {
        periodLabel = 'السنة_الحالية';
      } else if (period === 'custom') {
        const fromPart = customStartDate ? customStartDate.trim() : 'البداية';
        const toPart = customEndDate ? customEndDate.trim() : 'اليوم';
        periodLabel = `مخصص_${fromPart}_إلى_${toPart}`;
      } else if (period === 'all') {
        periodLabel = 'أرشيف_شامل';
      }

      const defaultFilename = `الإجازات_المنتهية_${periodLabel}_${localDateStr}.xlsx`;

      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win, {
        title: 'تصدير تقرير الإجازات المنتهية إلى Excel',
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

      await exportExpiredLeavesToExcel(result.filePath, { period, customStartDate, customEndDate }, db);
      return { canceled: false, filePath: result.filePath };
    })
  );


  // ── report:exportCriticalReport ───────────────────────────────
  //
  //  تصدير تقرير الأرصدة الحرجة وتراكم الإجازات السنوية إلى مصنف Excel رسمي متعدد الأوراق.
  //
  //  Renderer payload: { threshold?: number, year?: number }
  //  Response data:    { canceled: boolean, filePath?: string }
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
  //
  //  استرجاع الأرصدة الحرجة مقسمة لصفحات لجدول الواجهة.
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'report:getCriticalBalancesPaginated',
    safeHandleAsync(async (options = {}) => {
      const { getCriticalBalancesPaginated } = require('../services/ReportService');
      return getCriticalBalancesPaginated(db, options);
    })
  );

  // ── report:getAccumulatedPaginated ────────────────────────────
  //
  //  استرجاع تراكم الإجازات السنوي مقسماً لصفحات لجدول الواجهة.
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'report:getAccumulatedPaginated',
    safeHandleAsync(async (options = {}) => {
      const { getAccumulatedLeavesPaginated } = require('../services/ReportService');
      return getAccumulatedLeavesPaginated(db, options);
    })
  );

  // ── report:exportTransferredEmployees ─────────────────────────
  //
  //  تصدير الكشف الرسمي لكافة الموظفين المنقولين خارجياً إلى Excel.
  //
  //  Response data: { canceled: boolean, filePath?: string }
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

  LoggerService.info('ReportHandlers', 'Registered: report:exportHistory, report:exportActiveLeaves, report:exportExpiredLeaves, report:exportCriticalReport, report:getCriticalBalancesPaginated, report:getAccumulatedPaginated, report:exportTransferredEmployees');
}

module.exports = { registerReportHandlers };
