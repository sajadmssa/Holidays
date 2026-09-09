// ============================================================
//  NotificationService.js  –  Automated Alert & Notification Service
//  Main Process ONLY
//  Responsibilities:
//    • Baghdad Time (UTC+3) tracking for daily 11:00 AM alert
//    • Startup check for missed daily notifications
//    • Native OS Notification & IPC Push to Renderer
//    • Persistent notification logging in SQLite
// ============================================================

'use strict';

const { Notification } = require('electron');
const LeaveService = require('./LeaveService');

const NOTIFICATION_TYPE = 'resumption_alert';
const ALERT_HOUR_BAGHDAD = 11; // 11:00 AM

let _schedulerInterval = null;

/**
 * Returns the current date and time components in Baghdad timezone (UTC+3).
 * @returns {{ dateStr: string, hour: number, minute: number, second: number }}
 */
function getBaghdadTime() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (t) => parts.find((p) => p.type === t)?.value;

  const year    = getPart('year');
  const month   = getPart('month');
  const day     = getPart('day');
  const hour    = parseInt(getPart('hour'), 10);
  const minute  = parseInt(getPart('minute'), 10);
  const second  = parseInt(getPart('second'), 10);
  const dateStr = `${year}-${month}-${day}`;

  return { dateStr, hour, minute, second };
}

/**
 * Checks if a notification of the given type has already been sent today.
 * @param {import('better-sqlite3').Database} db
 * @param {string} dateStr
 * @returns {boolean}
 */
function hasNotificationBeenSent(db, dateStr) {
  const row = db
    .prepare('SELECT 1 FROM _NotificationLog WHERE notificationType = ? AND sentDate = ? LIMIT 1')
    .get(NOTIFICATION_TYPE, dateStr);
  return Boolean(row);
}

/**
 * Logs a successful notification in the database.
 * @param {import('better-sqlite3').Database} db
 * @param {string} dateStr
 * @param {number} itemCount
 */
function recordNotificationSent(db, dateStr, itemCount) {
  db.prepare(
    'INSERT INTO _NotificationLog (notificationType, sentDate, itemCount) VALUES (?, ?, ?)'
  ).run(NOTIFICATION_TYPE, dateStr, itemCount);
}

/**
 * Performs the check and triggers the notification if applicable.
 * @param {import('electron').BrowserWindow} mainWindow
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} force - Force trigger even if hour < 11 (e.g. for testing)
 */
function checkAndTriggerAlert(mainWindow, db, force = false) {
  if (!db) return;

  const { dateStr, hour } = getBaghdadTime();

  // If not forced, only trigger if time is at or after 11:00 AM Baghdad time
  if (!force && hour < ALERT_HOUR_BAGHDAD) {
    return;
  }

  // Check if already sent today
  if (!force && hasNotificationBeenSent(db, dateStr)) {
    return;
  }

  // Query employees with leaves ending within 3 days
  const approachingEmployees = LeaveService.getApproachingResumptions(db, 3);

  if (!approachingEmployees || approachingEmployees.length === 0) {
    // If no employees, record as checked so we don't spam checks
    recordNotificationSent(db, dateStr, 0);
    console.log(`[NotificationService] Checked for ${dateStr} (Baghdad): No approaching resumptions.`);
    return;
  }

  const count = approachingEmployees.length;
  console.log(`[NotificationService] Sending resumption alert for ${count} employee(s) on ${dateStr}`);

  // 1. Native OS Notification
  if (Notification.isSupported()) {
    const summaryNames = approachingEmployees
      .slice(0, 3)
      .map((e) => e.FullName)
      .join('، ');

    const extra = count > 3 ? ` و ${count - 3} آخرين` : '';

    const notification = new Notification({
      title: '⏰ تنبيه اقتراب المباشرة (نظام الإجازات)',
      body: `يوجد ${count} موظف/ين تنتهي إجازتهم خلال 3 أيام قادمة:\n${summaryNames}${extra}`,
      silent: false,
    });

    notification.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        // Send IPC to switch to dashboard
        mainWindow.webContents.send('notification:open-dashboard');
      }
    });

    notification.show();
  }

  // 2. In-App IPC Message to Renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('notification:resumption-alert', {
      date: dateStr,
      count,
      employees: approachingEmployees,
    });
  }

  // 3. Record in DB
  recordNotificationSent(db, dateStr, count);
}

/**
 * Initializes the background notification scheduler.
 * Runs once on app startup and polls every 60 seconds.
 *
 * @param {import('electron').BrowserWindow} mainWindow
 * @param {import('better-sqlite3').Database} db
 */
function startNotificationScheduler(mainWindow, db) {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
  }

  // 1. Immediate startup check (e.g. if opened after 11:00 AM)
  setTimeout(() => {
    try {
      checkAndTriggerAlert(mainWindow, db);
    } catch (err) {
      console.error('[NotificationService] Startup check error:', err.message);
    }
  }, 2500); // slight delay after window load

  // 2. Periodic 60-second polling (lightweight timestamp compare)
  _schedulerInterval = setInterval(() => {
    try {
      checkAndTriggerAlert(mainWindow, db);
    } catch (err) {
      console.error('[NotificationService] Scheduled check error:', err.message);
    }
  }, 60 * 1000);

  console.log('[NotificationService] Scheduler initialized (Daily 11:00 AM Baghdad time).');
}

/**
 * Stops the notification scheduler on app shutdown.
 */
function stopNotificationScheduler() {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
  }
}

module.exports = {
  startNotificationScheduler,
  stopNotificationScheduler,
  checkAndTriggerAlert,
  getBaghdadTime,
};
