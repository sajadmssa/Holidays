// ============================================================
//  ipc/employeeHandlers.js  –  Employee IPC Handlers
//  طبقة معالجة قنوات الاتصال الداخلي (IPC) للموظفين
//
//  Responsibilities / المسؤوليات الأساسية:
//    • تسجيل قنوات IPC الخاصة بإدارة الموظفين والبحث والتصدير.
//    • فرض غلاف استجابة موحد { success: true, data } أو { success: false, error }.
//    • تفويض كافة عمليات التحقق وقواعد العمل إلى EmployeeService.
//    • إدارة نافذة الحوار الأصلية (Native Save Dialog) لتصدير كشوف الموظفين إلى Excel.
//
//  This module is stateless. The live `db` instance is injected
//  at startup so the service stays testable without Electron running.
//  (الوحدة عديمة الحالة Stateless ويتم حقن كائن قاعدة البيانات db عند الإقلاع).
// ============================================================

'use strict';

const { dialog } = require('electron');
const {
  addEmployee,
  searchEmployees,
  getEmployeeById,
  updateEmployee,
  deactivateEmployee,
  activateEmployee,
  transferEmployee,
  cancelEmployeeTransfer,
  getEmployeesPaginated,
} = require('../services/EmployeeService');
const { exportAllEmployees } = require('../services/ReportService');
const LoggerService = require('../services/LoggerService');
const { createSafeHandler } = require('../utils/ipcHandlerHelper');
const { safeHandleAsync: safeHandle } = createSafeHandler('EmployeeHandlers');

// ──────────────────────────────────────────────────────────────
//  registerEmployeeHandlers(ipcMain, db)
//
//  تسجيل كافة قنوات IPC الخاصة بإدارة الموظفين:
//  تُستدعى مرة واحدة فقط عند إقلاع التطبيق في main.js بعد اكتمال تهيئة db.
//
//  Call this ONCE after db.initialize() in main.js.
//
//  @param {Electron.IpcMain} ipcMain
//  @param {import('better-sqlite3').Database} db
// ──────────────────────────────────────────────────────────────
function registerEmployeeHandlers(ipcMain, db) {

  // ── employee:add ─────────────────────────────────────────────
  //
  //  إضافة موظف جديد:
  //  تستقبل بيانات الموظف، وتفوض التحقق والإدراج الذري إلى EmployeeService.
  //
  //  Creates a new active employee record after rigorous validation.
  //
  //  Renderer payload:
  //    { employeeId, fullName, gender, hireDate, jobTitle, workLocation, leaveCardNumber, leaveApprover }
  //  Response data:
  //    number  – the new EmployeeID (lastInsertRowid)
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'employee:add',
    safeHandle((payload) => {
      // Surface-level guard: payload must be an object / التحقق السطحي من صحة كائن البيانات
      if (!payload || typeof payload !== 'object') {
        throw new Error('employee:add: payload must be a non-null object.');
      }
      // All further validation (field types, lengths, date bounds,
      // gender enum) is delegated entirely to EmployeeService.
      // تفويض التحقق الدقيق وقواعد العمل بالكامل إلى خدمة الموظفين
      return addEmployee(payload, db);
    })
  );

  // ── employee:search ───────────────────────────────────────────
  //
  //  البحث الفوري عن الموظفين:
  //  مخصص للنافذة المنبثقة للبحث، ويرجع حتى 50 موظفاً نشطاً.
  //
  //  Live name lookup for the Employee Search Modal (Phase 8).
  //  An empty keyword returns up to 50 active employees (show-all).
  //
  //  Renderer payload: { keyword: string }
  //  Response data:    { EmployeeID, FullName, JobTitle, ... }[]
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'employee:search',
    safeHandle((payload) => {
      const keyword = (payload && typeof payload.keyword === 'string')
        ? payload.keyword
        : '';
      return searchEmployees(keyword, db);
    })
  );

  // ── employee:getById ──────────────────────────────────────────
  //
  //  استرجاع بيانات موظف محدد مع كافة تفاصيل الأرصدة (الاعتيادية والمرضية).
  //
  //  Renderer payload: { employeeId: number } أو رقم الموظف مباشرة
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'employee:getById',
    safeHandle((payload) => {
      const id = Number(payload?.employeeId ?? payload);
      return getEmployeeById(id, db);
    })
  );

  // ── employee:getPaginated ─────────────────────────────────────
  //
  //  استرجاع قائمة الموظفين المقسمة إلى صفحات من جانب الخادم (Server-side Pagination).
  //
  //  Renderer payload: { page: number, pageSize: number, search: string }
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'employee:getPaginated',
    safeHandle((payload) => {
      const { page, pageSize, search } = payload ?? {};
      return getEmployeesPaginated({ page, pageSize, search }, db);
    })
  );

  // ── employee:exportAll ────────────────────────────────────────
  //
  //  تصدير كشف الموظفين الإجمالي إلى ملف Excel:
  //  يفتح نافذة الحوار الأصلية لاختيار مكان حفظ الملف، ثم ينشئ تقرير Excel الفاخر.
  //
  //  Renderer payload: { search?: string }
  //  Response data:    { canceled: boolean, filePath?: string }
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'employee:exportAll',
    safeHandle(async (payload) => {
      const { search } = payload ?? {};
      const now = new Date();
      const defaultFilename = `قائمة_الموظفين_${now.toISOString().slice(0, 10)}.xlsx`;

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'تصدير قائمة الموظفين إلى ملف Excel',
        defaultPath: defaultFilename,
        filters: [{ name: 'Excel Workbook (*.xlsx)', extensions: ['xlsx'] }],
      });

      if (canceled || !filePath) {
        return { canceled: true };
      }

      await exportAllEmployees({ search }, filePath, db);
      return { canceled: false, filePath };
    })
  );

  // ── employee:update ───────────────────────────────────────────
  //
  //  تحديث بيانات الموظف (الاسم، الوظيفة، موقع العمل، رقم الكرت، المسؤول، أيام التسوية).
  //
  //  Renderer payload: { employeeId, fullName, jobTitle, workLocation, leaveCardNumber, leaveApprover, adjustmentDays }
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'employee:update',
    safeHandle((payload) => {
      const {
        employeeId,
        fullName,
        jobTitle,
        workLocation,
        leaveCardNumber,
        leaveApprover,
        adjustmentDays
      } = payload ?? {};
      const id = Number(employeeId);
      return updateEmployee(id, {
        fullName,
        jobTitle,
        workLocation,
        leaveCardNumber,
        leaveApprover,
        adjustmentDays
      }, db);
    })
  );

  // ── employee:deactivate ───────────────────────────────────────
  //
  //  تجميد / تعطيل حساب الموظف (Soft-Delete) مع حفظ القيود المرجعية.
  //
  //  Renderer payload: { employeeId: number } أو رقم الموظف مباشرة
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'employee:deactivate',
    safeHandle((payload) => {
      const id = Number(payload?.employeeId ?? payload);
      return deactivateEmployee(id, db);
    })
  );

  // ── employee:activate ─────────────────────────────────────────
  //
  //  إعادة تنشيط حساب الموظف المجمد.
  //
  //  Renderer payload: { employeeId: number } أو رقم الموظف مباشرة
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'employee:activate',
    safeHandle((payload) => {
      const id = Number(payload?.employeeId ?? payload);
      return activateEmployee(id, db);
    })
  );

  // ── employee:transfer ─────────────────────────────────────────
  //
  //  تسجيل النقل الخارجي لموظف:
  //  يدعم الاستدعاء بكائن موحد أو بوسيطين (employeeId, transferData) لتوافق الإصدارات.
  //
  //  Renderer payload: { employeeId, transferOrderNumber, transferOrderDate, transferNotes }
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'employee:transfer',
    safeHandle((firstArg, secondArg) => {
      let employeeId, transferOrderNumber, transferOrderDate, transferNotes;
      if (typeof firstArg === 'object' && firstArg !== null) {
        ({ employeeId, transferOrderNumber, transferOrderDate, transferNotes } = firstArg);
      } else {
        employeeId = firstArg;
        ({ transferOrderNumber, transferOrderDate, transferNotes } = secondArg ?? {});
      }
      const id = Number(employeeId);
      return transferEmployee(id, {
        transferOrderNumber,
        transferOrderDate,
        transferNotes,
      }, db);
    })
  );

  // ── employee:cancelTransfer ───────────────────────────────────
  //
  //  إلغاء حالة النقل الخارجي للموظف وإعادة تعيين الحقول الخاصة بالنقل.
  //
  //  Renderer payload: { employeeId: number } أو رقم الموظف مباشرة
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'employee:cancelTransfer',
    safeHandle((payload) => {
      const id = Number(payload?.employeeId ?? payload);
      return cancelEmployeeTransfer(id, db);
    })
  );

  LoggerService.info('EmployeeHandlers', 'Registered: employee:add, employee:search, employee:getById, employee:getPaginated, employee:exportAll, employee:update, employee:deactivate, employee:activate, employee:transfer, employee:cancelTransfer');
}

module.exports = { registerEmployeeHandlers };
