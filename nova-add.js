(function() {
  const webState = {
    isOpen: false,
    mode: 'start',
    history: [],
    historyIndex: -1,
    pendingMedia: null,
    loading: false
  };

  function ensureWebBrowserUI() {
    if (document.getElementById('novaWebOverlay')) return;

    const style = document.createElement('style');
    style.id = 'novaWebOverlayStyles';
    style.textContent = `
      #novaWebOverlay {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100dvh;
        background:
          radial-gradient(70% 42% at 18% 24%, rgba(128, 105, 82, 0.78), transparent 72%),
          radial-gradient(58% 42% at 87% 82%, rgba(0, 105, 111, 0.68), transparent 72%),
          radial-gradient(54% 36% at 15% 88%, rgba(113, 117, 75, 0.7), transparent 72%),
          #29231d;
        z-index: 99999;
        display: none;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        user-select: none;
        overflow: hidden;
      }
      #novaWebOverlay.active {
        display: flex;
      }
      #novaWebStartScreen {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
        padding: env(safe-area-inset-top) 6px env(safe-area-inset-bottom);
        gap: 0;
        z-index: 2;
      }
      #novaWebOverlay.browsing #novaWebStartScreen {
        display: none;
      }
      .nova-web-header {
        position: relative;
        display: grid;
        grid-template-columns: 42px 1fr 42px;
        align-items: center;
        flex: none;
        min-height: 42px;
        color: #fff;
      }
      .nova-web-header-title {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 17px;
        font-weight: 700;
      }
      .nova-web-header-title svg { width: 23px; height: 23px; }
      .nova-web-icon-btn {
        display: grid;
        place-items: center;
        width: 38px;
        height: 36px;
        padding: 0;
        color: #fff;
        background: transparent;
        border: 0;
        border-radius: 10px;
        cursor: pointer;
      }
      .nova-web-icon-btn:hover:not(:disabled) { background: rgba(255,255,255,.12); }
      .nova-web-icon-btn:disabled { opacity: .38; cursor: default; }
      .nova-web-toolbar {
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr);
        align-items: center;
        gap: 4px;
        width: 100%;
        flex: none;
        margin-top: 6px;
      }
      .nova-web-pill {
        display: flex;
        width: 100%;
        min-width: 0;
        height: 42px;
        background: #fff;
        border: 1px solid rgba(0,0,0,.08);
        border-radius: 11px;
        display: flex;
        align-items: center;
        padding: 0 12px;
        gap: 9px;
        box-shadow: 0 4px 14px rgba(0,0,0,.12);
      }
      .nova-web-g-icon {
        width: 17px;
        height: 20px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #627087;
      }
      #novaWebInput {
        flex: 1;
        min-width: 0;
        background: transparent;
        border: none;
        outline: none;
        color: #202124;
        font-size: 14px;
        font-weight: 400;
      }
      #novaWebInput::placeholder {
        color: #8b95a5;
      }
      #novaWebSpinner {
        width: 16px;
        height: 16px;
        display: none;
        animation: novaHourglassSpin 1.1s infinite ease-in-out;
        flex-shrink: 0;
      }
      #novaWebOverlay.loading #novaWebSpinner {
        display: block;
      }
      .nova-web-start-content {
        display: flex;
        flex: 1;
        min-height: 0;
        flex-direction: column;
        align-items: center;
        padding: 46px 16px 24px;
        color: #fff;
      }
      @keyframes novaHourglassSpin {
        0% { transform: rotate(0deg); }
        50% { transform: rotate(180deg); }
        100% { transform: rotate(360deg); }
      }
      .nova-web-paste-label {
        color: rgba(255,255,255,.9);
        font-size: 12px;
        font-weight: 400;
        margin-bottom: 12px;
      }
      #novaWebPasteBtn {
        width: 58px;
        height: 58px;
        border-radius: 50%;
        background: rgba(255,255,255,.16);
        border: 1px solid rgba(255,255,255,.04);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.18s ease, transform 0.15s ease;
      }
      #novaWebPasteBtn:hover {
        background: rgba(255,255,255,.24);
        transform: scale(1.04);
      }
      #novaWebStatusCard {
        max-width: min(440px, 90vw);
        min-height: 42px;
        padding: 12px 16px;
        background: rgba(16,16,16,.48);
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 12px;
        display: none;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-top: 22px;
        text-align: center;
      }
      #novaWebStatusCard.visible {
        display: flex;
      }
      #novaWebStatusCard svg { width: 20px; height: 20px; flex: none; }
      #novaWebStatusText {
        color: rgba(255,255,255,.84);
        font-size: 13px;
        font-weight: 400;
      }
      #novaWebBrowserWrap {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: none;
        background: #202124;
        z-index: 3;
      }
      #novaWebOverlay.browsing #novaWebBrowserWrap {
        display: block;
      }
      #novaWebIframe {
        width: 100%;
        height: 100%;
        border: none;
        background: #202124;
      }
      #novaWebBackBtn {
        position: fixed;
        right: 22px;
        bottom: 22px;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: rgba(38, 38, 40, 0.78);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 100002;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
        transition: background 0.15s ease, transform 0.15s ease;
      }
      #novaWebBackBtn:hover {
        background: rgba(58, 58, 62, 0.98);
        transform: scale(1.05);
      }
      #novaWebConfirmModal {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.96);
        z-index: 100005;
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px;
        text-align: center;
      }
      #novaWebConfirmModal.active {
        display: flex;
      }
      #novaWebConfirmTitle {
        color: #ffffff;
        font-size: 16px;
        font-weight: 500;
        max-width: 480px;
        line-height: 1.45;
        margin-bottom: 22px;
      }
      .nova-web-confirm-actions {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .nova-web-confirm-btn {
        min-width: 106px;
        height: 38px;
        border-radius: 8px;
        background: #1c1c1e;
        border: 1px solid #2c2c2e;
        color: #ffffff;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .nova-web-confirm-btn:hover {
        background: #2c2c2e;
      }
      @media (max-width: 600px) {
        #novaWebBackBtn { right: 16px; bottom: 16px; width: 42px; height: 42px; }
        #novaWebConfirmTitle { font-size: 15px; max-width: 90vw; }
        .nova-web-start-content { padding-top: 42px; }
        .nova-web-header { min-height: 40px; }
        .nova-web-toolbar { grid-template-columns: 30px minmax(0, 1fr); }
      }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'novaWebOverlay';
    overlay.innerHTML = `
      <div id="novaWebStartScreen">
        <header class="nova-web-header">
          <button id="novaWebCloseBtn" class="nova-web-icon-btn" type="button" aria-label="Back to Nova" title="Back to Nova">
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>
          </button>
          <div class="nova-web-header-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.8 2.7 4 5.9 4 9.5s-1.2 6.8-4 9.5c-2.8-2.7-4-5.9-4-9.5s1.2-6.8 4-9.5z"/>
            </svg>
            <span>Web</span>
          </div>
          <span aria-hidden="true"></span>
        </header>

        <div class="nova-web-toolbar">
          <button id="novaWebHistoryBtn" class="nova-web-icon-btn" type="button" aria-label="Back" title="Back" disabled>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18 9 12l6-6"/></svg>
          </button>
          <form id="novaWebForm" class="nova-web-pill" autocomplete="off">
            <span class="nova-web-g-icon">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>
            </span>
            <input id="novaWebInput" type="text" placeholder="Search the web or type a web address" autocomplete="off" spellcheck="false" />
            <svg id="novaWebSpinner" viewBox="0 0 24 24" fill="none">
              <path d="M6 2h12v4l-4 4 4 4v4H6v-4l4-4-4-4V2z" fill="#65758b"/>
            </svg>
          </form>
        </div>

        <div class="nova-web-start-content">
          <div class="nova-web-paste-label">or paste clipboard</div>
          <button id="novaWebPasteBtn" type="button" title="Paste clipboard" aria-label="Paste clipboard">
            <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v4"/>
              <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
              <path d="M13 14h7"/>
              <path d="m17 11 3 3-3 3"/>
            </svg>
          </button>
          <div id="novaWebStatusCard">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-2.5 14.5a3.5 3.5 0 1 1 2.47-1.03l2.28 2.28-1.06 1.06-2.28-2.28A3.48 3.48 0 0 1 11.5 16.5zm0-5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
            </svg>
            <span id="novaWebStatusText">Enter a search or web address above.</span>
          </div>
        </div>
      </div>

      <div id="novaWebBrowserWrap">
        <iframe id="novaWebIframe" sandbox="allow-scripts allow-same-origin allow-forms allow-presentation" allow="autoplay; encrypted-media; fullscreen"></iframe>
      </div>

      <button id="novaWebBackBtn" type="button" title="Back">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>

      <div id="novaWebConfirmModal">
        <div id="novaWebConfirmTitle">Play - Video?</div>
        <div class="nova-web-confirm-actions">
          <button id="novaWebConfirmNo" class="nova-web-confirm-btn" type="button">No</button>
          <button id="novaWebConfirmYes" class="nova-web-confirm-btn" type="button">Yes</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const form = document.getElementById('novaWebForm');
    const input = document.getElementById('novaWebInput');
    const pasteBtn = document.getElementById('novaWebPasteBtn');
    const backBtn = document.getElementById('novaWebBackBtn');
    const closeBtn = document.getElementById('novaWebCloseBtn');
    const historyBtn = document.getElementById('novaWebHistoryBtn');
    const noBtn = document.getElementById('novaWebConfirmNo');
    const yesBtn = document.getElementById('novaWebConfirmYes');
    const iframe = document.getElementById('novaWebIframe');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handleWebQueryOrUrl(input.value.trim());
    });

    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          input.value = text.trim();
          handleWebQueryOrUrl(text.trim());
        } else {
          showStatusCard('Video not found');
        }
      } catch (err) {
        input.focus();
      }
    });

    backBtn.addEventListener('click', () => {
      if (document.getElementById('novaWebConfirmModal').classList.contains('active')) {
        hidePlayConfirmModal();
        return;
      }
      navigateBack();
    });

    closeBtn.addEventListener('click', closeWebBrowser);
    historyBtn.addEventListener('click', navigateBack);
    noBtn.addEventListener('click', () => {
      hidePlayConfirmModal();
    });

    yesBtn.addEventListener('click', () => {
      if (!webState.pendingMedia) return;
      const media = webState.pendingMedia;
      hidePlayConfirmModal();
      closeWebBrowser();
      launchWebVideoInRoom(media);
    });

    iframe.addEventListener('load', () => {
      setLoadingState(false);
    });

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'NOVA_WEB_NAVIGATE' && data.url) {
        const browseSrc = `/api/browse?url=${encodeURIComponent(data.url)}`;
        if (webState.history[webState.historyIndex] !== browseSrc) {
          webState.history = webState.history.slice(0, webState.historyIndex + 1);
          webState.history.push(browseSrc);
          webState.historyIndex = webState.history.length - 1;
          updateHistoryButton();
        }
      }

      if (data.type === 'NOVA_WEB_VIDEO_PROMPT' && data.streamUrl) {
        promptPlayWebVideo({
          title: data.title || 'Web Video',
          streamUrl: data.streamUrl,
          proxiedStreamUrl: data.proxiedStreamUrl || `/api/browse?stream=1&url=${encodeURIComponent(data.streamUrl)}`,
          streamType: data.streamType || 'auto',
          thumbnail: data.thumbnail || '',
          pageUrl: data.pageUrl || ''
        });
      }
    });
  }

  function updateHistoryButton() {
    const button = document.getElementById('novaWebHistoryBtn');
    if (button) button.disabled = webState.historyIndex <= 0;
  }

  function navigateBack() {
    if (document.getElementById('novaWebConfirmModal')?.classList.contains('active')) {
      hidePlayConfirmModal();
      return;
    }
    if (webState.mode === 'browsing') {
      if (webState.historyIndex > 0) {
        webState.historyIndex -= 1;
        const previous = webState.history[webState.historyIndex];
        const iframe = document.getElementById('novaWebIframe');
        if (iframe) iframe.src = previous;
        updateHistoryButton();
      } else {
        returnToWebStartScreen();
      }
    } else {
      closeWebBrowser();
    }
  }

  function setLoadingState(isLoading) {
    webState.loading = isLoading;
    const overlay = document.getElementById('novaWebOverlay');
    if (!overlay) return;
    overlay.classList.toggle('loading', Boolean(isLoading));
  }

  function showStatusCard(message) {
    const card = document.getElementById('novaWebStatusCard');
    const txt = document.getElementById('novaWebStatusText');
    if (txt) txt.textContent = message || 'Video not found';
    if (card) card.classList.add('visible');
  }

  function isLikelyDirectUrl(str) {
    if (/^https?:\/\//i.test(str)) return true;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(str) && !/\s/.test(str)) return true;
    return false;
  }

  async function handleWebQueryOrUrl(rawInput) {
    if (!rawInput) {
      showStatusCard('Video not found');
      return;
    }

    setLoadingState(true);

    if (isLikelyDirectUrl(rawInput)) {
      const normalizedUrl = /^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput}`;
      try {
        const res = await fetch(`/api/extract?url=${encodeURIComponent(normalizedUrl)}`);
        if (res.ok) {
          const extracted = await res.json();
          if (extracted && extracted.streamUrl) {
            setLoadingState(false);
            openBrowsingFrame(`/api/browse?url=${encodeURIComponent(normalizedUrl)}`);
            promptPlayWebVideo({
              title: extracted.title || 'Web Video',
              streamUrl: extracted.streamUrl,
              proxiedStreamUrl: extracted.proxiedStreamUrl || `/api/browse?stream=1&url=${encodeURIComponent(extracted.streamUrl)}`,
              streamType: extracted.streamType || 'auto',
              thumbnail: extracted.thumbnail || '',
              pageUrl: normalizedUrl
            });
            return;
          }
        }
      } catch (e) {}

      openBrowsingFrame(`/api/browse?url=${encodeURIComponent(normalizedUrl)}`);
      return;
    }

    openBrowsingFrame(`/api/browse?q=${encodeURIComponent(rawInput)}&tab=all`);
  }

  function openBrowsingFrame(srcUrl) {
    const overlay = document.getElementById('novaWebOverlay');
    const iframe = document.getElementById('novaWebIframe');
    if (!overlay || !iframe) return;

    webState.mode = 'browsing';
    overlay.classList.add('browsing');

    webState.history = webState.history.slice(0, webState.historyIndex + 1);
    webState.history.push(srcUrl);
    webState.historyIndex = webState.history.length - 1;
    updateHistoryButton();

    iframe.src = srcUrl;
  }

  function returnToWebStartScreen() {
    const overlay = document.getElementById('novaWebOverlay');
    const iframe = document.getElementById('novaWebIframe');
    if (!overlay || !iframe) return;

    webState.mode = 'start';
    overlay.classList.remove('browsing');
    setLoadingState(false);
    updateHistoryButton();
    iframe.src = 'about:blank';
  }

  function promptPlayWebVideo(media) {
    webState.pendingMedia = media;
    const modal = document.getElementById('novaWebConfirmModal');
    const titleEl = document.getElementById('novaWebConfirmTitle');
    if (!modal || !titleEl) return;

    titleEl.textContent = `Play - ${media.title || 'Web Video'}?`;
    modal.classList.add('active');
  }

  function hidePlayConfirmModal() {
    const modal = document.getElementById('novaWebConfirmModal');
    if (modal) modal.classList.remove('active');
  }

  function openWebBrowser(initialQuery = '') {
    ensureWebBrowserUI();
    const overlay = document.getElementById('novaWebOverlay');
    const input = document.getElementById('novaWebInput');
    if (!overlay) return;

    webState.isOpen = true;
    webState.mode = 'start';
    webState.history = [];
    webState.historyIndex = -1;
    overlay.classList.add('active');
    overlay.classList.remove('browsing');
    document.getElementById('novaWebStatusCard').classList.remove('visible');
    updateHistoryButton();

    if (input) {
      input.value = initialQuery || '';
      setTimeout(() => input.focus(), 60);
    }

    if (initialQuery && initialQuery.trim()) {
      handleWebQueryOrUrl(initialQuery.trim());
    }
  }

  function closeWebBrowser() {
    const overlay = document.getElementById('novaWebOverlay');
    const iframe = document.getElementById('novaWebIframe');
    if (!overlay) return;

    webState.isOpen = false;
    webState.mode = 'start';
    overlay.classList.remove('active', 'browsing', 'loading');
    hidePlayConfirmModal();
    if (iframe) iframe.src = 'about:blank';
  }

  async function launchWebVideoInRoom(media) {
    const roomPayload = {
      provider: 'web',
      sourceLabel: 'generic • Web',
      title: media.title || 'Web Video',
      url: media.proxiedStreamUrl || media.streamUrl,
      rawStreamUrl: media.streamUrl,
      pageUrl: media.pageUrl || media.streamUrl,
      streamType: media.streamType || (/\.m3u8(\?|$)/i.test(media.streamUrl) ? 'hls' : 'mp4'),
      thumbnail: media.thumbnail || ''
    };

    try {
      sessionStorage.setItem('nova_active_web_media', JSON.stringify(roomPayload));
      localStorage.setItem('nova_active_web_media', JSON.stringify(roomPayload));
    } catch (e) {}

    if (typeof window.onNovaWebMediaSelected === 'function') {
      window.onNovaWebMediaSelected(roomPayload);
      return;
    }

    if (typeof window.loadWebMediaIntoRoomPlayer === 'function') {
      window.loadWebMediaIntoRoomPlayer(roomPayload, true);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room') || params.get('id') || 'live-' + Math.random().toString(36).slice(2, 8);
    window.location.href = `/index.html?room=${encodeURIComponent(roomId)}&provider=web&video=${encodeURIComponent(roomPayload.url)}&title=${encodeURIComponent(roomPayload.title)}`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureWebBrowserUI();

    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-provider="web"], #webProviderBtn, .web-source-btn, [data-action="open-web"]');
      if (trigger) {
        e.preventDefault();
        openWebBrowser();
      }
    });
  });

  window.NovaWebBrowser = {
    open: openWebBrowser,
    close: closeWebBrowser,
    searchOrNavigate: handleWebQueryOrUrl
  };
})();

(function() {
  async function requestJson(path) {
    const response = await fetch(path);
    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw new Error('The server returned an invalid response.');
    }
    if (!response.ok) throw new Error(data.error || 'The request failed.');
    return data;
  }

  function youtubeUrl(params) {
    const query = new URLSearchParams();
    Object.keys(params).forEach(function(key) {
      if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
        query.set(key, params[key]);
      }
    });
    return '/api/youtube?' + query.toString();
  }

  function parseInput(value) {
    const input = String(value || '').trim();
    if (!input) return { t: 'query', q: '' };

    const candidate = /^https?:\/\//i.test(input) ? input : (/^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(input) ? 'https://' + input : '');
    if (candidate) {
      let url;
      try {
        url = new URL(candidate);
      } catch (e) {
        return { t: 'query', q: input };
      }
      if (/^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)$/i.test(url.hostname) || /^(?:www\.)?youtu\.be$/i.test(url.hostname)) {
        const id = url.hostname.endsWith('youtu.be')
          ? url.pathname.split('/').filter(Boolean)[0]
          : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)?.[1] || '';
        const pl = url.searchParams.get('list') || '';
        if (id && /^[\w-]{11}$/.test(id)) return { t: 'yt', id: id, pl: pl };
        if (pl) return { t: 'ytpl', pl: pl };
        return { t: 'url', url: url.toString() };
      }
      if (/\.(?:mp4|m4v|webm|ogv|mov|m3u8)(?:[?#]|$)/i.test(url.href)) {
        return { t: 'file', url: url.toString() };
      }
      return { t: 'url', url: url.toString() };
    }
    return { t: 'query', q: input };
  }

  function ytMedia(video) {
    const media = {
      kind: 'youtube',
      title: video.title || 'YouTube video',
      provider: 'youtube'
    };
    if (video.id) media.id = video.id;
    if (video.pl) media.pl = video.pl;
    if (video.thumb) media.thumb = video.thumb;
    if (video.live) media.live = true;
    if (!media.id && !media.pl) throw new Error('This YouTube item has no video or playlist ID.');
    return media;
  }

  async function extract(url) {
    const data = await requestJson('/api/extract?url=' + encodeURIComponent(url));
    const streams = data.streams || (data.streamUrl ? [{
      url: data.streamUrl,
      proxiedStreamUrl: data.proxiedStreamUrl,
      type: data.streamType
    }] : []);
    return {
      ok: streams.length > 0,
      site: data.url ? new URL(data.url).hostname : '',
      title: data.title || '',
      videos: streams.map(function(stream) {
        return {
          kind: 'video',
          url: stream.proxiedStreamUrl || data.proxiedStreamUrl || stream.url,
          title: data.title || 'Web video',
          thumb: data.thumbnail || '',
          provider: 'web',
          streamType: stream.type || data.streamType || 'auto'
        };
      }),
      error: data.error || ''
    };
  }

  function choose(site, title, videos, onSelect) {
    if (!videos || !videos.length) return;
    if (videos.length === 1) {
      onSelect(videos[0]);
      return;
    }
    const choices = videos.map(function(video, index) {
      return (index + 1) + '. ' + (video.title || 'Video');
    }).join('\n');
    const selection = window.prompt('Choose a video from ' + (title || site || 'this page') + ':\n' + choices);
    if (selection === null) return;
    const index = Number(selection) - 1;
    if (Number.isInteger(index) && index >= 0 && index < videos.length) onSelect(videos[index]);
  }

  window.NovaAdd = {
    parseInput: parseInput,
    ytSearch: function(options) {
      return requestJson(youtubeUrl({
        q: options.q,
        type: options.type,
        eventType: options.eventType,
        pageToken: options.pageToken,
        safe: options.safe
      }));
    },
    ytInfo: function(id, playlistId) {
      if (id) return requestJson(youtubeUrl({ id: id }));
      if (playlistId) return requestJson(youtubeUrl({ pl: playlistId }));
      return Promise.reject(new Error('Paste a YouTube video or playlist link.'));
    },
    ytMedia: ytMedia,
    extract: extract,
    webSearch: function(query) {
      return requestJson('/api/websearch?q=' + encodeURIComponent(query));
    },
    confirm: function(media, onConfirm) {
      const room = window.NovaRoom;
      const now = !(room && room.ctx && room.ctx().busy);
      const title = media.title || 'this video';
      if (window.confirm((now ? 'Play ' : 'Add ') + title + (now ? ' now?' : ' to the queue?'))) onConfirm(now);
    },
    choose: choose,
    browser: function() {
      if (!window.NovaWebBrowser) throw new Error('The in-app browser is unavailable.');
      window.NovaWebBrowser.open();
    }
  };
})();