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
  const [destinos, servicios, buses, choferes, tripulacion, agencias] = await Promise.all([
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
      'select=id,nombres,apellidos,tipo&activo=eq.true' +
      '&or=(tipo.eq.Terramoza,tipo.eq.Ayudante)&order=nombres.asc'),
    db.select('agencias', 'select=id,nombre,ciudad_id&activo=eq.true&order=nombre.asc'),
  ]);
  return {
    destinos:   destinos.data   || [],
    servicios:  servicios.data  || [],
    buses:      buses.data      || [],
    choferes:   choferes.data   || [],
    tripulacion: tripulacion.data || [],
    agencias:   agencias.data   || [],
  };
}

// ─── GET / — Lista de programaciones ─────────
router.get('/', requireAuth, requireProgramacionAuth, async (req, res) => {
  const { data: programaciones } = await db.select('programaciones',
    'select=id,fecha_salida,estado,precio_piso1,precio_piso2,creado_en,' +
    'destinos(id,' +
      'ciudades_origen:ciudades!ciudad_origen(nombre),' +
      'ciudades_destino:ciudades!ciudad_destino(nombre)),' +
    'servicios(nombre),' +
    'buses(placa)' +
    '&order=fecha_salida.desc,creado_en.desc');

  res.render('programacion/index', {
    layout: 'main', title: 'Programación de Salidas',
    pageTitle: 'Programación de Salidas',
    pageSubtitle: 'Gestión de viajes programados',
    programaciones: programaciones || []
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
    escalas: [],
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

  let creadas = 0;
  const errores = [];

  for (const fecha of fechas) {
    const { data: nuevaProg, error } = await db.insert('programaciones', {
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
    });

    if (error) { errores.push(fecha + ': ' + error.message); continue; }

    const progId = Array.isArray(nuevaProg) ? nuevaProg[0].id : nuevaProg.id;
    for (let i = 0; i < escalasPairs.length; i++) {
      const [agId, hora] = escalasPairs[i];
      await db.insert('programacion_escalas', {
        programacion_id: progId,
        orden:           i + 1,
        agencia_id:      agId,
        hora:            hora && hora !== '' ? hora : null
      });
    }
    creadas++;
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
