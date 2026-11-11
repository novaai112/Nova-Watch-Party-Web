/* On-demand UI translation. Only interface text and accessibility labels are sent. */
(function () {
  const LANGUAGES = {
    af:'Afrikaans', sq:'Albanian', am:'Amharic', ar:'Arabic', hy:'Armenian', az:'Azerbaijani',
    eu:'Basque', be:'Belarusian', bn:'Bengali', bs:'Bosnian', bg:'Bulgarian', ca:'Catalan',
    ceb:'Cebuano', 'zh-CN':'Chinese (Simplified)', 'zh-TW':'Chinese (Traditional)', co:'Corsican',
    hr:'Croatian', cs:'Czech', da:'Danish', nl:'Dutch', en:'English', eo:'Esperanto', et:'Estonian',
    tl:'Filipino', fi:'Finnish', fr:'French', fy:'Frisian', gl:'Galician', ka:'Georgian', de:'German',
    el:'Greek', gu:'Gujarati', ht:'Haitian Creole', ha:'Hausa', haw:'Hawaiian', he:'Hebrew', hi:'Hindi',
    hmn:'Hmong', hu:'Hungarian', is:'Icelandic', ig:'Igbo', id:'Indonesian', ga:'Irish', it:'Italian',
    ja:'Japanese', jv:'Javanese', kn:'Kannada', kk:'Kazakh', km:'Khmer', ko:'Korean', ku:'Kurdish',
    ky:'Kyrgyz', lo:'Lao', la:'Latin', lv:'Latvian', lt:'Lithuanian', lb:'Luxembourgish',
    mk:'Macedonian', mg:'Malagasy', ms:'Malay', ml:'Malayalam', mt:'Maltese', mi:'Maori',
    mr:'Marathi', mn:'Mongolian', my:'Myanmar (Burmese)', ne:'Nepali', no:'Norwegian', ny:'Nyanja',
    ps:'Pashto', fa:'Persian', pl:'Polish', pt:'Portuguese', pa:'Punjabi', ro:'Romanian', ru:'Russian',
    sm:'Samoan', gd:'Scots Gaelic', sr:'Serbian', st:'Sesotho', sn:'Shona', sd:'Sindhi', si:'Sinhala',
    sk:'Slovak', sl:'Slovenian', so:'Somali', es:'Spanish', su:'Sundanese', sw:'Swahili',
    sv:'Swedish', tg:'Tajik', ta:'Tamil', te:'Telugu', th:'Thai', tr:'Turkish', uk:'Ukrainian',
    ur:'Urdu', uz:'Uzbek', vi:'Vietnamese', cy:'Welsh', xh:'Xhosa', yi:'Yiddish', yo:'Yoruba', zu:'Zulu'
  };
  const CACHE_KEY = 'nova-ui-translations-v1';
  const CACHE_LIMIT = 1800;
  const personalContent = '.idt h3,.idt p,.hello b,.mid h2,.vhb h2,.vhb .mu,.vbio,.biot,.avt,.frc b,.frc small,.reqr,.vid b,.chip,.infogrid,.langName,.notranslate,[translate="no"]';
  const originals = new Map();
  const translatedValues = new Map();
  const originalAttributes = new Map();
  const failedTranslations = new Set();
  let cache = Object.create(null);
  let currentLanguage = 'en';
  let generation = 0;
  let scheduled = false;
  let failureCount = 0;
  let statusElement = null;

  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) cache = stored;
  } catch (error) {
    console.warn('Could not read the saved UI translation cache.', error);
  }

  function cacheKey(language, source) {
    return language + '\u0000' + source;
  }

  function saveCache() {
    const keys = Object.keys(cache);
    if (keys.length > CACHE_LIMIT) {
      for (const key of keys.slice(0, keys.length - CACHE_LIMIT)) delete cache[key];
    }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
      console.warn('Could not save the UI translation cache.', error);
    }
  }

  function isPrivateText(text) {
    return !text.trim() || /^\d+(?:[.,:/-]\d+)*$/.test(text.trim()) ||
      /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text) ||
      /(?:https?:\/\/|www\.)\S+/i.test(text);
  }

  function canTranslateNode(node) {
    const parent = node.parentElement;
    return !!parent && !parent.closest(personalContent) &&
      !parent.closest('script,style,noscript,code,pre,textarea,select,input,option,[data-translation-status]');
  }

  function collect(root) {
    const nodes = [];
    if (root.nodeType === Node.TEXT_NODE) {
      if (canTranslateNode(root)) nodes.push(root);
      return nodes;
    }
    if (!root.querySelectorAll) return nodes;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) if (canTranslateNode(node)) nodes.push(node);
    return nodes;
  }

  function showFailure() {
    if (!statusElement) {
      statusElement = document.createElement('div');
      statusElement.dataset.translationStatus = 'true';
      statusElement.setAttribute('role', 'status');
      statusElement.textContent = 'Some interface text could not be translated. Showing the original text.';
      Object.assign(statusElement.style, {
        position: 'fixed', left: '50%', bottom: '16px', transform: 'translateX(-50%)',
        zIndex: '9999', maxWidth: 'calc(100% - 32px)', padding: '10px 14px',
        borderRadius: '10px', background: '#172033', color: '#fff',
        font: '13px/1.45 system-ui,sans-serif', boxShadow: '0 4px 18px #0003'
      });
      document.body.append(statusElement);
    }
  }

  function clearFailure() {
    if (statusElement) statusElement.remove();
    statusElement = null;
  }

  async function translate(source, language, token) {
    const key = cacheKey(language, source);
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    const pieces = [];
    let piece = '';
    for (const word of source.match(/\S+\s*/g) || [source]) {
      if (piece.length && piece.length + word.length > 430) {
        pieces.push(piece);
        piece = '';
      }
      piece += word;
    }
    if (piece) pieces.push(piece);
    const translatedPieces = [];
    for (const text of pieces) {
      const params = new URLSearchParams({ q: text, langpair: 'en|' + language });
      const response = await fetch('https://api.mymemory.translated.net/get?' + params.toString());
      if (!response.ok) throw new Error('Translation service returned HTTP ' + response.status);
      const result = await response.json();
      if (result.responseStatus !== 200 || !result.responseData || typeof result.responseData.translatedText !== 'string') {
        throw new Error(result.responseDetails || 'Translation service returned an empty result');
      }
      translatedPieces.push(result.responseData.translatedText);
    }
    const translated = translatedPieces.join('');
    if (token === generation) cache[key] = translated;
    return translated;
  }

  async function translateItems(items, language, token) {
    const pending = new Map();
    for (const item of items) {
      const source = item.getOriginal();
      if (isPrivateText(source)) continue;
      const key = cacheKey(language, source), cached = cache[key];
      if (cached !== undefined) {
        if (token === generation) item.set(cached);
      } else if (failedTranslations.has(key)) {
        failureCount++;
      } else {
        if (!pending.has(key)) pending.set(key, { source, items: [] });
        pending.get(key).items.push(item);
      }
    }

    const work = [...pending.entries()];
    let cursor = 0;
    const worker = async () => {
      while (cursor < work.length) {
        const [key, group] = work[cursor++];
        try {
          const translated = await translate(group.source, language, token);
          if (token === generation) {
            for (const item of group.items) if (item.isConnected()) item.set(translated);
          }
        } catch (error) {
          if (token === generation) {
            failedTranslations.add(key);
            failureCount++;
          }
          console.warn('Could not translate an interface string.', error);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (token === generation) {
      if (failureCount) showFailure();
      else clearFailure();
      saveCache();
    }
  }

  function restoreOriginals() {
    for (const [node, original] of originals) {
      if (node.isConnected) {
        if (node.nodeValue !== original) node.nodeValue = original;
        translatedValues.delete(node);
      }
      else originals.delete(node);
    }
    for (const [element, values] of originalAttributes) {
      if (!element.isConnected) {
        originalAttributes.delete(element);
        continue;
      }
      for (const [attribute, original] of values) {
        if (element.getAttribute(attribute) !== original) element.setAttribute(attribute, original);
      }
    }
  }

  function collectItems(root) {
    for (const node of originals.keys()) if (!node.isConnected) originals.delete(node);
    for (const element of originalAttributes.keys()) if (!element.isConnected) originalAttributes.delete(element);
    const items = collect(root).map(node => ({
      getOriginal() {
        const translated = translatedValues.get(node);
        if (translated !== undefined && node.nodeValue !== translated) {
          originals.set(node, node.nodeValue);
          translatedValues.delete(node);
        }
        if (!originals.has(node)) originals.set(node, node.nodeValue);
        return originals.get(node);
      },
      set: value => {
        if (node.nodeValue !== value) node.nodeValue = value;
        translatedValues.set(node, value);
      },
      isConnected: () => node.isConnected
    }));
    if (root === document.body) {
      const title = document.querySelector('head title');
      if (title && title.firstChild) {
        const node = title.firstChild;
        items.push({
          getOriginal() {
            const translated = translatedValues.get(node);
            if (translated !== undefined && node.nodeValue !== translated) {
              originals.set(node, node.nodeValue);
              translatedValues.delete(node);
            }
            if (!originals.has(node)) originals.set(node, node.nodeValue);
            return originals.get(node);
          },
          set: value => {
            if (node.nodeValue !== value) node.nodeValue = value;
            translatedValues.set(node, value);
          },
          isConnected: () => node.isConnected
        });
      }
    }
    if (root.nodeType === Node.ELEMENT_NODE) {
      const elements = [root, ...root.querySelectorAll('[placeholder],[aria-label],[title]')];
      for (const element of elements) {
        if (element.closest(personalContent) || element.closest('script,style,noscript,code,pre,textarea,select,option,[data-translation-status]')) continue;
        for (const attribute of ['placeholder', 'aria-label', 'title']) {
          if (!element.hasAttribute(attribute)) continue;
          let values = originalAttributes.get(element);
          if (!values) {
            values = new Map();
            originalAttributes.set(element, values);
          }
          if (!values.has(attribute)) values.set(attribute, element.getAttribute(attribute));
          const original = values.get(attribute);
          if (isPrivateText(original)) continue;
          items.push({
            getOriginal: () => original,
            set: value => { if (element.getAttribute(attribute) !== value) element.setAttribute(attribute, value); },
            isConnected: () => element.isConnected
          });
        }
      }
    }
    return items;
  }

  function refresh() {
    if (currentLanguage === 'en') {
      restoreOriginals();
      clearFailure();
      return Promise.resolve();
    }
    failureCount = 0;
    return translateItems(collectItems(document.body), currentLanguage, generation);
  }

  function setLanguage(language) {
    const next = Object.prototype.hasOwnProperty.call(LANGUAGES, language) ? language : 'en';
    if (next !== currentLanguage) {
      generation++;
      currentLanguage = next;
      restoreOriginals();
      document.documentElement.lang = next;
      document.documentElement.dir = /^(ar|fa|he|ps|sd|ur|yi)$/.test(next) ? 'rtl' : 'ltr';
    }
    return refresh();
  }

  function scheduleRefresh() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      refresh();
    }, 40);
  }

  function start() {
    try {
      const settings = JSON.parse(localStorage.getItem('nova_settings') || '{}');
      if (settings && settings.lang) setLanguage(settings.lang);
      else refresh();
    } catch (error) {
      console.warn('Could not read the saved interface language.', error);
      refresh();
    }
    const observer = new MutationObserver(records => {
      if (records.some(record => record.addedNodes.length || record.type === 'attributes' || record.type === 'characterData')) scheduleRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title'] });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title'] });
  }

  window.NovaTranslate = {
    LANGUAGES,
    setLanguage,
    refresh
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
