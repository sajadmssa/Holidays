// ============================================================
//  services/LoggerService.js  –  Internal Technical Logger
//  خدمة التسجيل والتوثيق التقني الداخلي وحجب البيانات الحساسة
//  Main Process & Services - تعمل في كافة خدمات ومعالجات العملية الرئيسية
//
//  المسؤوليات الرئيسية:
//    • تسجيل الأخطاء الفنية وسجلات التتبع (Stack Traces) في ملف app.log.
//    • حجب البيانات الحساسة (PII Redaction) مثل الهويات والرواتب والمسارات الشخصية.
//    • تدوير ملف السجل (Log Rotation) تلقائياً عند تجاوز 5 ميجابايت لمنع التضخم.
//    • عزل المستخدم عن المصطلحات البرمجية المعقدة مع الاحتفاظ بالمعلومات للمطور.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// مسارات السجلات المؤقتة المحفوظة في الذاكرة
let _logsDir = null;
let _logFile = null;

/**
 * تحديد المسار الافتراضي الاحتياطي لمجلد السجلات في حال تعذر Electron getPath
 * @returns {string} المسار الاحتياطي في AppData
 */
function getDefaultFallbackDir() {
  const baseDir = process.env.APPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming') : '.');
  return path.join(baseDir, 'leave-management-system', 'logs');
}

/**
 * استكشاف وتحديد مجلد السجلات الفعلي للتطبيق
 * @returns {string} المسار المطلق لمجلد السجلات
 */
function resolveLogsDir() {
  if (_logsDir) return _logsDir;

  if (process.env.LOGS_DIR) {
    _logsDir = process.env.LOGS_DIR;
  } else if (app && typeof app.getPath === 'function') {
    try {
      _logsDir = path.join(app.getPath('userData'), 'logs');
    } catch (_e) {
      _logsDir = getDefaultFallbackDir();
    }
  } else {
    _logsDir = getDefaultFallbackDir();
  }

  _logFile = path.join(_logsDir, 'app.log');
  return _logsDir;
}

// الحد الأقصى لحجم ملف السجل قبل التدوير (5 ميجابايت)
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * التأكد من وجود مجلد السجلات وإنشاؤه مع التراجع الآمن في حال مشاكل الأذونات
 */
function ensureLogDir() {
  const dir = resolveLogsDir();
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (_e) {
    // في حال فشل الأذونات على المسار الأساسي، نتراجع للمجلد الآمن للمستخدم
    _logsDir = getDefaultFallbackDir();
    _logFile = path.join(_logsDir, 'app.log');
    try {
      if (!fs.existsSync(_logsDir)) {
        fs.mkdirSync(_logsDir, { recursive: true });
      }
    } catch (_err) {}
  }
}

/**
 * تدوير ملف السجل إذا تجاوز الحجم الأقصى (5 ميجابايت) بإعادة تسميته وحفظه بطابع زمني
 */
function rotateLogIfNeeded() {
  try {
    const file = getLogFilePath();
    if (fs.existsSync(file)) {
      const stats = fs.statSync(file);
      if (stats.size > MAX_LOG_SIZE) {
        const backupFile = path.join(resolveLogsDir(), `app_${Date.now()}.log`);
        fs.renameSync(file, backupFile);
      }
    }
  } catch (_e) {}
}

/**
 * الحصول على المسار الكامل لملف السجل الحالي app.log
 * @returns {string}
 */
function getLogFilePath() {
  if (!_logFile) resolveLogsDir();
  return _logFile;
}

// ──────────────────────────────────────────────────────────────
//  Sensitive Data Redaction (PII / Paths / Financials)
//  حجب وتطهير البيانات الحساسة (الهويات / المسارات / المالية)
// ──────────────────────────────────────────────────────────────

// الأنماط التعبيرية للحقول الحساسة المراد استبدالها بـ ***REDACTED***
const SENSITIVE_KEY_PATTERNS = [
  /name/i,
  /salary/i,
  /nationalid/i,
  /idnumber/i,
  /ssn/i,
  /civilid/i,
  /passport/i,
  /password/i,
  /token/i,
  /secret/i,
  /creditcard/i,
  /phone/i,
  /mobile/i,
  /email/i
];

/**
 * فحص ما إذا كان اسم الحقل مفتاحاً حساساً يستوجب الحجب
 * @param {string} key اسم الخاصية
 * @returns {boolean}
 */
function isSensitiveKey(key) {
  if (typeof key !== 'string') return false;
  const lower = key.toLowerCase();
  // استثناء الحقول الهيكلية المهمة للتشخيص البرمجي من الحجب
  if (lower === 'leavetypename' || lower === 'documenttypename' || lower === 'actiontype' || lower === 'entitytype') {
    return false;
  }
  return SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(lower));
}

/**
 * إخفاء مسارات مجلدات المستخدم الشخصية من النصوص منعاً لتسريب أسماء المستخدمين في السجلات
 * @param {string} str النص المراد تنقيته
 * @returns {string} النص بعد استبدال المسارات بـ [USER_DIR]
 */
function redactSensitiveString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/([a-zA-Z]:\\Users\\[^\\]+)/gi, '[USER_DIR]')
    .replace(/(\/Users\/[^\/]+)/gi, '[USER_DIR]')
    .replace(/(\/home\/[^\/]+)/gi, '[USER_DIR]');
}

/**
 * فحص وتنقية الكائنات والمصفوفات بشكل متكرر (Recursive) لحجب كافة البيانات الحساسة
 * @param {any} val القيمة أو الكائن المراد فحصه
 * @param {number} depth عمق التكرار لتفادي الحلقات اللانهائية
 * @returns {any} النسخة المنقاة
 */
function redactSensitiveData(val, depth = 0) {
  if (depth > 6) return '[MAX_DEPTH]';
  if (val === null || val === undefined) return val;

  if (typeof val === 'string') {
    return redactSensitiveString(val);
  }

  if (typeof val === 'number' || typeof val === 'boolean') {
    return val;
  }

  if (Array.isArray(val)) {
    return val.map(item => redactSensitiveData(item, depth + 1));
  }

  if (typeof val === 'object') {
    const cleanObj = {};
    for (const [key, value] of Object.entries(val)) {
      if (isSensitiveKey(key)) {
        cleanObj[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null) {
        cleanObj[key] = redactSensitiveData(value, depth + 1);
      } else if (typeof value === 'string') {
        cleanObj[key] = redactSensitiveString(value);
      } else {
        cleanObj[key] = value;
      }
    }
    return cleanObj;
  }

  return val;
}

/**
 * كتابة سطر منظم في ملف السجل مع تنقية البيانات التلقائية
 * Writes a structured entry to app.log with automatic PII redaction.
 * @param {'INFO'|'WARN'|'ERROR'} level مستوى التوثيق (معلومة/تحذير/خطأ)
 * @param {string} context سياق العملية أو اسم الموديول
 * @param {string} message رسالة التوضيح
 * @param {Error|object|string} [errorObj] كائن الخطأ أو حمولة البيانات الإضافية
 */
function log(level, context, message, errorObj = null) {
  try {
    ensureLogDir();
    rotateLogIfNeeded();

    const timestamp = new Date().toISOString();
    const cleanMessage = redactSensitiveString(message);
    let details = '';

    if (errorObj) {
      if (errorObj instanceof Error) {
        const cleanStack = redactSensitiveString(errorObj.stack || errorObj.message);
        details = ` | Stack: ${cleanStack}`;
      } else if (typeof errorObj === 'object') {
        const sanitizedData = redactSensitiveData(errorObj);
        details = ` | Data: ${JSON.stringify(sanitizedData)}`;
      } else {
        const cleanText = redactSensitiveString(String(errorObj));
        details = ` | Details: ${cleanText}`;
      }
    }

    const logLine = `[${timestamp}] [${level}] [${context}] ${cleanMessage}${details}\n`;
    fs.appendFileSync(getLogFilePath(), logLine, 'utf8');
  } catch (_e) {
    // صمام أمان: منع انهيار التطبيق في حال فشلت عملية التوثيق في الملف
  }
}

module.exports = {
  /** تسجيل رسالة معلومات عامة */
  info: (context, message, data) => log('INFO', context, message, data),
  /** تسجيل تحذير */
  warn: (context, message, data) => log('WARN', context, message, data),
  /** تسجيل خطأ فني مع طباعته في مخرجات وحدة التحكم للتشخيص السريع */
  error: (context, message, err) => {
    log('ERROR', context, message, err);
    console.error(`[${context}] ${message}`, err ? (err.message || err) : '');
  },
  /** مسار ملف السجل */
  getLogPath: () => getLogFilePath(),
  /** دوال التطهير والحجب المساعدة */
  redactSensitiveData,
  redactSensitiveString,
};


