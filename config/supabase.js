// =============================================
// config/supabase.js
// Cliente Supabase + helper REST nativo
// El SDK queda como fallback; las rutas críticas
// usan supabaseREST() que va por https nativo
// =============================================
require('dotenv').config();
const https = require('https');

// ─── Intenta cargar el SDK (puede fallar con allowlist) ───
let supabase = null, supabaseAdmin = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  supabase      = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
} catch(e) {
  console.warn('SDK Supabase no disponible, usando REST nativo:', e.message);
}

// ─── Helper REST nativo (bypasa restricciones de host) ───
function rest(method, table, query, body) {
  return new Promise((resolve, reject) => {
    const key     = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    const baseUrl = process.env.SUPABASE_URL + '/rest/v1/' + table;
    const fullUrl = query ? baseUrl + '?' + query : baseUrl;
    const parsed  = new URL(fullUrl);
    const bodyStr = body ? JSON.stringify(body) : null;

    const opts = {
      hostname: parsed.hostname,
      port:     443,
      path:     parsed.pathname + parsed.search,
      method:   method,
      headers: {
        'apikey':        key,
        'Authorization': 'Bearer ' + key,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Prefer':        method === 'POST' ? 'return=representation' : 'return=minimal'
      }
    };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ data: parsed, error: null });
        } else {
          resolve({ data: null, error: { message: typeof parsed === 'object' ? (parsed.message || JSON.stringify(parsed)) : data, code: res.statusCode } });
        }
      });
    });
    req.on('error', e => resolve({ data: null, error: { message: e.message } }));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── API pública del helper ───
const db = {
  // SELECT — ej: db.select('usuarios', 'username=ilike.admin&activo=eq.true&limit=1')
  select: (table, query) => rest('GET', table, query),
  // INSERT
  insert: (table, body) => rest('POST', table, null, Array.isArray(body) ? body : [body]),
  // UPDATE — ej: db.update('usuarios', 'id=eq.UUID', { activo: false })
  update: (table, query, body) => rest('PATCH', table, query, body),
  // DELETE
  delete: (table, query) => rest('DELETE', table, query),
};

module.exports = { supabase, supabaseAdmin, db };
