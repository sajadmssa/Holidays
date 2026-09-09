// ============================================================
//  uiHelpers.js – System Utilities: Toast, Confirm Dialog, Weekend Checks
// ============================================================

'use strict';

// Arabic workweek weekend: Friday = 5, Saturday = 6 (JS getDay())
export const WEEKEND_DAYS = new Set([5, 6]);

/**
 * Displays a sleek, non-blocking Toast notification.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} durationMs
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

  setTimeout(() => {
    toast.classList.add('toast-fade-out');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, durationMs);
}

/**
 * Displays a specialized export success toast with a "📂 فتح التقرير" action button
 * that automatically counts down and disappears after 5 seconds.
 *
 * @param {object} options
 * @param {string} options.filePath - Absolute path of the exported Excel file
 * @param {string} [options.message='تم تصدير التقرير بنجاح.'] - Notification message
 * @param {number} [options.durationMs=5000] - Duration in ms before auto fade-out
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

  // Progress Bar for 5s countdown
  const progressBar = document.createElement('div');
  progressBar.className = 'toast-progress-bar';

  toast.append(iconSpan, contentDiv, progressBar);
  container.appendChild(toast);

  // Trigger progress animation
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
 * Displays a custom, non-blocking HTML5 dialog confirmation returning a Promise<boolean>.
 * Replaces native window.confirm().
 *
 * @param {string} message
 * @param {string} title
 * @returns {Promise<boolean>}
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
 * Checks if a given ISO date falls on Friday or Saturday.
 * @param {string} isoDateStr
 * @returns {boolean}
 */
export function isWeekend(isoDateStr) {
  if (!isoDateStr) return false;
  const d = new Date(isoDateStr);
  if (isNaN(d.getTime())) return false;
  return WEEKEND_DAYS.has(d.getUTCDay());
}

/**
 * Toggles weekend warning styling and helper message.
 * @param {HTMLInputElement} inputEl
 * @param {HTMLElement} warningEl
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
