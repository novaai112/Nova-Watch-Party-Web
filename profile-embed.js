/* profile-embed.js — lets profile.html run inside the Watch-room dock (nova-home.html loads it as an iframe with ?embed=1).
   Nothing changes when the page is opened normally. Inside the dock:
   - "Back to Nova home" arrows and the Back buttons close the panel (or step back inside it) instead of navigating,
   - a public-room card opens that room through the parent page, after its "Switch rooms?" confirmation,
   - the browser history of the parent page is never touched (no history.back()). */
(function () {
  'use strict';
  var embedded = false;
  try { embedded = window.self !== window.top && /[?&]embed=1(?:&|$)/.test(location.search); } catch (e) { embedded = true; }
  window.NovaEmbed = { active: embedded, join: function () { return false; } };
  if (!embedded) return;

  document.documentElement.classList.add('is-embed');
  var stack = [location.hash || '#info'], quiet = false;
  var post = function (m) { try { parent.postMessage(Object.assign({ nova: 'dock' }, m), location.origin); } catch (e) {} };
  var homeRe = /(?:^|\/)nova-home\.html(?:#|$)/;
  var joinRe = /#join\/([A-Za-z0-9]{6,16})/;

  window.NovaEmbed.join = function (href) {
    if (!homeRe.test(String(href || '').replace(location.origin, ''))) return false;
    var m = joinRe.exec(href);
    post(m ? { type: 'join', code: m[1] } : { type: 'close' });
    return true;
  };

  /* tell the dock which page is showing (it hides its + button on Friends / chat, which have their own bottom bar) */
  var sendRoute = function () { post({ type: 'route', hash: location.hash || '#info' }); };
  addEventListener('hashchange', sendRoute);
  addEventListener('load', sendRoute);

  addEventListener('hashchange', function () {
    if (quiet) { quiet = false; return; }
    var h = location.hash || '';
    if (stack[stack.length - 1] !== h) stack.push(h);
  });
  /* the main profile page (the phone-style list: Info, Friends, Settings …) */
  var isHome = function () { return (location.hash || '').slice(1).split('/')[0] === 'home'; };
  var isPeople = function () { var k = (location.hash || '').slice(1).split('/')[0]; return k === 'friends' || k === 'chat'; };
  function toHome() { stack = ['#home']; quiet = true; location.replace('#home'); }
  function back() {
    if (stack.length > 1) { stack.pop(); quiet = true; location.replace(stack[stack.length - 1] || '#home'); }
    /* a sub-page reached directly (e.g. Settings) goes up to the main profile page; only that page closes the panel */
    else if (!isHome() && !isPeople()) toHome();
    else post({ type: 'close' });
  }

  /* capture phase: runs before the page's own click handlers */
  document.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var a = t.closest('a[href]');
    if (a && window.NovaEmbed.join(a.getAttribute('href'))) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    var g = t.closest('[data-go]');
    if (g && (g.dataset.go === 'back' || g.dataset.go === 'home')) { e.preventDefault(); e.stopImmediatePropagation(); back(); }
  }, true);

  addEventListener('keydown', function (e) { if (e.key === 'Escape' && !document.querySelector('.ov,#mdl')) post({ type: 'close' }); });

  /* the dock asks for a section ("#settings", "#friends") */
  addEventListener('message', function (e) {
    if (e.origin !== location.origin || e.source !== parent) return;
    var d = e.data; if (!d || d.nova !== 'dock-go' || typeof d.hash !== 'string' || d.hash.charAt(0) !== '#') return;
    stack = [d.hash];
    if ((location.hash || '') === d.hash) dispatchEvent(new HashChangeEvent('hashchange'));
    else { quiet = true; location.hash = d.hash; }
  });
})();
