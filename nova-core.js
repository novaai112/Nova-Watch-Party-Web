/* nova-core.js — shared: Supabase client, settings, haptics, translate, i18n.
   Include AFTER config.js on every page:  <script src="nova-core.js"></script>  */
(function () {
  const C = window.NOVA_CONFIG || window.APP_CONFIG || {};
  const url = window.SUPABASE_URL || C.SUPABASE_URL || C.supabaseUrl || C.url;      // <- adjust if your config.js differs
  const key = window.SUPABASE_ANON_KEY || C.SUPABASE_ANON_KEY || C.supabaseAnonKey || C.anonKey;
  const DEF = { quick: '❤️', restrict: false, hideMature: true, haptic: true, floating: true, translate: false,
                mute: true, hideLoc: false, lang: 'en', notif: true, noShare: true };
  const load = () => { try { return { ...DEF, ...JSON.parse(localStorage.getItem('nova_settings') || '{}') }; } catch { return { ...DEF }; } };
  const T = {
    en: { settings:'Settings', social:'Social', language:'Language', support:'Support', notification:'Notification', mydata:'My Data', terms:'Terms & Condition', acct:'Accounts & subscription', profile:'Profile',
      quick:'Quick Reaction', quickd:'Change your double-tap reaction to chat messages', restrict:'Restrict Invitations', restrictd:'Only allow invitations from friends',
      mature:'Hide Mature Content', matured:'Do not display explicit content', haptic:'Haptic Feedback', hapticd:'Vibrate in response to taps and actions',
      floating:'Floating Video Player', floatingd:'Allows videos to be played outside the app', translate:'Auto-translate Chat Messages', translated:'Auto-translate chat messages that do not match your language',
      mute:'Mute When Other Audio Plays', muted:'Mute audio when another app plays sound, though your device may mute it automatically during calls', hideloc:'Hide Location', hidelocd:'You will not appear on the map',
      privacy:'Privacy', contact:'Contact us', delete:'Delete Account', signout:'Sign out', save:'Save', cancel:'Cancel', no:'NO', yes:'YES', bio:'Bio', gallery:'Gallery', stats:'Stats', friends:'Friends', joined:'Join Date', socials:'Socials', soon:'Nothing here yet.',
      privpol:'Privacy Policy', datapol:'Data Policy', tos:'Terms of Service', noshare:'Do not share my data with third parties' },
    hi: { settings:'सेटिंग्स', social:'सोशल', language:'भाषा', support:'सहायता', notification:'सूचनाएँ', mydata:'मेरा डेटा', terms:'नियम और शर्तें', acct:'खाता और सदस्यता', profile:'प्रोफ़ाइल',
      quick:'त्वरित प्रतिक्रिया', restrict:'आमंत्रण सीमित करें', restrictd:'केवल दोस्तों से आमंत्रण स्वीकार करें', mature:'वयस्क सामग्री छिपाएँ', haptic:'हैप्टिक फ़ीडबैक', floating:'फ़्लोटिंग वीडियो प्लेयर',
      translate:'चैट संदेश स्वतः अनुवाद करें', mute:'अन्य ऑडियो चलने पर म्यूट करें', hideloc:'लोकेशन छिपाएँ', hidelocd:'आप मैप पर दिखाई नहीं देंगे', privacy:'गोपनीयता', contact:'हमसे संपर्क करें', delete:'खाता हटाएँ', signout:'साइन आउट',
      save:'सहेजें', cancel:'रद्द करें', no:'नहीं', yes:'हाँ', bio:'परिचय', gallery:'गैलरी', stats:'आँकड़े', friends:'दोस्त', joined:'जुड़ने की तारीख', privpol:'गोपनीयता नीति', datapol:'डेटा नीति', tos:'सेवा की शर्तें', noshare:'मेरा डेटा तीसरे पक्ष से साझा न करें' },
    es: { settings:'Ajustes', social:'Social', language:'Idioma', support:'Soporte', notification:'Notificaciones', mydata:'Mis datos', terms:'Términos y condiciones', acct:'Cuenta y suscripción', profile:'Perfil',
      quick:'Reacción rápida', restrict:'Restringir invitaciones', restrictd:'Solo permitir invitaciones de amigos', mature:'Ocultar contenido para adultos', haptic:'Respuesta háptica', floating:'Reproductor flotante',
      translate:'Traducir mensajes automáticamente', mute:'Silenciar si suena otro audio', hideloc:'Ocultar ubicación', hidelocd:'No aparecerás en el mapa', privacy:'Privacidad', contact:'Contáctanos', delete:'Eliminar cuenta', signout:'Cerrar sesión',
      save:'Guardar', cancel:'Cancelar', no:'NO', yes:'SÍ', bio:'Bio', gallery:'Galería', stats:'Estadísticas', friends:'Amigos', joined:'Fecha de registro', privpol:'Política de privacidad', datapol:'Política de datos', tos:'Términos del servicio', noshare:'No compartir mis datos con terceros' }
  };
  const LANGS = { en:'English', hi:'हिन्दी', es:'Español' };
  const Nova = {
    sb: window.supabase.createClient(url, key), S: load(), T, LANGS,
    t(k) { return (T[Nova.S.lang] || {})[k] || T.en[k] || k; },
    async set(k, v) {
      Nova.S[k] = v; localStorage.setItem('nova_settings', JSON.stringify(Nova.S));
      const { data } = await Nova.sb.auth.getSession();
      if (data.session) await Nova.sb.from('profiles').update({ settings: Nova.S }).eq('id', data.session.user.id);
    },
    async sync(userId) {            // pull server settings on login
      const { data } = await Nova.sb.from('profiles').select('settings').eq('id', userId).single();
      if (data && data.settings) { Nova.S = { ...DEF, ...data.settings }; localStorage.setItem('nova_settings', JSON.stringify(Nova.S)); }
    },
    haptic() { if (Nova.S.haptic && navigator.vibrate) navigator.vibrate(15); },
    // Use for every incoming chat message: returns English text if auto-translate is ON and message isn't English.
    async tr(text) {
      if (!Nova.S.translate || !text) return text;
      try {
        const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=' + encodeURIComponent(text));
        const j = await r.json(); return j[2] && j[2] !== 'en' ? j[0].map(x => x[0]).join('') : text;
      } catch { return text; }
    },
    // Floating player + mute rule: call from your player page.
    audioRule(video) {
      document.addEventListener('visibilitychange', () => { if (document.hidden && Nova.S.mute && video) video.muted = true; else if (video) video.muted = false; });
    },
    applyLang() { document.documentElement.lang = Nova.S.lang; document.querySelectorAll('[data-i18n]').forEach(e => e.textContent = Nova.t(e.dataset.i18n)); },
    esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
  };
  document.addEventListener('click', () => Nova.haptic(), true);
  window.Nova = Nova;
})();
