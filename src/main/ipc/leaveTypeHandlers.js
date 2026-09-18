// ============================================================
//  ipc/leaveTypeHandlers.js  –  Leave Type IPC Handlers
//  معالجات قنوات الاتصال الداخلي (IPC) لإدارة أنواع الإجازات
// ============================================================

'use strict';

const {
  getAllLeaveTypes,
  addLeaveType,
  updateLeaveType,
  deleteLeaveType,
} = require('../services/LeaveTypeService');
const { createSafeHandler } = require('../utils/ipcHandlerHelper');
const { safeHandleAsync: safeHandle } = createSafeHandler('LeaveTypeHandlers');

/**
 * تسجيل قنوات IPC الخاصة بإدارة أنواع الإجازات
 * @param {Electron.IpcMain} ipcMain
 * @param {import('better-sqlite3').Database} db
 */
function registerLeaveTypeHandlers(ipcMain, db) {
  // استرجاع جميع أنواع الإجازات
  ipcMain.handle(
    'leaveType:getAll',
    safeHandle(async () => {
      return getAllLeaveTypes(db);
    })
  );

  // إضافة نوع إجازة جديد
  ipcMain.handle(
    'leaveType:add',
    safeHandle(async (data) => {
      return addLeaveType(data, db);
    })
  );

  // تعديل اسم نوع إجازة
  ipcMain.handle(
    'leaveType:update',
    safeHandle(async (data, nameArg) => {
      if (nameArg !== undefined && typeof data !== 'object') {
        return updateLeaveType({ id: data, name: nameArg }, db);
      }
      return updateLeaveType(data, db);
    })
  );

  // حذف نوع إجازة
  ipcMain.handle(
    'leaveType:delete',
    safeHandle(async (id) => {
      return deleteLeaveType(id, db);
    })
  );
}

module.exports = { registerLeaveTypeHandlers };
