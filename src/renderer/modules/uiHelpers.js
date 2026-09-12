// ============================================================
//  uiHelpers.js – System Utilities: Toast, Confirm Dialog, Weekend Checks
//  أدوات مساعدة واجهة المستخدم: الإشعارات المنبثقة، مربعات التأكيد، وفحص العطل
//
//  المسؤوليات الرئيسية:
//    • عرض الإشعارات المنبثقة الخفيفة (Toast Notifications) بنجاح/فشل/تحذير.
//    • عرض إشعار التصدير التفاعلي مع زر مباشر لفتح الملف وشريط تقدم زمني تنازلي.
//    • نافذة تأكيد الإجراءات البديلة لـ window.confirm بنظام HTML5 Dialog المتوافق مع الوعود (Promises).
//    • التحقق من عطلة نهاية الأسبوع الرسمية (الجمعة والسبت) وتنبيه المستخدم بصرياً.
// ============================================================

'use strict';

// أيام العطلة الأسبوعية في نظام الخدمة المدنية العراقي: الجمعة = 5، السبت = 6
export const WEEKEND_DAYS = new Set([5, 6]);

/**
 * عرض إشعار سريع وأنيق وغير معطل لتفاعل المستخدم (Toast Notification)
 * Displays a sleek, non-blocking Toast notification.
 * @param {string} message نص الرسالة
 * @param {'success'|'error'|'warning'|'info'} type نوع الإشعار
 * @param {number} durationMs مدة الظهور بالمللي ثانية (افتراضياً 3.5 ثانية)
 */
export function showToast(message, type = 'info', durationMs = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  const iconSpan = document.createElement('span');
  iconSpan.textContent = iconMap[type] || 'ℹ️';

  const textSpan = document.createElement('span');
  textSpan.textContent = message;

  toast.append(iconSpan, textSpan);
  container.appendChild(toast);

  // إخفاء وحذف الإشعار تدريجياً بعد انقضاء المدة
  setTimeout(() => {
    toast.classList.add('toast-fade-out');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, durationMs);
}

/**
 * عرض إشعار نجاح التصدير المخصص مع زر مباشر "📂 فتح التقرير" وشريط عد تنازلي لمدة 5 ثوانٍ
 * Displays a specialized export success toast with a "📂 فتح التقرير" action button
 * that automatically counts down and disappears after 5 seconds.
 *
 * @param {object} options
 * @param {string} options.filePath - المسار المطلق لملف Excel المصدر
 * @param {string} [options.message='تم تصدير التقرير بنجاح.'] - نص الإشعار
 * @param {number} [options.durationMs=5000] - مدة العد التنازلي بالمللي ثانية
 */
export function showExportSuccessToast({ filePath, message = 'تم تصدير التقرير بنجاح.', durationMs = 5000 }) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast toast-success toast-export-success';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'toast-icon';
  iconSpan.textContent = '✅';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'toast-export-content';

  const textSpan = document.createElement('span');
  textSpan.className = 'toast-export-text';
  textSpan.textContent = message;

  contentDiv.appendChild(textSpan);

  // زر فتح الملف مباشرة بالبرنامج الافتراضي (مثل Excel)
  if (filePath && window.api?.system?.openPath) {
    const btnOpen = document.createElement('button');
    btnOpen.type = 'button';
    btnOpen.className = 'btn-toast-open-file';
    btnOpen.innerHTML = '<span>📂</span> <span>فتح التقرير</span>';
    btnOpen.title = 'فتح ملف التقرير بالبرنامج الافتراضي';
    btnOpen.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await window.api.system.openPath(filePath);
      } catch (err) {
        showToast('تعذر فتح الملف تلقائياً، يرجى فتحه يدوياً من المسار المحدد.', 'warning');
      }
    });
    contentDiv.appendChild(btnOpen);
  }

  // شريط التقدم للعد التنازلي
  const progressBar = document.createElement('div');
  progressBar.className = 'toast-progress-bar';

  toast.append(iconSpan, contentDiv, progressBar);
  container.appendChild(toast);

  // تحريك شريط التقدم بتدرج زمني خطي
  requestAnimationFrame(() => {
    progressBar.style.transition = `width ${durationMs}ms linear`;
    progressBar.style.width = '0%';
  });

  setTimeout(() => {
    toast.classList.add('toast-fade-out');
    setTimeout(() => {
      toast.remove();
    }, 350);
  }, durationMs);
}

/**
 * عرض نافذة تأكيد مخصصة (HTML5 Dialog) غير معطلة تُرجع وعداً منطقياً (Promise<boolean>)
 * Displays a custom, non-blocking HTML5 dialog confirmation returning a Promise<boolean>.
 * Replaces native window.confirm().
 *
 * @param {string} message نص رسالة التأكيد
 * @param {string} title عنوان نافذة التأكيد
 * @returns {Promise<boolean>} true إذا وافق المستخدم، وfalse إذا ألغى
 */
export function showConfirm(message, title = 'تأكيد الإجراء') {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const msgEl = document.getElementById('confirm-modal-message');
    const btnYes = document.getElementById('btn-confirm-yes');
    const btnNo = document.getElementById('btn-confirm-no');

    if (!modal || !btnYes || !btnNo) {
      resolve(true);
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;

    const handleYes = () => {
      cleanup();
      modal.close();
      resolve(true);
    };

    const handleNo = () => {
      cleanup();
      modal.close();
      resolve(false);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    // إزالة مستمعات الأحداث لتفادي تسريب الذاكرة أو التداخل
    const cleanup = () => {
      btnYes.removeEventListener('click', handleYes);
      btnNo.removeEventListener('click', handleNo);
      modal.removeEventListener('cancel', handleCancel);
    };

    btnYes.addEventListener('click', handleYes);
    btnNo.addEventListener('click', handleNo);
    modal.addEventListener('cancel', handleCancel);

    modal.showModal();
  });
}

/**
 * التحقق مما إذا كان التاريخ المحدد يصادف يوم عطلة نهاية أسبوع (جمعة أو سبت)
 * Checks if a given ISO date falls on Friday or Saturday.
 * @param {string} isoDateStr تاريخ بصيغة YYYY-MM-DD
 * @returns {boolean}
 */
export function isWeekend(isoDateStr) {
  if (!isoDateStr) return false;
  const d = new Date(isoDateStr);
  if (isNaN(d.getTime())) return false;
  return WEEKEND_DAYS.has(d.getUTCDay());
}

/**
 * تطبيق أو إزالة تنسيق ورسالة التحذير من العطلة الأسبوعية على حقل التاريخ
 * Toggles weekend warning styling and helper message.
 * @param {HTMLInputElement} inputEl حقل إدخال التاريخ
 * @param {HTMLElement} warningEl عنصر رسالة التحذير
 */
export function applyWeekendWarning(inputEl, warningEl) {
  const isWknd = isWeekend(inputEl.value);

  if (isWknd) {
    inputEl.classList.add('weekend-warning');
    warningEl.classList.add('visible');
  } else {
    inputEl.classList.remove('weekend-warning');
    warningEl.classList.remove('visible');
  }
}

/**
 * إضافة عدد محدد من الأيام إلى تاريخ بداية معين بالاعتماد على التوقيت العالمي UTC
 * مع مراعاة التوقيت القياسي UTC لتفادي فروق التوقيت الشتوي/الصيفي
 * @param {string} dateStr - تاريخ البداية بتنسيق YYYY-MM-DD
 * @param {number} daysCount - عدد الأيام
 * @returns {string|null} تاريخ النهاية المحسوب بتنسيق YYYY-MM-DD
 */
export function addDaysToDate(dateStr, daysCount) {
  if (!dateStr || !daysCount || daysCount <= 0) return null;
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return null;
  const [y, m, d] = parts;
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + (daysCount - 1));
  const resY = date.getUTCFullYear();
  const resM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const resD = String(date.getUTCDate()).padStart(2, '0');
  return `${resY}-${resM}-${resD}`;
}

/**
 * احتساب عدد الأيام بين تاريخين بالاعتماد على UTC شاملاً يومي البداية والنهاية
 * @param {string} startStr - تاريخ البداية بتنسيق YYYY-MM-DD
 * @param {string} endStr - تاريخ النهاية بتنسيق YYYY-MM-DD
 * @returns {number|null} عدد الأيام المحسوب
 */
export function recomputeDays(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const parts1 = startStr.split('-').map(Number);
  const parts2 = endStr.split('-').map(Number);
  if (parts1.length !== 3 || parts2.length !== 3) return null;
  const d1 = new Date(Date.UTC(parts1[0], parts1[1] - 1, parts1[2]));
  const d2 = new Date(Date.UTC(parts2[0], parts2[1] - 1, parts2[2]));
  if (isNaN(d1.getTime()) || isNaN(d2.getTime()) || d2 < d1) return null;
  const MS_PER_DAY = 86_400_000;
  return Math.round((d2.getTime() - d1.getTime()) / MS_PER_DAY) + 1;
}

