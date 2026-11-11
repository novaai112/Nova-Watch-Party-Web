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
    en: { settings:'Settings', social:'Social', language:'Language', support:'Support', notification:'Notification', mydata:'My Data', terms:'Terms & Condition', acct:'Accounts & subscription', profile:'Profile', watchparty:'Watch Party',
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
  Object.assign(T.en, { info:'Profile Info', accstats:'Account Stats', activity:'Watch Activity', privdata:'Privacy & Data', myaccount:'My Account', dashboard:'Dashboard', hello:'Hello,',
    verified:'Verified', editprofile:'Edit Profile', savechanges:'Save Changes', edit:'Edit', complete:'Profile completeness', nonotif:'No new notifications', addphotos:'Add photos', preview:'Preview',
    security:'Security Settings', password:'Password', passwordHint:'Change your account password', change:'Change', emailVerification:'Email Verification',
    notVerified:'Not verified', accountStatus:'Account Status', accountActive:'Account is active', active:'Active', twoFactor:'Two-Factor Authentication',
    twoFactorHint:'SMS and authenticator app', comingSoon:'Coming soon', dangerZone:'Danger Zone',
    deleteWarning:'Permanently delete your account. This action is irreversible.', deleteAccount:'Delete My Account',
    changePassword:'Change Password', newPassword:'New Password', confirmPassword:'Confirm New Password',
    passwordRequirement:'Min 8 characters, 1 number, 1 symbol', passwordMismatch:'Passwords do not match',
    updatePassword:'Update Password', passwordUpdated:'Password updated', passwordFailed:'Could not update password', typeDelete:'Type DELETE to confirm' });
  Object.assign(T.hi, { info:'प्रोफ़ाइल जानकारी', accstats:'खाता आँकड़े', activity:'देखने की गतिविधि', privdata:'गोपनीयता और डेटा', myaccount:'मेरा खाता', dashboard:'डैशबोर्ड', hello:'नमस्ते,',
    verified:'सत्यापित', editprofile:'प्रोफ़ाइल संपादित करें', savechanges:'बदलाव सहेजें', edit:'संपादित करें', complete:'प्रोफ़ाइल पूर्णता', nonotif:'कोई नई सूचना नहीं', addphotos:'फ़ोटो जोड़ें', preview:'पूर्वावलोकन',
    security:'सुरक्षा सेटिंग्स', password:'पासवर्ड', passwordHint:'अपने खाते का पासवर्ड बदलें', change:'बदलें', emailVerification:'ईमेल सत्यापन',
    notVerified:'सत्यापित नहीं', accountStatus:'खाते की स्थिति', accountActive:'खाता सक्रिय है', active:'सक्रिय', twoFactor:'दो-चरण प्रमाणीकरण',
    twoFactorHint:'SMS और प्रमाणक ऐप', comingSoon:'जल्द आ रहा है', dangerZone:'खतरे का क्षेत्र',
    deleteWarning:'अपना खाता स्थायी रूप से हटाएँ। यह कार्रवाई पूर्ववत नहीं की जा सकती।', deleteAccount:'मेरा खाता हटाएँ',
    changePassword:'पासवर्ड बदलें', newPassword:'नया पासवर्ड', confirmPassword:'नए पासवर्ड की पुष्टि करें',
    passwordRequirement:'कम से कम 8 अक्षर, 1 संख्या, 1 प्रतीक', passwordMismatch:'पासवर्ड मेल नहीं खाते',
    updatePassword:'पासवर्ड अपडेट करें', passwordUpdated:'पासवर्ड अपडेट किया गया', passwordFailed:'पासवर्ड अपडेट नहीं हो सका', typeDelete:'पुष्टि के लिए DELETE लिखें' });
  Object.assign(T.es, { info:'Info del perfil', accstats:'Estadísticas de la cuenta', activity:'Actividad de visualización', privdata:'Privacidad y datos', myaccount:'Mi cuenta', dashboard:'Panel', hello:'Hola,',
    verified:'Verificado', editprofile:'Editar perfil', savechanges:'Guardar cambios', edit:'Editar', complete:'Perfil completado', nonotif:'Sin notificaciones nuevas', addphotos:'Añadir fotos', preview:'Vista previa',
    security:'Configuración de seguridad', password:'Contraseña', passwordHint:'Cambia la contraseña de tu cuenta', change:'Cambiar', emailVerification:'Verificación de correo',
    notVerified:'No verificado', accountStatus:'Estado de la cuenta', accountActive:'La cuenta está activa', active:'Activo', twoFactor:'Autenticación de dos factores',
    twoFactorHint:'SMS y aplicación de autenticación', comingSoon:'Próximamente', dangerZone:'Zona de peligro',
    deleteWarning:'Elimina tu cuenta permanentemente. Esta acción es irreversible.', deleteAccount:'Eliminar mi cuenta',
    changePassword:'Cambiar contraseña', newPassword:'Nueva contraseña', confirmPassword:'Confirmar nueva contraseña',
    passwordRequirement:'Mínimo 8 caracteres, 1 número y 1 símbolo', passwordMismatch:'Las contraseñas no coinciden',
    updatePassword:'Actualizar contraseña', passwordUpdated:'Contraseña actualizada', passwordFailed:'No se pudo actualizar la contraseña', typeDelete:'Escribe DELETE para confirmar' });
  const LANGS = window.NovaTranslate ? window.NovaTranslate.LANGUAGES : { en:'English', hi:'हिन्दी', es:'Español' };
  const Nova = {
    sb: window.supabase.createClient(url, key), S: load(), T, LANGS,
    t(k) { return T.en[k] || k; },
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
    applyLang() {
      document.documentElement.lang = Nova.S.lang;
      document.querySelectorAll('[data-i18n]').forEach(e => e.textContent = Nova.t(e.dataset.i18n));
      if (window.NovaTranslate) window.NovaTranslate.setLanguage(Nova.S.lang);
    },
    esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
  };
  /* ---------- shared UI helpers (icons, avatar, toast, socials, username, image tools) ---------- */
  const P_ = {
    search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
    send:'<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    mic:'<rect width="8" height="14" x="8" y="2" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
    paperclip:'<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48"/>',
    file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8m-8 4h8"/>',
    user:'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    sliders:'<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
    link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    globe:'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    help:'<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    lock:'<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    mail:'<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    trash:'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    pin:'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    shield:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    smile:'<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
    phone:'<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
    mute:'<path d="M11 5 6 9H2v6h4l5 4z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
    pip:'<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/>',
    db:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    camera:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
    image:'<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',
    x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check:'<path d="M20 6 9 17l-5-5"/>',
    alert:'<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    right:'<path d="m9 18 6-6-6-6"/>', left:'<path d="m15 18-6-6 6-6"/>',
    pencil:'<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    eye:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff:'<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>',
    upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    more:'<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
    logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
    instagram:'<rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>',
    youtube:'<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>',
    facebook:'<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
    github:'<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
    linkedin:'<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/>',
    telegram:'<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    twitch:'<path d="M21 2H3v16h5v4l4-4h5l4-4V2zm-10 9V7m5 4V7"/>',
    music:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    ghost:'<path d="M9 10h.01M15 10h.01"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>',
    chat:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    xmark:'<path d="M4 4l16 16M20 4 4 20"/>',
    home:'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    chart:'<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
    sparkles:'<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
    settings:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    play:'<polygon points="6 3 20 12 6 21 6 3"/>',
    calendar:'<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    userplus:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
    at:'<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    key:'<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    badge:'<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>'
  };
  Nova.ic = (n, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P_[n] || ''}</svg>`;
  Nova.hasIcon = n => !!P_[n];

  Nova.avatar = (u, s, cls = '') => {
    const src = u.avatar_url || u.avatar, n = String(u.full_name || u.name || u.username || '?').trim() || '?';
    return src && /^https?:\/\//i.test(src)
      ? `<img class="avt ${cls}" style="width:${s}px;height:${s}px" src="${Nova.esc(src)}" alt="" referrerpolicy="no-referrer" loading="lazy">`
      : `<span class="avt ${cls}" style="width:${s}px;height:${s}px;font-size:${Math.round(s * .4)}px">${Nova.esc(n[0].toUpperCase())}</span>`;
  };

  Nova.toast = (m, kind = '') => {
    let h = document.getElementById('toasts');
    if (!h) { h = document.createElement('div'); h.id = 'toasts'; document.body.append(h); }
    const e = document.createElement('div'); e.className = 'toast ' + kind; e.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    e.innerHTML = Nova.ic(kind === 'err' ? 'alert' : 'check', 16) + '<span>' + Nova.esc(m) + '</span>';
    h.append(e); setTimeout(() => e.remove(), 3800);
  };

  /* Social platforms. p = visible prefix, u = profile URL base ('' = no link), i = icon */
  Nova.SOC = {
    instagram: { n: 'Instagram', p: 'instagram.com/', u: 'https://instagram.com/', i: 'instagram' },
    x:         { n: 'X (Twitter)', p: 'x.com/', u: 'https://x.com/', i: 'xmark' },
    youtube:   { n: 'YouTube', p: 'youtube.com/@', u: 'https://youtube.com/@', i: 'youtube' },
    tiktok:    { n: 'TikTok', p: 'tiktok.com/@', u: 'https://tiktok.com/@', i: 'music' },
    snapchat:  { n: 'Snapchat', p: 'snapchat.com/add/', u: 'https://snapchat.com/add/', i: 'ghost' },
    facebook:  { n: 'Facebook', p: 'facebook.com/', u: 'https://facebook.com/', i: 'facebook' },
    linkedin:  { n: 'LinkedIn', p: 'linkedin.com/in/', u: 'https://linkedin.com/in/', i: 'linkedin' },
    github:    { n: 'GitHub', p: 'github.com/', u: 'https://github.com/', i: 'github' },
    twitch:    { n: 'Twitch', p: 'twitch.tv/', u: 'https://twitch.tv/', i: 'twitch' },
    telegram:  { n: 'Telegram', p: 't.me/', u: 'https://t.me/', i: 'telegram' },
    discord:   { n: 'Discord', p: '', u: '', i: 'chat' }
  };
  /* Accepts "@name", "name" or a pasted profile URL. Returns { v, err }. Empty = { v:'' } (removes link). */
  Nova.parseSocial = (k, raw) => {
    let v = String(raw || '').trim(); if (!v) return { v: '' };
    if (k === 'website') {
      if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
      try { const u = new URL(v); if (!/\./.test(u.hostname)) throw 0; return v.length > 200 ? { err: 'Link is too long' } : { v: u.href.replace(/\/$/, '') }; }
      catch { return { err: 'Enter a valid website, e.g. https://example.com' }; }
    }
    if (/^https?:\/\//i.test(v)) { try { v = new URL(v).pathname.split('/').filter(Boolean).pop() || ''; } catch { return { err: 'Invalid link' }; } }
    v = v.replace(/^@/, '').replace(/\/$/, '');
    return /^[\w.\-]{2,40}$/.test(v) ? { v } : { err: 'Use letters, numbers, "." "_" or "-" (2–40 characters)' };
  };

  /* Username rules (mirrors the database). Returns '' when valid, otherwise a message. */
  const RESERVED = new Set('admin administrator root support help nova system moderator mod staff official null undefined api www settings login logout signup profile user users me'.split(' '));
  Nova.unameCheck = s => !s ? 'Choose a username' : s.length < 3 ? 'At least 3 characters' : s.length > 24 ? 'Maximum 24 characters'
    : !/^[a-z0-9_.]+$/.test(s) ? 'Only lowercase letters, numbers, "_" and "."' : /^[._]|[._]$/.test(s) ? 'Cannot start or end with "." or "_"'
    : /[._]{2}/.test(s) ? 'No consecutive "." or "_"' : RESERVED.has(s) ? 'This username is reserved' : '';
  /* Live availability check. Returns a state object { ok, val }. cb(state) fires on every change. */
  Nova.unameField = (inp, msg, current, cb) => {
    let tok = 0, tm; const st = { ok: false, val: '', pending: false };
    const say = (k, text) => { msg.className = 'hint ' + k; msg.innerHTML = (k === 'ok' ? Nova.ic('check', 14) : k === 'bad' ? Nova.ic('alert', 14) : k === 'wait' ? '<i class="spin"></i>' : '') + '<span>' + Nova.esc(text) + '</span>'; };
    const run = () => {
      const v = inp.value.trim().toLowerCase().replace(/^@/, ''), my = ++tok; clearTimeout(tm); st.ok = false; st.pending = false; st.val = v;
      if (v && v === (current || '')) { st.ok = true; say('ok', 'This is your current username'); return cb && cb(st); }
      const e = v ? Nova.unameCheck(v) : '';
      if (!v) { say('', '3–24 characters: lowercase letters, numbers, "_" and "."'); return cb && cb(st); }
      if (e) { say('bad', e); return cb && cb(st); }
      st.pending = true; say('wait', 'Checking availability…'); cb && cb(st);
      tm = setTimeout(async () => {
        const { data, error } = await Nova.sb.rpc('username_available', { p_username: v });
        if (my !== tok) return;
        st.pending = false;
        if (error) say('bad', 'Could not check right now. Please try again.');
        else if (data) { st.ok = true; say('ok', '@' + v + ' is available'); } else say('bad', '@' + v + ' is already taken');
        cb && cb(st);
      }, 350);
    };
    inp.addEventListener('input', run); run(); return st;
  };

  /* Resize + compress an image in the browser. square=true centre-crops (avatars). Returns a JPEG Blob. */
  Nova.imgBlob = async (file, max, q, square) => {
    if (!/^image\//i.test(file.type) && !/\.(jpe?g|png|webp|gif)$/i.test(file.name)) throw new Error('Unsupported file type');
    let bmp; try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new Error('This image could not be read'); }
    let sw = bmp.width, sh = bmp.height, sx = 0, sy = 0;
    if (square) { const m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 2; sw = sh = m; }
    const k = Math.min(1, max / Math.max(sw, sh)), w = Math.round(sw * k), h = Math.round(sh * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h); if (bmp.close) bmp.close();
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Compression failed')), 'image/jpeg', q));
  };

  document.addEventListener('click', () => Nova.haptic(), true);
  window.Nova = Nova;
})();
