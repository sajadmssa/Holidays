// ============================================================
//  NotificationService.js  –  Automated Alert & Notification Service
//  خدمة التنبيهات والإشعارات الآلية لمباشرة الموظفين بعد الإجازات
//  Main Process ONLY - تعمل حصرياً في العملية الرئيسية لنظام Electron
//
//  المسؤوليات الرئيسية:
//    • متابعة توقيت بغداد الرسمي (Asia/Baghdad - UTC+3) لتحديد موعد التنبيه اليومي (11:00 صباحاً).
//    • فحص الإقلاع (Startup Check) لتدارك التنبيهات إذا تم تشغيل البرنامج بعد الساعة 11:00 صباحاً.
//    • إطلاق إشعار نظام التشغيل الأصيل (Native Windows/OS Notification) مع دعم النقر للانتقال للوحة التحكم.
//    • بث حدث IPC فوري إلى واجهة المستخدم (Renderer Window) لعرض شريط التنبيه الداخلي.
//    • تسجيل عمليات التنبيه في قاعدة البيانات بجدول _NotificationLog لمنع تكرار الإشعار في نفس اليوم.
// ============================================================

'use strict';

const { Notification } = require('electron');
const LeaveService = require('./LeaveService');

// إعدادات التنبيه الثابتة
const NOTIFICATION_TYPE = 'resumption_alert'; // نوع التنبيه في جدول السجلات
const ALERT_HOUR_BAGHDAD = 11;                // الساعة المحددة للتنبيه بتوقيت بغداد (11:00 صباحاً)

// مؤشر المؤقت الدوري للمجدول في الذاكرة
let _schedulerInterval = null;

/**
 * استخراج مكونات التاريخ والوقت الحالي بدقة استناداً إلى توقيت بغداد (UTC+3)
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
 * التحقق مما إذا كان قد تم إرسال إشعار من هذا النوع بالفعل في تاريخ اليوم
 * Checks if a notification of the given type has already been sent today.
 * @param {import('better-sqlite3').Database} db
 * @param {string} dateStr تاريخ اليوم بصيغة YYYY-MM-DD
 * @returns {boolean}
 */
function hasNotificationBeenSent(db, dateStr) {
  const row = db
    .prepare('SELECT 1 FROM _NotificationLog WHERE notificationType = ? AND sentDate = ? LIMIT 1')
    .get(NOTIFICATION_TYPE, dateStr);
  return Boolean(row);
}

/**
 * تسجيل نجاح إرسال الإشعار لليوم الحالي في جدول _NotificationLog
 * Logs a successful notification in the database.
 * @param {import('better-sqlite3').Database} db
 * @param {string} dateStr
 * @param {number} itemCount عدد الموظفين المشمولين
 */
function recordNotificationSent(db, dateStr, itemCount) {
  db.prepare(
    'INSERT INTO _NotificationLog (notificationType, sentDate, itemCount) VALUES (?, ?, ?)'
  ).run(NOTIFICATION_TYPE, dateStr, itemCount);
}

/**
 * تنفيذ فحص استحقاق التنبيه وإطلاقه في حال انطباق الشروط
 * Performs the check and triggers the notification if applicable.
 * @param {import('electron').BrowserWindow} mainWindow نافذة التطبيق الرئيسية
 * @param {import('better-sqlite3').Database} db اتصال قاعدة البيانات
 * @param {boolean} force إجبار الإطلاق فوراً وتجاوز فحص الوقت والتكرار (لأغراض الاختبار)
 */
function checkAndTriggerAlert(mainWindow, db, force = false) {
  if (!db) return;

  const { dateStr, hour } = getBaghdadTime();

  // في حالة التشغيل التلقائي العادي: لا يتم الإطلاق إلا عند أو بعد الساعة 11:00 صباحاً بتوقيت بغداد
  if (!force && hour < ALERT_HOUR_BAGHDAD) {
    return;
  }

  // منع التكرار: إذا كان الإشعار قد أُرسل اليوم مسبقاً، نتوقف فوراً
  if (!force && hasNotificationBeenSent(db, dateStr)) {
    return;
  }

  // الاستعلام عن الموظفين الذين تنتهي إجازاتهم خلال الأيام الـ 3 القادمة
  const approachingEmployees = LeaveService.getApproachingResumptions(db, 3);

  if (!approachingEmployees || approachingEmployees.length === 0) {
    // في حال عدم وجود أي إجازات مقتربة من الانتهاء، نسجل الفحص كمنفذ لليوم (بعدد 0) لتجنب التكرار غير المفيد
    recordNotificationSent(db, dateStr, 0);
    console.log(`[NotificationService] Checked for ${dateStr} (Baghdad): No approaching resumptions.`);
    return;
  }

  const count = approachingEmployees.length;
  console.log(`[NotificationService] Sending resumption alert for ${count} employee(s) on ${dateStr}`);

  // 1. إطلاق إشعار نظام التشغيل الأصيل (Native Desktop Notification)
  if (Notification.isSupported()) {
    // تلخيص أسماء أول 3 موظفين في نص الإشعار
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

    // عند نقر المستخدم على الإشعار: إظهار النافذة والتركيز عليها وتوجيه الواجهة للوحة التحكم
    notification.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        // إرسال رسالة IPC لواجهة العرض للتحويل التلقائي إلى تبويب لوحة التحكم
        mainWindow.webContents.send('notification:open-dashboard');
      }
    });

    notification.show();
  }

  // 2. إرسال حدث داخلي (IPC Push) لواجهة المستخدم لعرض التنبيه داخل التطبيق نفسه
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('notification:resumption-alert', {
      date: dateStr,
      count,
      employees: approachingEmployees,
    });
  }

  // 3. توثيق إرسال التنبيه في قاعدة البيانات
  recordNotificationSent(db, dateStr, count);
}

/**
 * بدء وتشغيل مجدول التنبيهات في الخلفية
 * يعمل فور إقلاع التطبيق ثم يفحص دورياً كل 60 ثانية
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

  // 1. فحص فوري بعد إقلاع التطبيق بمهلة 2.5 ثانية (لاستدراك التنبيه إذا فُتح التطبيق بعد 11:00 صباحاً)
  setTimeout(() => {
    try {
      checkAndTriggerAlert(mainWindow, db);
    } catch (err) {
      console.error('[NotificationService] Startup check error:', err.message);
    }
  }, 2500); // مهلة قصيرة بعد اكتمال تحميل النافذة

  // 2. مؤقت دوري خفيف يفحص كل 60 ثانية لمقارنة الطابع الزمني الحالي بالساعة 11:00
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
 * إيقاف مجدول التنبيهات بأمان عند إغلاق التطبيق
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

