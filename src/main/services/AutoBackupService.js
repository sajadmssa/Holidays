// ============================================================
//  services/AutoBackupService.js  –  Automated 15-Day Backup Engine
//  Main Process ONLY
//  Responsibilities:
//    • Startup check for scheduled 15-day silent backups
//    • Safely create native SQLite backup in data/auto-backups
//    • Retain only the 10 most recent backups (auto-cleanup oldest)
//    • Record backup events in AuditLogs and _AppSettings
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const AuditService = require('./AuditService');

const BACKUP_INTERVAL_DAYS = 15;
const MS_PER_DAY = 86_400_000;
const MAX_BACKUPS_RETAINED = 10;

/**
 * Resolves the application data directory.
 * @returns {string}
 */
function getDbDir() {
  return process.env.HOLIDAYS_DB_DIR
    ? process.env.HOLIDAYS_DB_DIR
    : ((app && typeof app.getPath === 'function')
        ? app.getPath('userData')
        : path.join(process.env.APPDATA || '.', 'leave-management-system'));
}

/**
 * Ensures the auto-backups directory exists.
 * @param {string} dirPath
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

const LoggerService = require('./LoggerService');

/**
 * Rotates the auto-backups directory to keep only the newest N files.
 * @param {string} dirPath
 * @param {number} maxFiles
 */
function rotateBackups(dirPath, maxFiles = MAX_BACKUPS_RETAINED) {
  try {
    ensureDir(dirPath);
    const files = fs
      .readdirSync(dirPath)
      .filter((file) => /^auto_backup_.*\.(hbak|zip|db)$/i.test(file))
      .map((file) => {
        const fullPath = path.join(dirPath, file);
        const stats = fs.statSync(fullPath);
        return { file, fullPath, mtime: stats.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime); // Newest first

    if (files.length > maxFiles) {
      const filesToDelete = files.slice(maxFiles);
      for (const item of filesToDelete) {
        try {
          fs.unlinkSync(item.fullPath);
          LoggerService.info('AutoBackupService', `Rotated and removed old backup: ${item.file}`);
        } catch (delErr) {
          LoggerService.error('AutoBackupService', `Failed to delete old backup ${item.file}`, delErr);
        }
      }
    }
  } catch (err) {
    LoggerService.error('AutoBackupService', 'Rotation error', err);
  }
}

/**
 * Checks if 15 days have passed since the last automated backup and runs a new backup if due.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ force?: boolean, baseDir?: string }} options
 * @returns {Promise<{ performed: boolean, backupPath?: string, message?: string, error?: string }>}
 */
async function checkAndRunAutoBackup(db, { force = false, baseDir = null } = {}) {
  if (!db) {
    LoggerService.error('AutoBackupService', 'Database instance not provided.');
    return { performed: false, message: 'Database not provided.' };
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // 1. Check last auto-backup timestamp from _AppSettings
  const settingRow = db
    .prepare("SELECT Value FROM _AppSettings WHERE Key = 'last_auto_backup_date'")
    .get();

  let isDue = false;

  if (force || !settingRow || !settingRow.Value) {
    isDue = true;
  } else {
    const lastBackupTime = new Date(settingRow.Value).getTime();
    if (isNaN(lastBackupTime)) {
      isDue = true;
    } else {
      const daysSinceLast = (now.getTime() - lastBackupTime) / MS_PER_DAY;
      if (daysSinceLast >= BACKUP_INTERVAL_DAYS) {
        isDue = true;
      }
    }
  }

  if (!isDue) {
    return { performed: false, message: 'Auto backup is not due yet.' };
  }

  try {
    const dbDir = baseDir || getDbDir();
    const defaultBackupsDir = path.join(dbDir, 'auto-backups');

    // Check if custom path is configured in _AppSettings
    const customSetting = db
      .prepare("SELECT Value FROM _AppSettings WHERE Key = 'auto_backup_custom_path'")
      .get();
    const customPath = customSetting && customSetting.Value ? customSetting.Value.trim() : '';

    let autoBackupsDir = defaultBackupsDir;
    let usedFallback = false;
    let fallbackWarning = '';

    if (customPath) {
      try {
        if (!fs.existsSync(customPath)) {
          fs.mkdirSync(customPath, { recursive: true });
        }
        fs.accessSync(customPath, fs.constants.W_OK);
        autoBackupsDir = customPath;
      } catch (accessErr) {
        usedFallback = true;
        fallbackWarning = `تعذر الوصول لمسار النسخ الاحتياطي المخصص (${customPath}): ${accessErr.message}. تم الرجوع للمسار الافتراضي.`;
        LoggerService.warn('AutoBackupService', fallbackWarning, accessErr);
        autoBackupsDir = defaultBackupsDir;
      }
    }

    ensureDir(autoBackupsDir);

    // 2. Perform safe live backup (bundled .hbak format)
    const timestampStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFileName = `auto_backup_${timestampStr}.hbak`;
    const backupFilePath = path.join(autoBackupsDir, backupFileName);

    LoggerService.info('AutoBackupService', `Running 15-day automated bundle backup to: ${backupFilePath} (custom: ${!!customPath}, fallback: ${usedFallback})`);
    const dbModule = require('../database');
    await dbModule.backupDatabase(backupFilePath);

    // 3. Update _AppSettings (success & clear any previous error)
    db.prepare(`
      INSERT INTO _AppSettings (Key, Value, UpdatedAt)
      VALUES ('last_auto_backup_date', ?, datetime('now', 'localtime'))
      ON CONFLICT(Key) DO UPDATE SET
        Value = excluded.Value,
        UpdatedAt = excluded.UpdatedAt
    `).run(nowIso);

    db.prepare(`
      INSERT INTO _AppSettings (Key, Value, UpdatedAt)
      VALUES ('last_auto_backup_error', '', datetime('now', 'localtime'))
      ON CONFLICT(Key) DO UPDATE SET
        Value = excluded.Value,
        UpdatedAt = excluded.UpdatedAt
    `).run();

    db.prepare(`
      INSERT INTO _AppSettings (Key, Value, UpdatedAt)
      VALUES ('last_auto_backup_warning', ?, datetime('now', 'localtime'))
      ON CONFLICT(Key) DO UPDATE SET
        Value = excluded.Value,
        UpdatedAt = excluded.UpdatedAt
    `).run(usedFallback ? JSON.stringify({ warning: fallbackWarning, date: nowIso }) : '');

    // 4. Log to AuditService
    const auditDetails = usedFallback
      ? `نسخة احتياطية تلقائية دورية (مسار بديل آمن نظراً لتعذر المسار المخصص): ${backupFileName}`
      : (customPath
          ? `نسخة احتياطية تلقائية دورية (المسار المخصص): ${backupFileName}`
          : `نسخة احتياطية تلقائية دورية (كل 15 يوماً): ${backupFileName}`);

    AuditService.logAction(db, {
      actionType: 'BACKUP',
      entityType: 'System',
      entityID: null,
      oldValue: settingRow ? settingRow.Value : null,
      newValue: { fileName: backupFileName, path: backupFilePath, timestamp: nowIso, usedFallback },
      details: auditDetails,
    });

    // 5. Rotate backups (keep last 10)
    rotateBackups(autoBackupsDir, MAX_BACKUPS_RETAINED);

    return {
      performed: true,
      backupPath: backupFilePath,
      fileName: backupFileName,
      usedFallback,
      fallbackWarning,
    };
  } catch (err) {
    LoggerService.error('AutoBackupService', 'Failed to execute auto-backup', err);
    try {
      db.prepare(`
        INSERT INTO _AppSettings (Key, Value, UpdatedAt)
        VALUES ('last_auto_backup_error', ?, datetime('now', 'localtime'))
        ON CONFLICT(Key) DO UPDATE SET
          Value = excluded.Value,
          UpdatedAt = excluded.UpdatedAt
      `).run(JSON.stringify({ error: err.message, date: nowIso }));
    } catch (_saveErr) {}
    return { performed: false, error: err.message };
  }
}

module.exports = {
  checkAndRunAutoBackup,
  rotateBackups,
  BACKUP_INTERVAL_DAYS,
  MAX_BACKUPS_RETAINED,
};
