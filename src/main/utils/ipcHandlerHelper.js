// ============================================================
//  utils/ipcHandlerHelper.js
//  الغلاف الموحد لمعالجات قنوات الاتصال الداخلي (Safe IPC Handler Wrappers)
//  Main Process ONLY - تستخدمه كافة ملفات handlers في src/main/ipc/
//
//  المسؤوليات الرئيسية:
//    • توفير غلاف حماية شامل (try/catch wrapper) لكافة دوال IPC التزامنية وغير التزامنية.
//    • توحيد نمط استجابات الـ IPC بنية ثابتة: { success: true, data } أو { success: false, error }.
//    • ترجمة أخطاء SQLite والملفات ونظام التشغيل إلى رسائل عربية واضحة ومفهومة للمستخدم.
//    • التوثيق التلقائي للأخطاء وسياقها في LoggerService دون تسريب مصطلحات فنية للواجهة.
// ============================================================

'use strict';

const LoggerService = require('../services/LoggerService');
const { translateFileError } = require('./fileErrorTranslator');
const { translateSqliteError } = require('./sqliteErrorTranslator');

/**
 * استخراج وترجمة رسالة الخطأ وتحويلها إلى صياغة عربية واضحة للمستخدم النهائي
 * Standard error extractor and translator.
 * @param {Error|any} err كائن الخطأ البرمجي
 * @returns {string} رسالة الخطأ المترجمة للمستخدم
 */
function extractErrorMessage(err) {
  if (!err) return 'حدث خطأ غير متوقع.';
  return translateFileError(err) || translateSqliteError(err) || err.message || String(err);
}

/**
 * تغليف معالج IPC تزامني (Synchronous Handler) لحمايته من الانهيار وتوحيد مخرجاته
 * Wraps a synchronous DB/business function in a uniform try/catch wrapper.
 *
 * @param {string|Function} contextName اسم الموديول لتوثيق السجل (أو الدالة مباشرة)
 * @param {Function} [fn] الدالة المنفذة لمنطق العمل
 * @returns {Function} دالة المعالج المغلفة التي تُرجع { success: boolean, data?: any, error?: string }
 */
function safeHandle(contextName, fn) {
  let targetFn = fn;
  let targetContext = contextName;

  if (typeof contextName === 'function') {
    targetFn = contextName;
    targetContext = 'IPC';
  }

  return (_event, ...args) => {
    try {
      const data = targetFn(...args);
      return { success: true, data };
    } catch (err) {
      LoggerService.error(targetContext, 'IPC Handler Error', err);
      return { success: false, error: extractErrorMessage(err) };
    }
  };
}

/**
 * تغليف معالج IPC غير تزامني (Asynchronous / Promise-based Handler)
 * Wraps an asynchronous DB/business/dialog function in a uniform try/catch wrapper.
 *
 * @param {string|Function} contextName اسم الموديول لتوثيق السجل (أو الدالة مباشرة)
 * @param {Function} [fn] الدالة غير التزامنية المنفذة للمنطق
 * @returns {Function} دالة المعالج المغلفة التي تُرجع وعداً Promise<{ success: boolean, data?: any, error?: string }>
 */
function safeHandleAsync(contextName, fn) {
  let targetFn = fn;
  let targetContext = contextName;

  if (typeof contextName === 'function') {
    targetFn = contextName;
    targetContext = 'IPC';
  }

  return async (_event, ...args) => {
    try {
      const data = await targetFn(...args);
      return { success: true, data };
    } catch (err) {
      LoggerService.error(targetContext, 'IPC Error', err);
      return { success: false, error: extractErrorMessage(err) };
    }
  };
}

/**
 * مصنع لإنشاء أغلفة IPC مرتبطة مسبقاً باسم موديول محدد لتسهيل الاستخدام
 * Creates module-scoped handler wrappers that automatically log with the specified context name.
 * @param {string} contextName اسم الموديول (مثل 'employeeHandlers', 'leaveHandlers')
 * @returns {{ safeHandle: Function, safeHandleAsync: Function }}
 */
function createSafeHandler(contextName) {
  return {
    safeHandle: (fn) => safeHandle(contextName, fn),
    safeHandleAsync: (fn) => safeHandleAsync(contextName, fn)
  };
}

module.exports = {
  safeHandle,
  safeHandleAsync,
  createSafeHandler,
  extractErrorMessage
};

