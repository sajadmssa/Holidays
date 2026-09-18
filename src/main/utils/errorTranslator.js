// ============================================================
//  utils/errorTranslator.js
//  المترجم المركزي للأخطاء (Centralized Error Translator)
//  يحول قيود التكامل وشروط SQLite وأخطاء نظام الملفات Node.js إلى رسائل عربية دقيقة
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

  // قيد تفرد رقم الإضبارة للموظفين النشطين (ADR-032 / Defense-in-Depth)
  if (
    msg.includes('idx_employees_dossier_number_unique') ||
    (msg.includes('UNIQUE constraint failed') && (msg.includes('Employees.DossierNumber') || msg.includes('DossierNumber')))
  ) {
    return 'رقم الإضبارة مستخدم من قبل موظف نشط آخر.';
  }

  // قيود التفرد العامة (عدم تكرار الرقم الوظيفي مثلاً)
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

/**
 * استخراج وترجمة أي خطأ (ملفات، قاعدة بيانات، أو عام) إلى نص عربي مفهوم
 * Unified error translator covering filesystem, SQLite, and generic errors.
 *
 * @param {Error|any} err - كائن الخطأ البرمجي
 * @returns {string} - نص الرسالة المعربة للمستخدم
 */
function translateError(err) {
  if (!err) return 'حدث خطأ غير متوقع.';
  return translateFileError(err) || translateSqliteError(err) || err.message || String(err);
}

module.exports = {
  translateSqliteError,
  translateFileError,
  translateError,
};
