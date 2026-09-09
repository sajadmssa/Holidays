// ============================================================
//  utils/ipcHandlerHelper.js
//  Unified safe IPC handler wrappers for synchronous and asynchronous handlers.
//  Provides uniform response format: { success: true, data } or { success: false, error }
//  Logs errors consistently via LoggerService and translates file/sqlite errors.
// ============================================================

'use strict';

const LoggerService = require('../services/LoggerService');
const { translateFileError } = require('./fileErrorTranslator');
const { translateSqliteError } = require('./sqliteErrorTranslator');

/**
 * Standard error extractor and translator.
 * @param {Error|any} err
 * @returns {string} User-friendly translated error message
 */
function extractErrorMessage(err) {
  if (!err) return 'حدث خطأ غير متوقع.';
  return translateFileError(err) || translateSqliteError(err) || err.message || String(err);
}

/**
 * Wraps a synchronous DB/business function in a uniform try/catch wrapper.
 *
 * @param {string|Function} contextName Module / handler identifier for logging or fn
 * @param {Function} [fn] Function executing the handler logic
 * @returns {Function} Wrapped IPC handler returning { success: boolean, data?: any, error?: string }
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
 * Wraps an asynchronous DB/business/dialog function in a uniform try/catch wrapper.
 *
 * @param {string|Function} contextName Module / handler identifier for logging or fn
 * @param {Function} [fn] Async function executing the handler logic
 * @returns {Function} Wrapped IPC handler returning Promise<{ success: boolean, data?: any, error?: string }>
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
 * Creates module-scoped handler wrappers that automatically log with the specified context name.
 * @param {string} contextName
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
