(function () {
  const THEME_KEY = 'nova-watch-theme';
  const root = document.documentElement;

  function applyTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    root.style.colorScheme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      // Ignore storage issues in restricted contexts.
    }
  }

  applyTheme('light');

  window.setTheme = function (theme) {
    applyTheme(theme);
  };
})();
