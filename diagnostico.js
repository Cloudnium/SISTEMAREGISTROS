// =============================================
// diagnostico.js
// Ejecuta con: node diagnostico.js
// Prueba la conexión a Supabase y el login
// =============================================
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const URL  = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SVC  = process.env.SUPABASE_SERVICE_KEY;

console.log('\n=== DIAGNÓSTICO CLOUDNIUM ===\n');
console.log('SUPABASE_URL:         ', URL  ? '✅ ' + URL : '❌ VACÍO');
console.log('SUPABASE_ANON_KEY:    ', ANON ? '✅ (tiene valor)' : '❌ VACÍO');
console.log('SUPABASE_SERVICE_KEY: ', SVC  ? '✅ (tiene valor)' : '❌ VACÍO');
console.log('SESSION_SECRET:       ', process.env.SESSION_SECRET ? '✅' : '❌ VACÍO');
console.log('');

if (!URL || URL.includes('TU_PROJECT') || !ANON || ANON.includes('TU_ANON')) {
  console.log('❌ ERROR: El .env aún tiene valores de ejemplo, no los tuyos reales.');
  console.log('   Edita el archivo .env con tus credenciales y vuelve a correr este script.');
  process.exit(1);
}

async function main() {
  const supabase = createClient(URL, SVC || ANON);

  // 1. Prueba conexión
  console.log('1. Probando conexión a Supabase...');
  const { data: tablas, error: errTablas } = await supabase
    .from('usuarios')
    .select('count', { count: 'exact', head: true });

  if (errTablas) {
    console.log('❌ Error conectando a la tabla "usuarios":', errTablas.message);
    console.log('   Código:', errTablas.code);
    if (errTablas.code === '42P01') {
      console.log('   → La tabla "usuarios" NO EXISTE. Ejecuta el FIX_LOGIN.sql en Supabase.');
    } else if (errTablas.code === 'PGRST301') {
      console.log('   → RLS activado. Ejecuta: ALTER TABLE public.usuarios DISABLE ROW LEVEL SECURITY;');
    }
    process.exit(1);
  }
  console.log('✅ Conexión OK. Tabla "usuarios" existe.\n');

  // 2. Lista usuarios
  console.log('2. Usuarios en la BD:');
  const { data: users, error: errUsers } = await supabase
    .from('usuarios')
    .select('id, nombre, username, email, rol, activo, password_hash');

  if (errUsers) {
    console.log('❌ Error leyendo usuarios:', errUsers.message);
    process.exit(1);
  }

  if (!users || users.length === 0) {
    console.log('❌ No hay usuarios en la tabla. Ejecuta FIX_LOGIN.sql.');
    process.exit(1);
  }

  users.forEach(u => {
    console.log('  Usuario:', u.username, '| Rol:', u.rol, '| Activo:', u.activo);
    console.log('  Hash guardado:', u.password_hash ? u.password_hash.substring(0,20) + '...' : 'VACÍO ❌');
  });
  console.log('');

  // 3. Prueba de contraseña
  const testUser = users[0];
  const passwords = ['Admin123', 'admin123', 'password', 'Password123'];
  console.log('3. Probando contraseñas para usuario "' + testUser.username + '":');
  for (const pwd of passwords) {
    if (!testUser.password_hash) { console.log('  ❌ password_hash está vacío en la BD'); break; }
    const ok = await bcrypt.compare(pwd, testUser.password_hash);
    console.log('  "' + pwd + '" →', ok ? '✅ CORRECTA' : '❌ incorrecta');
    if (ok) break;
  }

  console.log('\n=== FIN DIAGNÓSTICO ===\n');
}

main().catch(err => {
  console.log('❌ Error inesperado:', err.message);
  process.exit(1);
});
