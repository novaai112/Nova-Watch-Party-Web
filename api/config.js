function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

module.exports = (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(res, 405, 'throw new Error("Method not allowed");');
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  let validUrl = false;

  try {
    const parsedUrl = new URL(supabaseUrl);
    validUrl = parsedUrl.protocol === 'https:' && !parsedUrl.username && !parsedUrl.password;
  } catch (error) {
    validUrl = false;
  }

  const configured = validUrl && Boolean(supabaseAnonKey);
  const publicConfig = {
    SUPABASE_URL: configured ? supabaseUrl : '',
    SUPABASE_ANON_KEY: configured ? supabaseAnonKey : '',
    CONFIG_ERROR: configured
      ? ''
      : 'Set valid SUPABASE_URL and SUPABASE_ANON_KEY environment variables, then redeploy.'
  };

  const script = `Object.assign(window.APP_CONFIG || (window.APP_CONFIG = {}), ${JSON.stringify(publicConfig)});`;
  return send(res, 200, req.method === 'HEAD' ? '' : script);
};
