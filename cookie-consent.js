/* Nova cookie settings (login page). Shown once: until the visitor chooses. Signing out clears the choice (profile.html), so the card
   appears once again on the login page. Choice is kept in localStorage 'nova_cookie_consent' = { v, analytics, marketing, t }.
   Other scripts can read it:  NovaCookies.allowed('analytics' | 'marketing')  (necessary cookies are always allowed)
   and listen for the 'nova:cookies' event. */
(function () {
  'use strict';
  var KEY = 'nova_cookie_consent';
  function read() { try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.v === 1 ? v : null; } catch (e) { return null; } }
  function save(a, m) {
    var v = { v: 1, analytics: !!a, marketing: !!m, t: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('nova:cookies', { detail: v })); } catch (e) {}
  }
  window.NovaCookies = {
    get: read,
    allowed: function (c) { var v = read(); return c === 'necessary' ? true : !!(v && v[c]); },
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} }
  };
  if (read()) return;

  var box = document.createElement('div');
  box.className = 'nck'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Cookie settings'); box.setAttribute('aria-live', 'polite');
  var prefs = { analytics: false, marketing: false };

  function close(a, m) { save(a, m); box.remove(); }
  function main() {
    box.innerHTML =
      '<h2>Cookie settings</h2>' +
      '<p>We use cookies to keep you signed in, remember your language, theme and watch-party settings, and, if you agree, to measure and improve ' +
      'site performance and to personalize recommendations and embedded video (YouTube, Twitch, X) for you. You can read our Cookie Policy ' +
      '<button type="button" class="nck-link" data-a="custom">here</button>.</p>' +
      '<button type="button" class="nck-btn nck-wide" data-a="custom">Customize cookie settings</button>' +
      '<div class="nck-row2"><button type="button" class="nck-btn" data-a="reject">Reject all cookies</button>' +
      '<button type="button" class="nck-btn nck-main" data-a="accept">Accept all cookies</button></div>';
  }
  function custom() {
    function item(id, title, desc, ctl) { return '<div class="nck-item"><div><b>' + title + '</b><small>' + desc + '</small></div><div class="nck-ctl">' + ctl + '</div></div>'; }
    function sw(id, on) { return '<span data-l="' + id + '">' + (on ? 'On' : 'Off') + '</span><button type="button" class="nck-sw" role="switch" data-t="' + id + '" aria-checked="' + on + '" aria-label="' + id + ' cookies"></button>'; }
    box.innerHTML =
      '<h2>Cookie settings</h2>' +
      '<p>Nova Watch Party uses cookies and similar storage to recognise you and to make rooms, chat and video playback work. This also lets us improve the site ' +
      'and, if you allow it, personalize recommendations and the third-party media (YouTube, Twitch, X) shown in your rooms. That information might be about you, ' +
      'your preferences or your device. It does not usually identify you directly, but it can give you a more personalized experience. You can choose not to allow ' +
      'some types of cookies; the necessary ones keep Nova working and cannot be turned off.</p>' +
      item('necessary', 'Necessary', 'Enables sign-in, security and basic functionality (language, theme, room settings).',
        '<span>Required</span><button type="button" class="nck-sw" role="switch" aria-checked="true" disabled aria-label="Necessary cookies, required"></button>') +
      item('analytics', 'Analytics', 'Enables tracking of site performance.', sw('analytics', prefs.analytics)) +
      item('marketing', 'Marketing', 'Enables personalized recommendations and third-party media tracking.', sw('marketing', prefs.marketing)) +
      '<button type="button" class="nck-btn nck-main nck-save" data-a="save">Save preferences</button>';
  }
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var a = b.getAttribute('data-a'), t = b.getAttribute('data-t');
    if (t) {
      prefs[t] = !prefs[t]; b.setAttribute('aria-checked', String(prefs[t]));
      var l = box.querySelector('[data-l="' + t + '"]'); if (l) l.textContent = prefs[t] ? 'On' : 'Off';
    } else if (a === 'accept') close(true, true);
    else if (a === 'reject') close(false, false);
    else if (a === 'save') close(prefs.analytics, prefs.marketing);
    else if (a === 'custom') { custom(); var s = box.querySelector('.nck-sw:not([disabled])'); if (s) s.focus(); box.scrollTop = 0; }
  });
  main();
  function mount() { document.body.appendChild(box); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
