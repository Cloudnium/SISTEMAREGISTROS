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
const { registrarAuditoria } = require('../utils/auditoria');
const { db }  = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { usuarioActualFresco } = require('../utils/permisos');

// Se re-valida siempre contra la base de datos (no contra la sesión
// cacheada), igual que en Códigos de Autorización y Programación, para
// que un cambio de permiso del admin aplique de inmediato.
async function requireInventarioAutorizado(req, res, next) {
  const u = await usuarioActualFresco(req.session.user);
  if (u && ((u.rol === 'admin' || u.rol === 'desarrollador') || u.puede_gestionar_inventario === true)) return next();
  req.flash('error', 'No tienes permiso para registrar nuevos uniformes ni editar sus precios.');
  res.redirect('/inventario');
}

router.get('/', requireAuth, async (req, res) => {
  const [{ data: categorias }, { data: uniformes }, { data: personal }] = await Promise.all([
    db.select('inventario_categorias', 'select=id,clave,nombre,icono,orden,es_sistema,activo&activo=eq.true&order=orden.asc,nombre.asc'),
    db.select('inventario_uniformes', 'select=id,nombre,descripcion,precio,stock,activo&order=nombre.asc'),
    db.select('personal_tripulantes', 'select=id,nombres,apellidos,categoria,tipo,cargo&activo=eq.true&order=apellidos.asc')
  ]);

  const seccion = req.query.seccion || 'uniformes';
  const listaCategorias = categorias || [];
  const categoriaActiva = listaCategorias.find(c => c.clave === seccion) || listaCategorias[0] || null;

  let items = [];
  if (categoriaActiva && categoriaActiva.clave !== 'uniformes') {
    const { data } = await db.select('inventario_items',
      `select=id,nombre,descripcion,precio,stock,activo&categoria_id=eq.${categoriaActiva.id}&order=nombre.asc`);
    items = data || [];
  }

  res.render('inventario/index', {
    layout: 'main', title: 'Inventario',
    pageTitle: 'Inventario', pageSubtitle: 'Almacén por secciones: uniformes, repuestos y lo que se vaya agregando',
    categorias: listaCategorias,
    categoriaActiva,
    esUniformes: !categoriaActiva || categoriaActiva.clave === 'uniformes',
    uniformes: uniformes || [],
    items,
    personal: (personal || []).map(p => ({
      ...p, etiqueta: (p.nombres + ' ' + p.apellidos) + ' — ' + (p.categoria === 'tripulacion' ? p.tipo : (p.cargo || 'Admin.'))
    }))
  });
});

// ─── Crear nueva sección de almacén — SOLO autorizados ──
router.post('/categorias', requireAuth, requireInventarioAutorizado, async (req, res) => {
  const { nombre, icono } = req.body;
  if (!nombre || !nombre.trim()) {
    req.flash('error', 'Indica el nombre de la sección.');
    return res.redirect('/inventario');
  }
  const clave = nombre.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const { data: max } = await db.select('inventario_categorias', 'select=orden&order=orden.desc&limit=1');
  const siguienteOrden = (max && max[0] ? max[0].orden : 0) + 1;

  const { error } = await db.insert('inventario_categorias', {
    clave: clave || ('seccion-' + Date.now()),
    nombre: nombre.trim(),
    icono: icono && icono.trim() !== '' ? icono.trim() : 'package',
    orden: siguienteOrden,
    es_sistema: false,
    activo: true
  });
  if (error) req.flash('error', error.message.includes('duplicate') ? 'Ya existe una sección con ese nombre.' : ('Error al crear la sección: ' + error.message));
  else       req.flash('success', 'Sección creada.');
  res.redirect('/inventario?seccion=' + clave);
});

// ─── Editar sección (nombre/ícono) — SOLO autorizados ──
router.post('/categorias/:id/editar', requireAuth, requireInventarioAutorizado, async (req, res) => {
  const { nombre, icono } = req.body;
  const { error } = await db.update('inventario_categorias', `id=eq.${req.params.id}`, {
    nombre: nombre && nombre.trim() !== '' ? nombre.trim() : undefined,
    icono: icono && icono.trim() !== '' ? icono.trim() : undefined
  });
  if (error) req.flash('error', 'Error al actualizar la sección: ' + error.message);
  else       req.flash('success', 'Sección actualizada.');
  res.redirect('/inventario');
});

// ─── Eliminar sección — SOLO autorizados, no se puede borrar Uniformes ──
router.post('/categorias/:id/eliminar', requireAuth, requireInventarioAutorizado, async (req, res) => {
  const { data: filas } = await db.select('inventario_categorias', `select=es_sistema&id=eq.${req.params.id}&limit=1`);
  if (filas && filas[0] && filas[0].es_sistema) {
    req.flash('error', 'Esta sección es parte del sistema y no se puede eliminar.');
    return res.redirect('/inventario');
  }
  const { error } = await db.delete('inventario_categorias', `id=eq.${req.params.id}`);
  if (error) req.flash('error', 'Error al eliminar: ' + error.message);
  else       req.flash('success', 'Sección eliminada.');
  res.redirect('/inventario');
});

// ─── Crear ítem en una sección genérica — SOLO autorizados ──
router.post('/items', requireAuth, requireInventarioAutorizado, async (req, res) => {
  const { categoria_id, nombre, descripcion, precio, stock } = req.body;
  if (!categoria_id || !nombre || !nombre.trim()) {
    req.flash('error', 'Indica la sección y el nombre del ítem.');
    return res.redirect('/inventario');
  }
  const { data: cat } = await db.select('inventario_categorias', `select=clave&id=eq.${categoria_id}&limit=1`);
  const { error } = await db.insert('inventario_items', {
    categoria_id,
    nombre: nombre.trim(),
    descripcion: descripcion && descripcion.trim() !== '' ? descripcion.trim() : null,
    precio: precio && precio !== '' ? parseFloat(precio) : 0,
    stock: stock && stock !== '' ? parseInt(stock) : 0,
    activo: true, creado_en: new Date().toISOString()
  });
  if (error) req.flash('error', 'Error al registrar: ' + error.message);
  else       req.flash('success', 'Ítem registrado.');
  res.redirect('/inventario' + (cat && cat[0] ? '?seccion=' + cat[0].clave : ''));
});

// ─── Editar ítem genérico — SOLO autorizados ──
router.post('/items/:id/editar', requireAuth, requireInventarioAutorizado, async (req, res) => {
  const { nombre, descripcion, precio, activo } = req.body;
  if (!nombre || !nombre.trim()) {
    req.flash('error', 'Indica el nombre del ítem.');
    return res.redirect('/inventario');
  }
  const { error } = await db.update('inventario_items', `id=eq.${req.params.id}`, {
    nombre: nombre.trim(),
    descripcion: descripcion && descripcion.trim() !== '' ? descripcion.trim() : null,
    precio: precio && precio !== '' ? parseFloat(precio) : 0,
    activo: activo === 'on' || activo === true
  });
  if (error) req.flash('error', 'Error al actualizar: ' + error.message);
  else       req.flash('success', 'Ítem actualizado.');
  res.redirect('/inventario');
});

// ─── Ingreso/salida de stock de un ítem genérico — CUALQUIER usuario ──
router.post('/items/:id/movimiento', requireAuth, async (req, res) => {
  const { tipo, cantidad, notas } = req.body;
  const cant = parseInt(cantidad);
  if (!['ingreso', 'salida'].includes(tipo)) return res.status(400).json({ error: 'Tipo de movimiento inválido.' });
  if (!cant || cant <= 0) return res.status(400).json({ error: 'Ingresa una cantidad válida.' });

  const { error } = await db.rpc('mover_stock_item', {
    p_item_id: req.params.id, p_tipo: tipo, p_cantidad: cant,
    p_notas: notas && notas.trim() !== '' ? notas.trim() : null,
    p_usuario_id: req.session.user.id
  });
  if (error) {
    const msg = error.message.includes('STOCK_INSUFICIENTE') ? 'No hay stock suficiente para esa salida.' :
                error.message.includes('ITEM_NO_ENCONTRADO') ? 'Ítem no encontrado.' :
                'No se pudo registrar el movimiento: ' + error.message;
    return res.status(400).json({ error: msg });
  }
  res.json({ ok: true });
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
  const { personal_id, cantidad, observacion } = req.body;
  const cant = parseInt(cantidad);
  if (!personal_id) return res.status(400).json({ error: 'Selecciona a quién se le entrega.' });
  if (!cant || cant <= 0) return res.status(400).json({ error: 'Ingresa una cantidad válida.' });

  const { data, error } = await db.rpc('entregar_uniforme', {
    p_uniforme_id: req.params.id,
    p_personal_id: personal_id,
    p_cantidad: cant,
    p_observacion: observacion || null,
    p_usuario_id: req.session.user.id
  });
  if (error) {
    const msg = error.message.includes('STOCK_INSUFICIENTE') ? 'No hay stock suficiente para esa cantidad.' :
                error.message.includes('UNIFORME_NO_ENCONTRADO') ? 'Uniforme no encontrado.' :
                'No se pudo registrar la entrega: ' + error.message;
    return res.status(400).json({ error: msg });
  }
  await registrarAuditoria({
    usuario: req.session.user, accion: 'entregar_uniforme', entidad: 'uniforme',
    entidad_id: req.params.id, valor_nuevo: { personal_id, cantidad: cant, descuento_id: data }
  });
  res.json({ ok: true, descuento_id: data });
});

module.exports = router;
