// ============================================================
//  utils/fileErrorTranslator.js
//  مترجم أخطاء نظام الملفات (Node.js FS Error Translator)
//  يحول رموز أخطاء الملفات مثل EBUSY و EACCES و ENOSPC إلى رسائل عربية واضحة
// ============================================================

'use strict';

/**
 * تحويل رموز أخطاء نظام الملفات الشائعة إلى رسائل عربية موجهة للمستخدم
 * Translates standard Node.js filesystem error codes into user-friendly Arabic messages.
 *
 * @param {Error|any} err - كائن الخطأ البرمجي
 * @returns {string|null} - نص الرسالة المترجمة أو null إذا لم يكن خطأ ملفات معروفاً
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

