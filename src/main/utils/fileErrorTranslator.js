'use strict';

/**
 * Translates standard Node.js filesystem error codes into user-friendly Arabic messages.
 *
 * @param {Error|any} err - The error object to translate
 * @returns {string|null} - The translated Arabic message, or null if unhandled / no code
 */
function translateFileError(err) {
  if (!err || typeof err !== 'object' || !err.code) {
    return null;
  }

  switch (err.code) {
    case 'EBUSY':
      return 'الملف مفتوح حالياً في برنامج آخر (مثل Excel)، يرجى إغلاقه ثم إعادة المحاولة.';
    case 'EACCES':
    case 'EPERM':
      return 'لا توجد صلاحية كافية للكتابة في هذا المسار، يرجى اختيار مسار آخر أو تشغيل البرنامج كمسؤول.';
    case 'ENOSPC':
      return 'لا توجد مساحة كافية على القرص لحفظ الملف.';
    case 'ENOENT':
      return 'المسار المحدد غير موجود، يرجى التأكد من صحة مسار الحفظ.';
    default:
      return null;
  }
}

module.exports = { translateFileError };
