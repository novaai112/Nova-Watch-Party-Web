const tls = require('tls');

const untrustedCertificateCodes = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_UNTRUSTED'
]);

function configureSystemCa() {
  if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') return;

  const certificates = tls.getCACertificates('default').concat(tls.getCACertificates('system'));
  tls.setDefaultCACertificates(Array.from(new Set(certificates)));
}

function errorMessage(error, fallback) {
  let cause = error;
  while (cause && !untrustedCertificateCodes.has(cause.code) &&
         cause.code !== 'CERT_HAS_EXPIRED' && cause.code !== 'ERR_TLS_CERT_ALTNAME_INVALID') {
    cause = cause.cause;
  }
  if (cause && untrustedCertificateCodes.has(cause.code)) {
    return 'This website uses a certificate that is not trusted by the server. Install its issuing CA in the system trust store or configure NODE_EXTRA_CA_CERTS. Certificate verification remains enabled.';
  }
  if (cause && cause.code === 'CERT_HAS_EXPIRED') {
    return 'This website’s HTTPS certificate has expired. Its owner must renew it; Nova will not bypass certificate validation.';
  }
  if (cause && cause.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    return 'This website’s HTTPS certificate does not match its hostname. Nova will not bypass certificate validation.';
  }
  return error && error.message ? error.message : fallback;
}

module.exports = { configureSystemCa, errorMessage };
