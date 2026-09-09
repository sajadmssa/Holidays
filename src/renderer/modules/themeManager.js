// ============================================================
//  themeManager.js – Application Theme Controller (Light / Dark / System)
// ============================================================

'use strict';

let currentTheme = 'system';
let mediaQuery = null;

/**
 * Resolves whether the UI is currently effectively dark.
 * @returns {boolean}
 */
export function isDarkActive() {
  const theme = document.documentElement.getAttribute('data-theme') || currentTheme;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
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
 * Sets and persists the application theme.
 * @param {'light'|'dark'|'system'} theme
 * @param {boolean} [saveToDb=true]
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

  if (saveToDb && window.api?.system?.setSetting) {
    try {
      await window.api.system.setSetting('app_theme', theme);
    } catch (err) {
      console.error('Failed to save app_theme to DB:', err);
    }
  }
}

/**
 * Toggles between Light and Dark mode directly from the quick button.
 */
export async function toggleQuickTheme() {
  const isDark = isDarkActive();
  const nextTheme = isDark ? 'light' : 'dark';
  await setAppTheme(nextTheme, true);
}

/**
 * Initializes the theme manager, hooks event listeners and synchronizes with DB.
 */
export async function initThemeManager() {
  // 1. Initial cached read from localStorage for instant sync
  let savedTheme = 'system';
  try {
    savedTheme = localStorage.getItem('app_theme') || 'system';
  } catch (_e) {}

  currentTheme = savedTheme;
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeUI();

  // 2. Listen to OS system theme changes
  if (window.matchMedia) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', () => {
      if (currentTheme === 'system') {
        updateThemeUI();
      }
    });
  }

  // 3. Bind Quick Toggle button
  const quickBtn = document.getElementById('btn-quick-theme-toggle');
  if (quickBtn) {
    quickBtn.addEventListener('click', () => {
      toggleQuickTheme();
    });
  }

  // 4. Async sync with DB setting (authoritative)
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
