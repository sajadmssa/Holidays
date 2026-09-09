// ============================================================
//  themeManager.js – Application Theme Controller (Light / Dark / System)
//  مدير مظهر وتنسيق التطبيق (الوضع الفاتح / الداكن / التلقائي حسب النظام)
//
//  المسؤوليات الرئيسية:
//    • إدارة حالة المظهر (Light, Dark, System) وتطبيق السمة على جذر الصفحة (data-theme).
//    • المزامنة الفورية من localStorage لمنع وميض الشاشة عند بدء التشغيل (Flash-free startup).
//    • المزامنة الموثوقة مع قاعدة البيانات (_AppSettings) لحفظ تفضيل المستخدم بشكل دائم.
//    • الاستجابة لتغيرات مظهر نظام التشغيل تلقائياً عند اختيار نمط "System".
// ============================================================

'use strict';

let currentTheme = 'system';
let mediaQuery = null;

/**
 * تحديد ما إذا كان المظهر الفعلي المطبق حالياً هو الوضع الداكن
 * Resolves whether the UI is currently effectively dark.
 * @returns {boolean} true إذا كانت الشاشة داكنة
 */
export function isDarkActive() {
  const theme = document.documentElement.getAttribute('data-theme') || currentTheme;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * تحديث أيقونة التبديل السريع في الشريط الجانبي والقائمة المنسدلة في الإعدادات
 * Updates the quick toggle icon in the sidebar and settings dropdown.
 */
function updateThemeUI() {
  const iconEl = document.getElementById('theme-toggle-icon');
  const quickBtn = document.getElementById('btn-quick-theme-toggle');
  const selectEl = document.getElementById('select-app-theme');

  const isDark = isDarkActive();

  if (iconEl) {
    iconEl.textContent = isDark ? '☀️' : '🌙';
  }

  if (quickBtn) {
    quickBtn.title = isDark ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن';
    quickBtn.setAttribute('aria-label', quickBtn.title);
  }

  if (selectEl && selectEl.value !== currentTheme) {
    selectEl.value = currentTheme;
  }
}

/**
 * تطبيق مظهر التطبيق وحفظه في التخزين المحلي وقاعدة البيانات
 * Sets and persists the application theme.
 * @param {'light'|'dark'|'system'} theme المظهر المطلوب
 * @param {boolean} [saveToDb=true] حفظ في قاعدة البيانات
 */
export async function setAppTheme(theme, saveToDb = true) {
  if (!['light', 'dark', 'system'].includes(theme)) {
    theme = 'system';
  }

  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);

  try {
    localStorage.setItem('app_theme', theme);
  } catch (_e) {}

  updateThemeUI();

  // الحفظ في قاعدة البيانات عبر IPC
  if (saveToDb && window.api?.system?.setSetting) {
    try {
      await window.api.system.setSetting('app_theme', theme);
    } catch (err) {
      console.error('Failed to save app_theme to DB:', err);
    }
  }
}

/**
 * تبديل فوري ومباشر بين الوضعين الفاتح والداكن عبر زر الشريط الجانبي
 * Toggles between Light and Dark mode directly from the quick button.
 */
export async function toggleQuickTheme() {
  const isDark = isDarkActive();
  const nextTheme = isDark ? 'light' : 'dark';
  await setAppTheme(nextTheme, true);
}

/**
 * تهيئة مدير المظهر وربط مستمعات الأحداث واسترجاع التفضيلات المحفوظة
 * Initializes the theme manager, hooks event listeners and synchronizes with DB.
 */
export async function initThemeManager() {
  // 1. قراءة فورية أولية من localStorage لتفادي الوميض
  let savedTheme = 'system';
  try {
    savedTheme = localStorage.getItem('app_theme') || 'system';
  } catch (_e) {}

  currentTheme = savedTheme;
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeUI();

  // 2. الاستماع لتغيرات مظهر نظام التشغيل ويندوز (OS Dark Mode Listener)
  if (window.matchMedia) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', () => {
      if (currentTheme === 'system') {
        updateThemeUI();
      }
    });
  }

  // 3. ربط زر التبديل السريع في الشريط الجانبي
  const quickBtn = document.getElementById('btn-quick-theme-toggle');
  if (quickBtn) {
    quickBtn.addEventListener('click', () => {
      toggleQuickTheme();
    });
  }

  // 4. استرجاع القيمة المعتمدة من قاعدة البيانات للتأكيد والمزامنة
  if (window.api?.system?.getSetting) {
    try {
      const res = await window.api.system.getSetting('app_theme');
      if (res && res.success && res.data) {
        const dbTheme = typeof res.data === 'string' ? res.data.trim() : (res.data.Value || '');
        if (dbTheme && ['light', 'dark', 'system'].includes(dbTheme) && dbTheme !== currentTheme) {
          setAppTheme(dbTheme, false);
        }
      }
    } catch (err) {
      console.warn('Could not read app_theme from database:', err);
    }
  }
}

