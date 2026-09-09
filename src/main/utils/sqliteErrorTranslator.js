'use strict';

/**
 * Translates SQLite trigger and constraint errors into user-friendly Arabic messages.
 *
 * @param {Error|any} err - The error object to translate
 * @returns {string|null} - The translated Arabic message, or null if unhandled / no pattern matched
 */
function translateSqliteError(err) {
  if (!err || typeof err !== 'object' || typeof err.message !== 'string') {
    return null;
  }

  const msg = err.message;

  if (msg.includes('GENDER_RESTRICTION')) {
    return 'هذا النوع من الإجازات مخصص للموظفات الإناث فقط.';
  }

  if (msg.includes('INACTIVE_EMPLOYEE')) {
    return 'لا يمكن تسجيل إجازة لموظف موقوف أو غير نشط حالياً.';
  }

  if (msg.includes('ORDER_REF_REQUIRED')) {
    return 'رقم الأمر الإداري مطلوب لهذا النوع من الإجازات.';
  }

  if (msg.includes('UNIQUE constraint failed')) {
    return 'البيانات المدخلة مكررة، يوجد سجل مطابق مسبقاً في النظام.';
  }

  if (msg.includes('FOREIGN KEY constraint failed')) {
    return 'لا يمكن إتمام هذا الإجراء لوجود سجلات أخرى مرتبطة بهذا العنصر.';
  }

  if (msg.includes('NOT NULL constraint failed')) {
    return 'يوجد حقل إلزامي مفقود في البيانات المدخلة.';
  }

  return null;
}

module.exports = { translateSqliteError };
