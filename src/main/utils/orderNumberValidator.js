// ============================================================
//  utils/orderNumberValidator.js
//  Reusable Administrative Order & Memo Number Validation
// ============================================================

'use strict';

/**
 * Normalizes Eastern Arabic (٠-٩) and Persian (۰-۹) numerals to standard ASCII digits (0-9).
 * Leaves all other characters untouched so validation can strictly evaluate them.
 *
 * @param {string} str
 * @returns {string}
 */
function normalizeArabicDigits(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)])
    .replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)]);
}

/**
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
 * @param {string|number|null|undefined} value The raw input value
 * @param {string} [fieldLabel='رقم الأمر الإداري'] Arabic label for the error message
 * @returns {string|null} Normalized numeric string or null if empty
 * @throws {Error} If value contains non-numeric characters
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

  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${fieldLabel} يجب أن يتكون من أرقام فقط.`);
  }

  return normalized;
}

/**
 * Returns true if the value is either empty (null/blank) or purely numeric.
 * Safe helper that never throws.
 *
 * @param {any} value
 * @returns {boolean}
 */
function isOrderNumberValid(value) {
  try {
    validateOrderNumber(value);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  validateOrderNumber,
  isOrderNumberValid,
  normalizeArabicDigits,
};
