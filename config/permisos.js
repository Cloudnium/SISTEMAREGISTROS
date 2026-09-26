// =============================================
// config/permisos.js
// Catálogo único de los permisos de usuario, agrupados en
// subsecciones. Lo usan tanto el formulario de Usuarios (para
// mostrar/guardar los permisos de una persona) como la página Roles
// (para definir los valores por defecto de cada rol).
//
// Agregar un permiso nuevo = agregarlo UNA vez aquí (y su columna en
// la tabla "usuarios" y en "configuracion_roles_permisos").
// =============================================

const GRUPOS_PERMISOS = [
  {
    clave: 'boletaje',
    nombre: 'Boletaje',
    permisos: [
      { clave: 'puede_anular',        label: 'Puede anular' },
      { clave: 'puede_postergar',     label: 'Puede postergar' },
      { clave: 'puede_reservar',      label: 'Puede reservar' },
      { clave: 'puede_habilitar',     label: 'Puede habilitar' },
      { clave: 'puede_reintegro',     label: 'Puede usar Reintegro' },
      { clave: 'puede_crear_codigos', label: 'Puede crear códigos de autorización' },
      { clave: 'puede_editar_precios', label: 'Puede editar precios/horarios en Boletaje' },
      { clave: 'puede_programar',     label: 'Puede programar salidas de buses' }
    ]
  },
  {
    clave: 'inventario',
    nombre: 'Inventario',
    permisos: [
      { clave: 'puede_ver_inventario',       label: 'Puede ver Inventario' },
      { clave: 'puede_gestionar_inventario', label: 'Puede gestionar Inventario (crear/editar catálogo y precios)' },
      { clave: 'puede_restar_stock',         label: 'Puede restar stock manualmente' }
    ]
  },
  {
    clave: 'planilla',
    nombre: 'Planilla',
    permisos: [
      { clave: 'puede_ver_planilla',    label: 'Puede ver Planilla (consulta, imprimir, reportes)' },
      { clave: 'puede_editar_planilla', label: 'Puede editar Planilla (crear periodos, bonos, descuentos, cobros, vacaciones, permisos)' }
    ]
  },
  {
    clave: 'general',
    nombre: 'General',
    permisos: [
      { clave: 'puede_ver_combustible', label: 'Puede ver Combustible' },
      { clave: 'puede_ver_personal',    label: 'Puede ver Personal' },
      { clave: 'puede_gestionar_estaciones_placas', label: 'Puede gestionar Estaciones y Placas (panel del Dashboard)' }
    ]
  }
];

// Lista plana de claves — útil para construir selects/inserts/updates
const CLAVES_PERMISOS = GRUPOS_PERMISOS.flatMap(g => g.permisos.map(p => p.clave));

// Roles que no dependen de estos permisos: siempre tienen acceso total
const ROLES_SIEMPRE_TOTAL = ['admin', 'desarrollador'];

// Roles cuyos permisos SÍ se pueden configurar en "Roles"
const ROLES_CONFIGURABLES = ['operador', 'visualizador'];

module.exports = { GRUPOS_PERMISOS, CLAVES_PERMISOS, ROLES_SIEMPRE_TOTAL, ROLES_CONFIGURABLES };
