// =============================================
// routes/chat.js — Chat completo
// ─ Mensajes 1-a-1 con checks de visto
// ─ Grupos con miembros y mensajes
// ─ Emojis (solo frontend, no necesita backend)
// ─ Estado en línea via heartbeat
// =============================================
const express = require('express');
const router  = express.Router();
const { db }  = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const ONLINE_SEG = 20; // segundos para considerar "en línea"
const fechaOnline = () => new Date(Date.now() - ONLINE_SEG * 1000).toISOString();

// ══════════════════════════════════════════
// HEARTBEAT — marca usuario como activo
// ══════════════════════════════════════════
router.post('/heartbeat', requireAuth, async (req, res) => {
  await db.update('usuarios', `id=eq.${req.session.user.id}`, {
    ultima_actividad: new Date().toISOString()
  });
  res.json({ ok: true });
});

// ══════════════════════════════════════════
// CONTACTOS — lista de usuarios + grupos
// ══════════════════════════════════════════
router.get('/contactos', requireAuth, async (req, res) => {
  const miId = req.session.user.id;

  // Todos los usuarios excepto yo
  const { data: usuarios } = await db.select('usuarios',
    `select=id,nombre,username,rol,ultima_actividad&activo=eq.true&id=neq.${miId}&order=nombre.asc`);

  // Mensajes 1-a-1 donde participo
  const { data: mensajes1a1 } = await db.select('chat_mensajes',
    `select=id,remitente_id,destinatario_id,contenido,leido,creado_en` +
    `&or=(remitente_id.eq.${miId},destinatario_id.eq.${miId})` +
    `&order=creado_en.desc`);

  // Grupos donde soy miembro
  const { data: misGrupos } = await db.select('chat_grupo_miembros',
    `select=grupo_id,chat_grupos(id,nombre,creado_por,creado_en)&usuario_id=eq.${miId}`);

  const limite = fechaOnline();

  // ── Construye lista de contactos 1-a-1 ──
  const contactos = (usuarios || []).map(u => {
    const conv = (mensajes1a1 || []).filter(m =>
      (m.remitente_id === u.id && m.destinatario_id === miId) ||
      (m.remitente_id === miId && m.destinatario_id === u.id)
    );
    const ultimo = conv[0] || null;
    const noLeidos = conv.filter(m =>
      m.destinatario_id === miId && m.remitente_id === u.id && !m.leido
    ).length;
    return {
      tipo: 'usuario',
      id: u.id,
      nombre: u.nombre,
      username: u.username,
      enLinea: !!(u.ultima_actividad && u.ultima_actividad > limite),
      ultimoMensaje: ultimo ? ultimo.contenido : null,
      ultimaFecha:   ultimo ? ultimo.creado_en : null,
      noLeidos
    };
  });

  // ── Construye lista de grupos ──
  const grupos = (misGrupos || []).map(mg => {
    const g = mg.chat_grupos;
    if (!g) return null;
    return {
      tipo: 'grupo',
      id: g.id,
      nombre: g.nombre,
      creadoPor: g.creado_por,
      enLinea: false,
      ultimoMensaje: null,
      ultimaFecha: null,
      noLeidos: 0
    };
  }).filter(Boolean);

  // Si hay grupos, traemos su ultimo mensaje y no leidos
  //
  // IMPORTANTE: antes esto comparaba fechas directamente en la URL
  // (creado_en=gt.2026-01-01T00:00:00+00:00), pero el simbolo "+"
  // en una URL se interpreta como espacio y corrompe la fecha,
  // haciendo que la consulta fallara en silencio y el contador
  // de no leidos siempre diera 0. Ahora se traen todos los mensajes
  // del grupo y se comparan las fechas como objetos Date en JS,
  // igual que ya se hace en los chats 1-a-1 (que si funcionaban bien).
  if (grupos.length > 0) {
    for (const g of grupos) {
      const { data: msgs } = await db.select('chat_grupo_mensajes',
        `select=id,contenido,creado_en,remitente_id&grupo_id=eq.${g.id}&order=creado_en.desc`);
      const { data: lectura } = await db.select('chat_grupo_lecturas',
        `select=ultimo_leido_en&grupo_id=eq.${g.id}&usuario_id=eq.${miId}&limit=1`);

      if (msgs && msgs.length > 0) {
        g.ultimoMensaje = msgs[0].contenido;
        g.ultimaFecha   = msgs[0].creado_en;

        const desdeMs = (lectura && lectura[0])
          ? new Date(lectura[0].ultimo_leido_en).getTime()
          : 0; // si nunca leyo, todos los mensajes de otros cuentan

        g.noLeidos = msgs.filter(m =>
          m.remitente_id !== miId && new Date(m.creado_en).getTime() > desdeMs
        ).length;
      }
    }
  }

  // Mezcla y ordena: primero los que tienen mensajes recientes
  const todos = [...contactos, ...grupos].sort((a, b) => {
    if (a.ultimaFecha && b.ultimaFecha) return new Date(b.ultimaFecha) - new Date(a.ultimaFecha);
    if (a.ultimaFecha) return -1;
    if (b.ultimaFecha) return 1;
    return a.nombre.localeCompare(b.nombre);
  });

  const totalNoLeidos = todos.reduce((s, c) => s + (c.noLeidos || 0), 0);
  res.json({ contactos: todos, totalNoLeidos });
});

// ══════════════════════════════════════════
// CONVERSACIÓN 1-A-1
// ══════════════════════════════════════════
router.get('/conversacion/:userId', requireAuth, async (req, res) => {
  const miId   = req.session.user.id;
  const otroId = req.params.userId;
  const { data: mensajes, error } = await db.select('chat_mensajes',
    `select=id,remitente_id,destinatario_id,contenido,leido,creado_en` +
    `&or=(and(remitente_id.eq.${miId},destinatario_id.eq.${otroId}),and(remitente_id.eq.${otroId},destinatario_id.eq.${miId}))` +
    `&order=creado_en.asc`);
  if (error) return res.status(500).json({ error: error.message });
  // Marca como leídos
  await db.update('chat_mensajes',
    `destinatario_id=eq.${miId}&remitente_id=eq.${otroId}&leido=eq.false`,
    { leido: true });
  res.json({ mensajes: mensajes || [] });
});

// ══════════════════════════════════════════
// ENVIAR MENSAJE 1-A-1
// ══════════════════════════════════════════
router.post('/enviar', requireAuth, async (req, res) => {
  const { destinatario_id, contenido } = req.body;
  if (!destinatario_id || !contenido || !contenido.trim())
    return res.status(400).json({ error: 'Faltan datos.' });
  const { data, error } = await db.insert('chat_mensajes', {
    remitente_id:    req.session.user.id,
    destinatario_id: destinatario_id,
    contenido:       contenido.trim().substring(0, 2000),
    leido:           false,
    creado_en:       new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ══════════════════════════════════════════
// GRUPOS — CRUD
// ══════════════════════════════════════════

// Lista todos los usuarios disponibles para agregar al grupo
router.get('/usuarios-disponibles', requireAuth, async (req, res) => {
  const miId = req.session.user.id;
  const { data } = await db.select('usuarios',
    `select=id,nombre,username&activo=eq.true&id=neq.${miId}&order=nombre.asc`);
  res.json({ usuarios: data || [] });
});

// Crea un nuevo grupo
router.post('/grupos/crear', requireAuth, async (req, res) => {
  const { nombre, miembros } = req.body;
  const miId = req.session.user.id;
  if (!nombre || !nombre.trim())
    return res.status(400).json({ error: 'El nombre del grupo es obligatorio.' });
  if (!miembros || miembros.length === 0)
    return res.status(400).json({ error: 'Agrega al menos un miembro.' });

  // Crea el grupo
  const { data: grupo, error } = await db.insert('chat_grupos', {
    nombre:     nombre.trim(),
    creado_por: miId,
    creado_en:  new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  const nuevoGrupo = Array.isArray(grupo) ? grupo[0] : grupo;
  if (!nuevoGrupo) return res.status(500).json({ error: 'No se pudo crear el grupo.' });

  // Agrega al creador + miembros seleccionados
  const todos = [...new Set([miId, ...miembros])];
  for (const uid of todos) {
    await db.insert('chat_grupo_miembros', {
      grupo_id:   nuevoGrupo.id,
      usuario_id: uid,
      unido_en:   new Date().toISOString()
    });
  }
  res.json({ ok: true, grupo: nuevoGrupo });
});

// Detalle de un grupo (miembros + info)
router.get('/grupos/:grupoId', requireAuth, async (req, res) => {
  const miId    = req.session.user.id;
  const grupoId = req.params.grupoId;

  const { data: grupo } = await db.select('chat_grupos',
    `select=id,nombre,creado_por,creado_en&id=eq.${grupoId}&limit=1`);
  if (!grupo || grupo.length === 0)
    return res.status(404).json({ error: 'Grupo no encontrado.' });

  const { data: miembros } = await db.select('chat_grupo_miembros',
    `select=usuario_id,unido_en,usuarios(id,nombre,username)&grupo_id=eq.${grupoId}`);

  // Verifica que yo sea miembro
  const soyMiembro = (miembros || []).some(m => m.usuario_id === miId);
  if (!soyMiembro) return res.status(403).json({ error: 'No eres miembro de este grupo.' });

  res.json({ grupo: grupo[0], miembros: miembros || [] });
});

// Mensajes de un grupo
router.get('/grupos/:grupoId/mensajes', requireAuth, async (req, res) => {
  const miId    = req.session.user.id;
  const grupoId = req.params.grupoId;

  // Verifica membresía
  const { data: memb } = await db.select('chat_grupo_miembros',
    `select=id&grupo_id=eq.${grupoId}&usuario_id=eq.${miId}&limit=1`);
  if (!memb || memb.length === 0)
    return res.status(403).json({ error: 'No eres miembro de este grupo.' });

  const { data: mensajes, error } = await db.select('chat_grupo_mensajes',
    `select=id,grupo_id,remitente_id,contenido,creado_en,usuarios(nombre)&grupo_id=eq.${grupoId}&order=creado_en.asc`);
  if (error) return res.status(500).json({ error: error.message });

  // Actualiza mi lectura al mensaje más reciente
  await db.update('chat_grupo_lecturas',
    `grupo_id=eq.${grupoId}&usuario_id=eq.${miId}`,
    { ultimo_leido_en: new Date().toISOString() });
  // Si no existía registro de lectura, lo crea
  const { data: lec } = await db.select('chat_grupo_lecturas',
    `select=id&grupo_id=eq.${grupoId}&usuario_id=eq.${miId}&limit=1`);
  if (!lec || lec.length === 0) {
    await db.insert('chat_grupo_lecturas', {
      grupo_id:       grupoId,
      usuario_id:     miId,
      ultimo_leido_en: new Date().toISOString()
    });
  }

  res.json({ mensajes: mensajes || [] });
});

// Enviar mensaje a un grupo
router.post('/grupos/:grupoId/enviar', requireAuth, async (req, res) => {
  const miId    = req.session.user.id;
  const grupoId = req.params.grupoId;
  const { contenido } = req.body;
  if (!contenido || !contenido.trim())
    return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });

  // Verifica membresía
  const { data: memb } = await db.select('chat_grupo_miembros',
    `select=id&grupo_id=eq.${grupoId}&usuario_id=eq.${miId}&limit=1`);
  if (!memb || memb.length === 0)
    return res.status(403).json({ error: 'No eres miembro de este grupo.' });

  const { error } = await db.insert('chat_grupo_mensajes', {
    grupo_id:     grupoId,
    remitente_id: miId,
    contenido:    contenido.trim().substring(0, 2000),
    creado_en:    new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });

  // Actualiza mi propia lectura al enviar
  await db.update('chat_grupo_lecturas',
    `grupo_id=eq.${grupoId}&usuario_id=eq.${miId}`,
    { ultimo_leido_en: new Date().toISOString() });

  res.json({ ok: true });
});

// Eliminar grupo (solo el creador)
router.delete('/grupos/:grupoId', requireAuth, async (req, res) => {
  const miId    = req.session.user.id;
  const grupoId = req.params.grupoId;
  const { data: grupo } = await db.select('chat_grupos',
    `select=creado_por&id=eq.${grupoId}&limit=1`);
  if (!grupo || grupo.length === 0)
    return res.status(404).json({ error: 'Grupo no encontrado.' });
  if (grupo[0].creado_por !== miId)
    return res.status(403).json({ error: 'Solo el creador puede eliminar el grupo.' });
  await db.delete('chat_grupos', `id=eq.${grupoId}`);
  res.json({ ok: true });
});

module.exports = router;
