/* nova-chat-picker.js — Unsplash / GIPHY / KLIPY attachment picker for Nova Chat (extracted from the original chat).
   Hooks (set by nova-chat.js): NovaChatPicker.hooks = { count(): number, add(media): void } */
(function () {
  'use strict';
  const { esc } = Nova, ic = Nova.ic, sb = Nova.sb;
  const MAX_ATTACHMENTS = 8;
  const hooks = { count: () => 0, add: () => {} };
  let mediaSearchItems = [], mediaSearchSequence = 0, mediaSearchTimer = null, mediaRetryTimer = null, mediaProvider = '', mediaKind = 'image', mediaKindPages = {}, mediaKindHasMore = {}, mediaLoadingMore = false, mediaPageError = false, mediaQuery = '';
  const pendingRemoteSeen = new Set();
  function safeUnsplashLink(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || !['unsplash.com', 'www.unsplash.com'].includes(url.hostname)) return null;
      url.searchParams.set('utm_source', 'nova_watch_party');
      url.searchParams.set('utm_medium', 'referral');
      return url.href;
    } catch { return null; }
  }

  function safeUnsplashAttribution(value) {
    if (!value || typeof value !== 'object') return null;
    const photographer = String(value.photographer || '').trim().slice(0, 120);
    const photographerUrl = safeUnsplashLink(value.photographerUrl);
    const photoUrl = safeUnsplashLink(value.photoUrl);
    return photographer && photographerUrl && photoUrl ? { photographer, photographerUrl, photoUrl } : null;
  }

  function safeUnsplashDownloadLocation(value, photoId) {
    try {
      const url = new URL(value);
      const match = url.pathname.match(/^\/photos\/([A-Za-z0-9_-]+)\/download\/?$/);
      if (url.protocol !== 'https:' || url.hostname !== 'api.unsplash.com' || url.username || url.password ||
          !match || match[1] !== photoId) return null;
      return url.href;
    } catch { return null; }
  }

  function safeRemoteMedia(value, typeHint = '', nameHint = '') {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      const extension = url.pathname.split('.').pop().toLowerCase();
      const types = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
        mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg',
        mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', weba: 'audio/webm'
      };
      const type = /^video\/(?:mp4|webm)$/.test(typeHint) || /^image\/(?:\*|jpeg|png|gif|webp|avif)$/.test(typeHint)
        ? typeHint : types[extension];
      if (!type) return null;
      let name = nameHint;
      try { name = name || decodeURIComponent(url.pathname.split('/').pop() || `${type.split('/')[0]} media`); }
      catch { name = `${type.split('/')[0]} media`; }
      return { url: url.href, name: name.slice(0, 180), type };
    } catch { return null; }
  }

  function addRemoteMedia(value, type = '', name = '', details = {}) {
    const media = safeRemoteMedia(value.trim(), type, name);
    if (!media) {
      Nova.toast('This media result is not a supported HTTPS image, GIF, video, or audio file.', 'err');
      return;
    }
    if (mediaProvider === 'unsplash') {
      const attribution = safeUnsplashAttribution(details.attribution);
      const photoId = typeof details.photoId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(details.photoId) ? details.photoId : '';
      const downloadLocation = safeUnsplashDownloadLocation(details.downloadLocation, photoId);
      if (!attribution || !downloadLocation || !photoId) {
        Nova.toast('Unsplash photo attribution or download tracking is missing. Choose another photo.', 'err');
        return;
      }
      Object.assign(media, { provider: 'unsplash', photoId, downloadLocation, attribution, downloadTracked: false });
    }
    if (hooks.count() >= MAX_ATTACHMENTS) {
      Nova.toast(`You can attach up to ${MAX_ATTACHMENTS} items per message.`, 'err');
      return;
    }
    if (pendingRemoteSeen.has(media.url)) { Nova.toast('That media link is already attached.', 'err'); return; }
    pendingRemoteSeen.add(media.url);
    if (details.mediaKind === 'gif' || details.mediaKind === 'sticker' || /\.gif(\?|$)/i.test(media.url)) media.gif = true;
    hooks.add(media);
  }
  function renderMediaResults(items = [], append = false) {
    const target = document.getElementById('mediaSearchResults');
    if (!target) return;
    target.classList.toggle('media-mixed-results', mediaProvider === 'giphy' || mediaProvider === 'klipy');
    if (!items.length && !append) {
      const mediaHint = mediaKind === 'all' ? 'Loading popular GIFs and stickers…'
        : mediaKind === 'sticker' ? 'Loading stickers…'
          : mediaKind === 'clip' ? `Loading ${mediaProvider.toUpperCase()} Clips with sound…`
            : mediaKind === 'meme' ? 'Loading KLIPY Memes…'
              : mediaKind === 'emoji' ? (mediaProvider === 'giphy' ? 'Loading animated emoji…' : 'Loading KLIPY AI Emoji…')
                : mediaKind === 'text' ? 'Type the exact words you want to animate'
                  : mediaKind === 'gif' ? 'Loading GIFs…'
                    : mediaProvider === 'unsplash' ? 'Search Unsplash photos' : 'Search to see results here';
      target.innerHTML = `<p class=chat-hint>${mediaHint}</p>`;
      return;
    }
    const offset = append ? mediaSearchItems.length - items.length : 0;
    const markup = items.map((item, index) => {
      const label = ({
        clip: 'clip with sound',
        emoji: 'animated emoji',
        image: 'image',
        meme: 'meme',
        sticker: 'sticker',
        text: 'animated text'
      })[item.mediaKind] || 'GIF';
      const badge = item.mediaKind === 'clip' ? 'Clip + sound'
        : item.mediaKind === 'meme' ? 'Meme'
          : item.mediaKind === 'emoji' ? 'AI Emoji' : '';
      const preview = mediaPreviewSource(item.preview);
      const original = mediaPreviewSource(item.url);
      const fallbackList = [
        item.type?.startsWith('image/') && original && original !== preview ? original : '',
        mediaProxySource(item.preview),
        item.type?.startsWith('image/') ? mediaProxySource(item.url) : ''
      ].filter((value, i, all) => value && value !== preview && all.indexOf(value) === i);
      const fallback = fallbackList.length ? `data-media-fallbacks="${esc(fallbackList.join('\n'))}"` : '';
      if (mediaProvider === 'unsplash') {
        const attribution = safeUnsplashAttribution(item.attribution);
        const credit = attribution
          ? `<span class=media-result-credit>Photo by <a href="${esc(attribution.photographerUrl)}" target=_blank rel="noopener noreferrer">${esc(attribution.photographer)}</a> on <a href="${esc(attribution.photoUrl)}" target=_blank rel="noopener noreferrer">Unsplash</a></span>`
          : '';
        return `<div class="media-result media-result-unsplash"><button data-media-result="${offset + index}" aria-label="Attach photo: ${esc(item.title)}"><img src="${esc(preview)}" alt="" loading=lazy decoding=async referrerpolicy=no-referrer ${fallback}></button>${credit}</div>`;
      }
      return `<button class="media-result${item.mediaKind === 'clip' ? ' media-result-clip' : ''}" data-media-result="${offset + index}" aria-label="Attach ${label}: ${esc(item.title)}"><img src="${esc(preview)}" alt="" loading=lazy decoding=async referrerpolicy=no-referrer ${fallback}>${badge ? `<span class=media-result-badge>${badge}</span>` : ''}</button>`;
    }).join('');
    if (append) target.insertAdjacentHTML('beforeend', markup);
    else target.innerHTML = markup;
  }

  function mediaPreviewSource(value) {
    try {
      const url = new URL(value, window.location.href);
      if (url.protocol !== 'https:' || url.username || url.password) return '';
      return url.href;
    } catch {
      return '';
    }
  }

  function mediaProxySource(value) {
    try {
      const url = new URL(value);
      return url.hostname.endsWith('klipy.com') || url.hostname.endsWith('klipy.co')
        ? `/api/media-preview?url=${encodeURIComponent(url.href)}`
        : '';
    } catch {
      return '';
    }
  }

  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.closest('.media-result')) return;
    const queue = (image.dataset.mediaFallbacks || '').split('\n').filter(Boolean);
    const next = queue.shift();
    if (next && image.src !== next) {
      image.dataset.mediaFallbacks = queue.join('\n');
      image.src = next;
      return;
    }
    const button = image.closest('button');
    const label = document.createElement('span');
    label.className = 'media-result-unavailable-label';
    label.textContent = 'Preview unavailable';
    image.replaceWith(label);
    if (button) button.disabled = true;
  }, true);

  async function mediaSearchError(error) {
    const response = error?.context;
    if (response instanceof Response) {
      if (response.status === 404) {
        return "The chat-media-search Edge Function is not deployed to the Supabase project in this site's SUPABASE_URL setting (or the URL is wrong). Deploy the function to that project.";
      }
      try {
        const body = await response.clone().json();
        if (body?.code === 'unsupported_media_provider' ||
            ['Unsupported media provider.', 'Unsupported media type for this provider.'].includes(body?.error)) {
          return "This Supabase Edge Function is outdated or belongs to a different project. Deploy the latest chat-media-search function to the Supabase project in this site's SUPABASE_URL setting, then refresh this page.";
        }
        if (body?.error === 'Unsplash search is not configured on the server.') {
          return 'Unsplash needs a fresh UNSPLASH_ACCESS_KEY in the Supabase Edge Function secrets for this site’s project. Add it in Supabase, deploy chat-media-search, then refresh.';
        }
        if (typeof body?.error === 'string') return body.error;
      } catch {
        if (response.status) return `Media search failed (HTTP ${response.status}).`;
      }
      if (response.status) return `Media search failed (HTTP ${response.status}).`;
    }
    return error?.message || 'Media search failed. Check the Edge Function deployment and provider configuration.';
  }

  async function mediaRetryDelay(error) {
    const response = error?.context;
    if (!(response instanceof Response)) return 0;
    const header = response.headers.get('Retry-After');
    if (!header) return 0;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
    const timestamp = Date.parse(header);
    if (!Number.isNaN(timestamp)) return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
    return 0;
  }

  function renderMediaRetry(target, append, delay) {
    clearInterval(mediaRetryTimer);
    const retryAction = append ? 'more' : 'search';
    const disabled = delay > 0 ? 'disabled' : '';
    target.insertAdjacentHTML('beforeend', `<button class=media-retry data-media-retry="${retryAction}" ${disabled}>${delay > 0 ? `Retry in ${delay}s` : 'Retry search'}</button>`);
    const update = () => {
      const button = target.querySelector('[data-media-retry]');
      if (!button) {
        clearInterval(mediaRetryTimer);
        return;
      }
      const remaining = Math.max(0, Math.ceil((button.dataset.retryUntil - Date.now()) / 1000));
      button.disabled = remaining > 0;
      button.textContent = remaining > 0 ? `Retry in ${remaining}s` : 'Retry search';
      if (!remaining) clearInterval(mediaRetryTimer);
    };
    if (delay > 0) {
      const button = target.querySelector('[data-media-retry]');
      button.dataset.retryUntil = String(Date.now() + delay * 1000);
      mediaRetryTimer = setInterval(update, 1000);
    }
  }

  function renderMediaProvider(provider) {
    mediaProvider = provider;
    mediaKind = provider === 'giphy' ? 'gif' : provider === 'klipy' ? 'all' : 'image';
    mediaSearchSequence++;
    clearTimeout(mediaSearchTimer);
    mediaSearchItems = [];
    mediaKindPages = {};
    mediaKindHasMore = {};
    mediaLoadingMore = false;
    mediaPageError = false;
    clearInterval(mediaRetryTimer);
    document.getElementById('chatMediaPicker').classList.add('provider-open');
    document.getElementById('mediaMenu').hidden = true;
    document.getElementById('mediaContactPicker').hidden = true;
    const panel = document.getElementById('mediaProviderPanel');
    panel.hidden = false;
    const title = ({ unsplash: 'Unsplash', giphy: 'GIPHY', klipy: 'KLIPY' })[provider];
    const searchLabel = provider === 'unsplash' ? 'Search Unsplash photos' : provider === 'giphy' ? 'Search GIPHY' : 'Search KLIPY';
    const kindOptions = provider === 'giphy'
      ? [['gif', 'GIFs'], ['sticker', 'Stickers'], ['clip', 'Clips'], ['emoji', 'Emoji'], ['text', 'Text']]
      : provider === 'klipy'
        ? [['all', 'All'], ['gif', 'GIFs'], ['sticker', 'Stickers'], ['clip', 'Clips'], ['meme', 'Memes'], ['emoji', 'AI Emoji']]
        : [];
    const options = `<div class=media-kind-toggle role=group aria-label="${title} content type">${kindOptions.map(([kind, label]) => `<button class="media-kind-option${mediaKind === kind ? ' selected' : ''}" aria-pressed="${mediaKind === kind}" data-media-kind="${kind}">${label}</button>`).join('')}</div>`;
    const search = `<label class=media-search-label><span>${ic('search',17)}</span><input id=mediaSearchInput type=search maxlength=100 placeholder="${searchLabel}" aria-label="${searchLabel}"></label>`;
    const footer = provider === 'giphy' || provider === 'klipy' || provider === 'unsplash'
      ? `<div class="media-provider-footer media-provider-footer-${provider}">${provider === 'giphy' || provider === 'klipy' ? options : ''}<span class=media-attribution>${provider === 'klipy' ? 'Powered by KLIPY' : provider === 'unsplash' ? 'Powered by Unsplash' : 'Powered by GIPHY'}</span></div>`
      : '';
    panel.innerHTML = `<div class="media-provider-head"><button class=media-back data-media-back aria-label="Back to attachments">${ic('left',18)}</button><b>${title}</b><button class=media-close data-close-media aria-label="Close attachment picker">${ic('x',18)}</button></div>
      ${provider === 'klipy' ? '' : search}
      <div id=mediaSearchScroll class=media-results-scroll role=region aria-label="Media search results"><div id=mediaSearchResults class=media-search-results aria-live=polite></div></div>
      ${provider === 'klipy' ? search : ''}
      ${footer}`;
    renderMediaResults();
    updateMediaSearchInput();
    panel.querySelector('#mediaSearchInput').focus();
    if (provider === 'giphy' || provider === 'klipy') searchMediaPicker('');
  }

  function updateMediaSearchInput() {
    const input = document.getElementById('mediaSearchInput');
    if (!input) return;
    const emojiLibrary = mediaProvider === 'giphy' && mediaKind === 'emoji';
    input.disabled = emojiLibrary;
    input.placeholder = mediaProvider === 'unsplash' ? 'Search Unsplash photos'
      : mediaProvider === 'klipy' ? 'Search KLIPY'
      : emojiLibrary ? 'Browse animated emoji'
      : mediaKind === 'text' ? 'Type exact words to animate'
        : mediaKind === 'clip' ? 'Search GIPHY Clips'
          : mediaKind === 'sticker' ? `Search ${mediaProvider === 'giphy' ? 'GIPHY' : 'KLIPY'} stickers`
            : mediaKind === 'gif' && (mediaProvider === 'giphy' || mediaProvider === 'klipy') ? `Search ${mediaProvider.toUpperCase()} GIFs`
              : `Search ${mediaProvider.toUpperCase()}`;
    input.maxLength = mediaKind === 'text' ? 100 : mediaProvider === 'giphy' ? 50 : 100;
    input.setAttribute('aria-label', input.placeholder);
    if (emojiLibrary) input.value = '';
  }

  async function searchMediaPicker(query, append = false) {
    const target = document.getElementById('mediaSearchResults');
    const trimmedQuery = query.trim();
    const queryRequired = mediaProvider === 'unsplash' || (mediaProvider === 'giphy' && mediaKind === 'text');
    if (!target || !mediaProvider || (!trimmedQuery && queryRequired)) return;
    if (append && (mediaLoadingMore || mediaPageError)) return;
    const selectedKinds = mediaKind === 'all' ? ['gif', 'sticker'] : [mediaKind];
    if (append && !selectedKinds.some(kind => mediaKindHasMore[kind])) return;
    clearTimeout(mediaSearchTimer);
    mediaQuery = trimmedQuery;
    const sequence = ++mediaSearchSequence;
    clearInterval(mediaRetryTimer);
    if (append) {
      mediaLoadingMore = true;
      target.querySelector('[data-media-load-more],[data-media-retry]')?.remove();
      target.insertAdjacentHTML('beforeend', '<p class="chat-hint media-loading-more">Loading more…</p>');
    } else {
      mediaKindPages = {};
      mediaKindHasMore = {};
      mediaLoadingMore = false;
      mediaPageError = false;
      target.scrollTop = 0;
      target.innerHTML = mediaProvider === 'giphy' || mediaProvider === 'klipy'
        ? '<div class="klipy-skeleton"><i></i><i></i><i></i><i></i><i></i><i></i></div>'
        : '<p class=chat-hint>Searching…</p>';
    }
    try {
      const kinds = append ? selectedKinds.filter(kind => mediaKindHasMore[kind]) : selectedKinds;
      const responses = await Promise.all(kinds.map(async kind => {
        const body = {
          provider: mediaProvider,
          query: trimmedQuery,
          kind,
          page: mediaKindPages[kind] || 0,
          ...(mediaProvider === 'klipy' ? { locale: navigator.languages?.[0] || navigator.language || 'en-US' } : {})
        };
        const response = await sb.functions.invoke('chat-media-search', { body });
        if (response.error) throw response.error;
        const data = response.data;
        return { kind, hasMore: data?.hasMore === true, items: (data?.results || []).map(item => ({ ...item, mediaKind: kind })) };
      }));
      if (sequence !== mediaSearchSequence || !target.isConnected) return;
      for (const result of responses) {
        mediaKindHasMore[result.kind] = result.hasMore;
        mediaKindPages[result.kind] = (mediaKindPages[result.kind] || 0) + 1;
      }
      if (mediaKind === 'all') {
        const merged = [];
        for (let index = 0; index < Math.max(0, ...responses.map(result => result.items.length)); index++) {
          for (const result of responses) if (result.items[index]) merged.push(result.items[index]);
        }
        if (append) mediaSearchItems.push(...merged);
        else mediaSearchItems = merged;
        target.querySelector('.media-loading-more')?.remove();
        renderMediaResults(merged, append);
      } else {
        const newItems = responses.flatMap(result => result.items);
        if (append) mediaSearchItems.push(...newItems);
        else mediaSearchItems = newItems;
        target.querySelector('.media-loading-more')?.remove();
        renderMediaResults(newItems, append);
      }
      if (!mediaSearchItems.length) {
        target.innerHTML = '<p class=chat-hint>No results. Try another search.</p>';
      }
      if (selectedKinds.some(kind => mediaKindHasMore[kind])) {
        target.insertAdjacentHTML('beforeend', '<button class=media-load-more data-media-load-more>Load more results</button>');
      }
    } catch (error) {
      if (sequence !== mediaSearchSequence || !target.isConnected) return;
      const [message, retryDelay] = await Promise.all([
        mediaSearchError(error),
        mediaProvider === 'unsplash' ? mediaRetryDelay(error) : 0
      ]);
      if (sequence !== mediaSearchSequence || !target.isConnected) return;
      mediaPageError = true;
      target.querySelector('.media-loading-more')?.remove();
      const errorMarkup = `<p class=chat-error>${esc(message)}</p>`;
      if (append && mediaSearchItems.length) {
        target.insertAdjacentHTML('beforeend', `<div class=media-page-error>${errorMarkup}</div>`);
      } else {
        target.innerHTML = errorMarkup;
      }
      if (mediaProvider === 'unsplash') renderMediaRetry(target, append, retryDelay);
    } finally {
      if (sequence === mediaSearchSequence) mediaLoadingMore = false;
    }
  }

  function selectMediaKind(kind) {
    if (!['image', 'gif', 'sticker', 'clip', 'meme', 'emoji', 'text', 'all'].includes(kind)) return;
    mediaKind = kind;
    document.querySelectorAll('[data-media-kind]').forEach(button => {
      const selected = button.dataset.mediaKind === kind;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    updateMediaSearchInput();
    const input = document.getElementById('mediaSearchInput');
    if (input?.value.trim()) searchMediaPicker(input.value);
    else if ((mediaProvider === 'giphy' && kind !== 'text') || mediaProvider === 'klipy') searchMediaPicker('');
    else {
      mediaSearchSequence++;
      mediaPageError = false;
      clearInterval(mediaRetryTimer);
      mediaSearchItems = [];
      renderMediaResults();
    }
  }

  function openMediaPicker() {
    const picker = document.getElementById('chatMediaPicker');
    const button = document.querySelector('[data-chat-media]');
    if (!picker) return;
    const opening = picker.hidden;
    picker.hidden = !opening;
    button?.setAttribute('aria-expanded', String(opening));
    if (opening) {
      mediaProvider = '';
      picker.classList.remove('provider-open');
      document.getElementById('mediaMenu').hidden = false;
      document.getElementById('mediaProviderPanel').hidden = true;
      document.getElementById('mediaContactPicker').hidden = true;
    } else closeMediaPicker();
  }

  function closeMediaPicker() {
    mediaSearchSequence++;
    clearTimeout(mediaSearchTimer);
    clearInterval(mediaRetryTimer);
    const picker = document.getElementById('chatMediaPicker');
    if (picker) { picker.hidden = true; picker.classList.remove('provider-open'); }
    document.querySelector('[data-chat-media]')?.setAttribute('aria-expanded', 'false');
  }
  async function trackUnsplash(item) {
    if (item.provider !== 'unsplash' || item.downloadTracked) return;
    const { data, error: trackingError } = await sb.functions.invoke('chat-media-search', {
      body: { provider: 'unsplash', action: 'download', kind: 'image', photoId: item.photoId, downloadLocation: item.downloadLocation }
    });
    if (trackingError) throw new Error(`Could not record Unsplash photo use: ${await mediaSearchError(trackingError)}`);
    if (data?.tracked !== true) throw new Error('Unsplash did not confirm photo-use tracking. Try sending again.');
    item.downloadTracked = true;
  }

  document.addEventListener('click', event => {
    const el = event.target.closest('[data-media-provider],[data-media-back],[data-media-kind],[data-media-result],[data-media-load-more],[data-media-retry],[data-close-media]');
    if (!el || !el.closest('#chatMediaPicker')) return;
    const d = el.dataset;
    if (d.closeMedia !== undefined) { closeMediaPicker(); window.NovaChatPicker.onClose && window.NovaChatPicker.onClose(); }
    if (d.mediaProvider) renderMediaProvider(d.mediaProvider);
    if (d.mediaLoadMore !== undefined) searchMediaPicker(mediaQuery, true);
    if (d.mediaRetry && !el.disabled) {
      mediaPageError = false;
      if (d.mediaRetry === 'more') { mediaKindHasMore[mediaKind] = true; searchMediaPicker(mediaQuery, true); } else searchMediaPicker(mediaQuery);
    }
    if (d.mediaBack !== undefined) {
      mediaSearchSequence++; clearTimeout(mediaSearchTimer); mediaProvider = '';
      document.getElementById('chatMediaPicker').classList.remove('provider-open');
      document.getElementById('mediaProviderPanel').hidden = true;
      document.getElementById('mediaMenu').hidden = false;
    }
    if (d.mediaKind) selectMediaKind(d.mediaKind);
    if (d.mediaResult !== undefined) { const item = mediaSearchItems[Number(d.mediaResult)]; if (item) addRemoteMedia(item.url, item.type, item.title, item); }
  });
  document.addEventListener('input', event => {
    const input = event.target;
    if (input.id !== 'mediaSearchInput') return;
    if (mediaProvider === 'giphy' && mediaKind === 'emoji') return;
    clearTimeout(mediaSearchTimer);
    if (input.value.trim().length >= 1) mediaSearchTimer = setTimeout(() => searchMediaPicker(input.value), 350);
    else if ((mediaProvider === 'giphy' && mediaKind !== 'text') || mediaProvider === 'klipy') mediaSearchTimer = setTimeout(() => searchMediaPicker(''), 180);
    else { mediaSearchSequence++; mediaSearchItems = []; renderMediaResults(); }
  });
  document.addEventListener('keydown', event => {
    if (event.target.id === 'mediaSearchInput' && event.key === 'Enter') {
      event.preventDefault();
      if (event.target.value.trim() || mediaProvider === 'giphy' || mediaProvider === 'klipy') searchMediaPicker(event.target.value);
    }
  });
  document.addEventListener('scroll', event => {
    const target = event.target;
    if (target?.id !== 'mediaSearchScroll' || mediaPageError || !['unsplash', 'giphy', 'klipy'].includes(mediaProvider)) return;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 180) searchMediaPicker(mediaQuery, true);
  }, true);

  window.NovaChatPicker = { hooks, open: openMediaPicker, close: closeMediaPicker, trackUnsplash, safeUnsplashAttribution, safeRemoteMedia, forget: url => pendingRemoteSeen.delete(url), reset: () => pendingRemoteSeen.clear(), onClose: null };
  Object.defineProperty(window.NovaChatPicker, 'hooks', { get: () => hooks });
})();
