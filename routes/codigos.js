// =============================================
// routes/codigos.js — Códigos de Autorización
// Códigos que cambian el precio de venta de un asiento al monto que
// tengan asignado. Cualquier usuario autenticado puede USARLOS al
// vender; solo quienes tengan el permiso puede_crear_codigos (o sean
// admin) pueden CREARLOS o desactivarlos.
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { usuarioActualFresco } = require('../utils/permisos');

router.use(requireAuth);

function puedeCrear(u) { return u.rol === 'admin' || u.puede_crear_codigos === true; }

// La ventana de Códigos de Autorización (verla, crearlos, activarlos/
// desactivarlos) es SOLO para admin o usuarios con el permiso
// puede_crear_codigos. Cualquier otro usuario que intente entrar es
// redirigido — aunque pueda seguir USANDO los códigos al vender,
// desde la pantalla de Boletaje (GET /codigos/validar/:codigo, más
// abajo, que sí queda abierta a todos los autenticados).
async function requireAccesoCodigos(req, res, next) {
  const u = await usuarioActualFresco(req.session.user);
  if (!puedeCrear(u)) {
    req.flash('error', 'No tienes permiso para ver esta sección.');
    return res.redirect('/dashboard');
  }
  req.usuarioFresco = u;
  next();
}

// ─── GET / — Lista de códigos (SOLO admin / autorizados) ──
router.get('/', requireAccesoCodigos, async (req, res) => {
  const u = req.usuarioFresco;
  const { data: codigos, error } = await db.select('codigos_autorizacion',
    'select=id,codigo,monto,descripcion,activo,creado_en,creador:usuarios!creado_por(nombre)&order=creado_en.desc');
  if (error) console.error('codigos list:', error);
  res.render('codigos/index', {
    layout: 'main', title: 'Códigos de Autorización',
    pageTitle: 'Códigos de Autorización',
    pageSubtitle: 'Códigos que cambian el precio de venta de un asiento al monto asignado',
    codigos: codigos || [],
    puedeCrear: puedeCrear(u)
  });
});

// ─── POST / — Crea un código (requiere permiso) ──
router.post('/', async (req, res) => {
  const u = await usuarioActualFresco(req.session.user);
  if (!puedeCrear(u)) {
    req.flash('error', 'No tienes permiso para crear códigos de autorización.');
    return res.redirect('/codigos');
  }
  const { codigo, monto, descripcion } = req.body;
  if (!codigo || !codigo.trim() || monto === undefined || monto === '') {
    req.flash('error', 'El código y el monto son obligatorios.');
    return res.redirect('/codigos');
  }
  const { error } = await db.insert('codigos_autorizacion', {
    codigo:      codigo.trim().toUpperCase(),
    monto:       parseFloat(monto),
    descripcion: descripcion && descripcion.trim() !== '' ? descripcion.trim() : null,
    activo:      true,
    creado_por:  u.id,
    creado_en:   new Date().toISOString()
  });
  if (error) {
    req.flash('error', error.message.includes('duplicate') ? 'Ese código ya existe.' : ('Error al crear el código: ' + error.message));
    return res.redirect('/codigos');
  }
  req.flash('success', `Código "${codigo.trim().toUpperCase()}" creado correctamente.`);
  res.redirect('/codigos');
});

// ─── POST /:id/activo — Activa/desactiva un código (requiere permiso) ──
router.post('/:id/activo', async (req, res) => {
  const u = await usuarioActualFresco(req.session.user);
  if (!puedeCrear(u)) {
    req.flash('error', 'No tienes permiso para modificar códigos de autorización.');
    return res.redirect('/codigos');
  }
  const { activo } = req.body;
  const { error } = await db.update('codigos_autorizacion', `id=eq.${req.params.id}`, { activo: activo === 'true' });
  if (error) req.flash('error', 'Error al actualizar: ' + error.message);
  else req.flash('success', 'Código actualizado.');
  res.redirect('/codigos');
});

// ─── GET /validar/:codigo — Valida un código al vender (cualquier usuario) ──
// Nota: esta validación es solo para feedback inmediato en pantalla.
// El bloqueo real de "un solo uso" ocurre de forma atómica dentro de
// la función SQL registrar_venta_asiento (evita condiciones de carrera
// si dos personas intentan usar el mismo código al mismo tiempo).
router.get('/validar/:codigo', async (req, res) => {
  const codigo = String(req.params.codigo).trim().toUpperCase();
  const { data, error } = await db.select('codigos_autorizacion',
    `select=codigo,monto,descripcion,activo,usado&codigo=eq.${encodeURIComponent(codigo)}&limit=1`);
  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.length === 0) return res.status(404).json({ error: 'Código no válido.' });
  if (!data[0].activo) return res.status(404).json({ error: 'Código inactivo.' });
  if (data[0].usado) return res.status(409).json({ error: 'Este código ya fue usado en otro boleto.' });
  res.json({ ok: true, codigo: data[0].codigo, monto: data[0].monto, descripcion: data[0].descripcion });
});

module.exports = router;
