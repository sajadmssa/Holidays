// ============================================================
//  utils/sqliteErrorTranslator.js
//  مترجم أخطاء وقيود قاعدة البيانات (SQLite Error Translator)
//  يحول قيود التكامل (Constraints) والشروط (Triggers) إلى رسائل عربية دقيقة
// ============================================================

'use strict';

/**
 * تحويل أخطاء قيود ومحفزات SQLite إلى رسائل عربية واضحة ومحددة
 * Translates SQLite trigger and constraint errors into user-friendly Arabic messages.
 *
 * @param {Error|any} err - كائن الخطأ البرمجي
 * @returns {string|null} - نص الرسالة بالعربية أو null إذا لم يكن خطأ SQLite معروفاً
 */
function translateSqliteError(err) {
  if (!err || typeof err !== 'object' || typeof err.message !== 'string') {
    return null;
  }

  const msg = err.message;

  // فحص قيود الجنس (إجازة الأمومة مقتصرة على الإناث)
  if (msg.includes('GENDER_RESTRICTION')) {
    return 'هذا النوع من الإجازات مخصص للموظفات الإناث فقط.';
  }

  // فحص قيد حالة الموظف (الموظفون غير النشطين أو المنقولين)
  if (msg.includes('INACTIVE_EMPLOYEE')) {
    return 'لا يمكن تسجيل إجازة لموظف موقوف أو غير نشط حالياً.';
  }

  // فحص قيد رقم الأمر الإداري الإلزامي
  if (msg.includes('ORDER_REF_REQUIRED')) {
    return 'رقم الأمر الإداري مطلوب لهذا النوع من الإجازات.';
  }

  // قيود التفرد (عدم تكرار الرقم الوظيفي مثلاً)
  if (msg.includes('UNIQUE constraint failed')) {
    return 'البيانات المدخلة مكررة، يوجد سجل مطابق مسبقاً في النظام.';
  }

  // قيود المفاتيح الأجنبية (الارتباط بين الجداول)
  if (msg.includes('FOREIGN KEY constraint failed')) {
    return 'لا يمكن إتمام هذا الإجراء لوجود سجلات أخرى مرتبطة بهذا العنصر.';
  }

  // قيود الحقول غير الفارغة
  if (msg.includes('NOT NULL constraint failed')) {
    return 'يوجد حقل إلزامي مفقود في البيانات المدخلة.';
  }

  return null;
}

module.exports = { translateSqliteError };

