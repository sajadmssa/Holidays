// ============================================================
//  services/LoggerService.js  –  Internal Technical Logger
//  Main Process & Services
//  Responsibilities:
//    • Append technical errors, stack traces & warnings to logs/app.log
//    • Rotate log file if it exceeds size limits (e.g. 5 MB)
//    • Keep UI clean from technical jargon while recording full debug info
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let _logsDir = null;
let _logFile = null;

function getDefaultFallbackDir() {
  const baseDir = process.env.APPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming') : '.');
  return path.join(baseDir, 'leave-management-system', 'logs');
}

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

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB

function ensureLogDir() {
  const dir = resolveLogsDir();
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (_e) {
    // If permission fails on primary path, fallback to safe user directory
    _logsDir = getDefaultFallbackDir();
    _logFile = path.join(_logsDir, 'app.log');
    try {
      if (!fs.existsSync(_logsDir)) {
        fs.mkdirSync(_logsDir, { recursive: true });
      }
    } catch (_err) {}
  }
}

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

function getLogFilePath() {
  if (!_logFile) resolveLogsDir();
  return _logFile;
}

// ──────────────────────────────────────────────────────────────
//  Sensitive Data Redaction (PII / Paths / Financials)
// ──────────────────────────────────────────────────────────────
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

function isSensitiveKey(key) {
  if (typeof key !== 'string') return false;
  const lower = key.toLowerCase();
  // Preserve structural/type metadata
  if (lower === 'leavetypename' || lower === 'documenttypename' || lower === 'actiontype' || lower === 'entitytype') {
    return false;
  }
  return SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(lower));
}

function redactSensitiveString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/([a-zA-Z]:\\Users\\[^\\]+)/gi, '[USER_DIR]')
    .replace(/(\/Users\/[^\/]+)/gi, '[USER_DIR]')
    .replace(/(\/home\/[^\/]+)/gi, '[USER_DIR]');
}

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
 * Writes a structured entry to app.log with automatic PII redaction.
 * @param {'INFO'|'WARN'|'ERROR'} level
 * @param {string} context - Module or function name
 * @param {string} message - Description
 * @param {Error|object|string} [errorObj] - Technical error or payload
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
    // Failsafe: do not crash on logging failure
  }
}

module.exports = {
  info: (context, message, data) => log('INFO', context, message, data),
  warn: (context, message, data) => log('WARN', context, message, data),
  error: (context, message, err) => {
    log('ERROR', context, message, err);
    console.error(`[${context}] ${message}`, err ? (err.message || err) : '');
  },
  getLogPath: () => getLogFilePath(),
  redactSensitiveData,
  redactSensitiveString,
};

