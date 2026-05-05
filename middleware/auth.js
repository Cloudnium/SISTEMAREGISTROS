// =============================================
// middleware/auth.js
// Middleware de autenticación — protege rutas privadas
// =============================================

// Verifica que el usuario tenga sesión activa
// Si no, redirige al login con mensaje de error
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  req.flash('error', 'Debes iniciar sesión para acceder.');
  res.redirect('/login');
}

// Verifica que el usuario sea administrador
// Usado para rutas sensibles como gestión de usuarios
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.rol === 'admin') {
    return next();
  }
  req.flash('error', 'No tienes permisos para acceder a esta sección.');
  res.redirect('/dashboard');
}

// Redirige al dashboard si ya está autenticado (para login/register)
function redirectIfAuth(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  next();
}

module.exports = { requireAuth, requireAdmin, redirectIfAuth };
