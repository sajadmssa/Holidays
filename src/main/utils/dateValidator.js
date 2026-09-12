// ============================================================
//  utils/dateValidator.js
//  أداة التحقق الصارم من صحة التواريخ التقويمية القياسية (ISO-8601)
//
//  المسؤوليات الرئيسية:
//    • التحقق من مطابقة صيغة التاريخ لـ YYYY-MM-DD.
//    • التحقق التقويمي الواقعي (Real Calendar Verification) باستخدام توقيت UTC.
//    • منع الترحيل التلقائي في JavaScript (Auto Rollover) لرفض تواريخ غير موجودة
//      مثل 2024-02-30 أو 2023-02-29 أو 2026-04-31.
//    • قبول السنوات الكبيسة الصحيحة بدقة (مثل 2024-02-29).
// ============================================================

'use strict';

/**
 * التحقق الصارم من صحة التاريخ التقويمي بصيغة YYYY-MM-DD:
 * يمنع الترحيل التلقائي في JavaScript ويرفض التواريخ الوهمية تقويمياً.
 *
 * Validates that a string is a valid ISO date (YYYY-MM-DD) and represents
 * a real calendar day (no auto-rollover, e.g. rejects '2024-02-30').
 *
 * @param {any} dateString - النص المراد فحصه
 * @returns {boolean} true إذا كان التاريخ حقيقياً وصحيحاً تقويمياً
 */
function isValidIsoDate(dateString) {
  if (typeof dateString !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(dateString)) {
    return false;
  }
  const [y, m, d] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

module.exports = {
  isValidIsoDate,
};
