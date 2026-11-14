/* nova-chat-rich.js — pure helpers for Nova Chat: safe rich-text rendering (bold / italic / underline /
   strikethrough / monospace), links, @mentions, #hashtags, emoji data, and shared formatters.
   Works in the browser (window.NovaChatRich) and in Node (module.exports) so it can be unit-tested. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NovaChatRich = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- rich text ---------- */
  const PH_OPEN = '', PH_CLOSE = '';
  const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
  const MENTION_RE = /(^|[^\p{L}\p{N}_.-])@([\p{L}\p{N}_.-]{2,40})/gu;
  const HASHTAG_RE = /(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]{1,60})/gu;

  function trimUrl(raw) {
    let url = raw, tail = '';
    for (;;) {
      const last = url.slice(-1);
      if (!last) break;
      const open = { ')': '(', ']': '[', '}': '{' }[last];
      if (/[.,!?:;'"*_~]/.test(last) || (open && (url.split(last).length - 1) > (url.split(open).length - 1))) {
        tail = last + tail; url = url.slice(0, -1);
      } else break;
    }
    return [url, tail];
  }

  function safeHref(url) {
    const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    try {
      const u = new URL(withProtocol);
      if (!/^https?:$/.test(u.protocol) || u.username || u.password || !u.hostname.includes('.')) return null;
      return u.href;
    } catch { return null; }
  }

  function extractLinks(text) {
    const out = [];
    for (const m of String(text || '').matchAll(URL_RE)) {
      const [url] = trimUrl(m[0]), href = safeHref(url);
      if (href && !out.includes(href)) out.push(href);
    }
    return out;
  }

  function extractHashtags(text) {
    return [...String(text || '').matchAll(HASHTAG_RE)].map(m => m[2].toLowerCase());
  }

  function applyFormatting(html) {
    const B = '(^|[\\s>;(\\[{])', A = '(?=$|[\\s<&.,!?:;)\\]}])';
    const pass = (marker, tag) => {
      const m = marker.replace(/[*_~]/g, c => '\\' + c);
      html = html.replace(new RegExp(`${B}${m}(?=\\S)([^\\n]*?\\S)${m}${A}`, 'g'), (_, pre, inner) => `${pre}<${tag}>${inner}</${tag}>`);
    };
    pass('__', 'u'); pass('*', 'b'); pass('_', 'i'); pass('~', 's');
    return html;
  }

  /* options.mentions: Map(lowercase username -> user id) of valid mentions in this conversation. */
  function render(text, options = {}) {
    const known = options.mentions || new Map();
    let source = String(text ?? '').replace(/[]/g, '');
    const slots = [];
    const hold = html => { slots.push(html); return `${PH_OPEN}${slots.length - 1}${PH_CLOSE}`; };

    source = source.replace(/```([\s\S]*?)```/g, (_, code) => hold(`<pre class=nc-code>${esc(code.replace(/^\n|\n$/g, ''))}</pre>`));
    source = source.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code class=nc-mono>${esc(code)}</code>`));
    source = source.replace(URL_RE, raw => {
      const [url, tail] = trimUrl(raw), href = safeHref(url);
      return href ? hold(`<a class=nc-link href="${esc(href)}" target=_blank rel="noopener noreferrer nofollow">${esc(url)}</a>`) + tail : raw;
    });
    source = source.replace(MENTION_RE, (match, pre, name) => {
      const id = known.get(name.toLowerCase());
      return id ? pre + hold(`<button type=button class=nc-mention data-user="${esc(id)}">@${esc(name)}</button>`) : match;
    });
    source = source.replace(HASHTAG_RE, (_, pre, tag) => pre + hold(`<button type=button class=nc-hashtag data-hashtag="${esc(tag)}">#${esc(tag)}</button>`));

    let html = applyFormatting(esc(source)).replace(/\n/g, '<br>');
    for (let guard = 0; guard < 4 && html.includes(PH_OPEN); guard++) {
      html = html.replace(new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, 'g'), (_, i) => slots[Number(i)] ?? '');
    }
    return html;
  }

  /* Strips formatting markers for previews (inbox row, reply quote). */
  function plain(text) {
    return String(text ?? '').replace(/```([\s\S]*?)```/g, '$1').replace(/`([^`\n]+)`/g, '$1')
      .replace(/(^|[\s(])([*_~]{1,2})(?=\S)([^\n]*?\S)\2(?=$|[\s.,!?:;)])/g, '$1$3').replace(/\s+/g, ' ').trim();
  }

  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[‍️⃣\s])+$/u;
  function emojiOnlyCount(text) {
    const value = String(text ?? '').trim();
    if (!value || value.length > 40 || !EMOJI_ONLY.test(value) || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value)) return 0;
    const graphemes = segmenter ? [...segmenter.segment(value.replace(/\s/g, ''))].length : [...value.replace(/\s/g, '')].length;
    return graphemes;
  }

  /* ---------- formatters ---------- */
  const pad = n => String(n).padStart(2, '0');
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
    if (n < 1073741824) return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
    return `${(n / 1073741824).toFixed(1)} GB`;
  }
  function fmtDuration(seconds) {
    seconds = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  function fmtTime(value) { return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function dayLabel(value, now = new Date()) {
    const d = new Date(value), y = new Date(now); y.setDate(y.getDate() - 1);
    if (sameDay(d, now)) return 'Today';
    if (sameDay(d, y)) return 'Yesterday';
    const days = (now - d) / 86400000;
    if (days < 6) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }
  function listTime(value, now = new Date()) {
    const d = new Date(value);
    if (sameDay(d, now)) return fmtTime(d);
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (sameDay(d, y)) return 'Yesterday';
    if ((now - d) / 86400000 < 6) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' });
  }
  function lastSeenLabel(value, now = new Date()) {
    if (!value) return '';
    const d = new Date(value), diff = (now - d) / 1000;
    if (diff < 60) return 'last seen just now';
    if (diff < 3600) return `last seen ${Math.floor(diff / 60)} min ago`;
    if (sameDay(d, now)) return `last seen today at ${fmtTime(d)}`;
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (sameDay(d, y)) return `last seen yesterday at ${fmtTime(d)}`;
    return `last seen ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${fmtTime(d)}`;
  }

  const fileExt = name => { const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
  const DOC_STYLES = {
    pdf: ['PDF', '#e11d48'], doc: ['DOC', '#2563eb'], docx: ['DOC', '#2563eb'], xls: ['XLS', '#16a34a'], xlsx: ['XLS', '#16a34a'],
    csv: ['CSV', '#16a34a'], ppt: ['PPT', '#ea580c'], pptx: ['PPT', '#ea580c'], zip: ['ZIP', '#7c3aed'], txt: ['TXT', '#64748b']
  };
  const docStyle = name => DOC_STYLES[fileExt(name)] || [(fileExt(name) || 'FILE').toUpperCase().slice(0, 4), '#475569'];

  /* Maps any stored attachment to one display kind. */
  function attKind(a) {
    if (!a) return 'file';
    if (a.kind === 'contact' || a.contact) return 'contact';
    if (a.kind === 'voice' || a.kind === 'video_note') return a.kind;
    const type = String(a.type || '').toLowerCase();
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';
    if (a.gif && a.url) return /\.(mp4|webm)(\?|$)/i.test(a.url) ? 'video' : 'image';
    return 'file';
  }

  /* One-line preview for the inbox / reply quotes. */
  function previewText(message) {
    if (!message) return '';
    if (message.deleted_at) return '🚫 This message was deleted';
    const att = (message.attachments || [])[0], extra = (message.attachments || []).length;
    const body = plain(message.body || '');
    if (att) {
      const label = {
        image: att.viewOnce ? '📷 View-once photo' : att.gif ? 'GIF' : '📷 Photo', video: att.viewOnce ? '🎥 View-once video' : '🎥 Video',
        voice: `🎤 Voice message${att.duration ? ` (${fmtDuration(att.duration)})` : ''}`, video_note: '⏺ Video message',
        audio: `🎵 ${att.name || 'Audio'}`, file: `📄 ${att.name || 'Document'}`, contact: '👤 Contact'
      }[attKind(att)];
      return body ? `${label} ${body}` : extra > 1 ? `${label} +${extra - 1}` : label;
    }
    return body;
  }

  const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });

  /* ---------- emoji ---------- */
  const raw = (name, icon, list) => ({
    name, icon, items: list.split(',').map(entry => { const i = entry.indexOf(' '); return [entry.slice(0, i), entry.slice(i + 1)]; })
  });
  const EMOJI = [
    raw('Smileys', '😀', '😀 grin happy,😃 smile happy,😄 smile laugh,😁 beam grin,😆 laugh squint,😅 sweat laugh,🤣 rofl lol,😂 joy tears lol,🙂 slight smile,🙃 upside down,😉 wink,😊 blush smile,😇 angel halo,🥰 love hearts face,😍 heart eyes love,🤩 star struck,😘 kiss,😗 kiss,😚 kiss,😙 kiss,😋 yum tasty,😛 tongue,😜 wink tongue,🤪 zany crazy,😝 tongue squint,🤑 money,🤗 hug,🤭 oops giggle,🤫 shush quiet,🤔 think,🤐 zipper,🤨 raised brow,😐 neutral,😑 expressionless,😶 silent,😏 smirk,😒 unamused,🙄 eye roll,😬 grimace,😮‍💨 exhale relief,🤥 lie,😌 relieved,😔 pensive sad,😪 sleepy,🤤 drool,😴 sleep,😷 mask sick,🤒 fever,🤕 hurt,🤢 nauseous,🤮 vomit,🥵 hot,🥶 cold,🥴 woozy,😵 dizzy,🤯 mind blown,🤠 cowboy,🥳 party,😎 cool sunglasses,🤓 nerd,🧐 monocle,😕 confused,😟 worried,🙁 frown,☹️ frown,😮 wow,😯 hushed,😲 astonished,😳 flushed,🥺 pleading,😦 frown,😧 anguish,😨 fear,😰 anxious,😥 sad relieved,😢 cry,😭 sob cry,😱 scream,😖 confounded,😣 persevere,😞 disappointed,😓 downcast sweat,😩 weary,😫 tired,🥱 yawn,😤 triumph,😡 angry,😠 mad,🤬 swearing,😈 devil,👿 imp,💀 skull,☠️ skull crossbones,💩 poop,🤡 clown,👻 ghost,👽 alien,🤖 robot,😺 cat smile,😸 cat grin,😹 cat joy,😻 cat love,🙈 see no evil,🙉 hear no evil,🙊 speak no evil'),
    raw('People', '👋', '👋 wave hello,🤚 raised hand,🖐️ hand,✋ stop high five,🖖 vulcan,👌 ok,🤌 pinched,🤏 pinch small,✌️ victory peace,🤞 crossed fingers luck,🤟 love you,🤘 rock,🤙 call me,👈 left,👉 right,👆 up,👇 down,☝️ point up,👍 thumbs up like yes,👎 thumbs down dislike no,✊ fist,👊 punch,🤛 fist left,🤜 fist right,👏 clap applause,🙌 raised hands celebrate,👐 open hands,🤲 palms up,🤝 handshake deal,🙏 pray thanks please,✍️ write,💅 nails,🤳 selfie,💪 muscle strong,🦾 mechanical arm,🧠 brain,👀 eyes look,👁️ eye,👅 tongue,👄 mouth lips,👶 baby,🧒 child,👦 boy,👧 girl,🧑 person,👨 man,👩 woman,🧓 older,👴 grandfather,👵 grandmother,🙋 raise hand,🤦 facepalm,🤷 shrug,💁 info,🙅 no,🙆 ok gesture,🙇 bow,💃 dance woman,🕺 dance man,🚶 walk,🏃 run,🧘 yoga meditate,🛌 bed,👪 family,🧑‍💻 developer coder,🧑‍🎓 student,🧑‍🍳 cook,🦸 hero,🦹 villain,🧙 wizard,🧛 vampire,🧜 mermaid,🧚 fairy'),
    raw('Hearts', '❤️', '❤️ red heart love,🧡 orange heart,💛 yellow heart,💚 green heart,💙 blue heart,💜 purple heart,🖤 black heart,🤍 white heart,🤎 brown heart,💔 broken heart,❣️ heart exclamation,💕 two hearts,💞 revolving hearts,💓 beating heart,💗 growing heart,💖 sparkling heart,💘 cupid arrow,💝 gift heart,💟 heart decoration,💋 kiss mark,💌 love letter,💯 hundred perfect,💢 anger,💥 boom collision,💫 dizzy star,💦 sweat drops,💨 dash wind,💬 speech bubble,💭 thought bubble,💤 zzz sleep,🔥 fire hot lit,✨ sparkles,⭐ star,🌟 glowing star,⚡ lightning,🎉 party popper tada,🎊 confetti,🎈 balloon,🎁 gift present,🏆 trophy win,🥇 gold medal,🥈 silver medal,🥉 bronze medal'),
    raw('Animals', '🐶', '🐶 dog,🐱 cat,🐭 mouse,🐹 hamster,🐰 rabbit,🦊 fox,🐻 bear,🐼 panda,🐨 koala,🐯 tiger,🦁 lion,🐮 cow,🐷 pig,🐸 frog,🐵 monkey,🐔 chicken,🐧 penguin,🐦 bird,🐤 chick,🦆 duck,🦅 eagle,🦉 owl,🦇 bat,🐺 wolf,🐗 boar,🐴 horse,🦄 unicorn,🐝 bee,🐛 bug,🦋 butterfly,🐌 snail,🐞 ladybug,🐜 ant,🦟 mosquito,🐢 turtle,🐍 snake,🦎 lizard,🐙 octopus,🦑 squid,🦐 shrimp,🦀 crab,🐠 fish,🐟 fish,🐬 dolphin,🐳 whale,🦈 shark,🐊 crocodile,🐅 tiger,🐆 leopard,🦓 zebra,🐘 elephant,🦒 giraffe,🐪 camel,🐑 sheep,🐐 goat,🐕 dog,🐈 cat,🌵 cactus,🌲 tree,🌳 tree,🌴 palm,🌱 seedling,🌿 herb,🍀 clover luck,🍁 maple leaf,🍂 fallen leaf,🌷 tulip,🌹 rose,🌻 sunflower,🌼 blossom,💐 bouquet,🌸 cherry blossom,🌈 rainbow,☀️ sun,🌙 moon,☁️ cloud,⛈️ storm,❄️ snow,☃️ snowman,🌊 wave ocean'),
    raw('Food', '🍕', '🍏 apple,🍎 apple,🍐 pear,🍊 orange,🍋 lemon,🍌 banana,🍉 watermelon,🍇 grapes,🍓 strawberry,🫐 blueberries,🍒 cherries,🍑 peach,🥭 mango,🍍 pineapple,🥥 coconut,🥝 kiwi,🍅 tomato,🥑 avocado,🥦 broccoli,🥕 carrot,🌽 corn,🌶️ chili,🥔 potato,🍞 bread,🥐 croissant,🧀 cheese,🥚 egg,🍳 cooking,🥞 pancakes,🥓 bacon,🍗 chicken leg,🍖 meat,🌭 hot dog,🍔 burger,🍟 fries,🍕 pizza,🥪 sandwich,🌮 taco,🌯 burrito,🥗 salad,🍝 pasta spaghetti,🍜 ramen noodles,🍲 stew,🍛 curry,🍣 sushi,🍤 shrimp,🍙 rice ball,🍚 rice,🥟 dumpling,🍦 ice cream,🍩 donut,🍪 cookie,🎂 birthday cake,🍰 cake,🍫 chocolate,🍬 candy,🍭 lollipop,🍯 honey,☕ coffee,🍵 tea,🥤 cup drink,🧃 juice,🍺 beer,🍻 cheers beers,🥂 champagne cheers,🍷 wine,🍸 cocktail,🥃 whisky'),
    raw('Activities', '⚽', '⚽ soccer football,🏀 basketball,🏈 american football,⚾ baseball,🎾 tennis,🏐 volleyball,🏉 rugby,🎱 pool 8 ball,🏓 ping pong,🏸 badminton,🥊 boxing,🥋 martial arts,⛳ golf,🏹 archery,🎣 fishing,🛹 skateboard,🏂 snowboard,🏄 surf,🏊 swim,🚴 cycling,🏋️ weights gym,🤸 gymnastics,🎮 video game,🕹️ joystick,🎲 dice,♟️ chess,🎯 darts target,🎳 bowling,🎬 movie clapper,🎤 microphone sing,🎧 headphones,🎼 music score,🎹 piano,🥁 drum,🎷 saxophone,🎸 guitar,🎺 trumpet,🎻 violin,🎨 art palette,📚 books,🍿 popcorn,🎭 theatre,🎪 circus'),
    raw('Travel', '✈️', '🚗 car,🚕 taxi,🚌 bus,🚎 trolley,🏎️ racing car,🚓 police car,🚑 ambulance,🚒 fire engine,🚚 truck,🚲 bicycle,🛵 scooter,🏍️ motorbike,🚂 train,🚆 train,🚇 metro,🚁 helicopter,✈️ airplane flight,🚀 rocket,🛸 ufo,🚢 ship,⛵ sailboat,⚓ anchor,🏠 house home,🏢 office building,🏥 hospital,🏫 school,🏰 castle,🗼 tower,🗽 statue of liberty,⛰️ mountain,🏔️ snow mountain,🏝️ island,🏖️ beach,🏕️ camping,🌅 sunrise,🌃 night city,🌉 bridge night,🗺️ map,🧭 compass,⏰ alarm clock,⌛ hourglass,🌍 earth globe,🌎 earth,🌏 earth asia'),
    raw('Objects', '💡', '⌚ watch,📱 phone mobile,💻 laptop,⌨️ keyboard,🖥️ desktop,🖨️ printer,📷 camera,📸 camera flash,📹 video camera,🎥 movie camera,📺 tv,📻 radio,🔋 battery,🔌 plug,💡 idea bulb,🔦 flashlight,💰 money bag,💵 dollar,💳 credit card,💎 gem diamond,🔧 wrench,🔨 hammer,🛠️ tools,🔒 lock,🔑 key,📦 package,✉️ envelope,📧 email,📝 memo note,📁 folder,📄 page,📊 chart,📌 pushpin,📎 paperclip,✂️ scissors,🗑️ trash,📅 calendar,📍 location pin,🔔 bell,🔕 bell off,📢 loudspeaker,🔍 search,🧪 test tube,💊 pill,🩺 stethoscope,🧸 teddy,🛒 cart,🎒 backpack,👓 glasses,🕶️ sunglasses,👑 crown,💍 ring,👗 dress,👟 sneaker,🧢 cap,☂️ umbrella'),
    raw('Symbols', '✅', '✅ check done yes,❌ cross no,❎ cross mark,❗ exclamation,❓ question,‼️ double exclamation,⚠️ warning,🚫 prohibited,⛔ no entry,♻️ recycle,✔️ check mark,➕ plus,➖ minus,➗ divide,✖️ multiply,♾️ infinity,💲 dollar sign,©️ copyright,®️ registered,™️ trademark,🔴 red circle,🟠 orange circle,🟡 yellow circle,🟢 green circle,🔵 blue circle,🟣 purple circle,⚫ black circle,⚪ white circle,🔺 triangle up,🔻 triangle down,🔶 diamond,⬆️ up,⬇️ down,⬅️ left,➡️ right,↩️ return,🔄 refresh,▶️ play,⏸️ pause,⏹️ stop,⏺️ record,🔊 volume,🔇 mute,🆗 ok,🆕 new,🆒 cool,🔝 top,🏁 finish flag,🚩 red flag,🏳️ white flag')
  ];
  const DEFAULT_QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  return {
    esc, render, plain, extractLinks, extractHashtags, emojiOnlyCount, safeHref,
    fmtBytes, fmtDuration, fmtTime, dayLabel, listTime, lastSeenLabel, sameDay,
    fileExt, docStyle, attKind, previewText, uuid, EMOJI, DEFAULT_QUICK
  };
});
