/* skeleton.js — HTML builders for skeleton placeholders. Include once; use NovaSk.xxx(n) anywhere. */
(function () {
  const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
  const S = {
    /* generic status wrapper: announces "Loading" to screen readers */
    wrap: (inner, label) => `<div class="sk-wrap" role="status" aria-busy="true" aria-live="polite"><span class="sk-sr">${label || 'Loading'}…</span>${inner}</div>`,
    rooms: (n = 3) => S.wrap(rep(n, () => '<div class="sk-room"><i class="skl"></i><div class="sk-info"><i class="skl ln w4"></i><i class="skl ln w2"></i><div class="sk-av"><i class="skl c"></i><i class="skl c"></i><i class="skl c"></i></div></div></div>'), 'Loading rooms'),
    videos: (n = 6) => S.wrap('<div class="sk-vg">' + rep(n, () => '<div class="sk-vc"><i class="skl th"></i><i class="skl ln w4"></i><i class="skl ln w2"></i></div>') + '</div>', 'Loading videos'),
    platforms: (n = 6) => S.wrap('<div class="sk-pg">' + rep(n, () => '<i class="skl"></i>') + '</div>', 'Loading'),
    rows: (n = 5) => S.wrap(rep(n, () => '<div class="sk-row"><i class="skl c"></i><div><i class="skl ln w1"></i><i class="skl ln w2"></i></div></div>'), 'Loading'),
    msgs: (n = 5) => S.wrap(rep(n, i => `<div class="sk-msg${i % 3 === 1 ? ' r' : ''}"><i class="skl c"></i><i class="skl b"></i></div>`), 'Loading messages'),
    room: () => S.wrap('<div class="sk-room-shell"><i class="skl vid"></i><div class="sk-chat">' + rep(5, i => `<div class="sk-msg${i % 3 === 1 ? ' r' : ''}"><i class="skl c"></i><i class="skl b"></i></div>`) + '</div></div>', 'Loading room'),
    profile: () => S.wrap('<div class="sk-prof"><div class="sk-hero"><i class="skl c"></i><div><i class="skl ln w1"></i><i class="skl ln w2"></i></div></div><div class="sk-cards"><i class="skl"></i><i class="skl"></i><i class="skl"></i></div><i class="skl" style="height:120px;border-radius:16px"></i><div class="sk-gal">' + rep(6, () => '<i class="skl"></i>') + '</div></div>', 'Loading profile'),
    splash: () => '<div class="sk-splash" aria-hidden="true"><div class="sk-top"><i class="skl"></i><i class="skl brand"></i><i class="skl"></i></div><i class="skl search"></i><i class="skl ln w3" style="height:20px"></i><div class="sk-wrap"><div class="sk-room"><i class="skl"></i><div class="sk-info"><i class="skl ln w4"></i><i class="skl ln w2"></i></div></div><div class="sk-room"><i class="skl"></i><div class="sk-info"><i class="skl ln w4"></i><i class="skl ln w2"></i></div></div></div></div><span class="sk-sr">Checking your sign-in…</span>',
    line: (w) => `<i class="skl ln ${w || 'w2'}" style="display:inline-block;vertical-align:middle"></i>`
  };
  window.NovaSk = S;
})();
