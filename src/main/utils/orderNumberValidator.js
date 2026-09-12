// ============================================================
//  utils/orderNumberValidator.js
//  أداة التحقق وتوحيد أرقام الأوامر الإدارية والكتب الرسمية
//
//  المسؤوليات الرئيسية:
//    • توحيد الأرقام المشرقية (٠-٩) والفارسية (۰-۹) وتحويلها إلى أرقام قياسية (0-9).
//    • التحقق الصارم من أن رقم الأمر الإداري أو المذكرة يتكون من خانات رقمية فقط.
//    • الحفاظ على الأصفار البادئة (Leading Zeros) مثل "0123" دون فقدها.
//    • قبول الحقول الاختيارية الفارغة (null / undefined / '') بإرجاع null.
// ============================================================

'use strict';

/**
 * تحويل الأرقام العربية الشرقية (٠-٩) والفارسية (۰-۹) إلى أرقام لاتينية قياسية (0-9)
 * Normalizes Eastern Arabic (٠-٩) and Persian (۰-۹) numerals to standard ASCII digits (0-9).
 * Leaves all other characters untouched so validation can strictly evaluate them.
 *
 * @param {string} str النص المراد تحويل أرقامه
 * @returns {string} النص بعد توحيد الأرقام
 */
function normalizeArabicDigits(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)])
    .replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)]);
}

/**
 * التحقق الصارم من صحة رقم الأمر الإداري وتوحيد تنسيقه الرقمي
 * Validates and normalizes an Administrative Order Number (or Memo Number).
 *
 * Requirements:
 *  1. Completely optional: null, undefined, or empty string returns null.
 *  2. Purely numeric: only digits 0-9 are permitted.
 *  3. Preserves leading zeros (e.g. "0123" stays "0123").
 *  4. Normalizes Arabic-Indic numerals (e.g. "٠١٢٣" -> "0123").
 *  5. Rejects any letters (Arabic or Latin), punctuation, slashes, dashes, or internal spaces.
 *  6. Throws a clear Arabic Error message on any non-numeric input.
 *
 * @param {string|number|null|undefined} value القيمة المدخلة
 * @param {string} [fieldLabel='رقم الأمر الإداري'] مسمى الحقل لرسالة الخطأ
 * @returns {string|null} السلسلة الرقمية بعد التوحيد أو null إذا كان الحقل فارغاً
 * @throws {Error} إطلاق خطأ بالعربية إذا احتوت القيمة على أي رموز أو حروف غير رقمية
 */
function validateOrderNumber(value, fieldLabel = 'رقم الأمر الإداري') {
  if (value === null || value === undefined) {
    return null;
  }

  const rawStr = typeof value === 'string' ? value : String(value);
  const trimmed = rawStr.trim();
  if (trimmed === '') {
    return null;
  }

  const normalized = normalizeArabicDigits(trimmed);

  // التحقق من أن السلسلة تتكون من أرقام فقط (0-9)
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${fieldLabel} يجب أن يتكون من أرقام فقط.`);
  }

  return normalized;
}

module.exports = {
  validateOrderNumber,
  normalizeArabicDigits,
};

