// =============================================
// routes/usuarios.js — CRUD usuarios (REST nativo)
// =============================================
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const { db }   = require('../config/supabase');
const { requireAuth, requireAdmin, requireAdminToEdit, requireAdminToDelete } = require('../middleware/auth');

router.use(requireAuth, requireAdmin);

// ─── LIST ───
router.get('/', async (req, res) => {
  const { data: usuarios, error } = await db.select('usuarios',
    'select=id,nombre,username,email,rol,activo,creado_en,ultimo_acceso&order=creado_en.desc');
  if (error) console.error('usuarios list:', error);
  res.render('usuarios/index', {
    layout: 'main', title: 'Usuarios',
    pageTitle: 'Usuarios', pageSubtitle: 'Administra los accesos al sistema',
    usuarios: usuarios || []
  });
});

// ─── NEW FORM ───
router.get('/nuevo', (req, res) => {
  res.render('usuarios/form', {
    layout: 'main', title: 'Nuevo Usuario',
    pageTitle: 'Nuevo Usuario', pageSubtitle: 'Crea un nuevo acceso',
    accion: 'crear'
  });
});

// ─── CREATE ───
router.post('/', async (req, res) => {
  const { nombre, username, email, password, confirmar_password, rol } = req.body;
  if (!nombre || !username || !email || !password || !rol) {
    req.flash('error', 'Todos los campos son obligatorios.');
    return res.redirect('/usuarios/nuevo');
  }
  if (password !== confirmar_password) {
    req.flash('error', 'Las contrasenas no coinciden.');
    return res.redirect('/usuarios/nuevo');
  }
  if (password.length < 6) {
    req.flash('error', 'La contrasena debe tener al menos 6 caracteres.');
    return res.redirect('/usuarios/nuevo');
  }
  try {
    const { data: existente } = await db.select('usuarios',
      `select=id&or=(username.ilike.${encodeURIComponent(username)},email.ilike.${encodeURIComponent(email)})&limit=1`);
    if (existente && existente.length > 0) {
      req.flash('error', 'El usuario o correo ya existe.');
      return res.redirect('/usuarios/nuevo');
    }
    const password_hash = await bcrypt.hash(password, 10);
    const { error } = await db.insert('usuarios', {
      nombre, username: username.toLowerCase(), email, password_hash, rol,
      activo: true, creado_en: new Date().toISOString()
    });
    if (error) throw new Error(error.message);
    req.flash('success', `Usuario "${nombre}" creado correctamente.`);
    res.redirect('/usuarios');
  } catch (err) {
    console.error('create usuario:', err);
    req.flash('error', 'Error al crear el usuario: ' + err.message);
    res.redirect('/usuarios/nuevo');
  }
});

// ─── EDIT FORM ───
router.get('/:id/editar', requireAdminToEdit, async (req, res) => {
  const { data, error } = await db.select('usuarios',
    `select=id,nombre,username,email,rol,activo&id=eq.${req.params.id}&limit=1`);
  if (error || !data || data.length === 0) {
    req.flash('error', 'Usuario no encontrado.');
    return res.redirect('/usuarios');
  }
  res.render('usuarios/form', {
    layout: 'main', title: 'Editar Usuario',
    pageTitle: 'Editar Usuario', pageSubtitle: 'Modifica los datos',
    accion: 'editar', usuario: data[0]
  });
});

// ─── UPDATE ───
router.post('/:id/editar', requireAdminToEdit, async (req, res) => {
  const { nombre, username, email, password, confirmar_password, rol, activo } = req.body;
  try {
    const updates = { nombre, username: username.toLowerCase(), email, rol, activo: activo === 'on' };
    if (password && password.trim() !== '') {
      if (password !== confirmar_password) {
        req.flash('error', 'Las contrasenas no coinciden.');
        return res.redirect(`/usuarios/${req.params.id}/editar`);
      }
      updates.password_hash = await bcrypt.hash(password, 10);
    }
    const { error } = await db.update('usuarios', `id=eq.${req.params.id}`, updates);
    if (error) throw new Error(error.message);
    req.flash('success', 'Usuario actualizado correctamente.');
    res.redirect('/usuarios');
  } catch (err) {
    console.error('update usuario:', err);
    req.flash('error', 'Error al actualizar: ' + err.message);
    res.redirect(`/usuarios/${req.params.id}/editar`);
  }
});

// ─── DELETE ───
router.post('/:id/eliminar', requireAdminToDelete, async (req, res) => {
  if (req.params.id === String(req.session.user.id)) {
    req.flash('error', 'No puedes eliminarte a ti mismo.');
    return res.redirect('/usuarios');
  }
  const { error } = await db.delete('usuarios', `id=eq.${req.params.id}`);
  if (error) req.flash('error', 'Error al eliminar.');
  else req.flash('success', 'Usuario eliminado.');
  res.redirect('/usuarios');
});

module.exports = router;
