// =============================================
// routes/boletaje.js — Boletaje e Itinerarios
// Muestra programaciones filtradas por fecha y destino
// con sus escalas, tarifas, bus y servicio
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const { fecha, destino_id } = req.query;

  // Siempre carga la lista de destinos para el filtro
  const { data: destinos } = await db.select('destinos',
    'select=id,ciudad_origen,ciudad_destino,' +
    'ciudades_origen:ciudades!ciudad_origen(nombre),' +
    'ciudades_destino:ciudades!ciudad_destino(nombre)' +
    '&order=creado_en.asc');

  let salidas = [];

  // Solo busca si se proporcionó al menos la fecha
  if (fecha) {
    let query =
      'select=id,fecha_salida,precio_piso1,precio_piso2,' +
      'servicios(nombre,icono,categoria),' +
      'buses(placa,total_asientos),' +
      'destinos(id,' +
        'ciudades_origen:ciudades!ciudad_origen(nombre),' +
        'ciudades_destino:ciudades!ciudad_destino(nombre))' +
      `&fecha_salida=eq.${fecha}` +
      '&estado=eq.publicado' +
      '&order=creado_en.asc';

    if (destino_id && destino_id !== '') {
      query += `&destino_id=eq.${destino_id}`;
    }

    const { data: programaciones, error } = await db.select('programaciones', query);
    if (error) console.error('Error boletaje:', error.message);

    // Para cada programación, carga sus escalas
    const lista = programaciones || [];
    for (const prog of lista) {
      const { data: escalas } = await db.select('programacion_escalas',
        `select=orden,hora,agencias(nombre)&programacion_id=eq.${prog.id}&order=orden.asc`);
      prog.escalas = escalas || [];
    }
    salidas = lista;
  }

  res.render('boletaje/index', {
    layout: 'main',
    title: 'Boletaje e Itinerarios',
    pageTitle: 'Boletaje e Itinerarios',
    pageSubtitle: 'Vista general de salidas, rutas y control de ventas en tiempo real',
    destinos:   destinos  || [],
    salidas:    salidas,
    // Valores actuales de los filtros para repoblar el form
    filtroFecha:    fecha      || '',
    filtroDestino:  destino_id || '',
    buscado: !!fecha
  });
});

module.exports = router;
