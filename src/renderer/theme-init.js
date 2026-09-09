// ============================================================
//  theme-init.js
//  Synchronous Early Theme Initializer (يُنفَّذ مبكراً داخل head)
//  يقرأ السمة المحفوظة في localStorage ويُطبّقها على جذر المستند
//  فورياً لمنع وميض الشاشة الأبيض (FOUT) قبل رندرة عناصر الواجهة.
// ============================================================

try {
  const savedTheme = localStorage.getItem('app_theme') || 'system';
  if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else if (savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'system');
  }
} catch (_e) {}
