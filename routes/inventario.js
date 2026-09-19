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
const XLSX = require('xlsx');
const { registrarAuditoria } = require('../utils/auditoria');
const { db }  = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { usuarioActualFresco } = require('../utils/permisos');

// Catálogo de tipos de sección que se pueden crear desde "Nueva sección".
// "Uniformes" no aparece aquí porque ya existe como sección fija del
// sistema. Cuando definamos el formato de un tipo nuevo, se agrega una
// línea aquí (y su propio formulario/tabla si necesita campos propios).
const CATALOGO_TIPOS_SECCION = [
  { tipo: 'repuestos', nombre: 'Repuestos', icono: 'wrench' }
  // Próximos tipos se agregan aquí, ej:
  // { tipo: 'herramientas', nombre: 'Herramientas', icono: 'hammer' },
];

// Íconos seleccionables al crear o editar una sección (de lucide.dev/icons)
const ICONOS_DISPONIBLES = [
  'package', 'box', 'wrench', 'hammer', 'cog', 'shirt',
  'droplet', 'battery', 'zap', 'layers', 'archive', 'truck'
];

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
    db.select('inventario_categorias', 'select=id,clave,nombre,icono,tipo,orden,es_sistema,activo&activo=eq.true&order=orden.asc,nombre.asc'),
    db.select('inventario_uniformes', 'select=id,nombre,descripcion,precio,stock,activo&order=nombre.asc'),
    db.select('personal_tripulantes', 'select=id,nombres,apellidos,categoria,tipo,cargo&activo=eq.true&order=apellidos.asc')
  ]);

  const seccion = req.query.seccion || 'uniformes';
  const listaCategorias = categorias || [];
  const categoriaActiva = listaCategorias.find(c => c.clave === seccion) || listaCategorias[0] || null;
  const tiposYaCreados = new Set(listaCategorias.map(c => c.tipo));
  const tiposDisponibles = CATALOGO_TIPOS_SECCION.filter(t => !tiposYaCreados.has(t.tipo));

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
    tiposDisponibles,
    iconosDisponibles: ICONOS_DISPONIBLES,
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
  const { tipo, icono } = req.body;
  const catalogoEntry = CATALOGO_TIPOS_SECCION.find(t => t.tipo === tipo);
  if (!catalogoEntry) {
    req.flash('error', 'Selecciona un tipo de sección válido.');
    return res.redirect('/inventario');
  }
  const { data: yaExiste } = await db.select('inventario_categorias', `select=id&clave=eq.${catalogoEntry.tipo}&limit=1`);
  if (yaExiste && yaExiste.length) {
    req.flash('error', 'Esa sección ya existe.');
    return res.redirect('/inventario');
  }

  const iconoElegido = ICONOS_DISPONIBLES.includes(icono) ? icono : catalogoEntry.icono;
  const { data: max } = await db.select('inventario_categorias', 'select=orden&order=orden.desc&limit=1');
  const siguienteOrden = (max && max[0] ? max[0].orden : 0) + 1;

  const { error } = await db.insert('inventario_categorias', {
    clave: catalogoEntry.tipo,
    nombre: catalogoEntry.nombre,
    tipo: catalogoEntry.tipo,
    icono: iconoElegido,
    orden: siguienteOrden,
    es_sistema: false,
    activo: true
  });
  if (error) req.flash('error', error.message.includes('duplicate') ? 'Ya existe una sección con ese nombre.' : ('Error al crear la sección: ' + error.message));
  else       req.flash('success', 'Sección creada.');
  res.redirect('/inventario?seccion=' + catalogoEntry.tipo);
});

// ─── Editar sección (ícono) — SOLO autorizados ──
router.post('/categorias/:id/editar', requireAuth, requireInventarioAutorizado, async (req, res) => {
  const { icono } = req.body;
  if (!ICONOS_DISPONIBLES.includes(icono)) {
    req.flash('error', 'Selecciona un ícono válido.');
    return res.redirect('/inventario');
  }
  const { error } = await db.update('inventario_categorias', `id=eq.${req.params.id}`, { icono });
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

  const { data: filas } = await db.select('inventario_uniformes', `select=*&id=eq.${req.params.id}&limit=1`);
  const antes = filas && filas[0];
  if (!antes) { req.flash('error', 'Uniforme no encontrado.'); return res.redirect('/inventario'); }

  const nuevoPrecio = precio && precio !== '' ? parseFloat(precio) : 0;
  const nuevoActivo = activo === 'on' || activo === true;

  const { error } = await db.update('inventario_uniformes', `id=eq.${req.params.id}`, {
    nombre: nombre.trim(),
    descripcion: descripcion && descripcion.trim() !== '' ? descripcion.trim() : null,
    precio: nuevoPrecio,
    activo: nuevoActivo
  });
  if (error) { req.flash('error', 'Error al actualizar: ' + error.message); return res.redirect('/inventario'); }

  // Deja registrado en el historial qué cambió exactamente (si cambió algo)
  const cambios = [];
  if (antes.nombre !== nombre.trim()) cambios.push(`Nombre: "${antes.nombre}" → "${nombre.trim()}"`);
  if (Number(antes.precio) !== nuevoPrecio) cambios.push(`Precio: S/ ${Number(antes.precio).toFixed(2)} → S/ ${nuevoPrecio.toFixed(2)}`);
  if (antes.activo !== nuevoActivo) cambios.push(nuevoActivo ? 'Reactivado' : 'Desactivado');
  if (cambios.length) {
    await db.insert('inventario_uniformes_movimientos', {
      uniforme_id: req.params.id, tipo: 'modificacion', cantidad: 0, usuario_id: req.session.user.id,
      stock_anterior: antes.stock, stock_nuevo: antes.stock, motivo: cambios.join('; ')
    });
  }

  req.flash('success', 'Uniforme actualizado.');
  res.redirect('/inventario');
});

// ─── Aumentar stock — CUALQUIER usuario ──
router.post('/uniformes/:id/stock', requireAuth, async (req, res) => {
  const cantidad = parseInt(req.body.cantidad);
  if (!cantidad || cantidad <= 0) return res.status(400).json({ error: 'Ingresa una cantidad válida.' });

  const { data: filas } = await db.select('inventario_uniformes', `select=stock&id=eq.${req.params.id}&limit=1`);
  const actual = filas && filas[0];
  if (!actual) return res.status(404).json({ error: 'Uniforme no encontrado.' });

  const stockAnterior = actual.stock || 0;
  const stockNuevo = stockAnterior + cantidad;

  const { error } = await db.update('inventario_uniformes', `id=eq.${req.params.id}`, { stock: stockNuevo });
  if (error) return res.status(500).json({ error: error.message });

  const motivo = (req.body.motivo && req.body.motivo.trim()) || 'Ingreso de stock';
  await db.insert('inventario_uniformes_movimientos', {
    uniforme_id: req.params.id, tipo: 'ingreso', cantidad, usuario_id: req.session.user.id,
    stock_anterior: stockAnterior, stock_nuevo: stockNuevo, motivo
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

// ══════════════════════════════════════════
// HISTORIAL DE MOVIMIENTOS DE UNIFORMES
// Entradas (ingreso de stock), Salidas (entrega a trabajador) y
// Modificaciones (cambios de nombre/precio/estado), con el stock
// antes → después de cada movimiento puntual, quién lo hizo y cuándo.
// ══════════════════════════════════════════
async function obtenerHistorialUniformes(query) {
  const { desde, hasta, uniforme_id, tipo } = query;
  let filtro = 'select=id,tipo,cantidad,stock_anterior,stock_nuevo,motivo,observacion,creado_en,' +
    'uniforme:inventario_uniformes(nombre),usuario:usuarios(nombre)' +
    '&order=creado_en.desc&limit=1000';
  if (desde) filtro += `&creado_en=gte.${desde}T00:00:00`;
  if (hasta) filtro += `&creado_en=lte.${hasta}T23:59:59`;
  if (uniforme_id) filtro += `&uniforme_id=eq.${uniforme_id}`;
  if (tipo && tipo !== 'todos') filtro += `&tipo=eq.${tipo}`;

  const { data } = await db.select('inventario_uniformes_movimientos', filtro);
  const filas = data || [];

  const etiquetaTipo = { ingreso: 'Entrada', entrega: 'Salida', modificacion: 'Modificación' };
  const motivoPorDefecto = { ingreso: 'Ingreso de stock', entrega: 'Entrega a trabajador', modificacion: 'Modificación' };

  const movimientos = filas.map(m => {
    const f = new Date(m.creado_en);
    return {
      fecha: m.creado_en,
      fechaMostrar: f.toLocaleDateString('es-PE'),
      horaMostrar: f.toLocaleTimeString('es-PE'),
      producto: m.uniforme ? m.uniforme.nombre : '—',
      tipo: m.tipo,
      tipoMostrar: etiquetaTipo[m.tipo] || m.tipo,
      motivo: m.motivo || motivoPorDefecto[m.tipo] || '—',
      signoCantidad: m.tipo === 'entrega' ? -m.cantidad : (m.tipo === 'ingreso' ? m.cantidad : 0),
      stockAnterior: m.stock_anterior,
      stockNuevo: m.stock_nuevo,
      usuario: m.usuario ? m.usuario.nombre : '—'
    };
  });

  return {
    movimientos,
    totalMovimientos: movimientos.length,
    unidadesIngresadas: filas.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.cantidad || 0), 0),
    unidadesSalidas: filas.filter(m => m.tipo === 'entrega').reduce((s, m) => s + (m.cantidad || 0), 0)
  };
}

router.get('/uniformes/historial', requireAuth, async (req, res) => {
  const resultado = await obtenerHistorialUniformes(req.query);
  res.json(resultado);
});

router.get('/uniformes/historial/exportar.xlsx', requireAuth, async (req, res) => {
  const { movimientos, totalMovimientos, unidadesIngresadas, unidadesSalidas } = await obtenerHistorialUniformes(req.query);

  const wb = XLSX.utils.book_new();

  const wsResumen = XLSX.utils.aoa_to_sheet([
    ['Historial de Movimientos de Uniformes'],
    ['Generado el', new Date().toLocaleString('es-PE')],
    [],
    ['Total de movimientos', totalMovimientos],
    ['Unidades ingresadas', unidadesIngresadas],
    ['Unidades salidas', unidadesSalidas]
  ]);
  wsResumen['!cols'] = [{ wch: 26 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  const filasDetalle = [['Fecha', 'Hora', 'Producto', 'Tipo', 'Motivo', 'Cantidad', 'Stock anterior', 'Stock nuevo', 'Usuario']];
  movimientos.forEach(m => {
    filasDetalle.push([
      m.fechaMostrar, m.horaMostrar,
      m.producto, m.tipoMostrar, m.motivo, m.signoCantidad,
      m.stockAnterior != null ? m.stockAnterior : '', m.stockNuevo != null ? m.stockNuevo : '',
      m.usuario
    ]);
  });
  const wsDetalle = XLSX.utils.aoa_to_sheet(filasDetalle);
  wsDetalle['!cols'] = filasDetalle[0].map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, wsDetalle, 'Movimientos');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="historial-uniformes.xlsx"');
  res.send(buffer);
});

router.get('/uniformes/historial/imprimir', requireAuth, async (req, res) => {
  const resultado = await obtenerHistorialUniformes(req.query);
  res.render('inventario/historial-imprimir', {
    layout: false,
    ...resultado,
    filtros: req.query,
    fechaEmision: new Date().toLocaleString('es-PE')
  });
});

module.exports = router;
