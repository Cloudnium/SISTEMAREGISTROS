// =============================================
// middleware/auth.js — Control de acceso
//
// Roles del sistema:
//   admin       → todo: ver, registrar, editar, eliminar
//   operador    → ver y registrar solamente
//   visualizador → solo ver
// =============================================

// Verifica sesión activa — requerido en todas las rutas privadas
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Debes iniciar sesion para acceder.');
  res.redirect('/login');
}

// Solo administradores (gestión de usuarios del sistema)
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.rol === 'admin') return next();
  req.flash('error', 'No tienes permisos para acceder a esta seccion.');
  res.redirect('/dashboard');
}

// Solo admin puede EDITAR (PUT/POST editar)
function requireAdminToEdit(req, res, next) {
  if (req.session && req.session.user && req.session.user.rol === 'admin') return next();
  req.flash('error', 'Solo el administrador puede editar registros.');
  res.redirect('back');
}

// Solo admin puede ELIMINAR (POST eliminar)
function requireAdminToDelete(req, res, next) {
  if (req.session && req.session.user && req.session.user.rol === 'admin') return next();
  req.flash('error', 'Solo el administrador puede eliminar registros.');
  res.redirect('back');
}

// Redirige al dashboard si ya tiene sesión activa (para el login)
function redirectIfAuth(req, res, next) {
  if (req.session && req.session.user) return res.redirect('/dashboard');
  next();
}

// Expone el rol del usuario a las vistas HBS como variable global
// Usado para mostrar/ocultar botones según el rol
function exposeUserRole(req, res, next) {
  res.locals.isAdmin      = req.session && req.session.user && req.session.user.rol === 'admin';
  res.locals.isOperador   = req.session && req.session.user && req.session.user.rol === 'operador';
  res.locals.userRol      = req.session && req.session.user ? req.session.user.rol : null;
  next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireAdminToEdit,
  requireAdminToDelete,
  redirectIfAuth,
  exposeUserRole
};
