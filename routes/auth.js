// =============================================
// routes/auth.js — Autenticación completa
// =============================================
require('dotenv').config();
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const https    = require('https');
const { redirectIfAuth } = require('../middleware/auth');

// ─── Helper: consulta directa a Supabase REST API ───
// Evita cualquier problema con el SDK y allowlist
function supabaseQuery(path) {
  return new Promise((resolve, reject) => {
    const url  = process.env.SUPABASE_URL + '/rest/v1/' + path;
    const key  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    const opts = {
      headers: {
        'apikey':        key,
        'Authorization': 'Bearer ' + key,
        'Content-Type':  'application/json',
        'Accept':        'application/json'
      }
    };
    const parsedUrl = new URL(url);
    const reqOpts = {
      hostname: parsedUrl.hostname,
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   'GET',
      headers:  opts.headers
    };
    const req = https.request(reqOpts, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch(e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function supabasePatch(table, id, payload) {
  return new Promise((resolve, reject) => {
    const key  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    const body = JSON.stringify(payload);
    const parsedUrl = new URL(process.env.SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + id);
    const opts = {
      hostname: parsedUrl.hostname,
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   'PATCH',
      headers: {
        'apikey':         key,
        'Authorization':  'Bearer ' + key,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Prefer':         'return=minimal'
      }
    };
    const req = https.request(opts, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── GET / ───
router.get('/', (req, res) => {
  res.redirect(req.session && req.session.user ? '/dashboard' : '/login');
});

// ─── GET /login ───
router.get('/login', redirectIfAuth, (req, res) => {
  res.render('auth/login', { layout: 'auth', title: 'Iniciar Sesion' });
});

// ─── POST /login ───
router.post('/login', redirectIfAuth, async (req, res) => {
  const { identificador, password } = req.body;

  if (!identificador || !password) {
    req.flash('error', 'Completa todos los campos.');
    return res.redirect('/login');
  }

  try {
    const id = identificador.trim().toLowerCase();

    // Busca primero por username, luego por email
    let result = await supabaseQuery(
      `usuarios?select=*&username=ilike.${encodeURIComponent(id)}&activo=eq.true&limit=1`
    );

    let usuario = null;
    if (result.status === 200 && Array.isArray(result.data) && result.data.length > 0) {
      usuario = result.data[0];
    }

    // Si no encontró por username, busca por email
    if (!usuario) {
      result = await supabaseQuery(
        `usuarios?select=*&email=ilike.${encodeURIComponent(id)}&activo=eq.true&limit=1`
      );
      if (result.status === 200 && Array.isArray(result.data) && result.data.length > 0) {
        usuario = result.data[0];
      }
    }

    // Log para debug (quitar en producción)
    console.log('[LOGIN] Buscando:', id, '| Encontrado:', usuario ? usuario.username : 'ninguno');
    console.log('[LOGIN] Status Supabase:', result.status);
    if (!Array.isArray(result.data)) console.log('[LOGIN] Respuesta Supabase:', JSON.stringify(result.data));

    if (!usuario) {
      req.flash('error', 'Usuario o contrasena incorrectos.');
      return res.redirect('/login');
    }

    const passwordValida = await bcrypt.compare(password, usuario.password_hash);
    console.log('[LOGIN] Password valida:', passwordValida);

    if (!passwordValida) {
      req.flash('error', 'Usuario o contrasena incorrectos.');
      return res.redirect('/login');
    }

    req.session.user = {
      id:       usuario.id,
      nombre:   usuario.nombre,
      username: usuario.username,
      email:    usuario.email,
      rol:      usuario.rol,
      avatar:   usuario.avatar || null
    };

    // Actualiza último acceso
    supabasePatch('usuarios', usuario.id, { ultimo_acceso: new Date().toISOString() })
      .catch(e => console.error('Error actualizando ultimo_acceso:', e.message));

    req.flash('success', 'Bienvenido, ' + usuario.nombre);
    res.redirect('/dashboard');

  } catch (err) {
    console.error('[LOGIN] Error inesperado:', err);
    req.flash('error', 'Error del servidor: ' + err.message);
    res.redirect('/login');
  }
});

// ─── GET /logout ───
// cookie-session no tiene .destroy(); se limpia asignando null
// y eso hace que el navegador borre la cookie de sesion
router.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

module.exports = router;
