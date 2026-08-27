// =============================================
// routes/inventario.js — Inventario (sección Uniformes)
//
// - Crear tipos de uniforme y su precio: SOLO usuarios autorizados
//   (admin o puede_gestionar_inventario).
// - Aumentar stock y entregar a personal: CUALQUIER usuario.
// - Cada entrega descuenta el stock y genera automáticamente un
//   descuento en la Planilla del trabajador (función SQL
//   entregar_uniforme, atómica).
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

function requireInventarioAutorizado(req, res, next) {
  const u = req.session.user;
  if (u && ((u.rol === 'admin' || u.rol === 'desarrollador') || u.puede_gestionar_inventario === true)) return next();
  req.flash('error', 'No tienes permiso para registrar nuevos uniformes ni editar sus precios.');
  res.redirect('/inventario');
}

router.get('/', requireAuth, async (req, res) => {
  const [{ data: uniformes }, { data: personal }] = await Promise.all([
    db.select('inventario_uniformes', 'select=id,nombre,descripcion,precio,stock,activo&order=nombre.asc'),
    db.select('personal_tripulantes', 'select=id,nombres,apellidos,categoria,tipo,cargo&activo=eq.true&order=apellidos.asc')
  ]);

  res.render('inventario/index', {
    layout: 'main', title: 'Inventario',
    pageTitle: 'Inventario', pageSubtitle: 'Uniformes: stock y entregas al personal',
    uniformes: uniformes || [],
    personal: (personal || []).map(p => ({
      ...p, etiqueta: (p.nombres + ' ' + p.apellidos) + ' — ' + (p.categoria === 'tripulacion' ? p.tipo : (p.cargo || 'Admin.'))
    }))
  });
});

// ─── Crear tipo de uniforme — SOLO autorizados ──
router.post('/uniformes', requireAuth, requireInventarioAutorizado, async (req, res) => {
  const { nombre, descripcion, precio, stock } = req.body;
  if (!nombre || !nombre.trim()) {
    req.flash('error', 'Indica el nombre del uniforme (ej. talla y prenda).');
    return res.redirect('/inventario');
  }
  const { error } = await db.insert('inventario_uniformes', {
    nombre: nombre.trim(),
    descripcion: descripcion && descripcion.trim() !== '' ? descripcion.trim() : null,
    precio: precio && precio !== '' ? parseFloat(precio) : 0,
    stock: stock && stock !== '' ? parseInt(stock) : 0,
    activo: true, creado_en: new Date().toISOString()
  });
  if (error) req.flash('error', 'Error al registrar: ' + error.message);
  else       req.flash('success', 'Uniforme registrado en el catálogo.');
  res.redirect('/inventario');
});

// ─── Editar precio/nombre — SOLO autorizados ──
router.post('/uniformes/:id/editar', requireAuth, requireInventarioAutorizado, async (req, res) => {
  const { nombre, descripcion, precio, activo } = req.body;
  if (!nombre || !nombre.trim()) {
    req.flash('error', 'Indica el nombre del uniforme.');
    return res.redirect('/inventario');
  }
  const { error } = await db.update('inventario_uniformes', `id=eq.${req.params.id}`, {
    nombre: nombre.trim(),
    descripcion: descripcion && descripcion.trim() !== '' ? descripcion.trim() : null,
    precio: precio && precio !== '' ? parseFloat(precio) : 0,
    activo: activo === 'on' || activo === true
  });
  if (error) req.flash('error', 'Error al actualizar: ' + error.message);
  else       req.flash('success', 'Uniforme actualizado.');
  res.redirect('/inventario');
});

// ─── Aumentar stock — CUALQUIER usuario ──
router.post('/uniformes/:id/stock', requireAuth, async (req, res) => {
  const cantidad = parseInt(req.body.cantidad);
  if (!cantidad || cantidad <= 0) return res.status(400).json({ error: 'Ingresa una cantidad válida.' });

  const { data: filas } = await db.select('inventario_uniformes', `select=stock&id=eq.${req.params.id}&limit=1`);
  const actual = filas && filas[0];
  if (!actual) return res.status(404).json({ error: 'Uniforme no encontrado.' });

  const { error } = await db.update('inventario_uniformes', `id=eq.${req.params.id}`, {
    stock: (actual.stock || 0) + cantidad
  });
  if (error) return res.status(500).json({ error: error.message });

  await db.insert('inventario_uniformes_movimientos', {
    uniforme_id: req.params.id, tipo: 'ingreso', cantidad, usuario_id: req.session.user.id
  });

  res.json({ ok: true });
});

// ─── Entregar a personal — CUALQUIER usuario (genera descuento de planilla) ──
router.post('/uniformes/:id/entregar', requireAuth, async (req, res) => {
  const { personal_id, cantidad } = req.body;
  const cant = parseInt(cantidad);
  if (!personal_id) return res.status(400).json({ error: 'Selecciona a quién se le entrega.' });
  if (!cant || cant <= 0) return res.status(400).json({ error: 'Ingresa una cantidad válida.' });

  const { data, error } = await db.rpc('entregar_uniforme', {
    p_uniforme_id: req.params.id,
    p_personal_id: personal_id,
    p_cantidad: cant,
    p_usuario_id: req.session.user.id
  });
  if (error) {
    const msg = error.message.includes('STOCK_INSUFICIENTE') ? 'No hay stock suficiente para esa cantidad.' :
                error.message.includes('UNIFORME_NO_ENCONTRADO') ? 'Uniforme no encontrado.' :
                'No se pudo registrar la entrega: ' + error.message;
    return res.status(400).json({ error: msg });
  }
  res.json({ ok: true });
});

module.exports = router;
