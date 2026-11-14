/* Watch-room attachments: the SAME picker as the friends chat (Document, Photos & videos, Camera, Audio,
   Unsplash, GIPHY, KLIPY). Ported from nova-chat.js; the voice recorder is left out (the room has its own mic).
   Requires room-media-schema.sql (attachments column + room-media bucket). */
(function () {
  const { sb, esc } = Nova, ic = Nova.ic;
  const MAX_FILE = 20 * 1024 * 1024, MAX_ATTACHMENTS = 8, PAGE_SIZE = 60;
  const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,image/bmp,image/tiff,video/mp4,video/webm,video/quicktime,video/ogg,video/3gpp,video/x-msvideo,audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/wav,audio/x-wav,audio/aac,audio/flac,audio/3gpp,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/zip';
  const MIME = new Set(ACCEPT.split(','));
  let pendingFiles = [], pendingRemote = [], pendingContacts = [], mediaSearchItems = [], mediaSearchSequence = 0, mediaSearchTimer = null, mediaRetryTimer = null, mediaProvider = '', mediaKind = 'image', mediaKindPages = {}, mediaKindHasMore = {}, mediaLoadingMore = false, mediaPageError = false, mediaQuery = '';
  const pendingPreviewUrls = new WeakMap();
  const setBusy = (node, busy) => { if (node) node.disabled = busy; };
  const room = () => window.NovaRoomMedia._ctx || {};

  function renderPending() {
    const target = document.getElementById('pendingFiles');
    if (!target) return;
    const renderPreview = (item, index, remote = false) => {
      const { name, type, url } = item;
      const previewUrl = url || (() => {
        let current = pendingPreviewUrls.get(item);
        if (!current) { current = URL.createObjectURL(item); pendingPreviewUrls.set(item, current); }
        return current;
      })();
      const media = type.startsWith('image/')
        ? `<img class=pending-preview-image src="${esc(previewUrl)}" alt="">`
        : type.startsWith('video/')
          ? `<video class=pending-preview-video src="${esc(previewUrl)}" muted playsinline preload=metadata></video>`
          : type.startsWith('audio/')
            ? `<audio class=pending-preview-audio controls preload=metadata src="${esc(previewUrl)}"></audio>`
            : `<span class=pending-preview-file>${ic(type === 'application/pdf' ? 'file' : 'file',20)}</span>`;
      const remove = remote
        ? `data-remove-remote="${index}"`
        : `data-remove-file="${index}"`;
      return `<div class="pending-preview${type.startsWith('audio/') ? ' pending-preview-audio-card' : ''}">${media}<span class=pending-preview-name title="${esc(name)}">${esc(name)}</span><button class=pending-preview-remove ${remove} aria-label="Remove ${esc(name)}">${ic('x',15)}</button></div>`;
    };
    target.innerHTML = [
      ...pendingFiles.map((file, index) => renderPreview(file, index)),
      ...pendingRemote.map((item, index) => renderPreview(item, index, true)),
      ...pendingContacts.map((contact, index) => `<div class="pending-preview pending-contact"><span class=pending-preview-file>${ic('users',20)}</span><span class=pending-preview-name>${esc(contact.full_name || contact.username || 'Contact')}</span><button class=pending-preview-remove data-remove-contact="${index}" aria-label="Remove ${esc(contact.full_name || contact.username || 'contact')}">${ic('x',15)}</button></div>`)
    ].join('');
  }

  function clearPendingPreviews() {
    pendingFiles.forEach(file => {
      const url = pendingPreviewUrls.get(file);
      if (url) URL.revokeObjectURL(url);
    });
  }

  function resizeChatInput(input) {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  function addFiles(files) {
    for (const file of files) {
      const type = (file.type || '').split(';')[0].toLowerCase();
      if (!MIME.has(type) && !/^(?:video|audio)\//.test(type)) { Nova.toast(`${file.name}: this file type is not supported.`, 'err'); continue; }
      if (file.size > MAX_FILE) { Nova.toast(`${file.name} is larger than 20 MB.`, 'err'); continue; }
      if (pendingFiles.length + pendingRemote.length + pendingContacts.length >= MAX_ATTACHMENTS) { Nova.toast(`You can attach up to ${MAX_ATTACHMENTS} items per message.`, 'err'); break; }
      pendingFiles.push(file);
    }
    renderPending();
  }

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
    if (pendingFiles.length + pendingRemote.length + pendingContacts.length >= MAX_ATTACHMENTS) {
      Nova.toast(`You can attach up to ${MAX_ATTACHMENTS} items per message.`, 'err');
      return;
    }
    if (pendingRemote.some(item => item.url === media.url)) {
      Nova.toast('That media link is already attached.', 'err');
      return;
    }
    if (details.mediaKind === 'gif' || details.mediaKind === 'sticker' || /\.gif(\?|$)/i.test(media.url)) media.gif = true;
    pendingRemote.push(media);
    renderPending();
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
    /* no contact panel in rooms */
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
      /* no contact panel in rooms */
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

  /* ---------------- room integration ---------------- */
  const signed = new Map();            /* storage path -> signed url */
  const BUCKET = 'room-media';

  function markup() {
    return `<section id=chatMediaPicker class=chat-media-picker role=region aria-label="Share media" hidden>
        <div id=mediaMenu class=media-menu>
          <button type=button class=media-menu-item data-media-action="document">${ic('file',18)}<span>Document</span></button>
          <button type=button class=media-menu-item data-media-action="gallery">${ic('image',18)}<span>Photos &amp; videos</span></button>
          <button type=button class=media-menu-item data-media-action="camera">${ic('camera',18)}<span>Camera</span></button>
          <button type=button class=media-menu-item data-media-action="audio">${ic('mic',18)}<span>Audio</span></button>
          <button type=button class=media-menu-item data-media-provider="unsplash"><i class="media-brand unsplash-brand">U</i><span>Unsplash Photos</span></button>
          <button type=button class=media-menu-item data-media-provider="giphy"><i class="media-brand giphy-brand">GIF</i><span>GIPHY</span></button>
          <button type=button class=media-menu-item data-media-provider="klipy"><i class="media-brand klipy-brand">K</i><span>KLIPY</span></button>
        </div>
        <div id=mediaProviderPanel class=media-provider-panel hidden></div>
        <div id=mediaContactPicker hidden></div>
      </section>
      <div id=pendingFiles class=pending-files></div>
      <input type=file id=chatFiles accept="image/*,video/*" multiple hidden aria-label="Choose photos and videos">
      <input type=file id=chatDocuments accept="application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/zip" multiple hidden aria-label="Choose documents">
      <input type=file id=chatAudio accept="audio/*" multiple hidden aria-label="Choose audio files">
      <input type=file id=chatCamera accept="image/*,video/*" capture="environment" hidden aria-label="Take a photo or video">`;
  }
  const buttonHTML = () => `<button type=button class="ib2 attach-btn" data-chat-media aria-expanded="false" aria-controls=chatMediaPicker title="Attach media or file" aria-label="Attach media or file">${ic('paperclip', 22)}</button>`;

  const count = () => pendingFiles.length + pendingRemote.length;
  function reset() {
    clearPendingPreviews();
    pendingFiles = []; pendingRemote = [];
    closeMediaPicker(); renderPending();
  }

  /* upload files, record Unsplash use, return the attachments array for the message row */
  async function prepare(roomId, userId) {
    const files = [...pendingFiles], remoteFiles = [...pendingRemote], uploaded = [];
    const attachments = remoteFiles.map(item => ({
      url: item.url, name: item.name, type: item.type,
      ...(item.gif ? { gif: true } : {}),
      ...(item.provider === 'unsplash' ? { attribution: item.attribution } : {})
    }));
    try {
      for (const file of files) {
        const extension = file.name.includes('.') ? file.name.split('.').pop().replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) : 'bin';
        const fileId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const path = `${roomId}/${userId}/${fileId}.${extension}`;
        const mimeType = (file.type || '').split(';')[0].toLowerCase();
        const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: mimeType, upsert: false });
        if (error) throw error;
        uploaded.push(path);
        attachments.push({ path, name: file.name.slice(0, 180), type: mimeType, size: file.size });
      }
      for (const item of remoteFiles) {
        if (item.provider !== 'unsplash' || item.downloadTracked) continue;
        const { data, error: trackingError } = await sb.functions.invoke('chat-media-search', {
          body: { provider: 'unsplash', action: 'download', kind: 'image', photoId: item.photoId, downloadLocation: item.downloadLocation }
        });
        if (trackingError) throw new Error(`Could not record Unsplash photo use: ${await mediaSearchError(trackingError)}`);
        if (data?.tracked !== true) throw new Error('Unsplash did not confirm photo-use tracking. Try sending again.');
        item.downloadTracked = true;
      }
    } catch (error) {
      if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded).catch(() => {});
      throw error;
    }
    return { attachments, cleanup: () => uploaded.length && sb.storage.from(BUCKET).remove(uploaded).catch(() => {}) };
  }

  /* ---- showing attachments inside a message ----
     Photos / videos / GIFs / stickers are "visual": shown bare, as a collage. Documents, audio and the rest are "other": shown inside the message card. */
  const fmtBytes = n => !n ? '' : n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  function describe(a) {
    if (!a || typeof a !== 'object') return null;
    if (a.url) {
      const remote = safeRemoteMedia(a.url, a.type, a.name);
      if (!remote) return null;
      return { href: remote.url, name: a.name || remote.name, type: remote.type, gif: !!a.gif || remote.type === 'image/gif',
        attribution: remote.type.startsWith('image/') ? safeUnsplashAttribution(a.attribution) : null, size: a.size };
    }
    if (!a.path) return null;
    return { href: signed.get(a.path) || '', name: a.name || 'file', type: a.type || '', gif: false, size: a.size };
  }
  const isVisual = d => d && (d.type.startsWith('image/') || d.type.startsWith('video/'));
  function tileHTML(d, i, more) {
    const href = esc(d.href), name = esc(d.name), video = d.type.startsWith('video/');
    if (!href) return `<span class="rm-tile rm-loading" data-i="${i}"><span class=spin></span></span>`;
    const body = video
      ? (d.gif ? `<video src="${href}" autoplay loop muted playsinline></video>` : `<video src="${href}#t=0.1" preload=metadata muted playsinline></video><span class=rm-play>${ic('play',22)}</span>`)
      : `<img src="${href}" alt="${name}" loading=lazy>`;
    return `<button type=button class="rm-tile${d.gif ? ' gif' : ''}" data-rm-view="${i}" aria-label="Open ${name}">${body}${more ? `<span class=rm-more>+${more}</span>` : ''}</button>`;
  }
  function otherHTML(d) {
    const href = esc(d.href), name = esc(d.name);
    if (d.type.startsWith('audio/')) return href ? `<audio class=message-audio controls preload=metadata src="${href}"></audio>` : `<span class=message-file>${ic('file',18)}<span>Loading ${name}…</span></span>`;
    if (!href) return `<span class=message-file>${ic('file',18)}<span>Loading ${name}…</span></span>`;
    return `<a class=message-file href="${href}" target=_blank rel=noopener>${ic('file',18)}<span><b>${name}</b>${d.size ? `<small>${fmtBytes(d.size)}</small>` : ''}</span></a>`;
  }
  /* split a message's attachments -> { visual: html collage, other: html, hasVisual, hasOther, gifOnly } */
  function parts(list, key) {
    const all = (Array.isArray(list) ? list : []).map(describe).filter(Boolean);
    const vis = all.filter(isVisual), oth = all.filter(d => !isVisual(d));
    if (key !== undefined) groups.set(String(key), vis);
    let visual = '';
    if (vis.length) {
      const n = Math.min(vis.length, 4), more = vis.length > 4 ? vis.length - 4 : 0;
      const credit = vis.length === 1 && vis[0].attribution
        ? `<small class=rm-credit>Photo by <a href="${esc(vis[0].attribution.photographerUrl)}" target=_blank rel="noopener noreferrer">${esc(vis[0].attribution.photographer)}</a> on <a href="${esc(vis[0].attribution.photoUrl)}" target=_blank rel="noopener noreferrer">Unsplash</a></small>` : '';
      visual = `<div class="rm-grid g${n}" data-rm-msg="${esc(String(key ?? ''))}">${vis.slice(0, n).map((d, i) => tileHTML(d, i, i === n - 1 ? more : 0)).join('')}</div>${credit}`;
    }
    return { visual, other: oth.map(otherHTML).join(''), hasVisual: vis.length > 0, hasOther: oth.length > 0, gifOnly: vis.length === 1 && vis[0].gif };
  }
  const groups = new Map();            /* message key -> visual items (for the viewer) */

  /* full-screen viewer */
  function openViewer(key, start) {
    const items = groups.get(String(key)) || []; if (!items.length) return;
    let i = Math.max(0, Math.min(start, items.length - 1));
    const el = document.createElement('div'); el.className = 'rm-viewer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Media viewer');
    const paint = () => {
      const d = items[i], href = esc(d.href);
      el.innerHTML = `<div class=rm-v-top><span>${i + 1} / ${items.length}</span><b>${esc(d.name)}</b><a href="${href}" download target=_blank rel=noopener aria-label=Download>${ic('down',22)}</a><button type=button data-v-close aria-label=Close>${ic('x',22)}</button></div>
        <div class=rm-v-stage>${d.type.startsWith('video/') ? `<video src="${href}" controls autoplay playsinline ${d.gif ? 'loop muted' : ''}></video>` : `<img src="${href}" alt="${esc(d.name)}">`}</div>
        ${items.length > 1 ? `<button type=button class="rm-v-nav prev" data-v-prev aria-label=Previous>${ic('chev',26)}</button><button type=button class="rm-v-nav next" data-v-next aria-label=Next>${ic('chev',26)}</button>` : ''}`;
    };
    const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); };
    const step = n => { i = (i + n + items.length) % items.length; paint(); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); };
    el.addEventListener('click', e => {
      if (e.target.closest('[data-v-close]') || e.target === el || e.target.classList.contains('rm-v-stage')) close();
      else if (e.target.closest('[data-v-prev]')) step(-1); else if (e.target.closest('[data-v-next]')) step(1);
    });
    document.addEventListener('keydown', onKey, true);
    paint(); (document.getElementById('rm') || document.body).appendChild(el);
  }
  const render = list => { const p = parts(list); return p.visual + p.other; };
  /* fetch signed links for stored files; resolves true when something new arrived (caller re-renders) */
  async function sign(msgs) {
    const need = [];
    (msgs || []).forEach(m => (Array.isArray(m.attachments) ? m.attachments : []).forEach(a => { if (a && a.path && !signed.has(a.path) && !need.includes(a.path)) need.push(a.path); }));
    if (!need.length) return false;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need, 3600);
    if (error || !data) return false;
    let got = false;
    data.forEach((row, i) => { if (row && row.signedUrl) { signed.set(need[i] || row.path, row.signedUrl); got = true; } });
    return got;
  }

  /* ---- events (same data-attributes as the friends chat) ---- */
  document.addEventListener('click', event => {
    const tile = event.target.closest('#rm [data-rm-view]');
    if (tile) { const g = tile.closest('[data-rm-msg]'); if (g) openViewer(g.dataset.rmMsg, Number(tile.dataset.rmView)); return; }
    const el = event.target.closest('#rm [data-chat-media],#rm [data-remove-file],#rm [data-remove-remote],#rm [data-close-media],#rm [data-media-action],#rm [data-media-provider],#rm [data-media-back],#rm [data-media-kind],#rm [data-media-result],#rm [data-media-load-more],#rm [data-media-retry]');
    if (!el) return;
    const d = el.dataset;
    if (d.chatMedia !== undefined) openMediaPicker();
    if (d.closeMedia !== undefined) closeMediaPicker();
    if (d.mediaProvider) renderMediaProvider(d.mediaProvider);
    if (d.mediaLoadMore !== undefined) searchMediaPicker(mediaQuery, true);
    if (d.mediaRetry && !el.disabled) {
      mediaPageError = false;
      if (d.mediaRetry === 'more') { mediaKindHasMore[mediaKind] = true; searchMediaPicker(mediaQuery, true); }
      else searchMediaPicker(mediaQuery);
    }
    if (d.mediaBack !== undefined) {
      mediaSearchSequence++;
      clearTimeout(mediaSearchTimer);
      mediaProvider = '';
      document.getElementById('chatMediaPicker').classList.remove('provider-open');
      document.getElementById('mediaProviderPanel').hidden = true;
      document.getElementById('mediaMenu').hidden = false;
    }
    if (d.mediaAction === 'gallery') document.getElementById('chatFiles')?.click();
    if (d.mediaAction === 'document') document.getElementById('chatDocuments')?.click();
    if (d.mediaAction === 'audio') document.getElementById('chatAudio')?.click();
    if (d.mediaAction === 'camera') { closeMediaPicker(); openCamera(); }
    if (d.mediaKind) selectMediaKind(d.mediaKind);
    if (d.mediaResult !== undefined) {
      const item = mediaSearchItems[Number(d.mediaResult)];
      if (item) addRemoteMedia(item.url, item.type, item.title, item);
    }
    if (d.removeFile !== undefined) {
      const [file] = pendingFiles.splice(Number(d.removeFile), 1);
      const url = file && pendingPreviewUrls.get(file);
      if (url) URL.revokeObjectURL(url);
      renderPending();
    }
    if (d.removeRemote !== undefined) { pendingRemote.splice(Number(d.removeRemote), 1); renderPending(); }
    if (window.NovaRoomMedia && NovaRoomMedia.onChange) NovaRoomMedia.onChange();
  });
  document.addEventListener('input', event => {
    const input = event.target;
    if (input.id !== 'mediaSearchInput' || !input.closest('#rm')) return;
    if (mediaProvider === 'giphy' && mediaKind === 'emoji') return;
    clearTimeout(mediaSearchTimer);
    if (input.value.trim().length >= 1) mediaSearchTimer = setTimeout(() => searchMediaPicker(input.value), 350);
    else if ((mediaProvider === 'giphy' && mediaKind !== 'text') || mediaProvider === 'klipy') mediaSearchTimer = setTimeout(() => searchMediaPicker(''), 180);
    else { mediaSearchSequence++; mediaSearchItems = []; renderMediaResults(); }
  });
  document.addEventListener('scroll', event => {
    const target = event.target;
    if (target?.id !== 'mediaSearchScroll' || mediaPageError || !['unsplash', 'giphy', 'klipy'].includes(mediaProvider)) return;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 180) searchMediaPicker(mediaQuery, true);
  }, true);
  document.addEventListener('change', event => {
    if (['chatFiles', 'chatCamera', 'chatDocuments', 'chatAudio'].includes(event.target.id) && event.target.closest('#rm')) {
      addFiles([...event.target.files]);
      event.target.value = '';
      closeMediaPicker();
      if (NovaRoomMedia.onChange) NovaRoomMedia.onChange();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.target.id === 'mediaSearchInput' && event.key === 'Enter' && event.target.closest('#rm')) {
      event.preventDefault();
      if (event.target.value.trim() || mediaProvider === 'giphy' || mediaProvider === 'klipy') searchMediaPicker(event.target.value);
    }
    if (event.key === 'Escape') closeMediaPicker();
  });
  document.addEventListener('paste', event => {
    if (event.target.id !== 'cmsg') return;
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) { addFiles(files); if (NovaRoomMedia.onChange) NovaRoomMedia.onChange(); }
  });

  /* ---- camera: the SAME live camera + photo editor + send preview as the inbox chat (nova-chat-capture.js) ---- */
  let cameraBusy = false;
  async function openCamera() {
    const C = window.NovaChatMedia;
    if (!C || !C.openCamera || !C.mediaSupported || !C.mediaSupported()) { document.getElementById('chatCamera')?.click(); return; }
    if (cameraBusy) return; cameraBusy = true;
    /* the Nova Home page listens to history/popstate; keep the camera overlays out of the history stack */
    const push = history.pushState; history.pushState = function () {};
    try {
      const files = await C.openCamera({ video: true });
      if (!files || !files.length) return;
      const r = await C.openSendPreview(files.slice(0, MAX_ATTACHMENTS), { title: 'Send to room', allowMore: false });
      if (!r) return;
      addFiles(r.items.map(i => i.file));
      const input = document.getElementById('cmsg');
      if (input && r.caption) input.value = r.caption.slice(0, 500);
      if (NovaRoomMedia.onChange) NovaRoomMedia.onChange();
      if (NovaRoomMedia.onSend) NovaRoomMedia.onSend();
    } catch (error) {
      Nova.toast(/denied|NotAllowed/i.test((error && error.name || '') + (error && error.message || '')) ? 'Camera permission is blocked.' : 'Camera unavailable.', 'err');
    } finally { history.pushState = push; cameraBusy = false; }
  }
  window.NovaRoomMedia = { markup, buttonHTML, count, reset, prepare, render, parts, sign, addFiles, urlFor: path => signed.get(path), camera: openCamera, close: closeMediaPicker, onChange: null };
})();
