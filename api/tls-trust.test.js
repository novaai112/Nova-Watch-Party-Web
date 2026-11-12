const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const tls = require('node:tls');
const { configureSystemCa, errorMessage } = require('../tls-trust');

test('adds system roots without dropping Node trusted roots', (t) => {
  if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') {
    t.skip('System CA merging is not supported by this Node version.');
    return;
  }

  const defaultRoots = tls.getCACertificates('default');
  const systemRoots = tls.getCACertificates('system');
  configureSystemCa();
  const fingerprint = (certificate) => new crypto.X509Certificate(certificate).fingerprint256;
  const trusted = new Set(tls.getCACertificates('default').map(fingerprint));
  assert.ok(defaultRoots.every((certificate) => trusted.has(fingerprint(certificate))));
  assert.ok(systemRoots.every((certificate) => trusted.has(fingerprint(certificate))));
});

test('explains untrusted certificate errors without suggesting a TLS bypass', () => {
  const message = errorMessage({ cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } }, 'fallback');
  assert.match(message, /NODE_EXTRA_CA_CERTS/);
  assert.match(message, /verification remains enabled/);
});
