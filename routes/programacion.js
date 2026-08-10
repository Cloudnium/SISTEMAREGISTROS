// =============================================
// routes/programacion.js — Programación de Salidas
// Vincula: destinos, servicios, buses, personal, agencias
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth, requireAdminToDelete } = require('../middleware/auth');
const { usuarioActualFresco } = require('../utils/permisos');

// Solo admin o usuarios con el permiso puede_programar (consultado
// fresco desde la BD, para que un cambio de permiso aplique de
// inmediato sin necesitar volver a iniciar sesión).
async function requireProgramacionAuth(req, res, next) {
  const u = await usuarioActualFresco(req.session.user);
  if (u.rol === 'admin' || u.puede_programar === true) {
    req.usuarioActual = u;
    return next();
  }
  req.flash('error', 'No tienes autorización para programar salidas de buses.');
  res.redirect('/dashboard');
}

// ─── Helper: carga todos los combos del formulario ───
async function cargarCombos() {
  const [destinos, servicios, buses, choferes, terramozas, ayudantes, agencias] = await Promise.all([
    db.select('destinos',
      'select=id,ciudad_origen,ciudad_destino,agencia_id,' +
      'ciudades_origen:ciudades!ciudad_origen(nombre),' +
      'ciudades_destino:ciudades!ciudad_destino(nombre)' +
      '&order=creado_en.asc'),
    db.select('servicios', 'select=id,nombre&activo=eq.true&order=nombre.asc'),
    db.select('buses',     'select=id,placa,marca,modelo&activo=eq.true&order=placa.asc'),
    db.select('personal_tripulantes',
      'select=id,nombres,apellidos,licencia&tipo=eq.Chofer&activo=eq.true&order=nombres.asc'),
    db.select('personal_tripulantes',
      'select=id,nombres,apellidos&tipo=eq.Terramoza&activo=eq.true&order=nombres.asc'),
    db.select('personal_tripulantes',
      'select=id,nombres,apellidos&tipo=eq.Ayudante&activo=eq.true&order=nombres.asc'),
    db.select('agencias', 'select=id,nombre,ciudad_id&activo=eq.true&order=nombre.asc'),
  ]);
  return {
    destinos:   destinos.data   || [],
    servicios:  servicios.data  || [],
    buses:      buses.data      || [],
    choferes:   choferes.data   || [],
    terramozas: terramozas.data || [],
    ayudantes:  ayudantes.data  || [],
    agencias:   agencias.data   || [],
  };
}

// ─── GET / — Lista de programaciones (con filtros) ──
router.get('/', requireAuth, requireProgramacionAuth, async (req, res) => {
  const { fecha, destino_id } = req.query;

  let query = 'select=id,fecha_salida,estado,precio_piso1,precio_piso2,creado_en,destino_id,' +
    'destinos(id,' +
      'ciudades_origen:ciudades!ciudad_origen(nombre),' +
      'ciudades_destino:ciudades!ciudad_destino(nombre)),' +
    'servicios(nombre),' +
    'buses(placa)' +
    '&order=fecha_salida.desc,creado_en.desc';

  if (fecha)      query += `&fecha_salida=eq.${fecha}`;
  if (destino_id) query += `&destino_id=eq.${destino_id}`;

  const { data: programaciones } = await db.select('programaciones', query);

  const { data: destinos } = await db.select('destinos',
    'select=id,ciudades_origen:ciudades!ciudad_origen(nombre),ciudades_destino:ciudades!ciudad_destino(nombre)&order=id.asc');

  res.render('programacion/index', {
    layout: 'main', title: 'Programación de Salidas',
    pageTitle: 'Programación de Salidas',
    pageSubtitle: 'Gestión de viajes programados',
    programaciones: programaciones || [],
    destinos: destinos || [],
    filtros: { fecha: fecha || '', destino_id: destino_id || '' }
  });
});

// ─── GET /nueva — Formulario de nueva programación ──
router.get('/nueva', requireAuth, requireProgramacionAuth, async (req, res) => {
  const combos = await cargarCombos();
  res.render('programacion/form', {
    layout: 'main', title: 'Nueva Programación',
    pageTitle: 'Nueva Programación de Salida',
    pageSubtitle: 'Asignación de recursos técnicos, humanos y comerciales',
    accion: 'nueva',
    prog: {},
    escalasByOrden: {},
    agenciasJson: JSON.stringify(combos.agencias),
    ...combos
  });
});

// ─── POST / — Crear programación (única o masiva por rango de fechas) ──
router.post('/', requireAuth, requireProgramacionAuth, async (req, res) => {
  const {
    fecha_salida, fecha_hasta, destino_id, servicio_id, bus_id,
    piloto_id, copiloto1_id, copiloto2_id, terramoza_id,
    precio_piso1, precio_piso2,
    // Escalas: agencia_1..6 y hora_1..6
    agencia_1, hora_1, agencia_2, hora_2, agencia_3, hora_3,
    agencia_4, hora_4, agencia_5, hora_5, agencia_6, hora_6
  } = req.body;

  if (!fecha_salida || !destino_id || !piloto_id) {
    req.flash('error', 'Fecha, Destino y Piloto son obligatorios.');
    return res.redirect('/programacion/nueva');
  }

  const toNum = v => v && v !== '' ? parseFloat(v) : null;
  const toOpt = v => v && v !== '' ? v : null;
  const escalasPairs = [
    [agencia_1, hora_1], [agencia_2, hora_2], [agencia_3, hora_3],
    [agencia_4, hora_4], [agencia_5, hora_5], [agencia_6, hora_6]
  ].filter(([agId]) => agId && agId !== '');

  // Arma la lista de fechas a programar: una sola, o cada día del rango
  // (incluyendo ambos extremos) si se indicó "fecha_hasta".
  const fechas = [fecha_salida];
  if (fecha_hasta && fecha_hasta > fecha_salida) {
    let cursor = new Date(fecha_salida + 'T00:00:00');
    const fin  = new Date(fecha_hasta + 'T00:00:00');
    fechas.length = 0;
    while (cursor <= fin) {
      fechas.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // Arma TODAS las filas de una sola vez y las inserta en bloque (2
  // peticiones en total, sin importar cuántas fechas sean) — antes se
  // insertaba una programación a la vez, y cada una con otra petición
  // aparte por cada escala, lo que hacía muy lento crear varias
  // fechas de golpe.
  const filasProgramaciones = fechas.map(fecha => ({
    fecha_salida: fecha, destino_id,
    servicio_id:  toOpt(servicio_id),
    bus_id:       toOpt(bus_id),
    piloto_id,
    copiloto1_id: toOpt(copiloto1_id),
    copiloto2_id: toOpt(copiloto2_id),
    terramoza_id: toOpt(terramoza_id),
    precio_piso1: toNum(precio_piso1),
    precio_piso2: toNum(precio_piso2),
    estado:       'publicado',
    creado_en:    new Date().toISOString()
  }));

  const { data: nuevasProgs, error: errorProgs } = await db.insert('programaciones', filasProgramaciones);

  let creadas = 0;
  const errores = [];

  if (errorProgs || !nuevasProgs) {
    errores.push(errorProgs ? errorProgs.message : 'Sin respuesta al crear las programaciones.');
  } else {
    const progsCreadas = Array.isArray(nuevasProgs) ? nuevasProgs : [nuevasProgs];
    creadas = progsCreadas.length;

    if (escalasPairs.length > 0 && progsCreadas.length > 0) {
      // Cada programación creada ya vuelve con su propio "id" en la
      // respuesta, así que no hace falta correlacionarla por fecha.
      const filasEscalas = [];
      progsCreadas.forEach(prog => {
        escalasPairs.forEach(([agId, hora], i) => {
          filasEscalas.push({
            programacion_id: prog.id,
            orden:           i + 1,
            agencia_id:      agId,
            hora:            hora && hora !== '' ? hora : null
          });
        });
      });
      const { error: errorEscalas } = await db.insert('programacion_escalas', filasEscalas);
      if (errorEscalas) errores.push('Escalas: ' + errorEscalas.message);
    }
  }

  if (creadas === 0) {
    req.flash('error', 'No se pudo crear ninguna programación: ' + errores.join(' | '));
    return res.redirect('/programacion/nueva');
  }

  if (fechas.length > 1) {
    let msg = `Se programaron ${creadas} de ${fechas.length} salidas (del ${fecha_salida} al ${fecha_hasta}).`;
    if (errores.length > 0) msg += ` Fallaron: ${errores.length}.`;
    req.flash('success', msg);
  } else {
    req.flash('success', 'Programación publicada correctamente.');
  }
  res.redirect('/programacion');
});

// ─── GET /:id/editar — Formulario de edición ──
router.get('/:id/editar', requireAuth, requireProgramacionAuth, async (req, res) => {
  const { data: progRows, error } = await db.select('programaciones',
    `select=*&id=eq.${req.params.id}&limit=1`);
  if (error || !progRows || progRows.length === 0) {
    req.flash('error', 'Programación no encontrada.');
    return res.redirect('/programacion');
  }
  const { data: escalas } = await db.select('programacion_escalas',
    `select=orden,agencia_id,hora&programacion_id=eq.${req.params.id}&order=orden.asc`);

  const escalasByOrden = {};
  (escalas || []).forEach(e => { escalasByOrden[e.orden] = e; });

  const combos = await cargarCombos();
  res.render('programacion/form', {
    layout: 'main', title: 'Editar Programación',
    pageTitle: 'Editar Programación de Salida',
    pageSubtitle: 'Modifica los recursos técnicos, humanos y comerciales',
    accion: 'editar',
    prog: progRows[0],
    escalasByOrden: escalasByOrden,
    agenciasJson: JSON.stringify(combos.agencias),
    ...combos
  });
});

// ─── POST /:id/editar — Actualiza una programación existente ──
router.post('/:id/editar', requireAuth, requireProgramacionAuth, async (req, res) => {
  const progId = req.params.id;
  const {
    fecha_salida, destino_id, servicio_id, bus_id,
    piloto_id, copiloto1_id, copiloto2_id, terramoza_id, ayudante_id,
    precio_piso1, precio_piso2,
    agencia_1, hora_1, agencia_2, hora_2, agencia_3, hora_3,
    agencia_4, hora_4, agencia_5, hora_5, agencia_6, hora_6
  } = req.body;

  if (!fecha_salida || !destino_id || !piloto_id) {
    req.flash('error', 'Fecha, Destino y Piloto son obligatorios.');
    return res.redirect(`/programacion/${progId}/editar`);
  }

  const toNum = v => v && v !== '' ? parseFloat(v) : null;
  const toOpt = v => v && v !== '' ? v : null;

  const { error } = await db.update('programaciones', `id=eq.${progId}`, {
    fecha_salida, destino_id,
    servicio_id:  toOpt(servicio_id),
    bus_id:       toOpt(bus_id),
    piloto_id,
    copiloto1_id: toOpt(copiloto1_id),
    copiloto2_id: toOpt(copiloto2_id),
    terramoza_id: toOpt(terramoza_id),
    ayudante_id:  toOpt(ayudante_id),
    precio_piso1: toNum(precio_piso1),
    precio_piso2: toNum(precio_piso2)
  });

  if (error) {
    req.flash('error', 'Error al actualizar: ' + error.message);
    return res.redirect(`/programacion/${progId}/editar`);
  }

  // Reemplaza las escalas: borra las anteriores y guarda las nuevas
  await db.delete('programacion_escalas', `programacion_id=eq.${progId}`);
  const escalasPairs = [
    [agencia_1, hora_1], [agencia_2, hora_2], [agencia_3, hora_3],
    [agencia_4, hora_4], [agencia_5, hora_5], [agencia_6, hora_6]
  ].filter(([agId]) => agId && agId !== '');
  for (let i = 0; i < escalasPairs.length; i++) {
    const [agId, hora] = escalasPairs[i];
    await db.insert('programacion_escalas', {
      programacion_id: progId, orden: i + 1, agencia_id: agId,
      hora: hora && hora !== '' ? hora : null
    });
  }

  req.flash('success', 'Programación actualizada correctamente.');
  res.redirect('/programacion');
});

// ─── POST /:id/descartar — Marca como descartado ──
router.post('/:id/descartar', requireAuth, requireProgramacionAuth, async (req, res) => {
  const { error } = await db.update('programaciones', `id=eq.${req.params.id}`,
    { estado: 'descartado' });
  if (error) req.flash('error', 'Error: ' + error.message);
  else       req.flash('success', 'Programación descartada.');
  res.redirect('/programacion');
});

// ─── POST /:id/eliminar — SOLO admin ─────────
router.post('/:id/eliminar', requireAuth, requireAdminToDelete, async (req, res) => {
  const { error } = await db.delete('programaciones', `id=eq.${req.params.id}`);
  if (error) req.flash('error', 'Error al eliminar: ' + error.message);
  else       req.flash('success', 'Programación eliminada.');
  res.redirect('/programacion');
});

module.exports = router;
