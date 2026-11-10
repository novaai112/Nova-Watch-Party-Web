(function () {
  const THEME_KEY = 'nova-watch-theme';
  const root = document.documentElement;
  const media = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');

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

  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') {
      applyTheme(stored);
      return;
    }
  } catch (e) {
    // Ignore storage issues in restricted contexts.
  }

  applyTheme(media && media.matches ? 'dark' : 'light');

  if (media && media.addEventListener) {
    media.addEventListener('change', function (event) {
      try {
        if (!localStorage.getItem(THEME_KEY)) {
          applyTheme(event.matches ? 'dark' : 'light');
        }
      } catch (e) {
        applyTheme(event.matches ? 'dark' : 'light');
      }
    });
  } else if (media && media.addListener) {
    media.addListener(function (event) {
      try {
        if (!localStorage.getItem(THEME_KEY)) {
          applyTheme(event.matches ? 'dark' : 'light');
        }
      } catch (e) {
        applyTheme(event.matches ? 'dark' : 'light');
      }
    });
  }

  window.setTheme = function (theme) {
    applyTheme(theme);
  };
})();
