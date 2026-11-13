/* nova-location.js — country flag, "City, State (Country)", open-map popup and the post-login location prompt.
   Include AFTER nova-core.js on pages that show people (profile.html, nova-home.html) together with nova-location.css.

   Privacy model
   - The browser asks for location only after the user taps "Allow location" in our own sheet (never on page load).
   - Only the city, state and country are stored, plus coordinates rounded to 2 decimals (about 1 km).
   - "Hide Location" ON  -> the SERVER stops sending city, state and coordinates to other users (see schema.sql, public_profiles);
                            the country flag is still sent. This file only mirrors that rule for the user's own screen.
   - Flags are images from flagcdn.com; reverse geocoding uses BigDataCloud (fallback: OpenStreetMap Nominatim). */
(function () {
  'use strict';
  if (!window.Nova || window.Nova.geo) return;
  const { esc, sb } = Nova;
  const G = (Nova.geo = {});
  const CC = /^[A-Za-z]{2}$/;
  const FLAG_H = [20, 24, 40, 60, 80, 120, 240];                 // heights flagcdn serves
  const pickH = n => FLAG_H.find(x => x >= n) || 240;
  let regionNames = null; try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { /* old browser */ }
  const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const clean = (s, n = 80) => String(s == null ? '' : s).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);

  /* ---------------------------------------------------------------- pure helpers (unit-tested) */
  G.cname = (code, fallback) => {
    code = String(code || '').toUpperCase();
    if (!CC.test(code)) return fallback || '';
    try { const n = regionNames && regionNames.of(code); if (n && n !== code) return n; } catch (e) { /* ignore */ }
    return fallback || code;
  };
  /* What others may see: with Hide Location ON only the country (flag) is left. */
  G.mask = (u, hide) => {
    const o = Object.assign({}, u || {});
    if (hide) { o.city = null; o.region = null; o.location_lat = null; o.location_lng = null; o.lat = null; o.lng = null; }
    return o;
  };
  G.coords = u => {
    const lat = num(u && (u.location_lat != null ? u.location_lat : u.lat)), lng = num(u && (u.location_lng != null ? u.location_lng : u.lng));
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  };
  /* "Ludhiana, Punjab (India)". Empty when no city/state is visible (hidden) — then only the flag is shown. */
  G.text = u => {
    if (!u) return '';
    const parts = [clean(u.city), clean(u.region)].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');
    if (!parts) return '';
    const country = G.cname(u.country_code, clean(u.country));
    return country ? parts + ' (' + country + ')' : parts;
  };
  G.round2 = n => Math.round(n * 100) / 100;

  /* ---------------------------------------------------------------- markup helpers */
  G.flag = (code, h = 14) => {
    if (!CC.test(code || '')) return '';
    const c = code.toLowerCase(), n = esc(G.cname(code));
    return `<img class="geo-flag" src="https://flagcdn.com/h${pickH(h)}/${c}.png" srcset="https://flagcdn.com/h${pickH(h * 2)}/${c}.png 2x" height="${h}" alt="${n}" title="${n}" data-cc="${c.toUpperCase()}" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="height:${h}px">`;
  };
  G.badge = (u, size) => {
    const code = u && u.country_code; if (!CC.test(code || '')) return '';
    const c = code.toLowerCase(), n = esc(G.cname(code)), b = Math.max(13, Math.round((size || 40) * 0.38));
    return `<span class="geo-badge" style="--b:${b}px" title="${n}"><img src="https://flagcdn.com/w40/${c}.png" srcset="https://flagcdn.com/w80/${c}.png 2x" alt="${n}" data-cc="${c.toUpperCase()}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`;
  };
  const MAP_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z"/><path d="M9 3v15M15 6v15"/></svg>';
  G.mapBtn = u => {
    const c = G.coords(u); if (!c) return '';
    return `<button type="button" class="geo-map" data-geo-map data-lat="${c.lat}" data-lng="${c.lng}" data-label="${esc(G.text(u))}" aria-label="Open map" title="Open map">${MAP_SVG}</button>`;
  };
  /* "Ludhiana, Punjab (India) [map]" — '' when the location is hidden or unknown. The flag itself sits next to @username / on the photo. */
  G.line = (u, opts) => {
    const t = G.text(u); if (!t) return '';
    const cls = opts && opts.cls ? ' ' + opts.cls : '';
    return `<div class="geo-line${cls}">${opts && opts.flag ? G.flag(u.country_code, 14) : ''}<span class="geo-text">${esc(t)}</span>${G.mapBtn(u)}</div>`;
  };
  /* Avatar with the country flag in its corner (use where Nova.avatar is not already inside a positioned button). */
  G.avatar = (u, size, cls = '') => `<span class="geo-av" style="width:${size}px;height:${size}px">${Nova.avatar(u, size, cls)}${G.badge(u, size)}</span>`;

  /* a failed flag image falls back to the 2-letter code instead of a broken icon */
  document.addEventListener('error', e => {
    const el = e.target; if (!el || el.tagName !== 'IMG' || !el.dataset || !el.dataset.cc) return;
    if (el.classList.contains('geo-flag')) { const s = document.createElement('span'); s.className = 'geo-code'; s.textContent = el.dataset.cc; s.title = el.title || ''; el.replaceWith(s); }
    else { const b = el.closest('.geo-badge'); if (b) { b.classList.add('txt'); b.textContent = el.dataset.cc; } }
  }, true);

  /* ---------------------------------------------------------------- map popup */
  let lastFocus = null;
  function closeOv() { document.querySelectorAll('.geo-ov').forEach(o => o.remove()); document.body.classList.remove('geo-lock'); if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* gone */ } } lastFocus = null; }
  function overlay(inner, label) {
    closeOv(); lastFocus = document.activeElement;
    const o = document.createElement('div'); o.className = 'geo-ov'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', label);
    o.innerHTML = inner; document.body.append(o); document.body.classList.add('geo-lock');
    o.addEventListener('mousedown', e => { if (e.target === o) closeOv(); });
    return o;
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.querySelector('.geo-ov')) closeOv(); });

  G.openMap = (lat, lng, label) => {
    lat = num(lat); lng = num(lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    const f = n => n.toFixed(5), dLng = 0.06, dLat = 0.04;
    const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map(f).join(',');
    const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(f(lat) + ',' + f(lng))}`;
    const osm = `https://www.openstreetmap.org/?mlat=${f(lat)}&mlon=${f(lng)}#map=13/${f(lat)}/${f(lng)}`;
    const gm = `https://www.google.com/maps/search/?api=1&query=${f(lat)}%2C${f(lng)}`;
    const o = overlay(`<div class="geo-modal"><div class="geo-mh"><b>${esc(label || 'Location')}</b><button type="button" class="geo-x" data-geo-close aria-label="Close map">&times;</button></div>
      <div class="geo-mapbox"><iframe title="Map of ${esc(label || 'location')}" src="${embed}" loading="lazy" referrerpolicy="no-referrer"></iframe></div>
      <div class="geo-mf"><small>Approximate area (about 1 km)</small><span><a href="${osm}" target="_blank" rel="noopener noreferrer">OpenStreetMap</a><a href="${gm}" target="_blank" rel="noopener noreferrer">Google Maps</a></span></div></div>`, 'Map');
    o.querySelector('[data-geo-close]').addEventListener('click', closeOv); o.querySelector('[data-geo-close]').focus();
  };
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-geo-map]');
    if (b) { e.preventDefault(); e.stopPropagation(); G.openMap(b.dataset.lat, b.dataset.lng, b.dataset.label); return; }
    const u = e.target.closest && e.target.closest('[data-geo-update]');
    if (u) { e.preventDefault(); G.request({ manual: true, btn: u }); }
  }, true);

  /* ---------------------------------------------------------------- finding + saving the user's place */
  async function fetchJson(url, ms) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms || 8000);
    try { const r = await fetch(url, { signal: ac.signal, referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }
  /* -> { city, region, cc, country } or null */
  G.parsePlace = (src, j) => {
    if (!j || typeof j !== 'object') return null;
    let city, region, cc, country;
    if (src === 'bdc') { city = j.city || j.locality; region = j.principalSubdivision; cc = j.countryCode; country = j.countryName; }
    else { const a = j.address || {}; city = a.city || a.town || a.village || a.suburb || a.municipality || a.county; region = a.state || a.region || a.state_district; cc = (a.country_code || '').toUpperCase(); country = a.country; }
    cc = String(cc || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return null;
    return { city: clean(city) || null, region: clean(region) || null, cc, country: G.cname(cc, clean(country)) };
  };
  G.reverse = async (lat, lng) => {
    const q = `latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}`;
    try { const p = G.parsePlace('bdc', await fetchJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?${q}&localityLanguage=en`)); if (p) return p; } catch (e) { /* try the fallback */ }
    try { const p = G.parsePlace('osm', await fetchJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&accept-language=en&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`)); if (p) return p; } catch (e) { /* give up */ }
    return null;
  };
  const permState = async () => { try { if (navigator.permissions && navigator.permissions.query) return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch (e) { /* Safari */ } return 'unknown'; };
  const getPos = () => new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 }));

  /* device position -> place -> profile row. Throws { code } on failure. */
  G.refresh = async () => {
    if (!navigator.geolocation) throw { code: 'unsupported' };
    let pos; try { pos = await getPos(); } catch (e) { throw { code: e && e.code === 1 ? 'denied' : e && e.code === 3 ? 'timeout' : 'unavailable' }; }
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    const place = await G.reverse(lat, lng); if (!place) throw { code: 'geocode' };
    const { data } = await sb.auth.getSession(); if (!data.session) throw { code: 'auth' };
    const row = { country: place.country, country_code: place.cc, city: place.city, region: place.region,
      location_lat: G.round2(lat), location_lng: G.round2(lng), location_updated_at: new Date().toISOString() };
    const { error } = await sb.from('profiles').update(row).eq('id', data.session.user.id);
    if (error) throw { code: 'save', message: error.message };
    try { sessionStorage.setItem('nova_pos', JSON.stringify({ lat, lng, t: Date.now() })); } catch (e) { /* private mode */ }   // lets "Nearby rooms" reuse it without asking again
    document.dispatchEvent(new CustomEvent('nova-geo-updated', { detail: row }));
    return Object.assign({ text: G.text(row) }, row);
  };

  const FAIL = {
    denied: 'Location is blocked for this site. Allow it from the lock icon in the address bar, then try again.',
    timeout: 'Finding your location took too long. Please try again.',
    unavailable: 'Your device could not find its location. Check that location services are on.',
    geocode: 'We found you, but could not look up the city. Check your connection and try again.',
    save: 'Could not save your location. If this keeps happening, run the latest schema.sql in Supabase.',
    unsupported: 'This browser cannot share its location.', auth: 'Please sign in again.'
  };
  G.request = async opts => {
    opts = opts || {}; const btn = opts.btn;
    if (G._busy) return null; G._busy = true; if (btn) { btn.disabled = true; btn.classList.add('busy'); }
    try {
      const p = await G.refresh();
      Nova.toast('Location updated' + (p.text ? ': ' + p.text : p.country ? ': ' + p.country : ''));
      return p;
    } catch (e) { Nova.toast(FAIL[e && e.code] || 'Could not update your location', 'err'); return null; }
    finally { G._busy = false; if (btn) { btn.disabled = false; btn.classList.remove('busy'); } }
  };

  /* ---------------------------------------------------------------- the sheet shown once after login */
  G.askSheet = () => new Promise(res => {
    const o = overlay(`<div class="geo-sheet"><div class="geo-pin">${MAP_SVG.replace('width="15" height="15"', 'width="26" height="26"')}</div>
      <h2>Show where you’re watching from?</h2>
      <p>Nova can add your <b>country flag</b> and <b>city</b> to your profile and to rooms. Your device location is used once to work this out.</p>
      <ul><li>Only your city, state and country are shown. The map pin is rounded to about 1&nbsp;km.</li><li><b>Settings → Hide Location</b> removes your city and map pin any time; your country flag stays.</li></ul>
      <button type="button" class="geo-go" data-a="allow">Allow location</button><button type="button" class="geo-later" data-a="later">Not now</button></div>`, 'Allow location');
    o.classList.add('geo-bottom');
    const done = v => { closeOv(); res(v); };
    o.addEventListener('mousedown', e => { if (e.target === o) done('later'); });
    o.addEventListener('keydown', e => { if (e.key === 'Escape') done('later'); });
    o.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => { const v = b.dataset.a; if (v === 'allow') { closeOv(); } res(v); if (v !== 'allow') closeOv(); }));
    o.querySelector('[data-a=allow]').focus();
  });

  /* Called after login on pages that include this file. Never nags: "Not now" is remembered, a blocked permission is left alone. */
  G.ensure = async () => {
    if (!navigator.geolocation || G._busy) return;
    try {
      const { data } = await sb.auth.getSession(); if (!data.session) return;
      const uid = data.session.user.id;
      const { data: me, error } = await sb.from('profiles').select('country_code,location_updated_at').eq('id', uid).single();
      if (error || !me) return;                                    // columns not created yet: stay quiet
      const age = me.location_updated_at ? Date.now() - Date.parse(me.location_updated_at) : Infinity, DAY = 864e5;
      const st = await permState();
      if (st === 'denied') return;
      if (st === 'granted') { if (age > 6 * 36e5) { G._busy = true; try { await G.refresh(); } catch (e) { /* silent */ } finally { G._busy = false; } } return; }
      if (me.country_code && age < 30 * DAY) return;               // already known recently
      const key = 'nova_geo_later_' + uid, later = +localStorage.getItem(key) || 0;
      if (Date.now() - later < (me.country_code ? 7 : 1) * DAY) return;
      const choice = await G.askSheet();
      if (choice === 'allow') await G.request({}); else { try { localStorage.setItem(key, String(Date.now())); } catch (e) { /* ignore */ } }
    } catch (e) { /* location is optional: never break the page */ }
  };

  function boot() {
    if (/(^|\/)(index|login|age-verify)(\.html)?$/.test(location.pathname)) return;
    const go = () => setTimeout(() => G.ensure(), 1800);
    if ((location.hash || '').startsWith('#setup')) {              // new user: finish the profile first
      addEventListener('hashchange', function h() { if (!(location.hash || '').startsWith('#setup')) { removeEventListener('hashchange', h); go(); } });
    } else go();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
