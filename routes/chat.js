// =============================================
// routes/chat.js
// Chat interno tipo Facebook Messenger
// "Tiempo real" via polling corto (cada 3s desde el frontend)
// Estado en linea via heartbeat (ultima_actividad)
//
// Se considera "en linea" si ultima_actividad fue
// hace menos de UMBRAL_ONLINE_SEGUNDOS
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const UMBRAL_ONLINE_SEGUNDOS = 20; // si no manda heartbeat en 20s, se considera offline

// ─── Helper: fecha limite para considerar "en linea" ───
function fechaLimiteOnline() {
  return new Date(Date.now() - UMBRAL_ONLINE_SEGUNDOS * 1000).toISOString();
}

// ─── POST /chat/heartbeat — marca al usuario actual como activo ───
// El frontend llama esto cada ~10 segundos mientras la pagina esta abierta
router.post('/heartbeat', requireAuth, async (req, res) => {
  await db.update('usuarios', `id=eq.${req.session.user.id}`, {
    ultima_actividad: new Date().toISOString()
  });
  res.json({ ok: true });
});

// ─── GET /chat/contactos — lista de usuarios para chatear ───
// Incluye: nombre, si esta en linea, mensajes no leidos, ultimo mensaje
router.get('/contactos', requireAuth, async (req, res) => {
  const miId = req.session.user.id;

  // Todos los usuarios activos excepto yo mismo
  const { data: usuarios } = await db.select('usuarios',
    `select=id,nombre,username,rol,avatar,ultima_actividad&activo=eq.true&id=neq.${miId}&order=nombre.asc`);

  // Todos los mensajes donde participo (para sacar ultimo mensaje + no leidos)
  const { data: mensajes } = await db.select('chat_mensajes',
    `select=id,remitente_id,destinatario_id,contenido,leido,creado_en` +
    `&or=(remitente_id.eq.${miId},destinatario_id.eq.${miId})` +
    `&order=creado_en.desc`);

  const limiteOnline = fechaLimiteOnline();
  const lista = (usuarios || []).map(u => {
    // Filtra mensajes de esta conversacion especifica
    const conversacion = (mensajes || []).filter(m =>
      (m.remitente_id === u.id && m.destinatario_id === miId) ||
      (m.remitente_id === miId && m.destinatario_id === u.id)
    );
    const ultimoMensaje = conversacion[0] || null;
    const noLeidos = conversacion.filter(m =>
      m.destinatario_id === miId && m.remitente_id === u.id && !m.leido
    ).length;

    return {
      id: u.id,
      nombre: u.nombre,
      username: u.username,
      rol: u.rol,
      enLinea: !!(u.ultima_actividad && u.ultima_actividad > limiteOnline),
      ultimoMensaje: ultimoMensaje ? ultimoMensaje.contenido : null,
      ultimaFecha: ultimoMensaje ? ultimoMensaje.creado_en : null,
      noLeidos: noLeidos
    };
  });

  // Ordena: primero los que tienen mensajes recientes, luego alfabetico
  lista.sort((a, b) => {
    if (a.ultimaFecha && b.ultimaFecha) return new Date(b.ultimaFecha) - new Date(a.ultimaFecha);
    if (a.ultimaFecha) return -1;
    if (b.ultimaFecha) return 1;
    return a.nombre.localeCompare(b.nombre);
  });

  const totalNoLeidos = lista.reduce((sum, u) => sum + u.noLeidos, 0);

  res.json({ contactos: lista, totalNoLeidos });
});

// ─── GET /chat/conversacion/:userId — historial con un usuario ───
// Marca los mensajes recibidos como leidos al abrir
router.get('/conversacion/:userId', requireAuth, async (req, res) => {
  const miId = req.session.user.id;
  const otroId = req.params.userId;

  const { data: mensajes, error } = await db.select('chat_mensajes',
    `select=id,remitente_id,destinatario_id,contenido,leido,creado_en` +
    `&or=(and(remitente_id.eq.${miId},destinatario_id.eq.${otroId}),and(remitente_id.eq.${otroId},destinatario_id.eq.${miId}))` +
    `&order=creado_en.asc`);

  if (error) return res.status(500).json({ error: error.message });

  // Marca como leidos los mensajes que el otro usuario me envio
  const sinLeer = (mensajes || []).filter(m => m.destinatario_id === miId && !m.leido);
  if (sinLeer.length > 0) {
    await db.update('chat_mensajes',
      `destinatario_id=eq.${miId}&remitente_id=eq.${otroId}&leido=eq.false`,
      { leido: true });
  }

  res.json({ mensajes: mensajes || [] });
});

// ─── POST /chat/enviar — envia un mensaje nuevo ───
router.post('/enviar', requireAuth, async (req, res) => {
  const { destinatario_id, contenido } = req.body;

  if (!destinatario_id || !contenido || !contenido.trim()) {
    return res.status(400).json({ error: 'Falta destinatario o contenido.' });
  }

  const { data, error } = await db.insert('chat_mensajes', {
    remitente_id: req.session.user.id,
    destinatario_id: destinatario_id,
    contenido: contenido.trim().substring(0, 2000), // limite de seguridad
    leido: false,
    creado_en: new Date().toISOString()
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ mensaje: Array.isArray(data) ? data[0] : data });
});

module.exports = router;
