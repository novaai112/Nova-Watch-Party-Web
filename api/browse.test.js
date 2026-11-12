'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const browse = require('./browse.js');

function videoElement(src, mimeType = '') {
  const source = {
    src,
    currentSrc: src,
    getAttribute(name) { return name === 'type' ? mimeType : name === 'src' ? src : null; }
  };
  return {
    tagName: 'VIDEO',
    currentSrc: src,
    src,
    poster: 'https://media.example/poster.jpg',
    querySelector() { return mimeType ? source : null; },
    getAttribute(name) { return name === 'title' ? 'Licensed video' : null; }
  };
}

function runBrowserScript(videos = []) {
  const documentListeners = {};
  const timers = [];
  const messages = [];
  class HTMLMediaElement { play() {} }
  class XMLHttpRequest { open() {} }
  const document = {
    title: 'Publisher video',
    documentElement: {},
    addEventListener(name, callback) {
      (documentListeners[name] ||= []).push(callback);
    },
    querySelector() { return null; },
    querySelectorAll(selector) { return selector === 'video' ? videos : []; }
  };
  const window = {
    parent: { postMessage(message) { messages.push(message); } },
    addEventListener() {}
  };
  const html = browse._getInjectedBrowserScript('https://publisher.example/watch', {
    title: 'Licensed video',
    thumbnail: '',
    streams: [{ url: 'https://media.example/movie.m3u8', type: 'hls' }]
  });
  const script = html.match(/^<script>([\s\S]*)<\/script>$/)[1];

  vm.runInNewContext(script, {
    window,
    document,
    URL,
    HTMLMediaElement,
    XMLHttpRequest,
    Date,
    setTimeout(callback) { timers.push(callback); return timers.length; }
  });
  return { documentListeners, timers, messages };
}

test('detects accessible video sources without prompting before playback', () => {
  const preExtracted = runBrowserScript();
  preExtracted.timers.forEach(callback => callback());
  assert.equal(preExtracted.messages.some(message => message.type === 'NOVA_WEB_VIDEO_PROMPT'), false);

  const harness = runBrowserScript([videoElement('https://media.example/movie.webm')]);
  harness.timers.forEach(callback => callback());

  assert.ok(harness.messages.some(message =>
    message.type === 'NOVA_WEB_VIDEO_DETECTED' && message.streamType === 'webm'));
  assert.equal(harness.messages.some(message => message.type === 'NOVA_WEB_VIDEO_PROMPT'), false);
});

test('prompts to add an HTTPS HLS video after the player is clicked', () => {
  const video = videoElement('https://media.example/movie.m3u8?token=sample');
  const harness = runBrowserScript();
  const click = harness.documentListeners.click[0];
  click({
    target: { closest() { return video; } },
    preventDefault() {},
    stopPropagation() {}
  });
  harness.timers[harness.timers.length - 1]();

  const prompt = harness.messages.find(message => message.type === 'NOVA_WEB_VIDEO_PROMPT');
  assert.ok(prompt);
  assert.equal(prompt.streamUrl, video.currentSrc);
  assert.equal(prompt.streamType, 'hls');
  assert.equal(prompt.title, 'Licensed video');
});

test('offers directly linked HTTPS video after the link is clicked', () => {
  const anchor = {
    textContent: 'Watch licensed video',
    getAttribute(name) {
      return name === 'href' ? 'https://media.example/movie.mp4?token=sample' : null;
    }
  };
  const harness = runBrowserScript();
  harness.documentListeners.click[1]({
    target: { closest(selector) { return selector === 'a[href]' ? anchor : null; } },
    preventDefault() {},
    stopPropagation() {}
  });

  const prompt = harness.messages.find(message => message.type === 'NOVA_WEB_VIDEO_PROMPT');
  assert.ok(prompt);
  assert.equal(prompt.streamUrl, 'https://media.example/movie.mp4?token=sample');
  assert.equal(prompt.streamType, 'mp4');
  assert.equal(prompt.title, 'Watch licensed video');
});

test('detects extensionless HLS sources from their declared media type', () => {
  const video = videoElement('https://media.example/stream?token=sample', 'application/vnd.apple.mpegurl');
  const harness = runBrowserScript();
  harness.documentListeners.click[0]({
    target: { closest() { return video; } },
    preventDefault() {},
    stopPropagation() {}
  });
  harness.timers[harness.timers.length - 1]();

  const prompt = harness.messages.find(message => message.type === 'NOVA_WEB_VIDEO_PROMPT');
  assert.ok(prompt);
  assert.equal(prompt.streamType, 'hls');
});

test('reports DASH streams as unsupported instead of offering a broken room player', () => {
  const harness = runBrowserScript([videoElement('https://media.example/movie.mpd')]);
  harness.timers.forEach(callback => callback());

  assert.ok(harness.messages.some(message => message.type === 'NOVA_WEB_VIDEO_UNSUPPORTED'));
  assert.equal(harness.messages.some(message => message.type === 'NOVA_WEB_VIDEO_PROMPT'), false);
});

test('does not forward insecure HTTP video sources to the room', () => {
  const harness = runBrowserScript([videoElement('http://media.example/movie.mp4')]);
  harness.timers.forEach(callback => callback());

  assert.equal(harness.messages.length, 0);
});
