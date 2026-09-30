// =============================================
// public/js/main.js — JS global del sistema
// Sidebar responsive, flash auto-dismiss,
// detección de dispositivo
// =============================================

// ─── Modo nocturno ───
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('theme', next); } catch (e) {}
  actualizarBotonTema(next === 'dark');
}
function actualizarBotonTema(esOscuro) {
  const icon = document.getElementById('themeToggleIcon');
  const label = document.getElementById('themeToggleLabel');
  const btn = document.getElementById('themeToggleBtn');
  const switchEl = document.getElementById('themeSwitch');
  if (icon) icon.setAttribute('data-lucide', esOscuro ? 'sun' : 'moon');
  if (label) label.textContent = esOscuro ? 'Modo claro' : 'Modo nocturno';
  if (btn) btn.title = esOscuro ? 'Cambiar a modo claro' : 'Cambiar a modo nocturno';
  if (switchEl) switchEl.classList.toggle('on', esOscuro);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ─── Estado del sidebar ───
let sidebarOpen = false;

// ─── Contraer/expandir sidebar a solo íconos (escritorio) ───
function toggleSidebarCollapse() {
  const collapsed = !document.body.classList.contains('sidebar-collapsed');
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); } catch (e) {}
  const icon = document.getElementById('sidebarToggleIcon');
  const btn = document.getElementById('sidebarToggleBtn');
  if (icon) icon.setAttribute('data-lucide', collapsed ? 'panel-left-open' : 'panel-left-close');
  if (btn) btn.title = collapsed ? 'Expandir menú' : 'Contraer menú';
  if (typeof lucide !== 'undefined') lucide.createIcons();
  cerrarFlyoutSidebar();
}

// ─── Grupos colapsables del sidebar (Boletaje / General / etc.) ───
// Sidebar EXPANDIDO: un clic alterna abierto/cerrado en línea y
// recuerda la preferencia en localStorage por nombre de grupo. El
// grupo que contiene la página activa siempre arranca abierto (para
// no "perder" la página en la que estás), sin importar localStorage.
//
// Sidebar CONTRAÍDO (solo íconos): un clic abre un panel flotante al
// lado del ícono con los enlaces de ese grupo — no hay espacio para
// desplegarlos en línea. Solo un panel puede estar abierto a la vez.
function toggleSidebarGroup(key) {
  const items  = document.getElementById('sidebarGroup-' + key);
  const header = document.querySelector('[data-group-toggle="' + key + '"]');
  if (!items || !header) return;
  const abrirAhora = items.classList.contains('sidebar-group-collapsed');
  items.classList.toggle('sidebar-group-collapsed', !abrirAhora);
  header.setAttribute('aria-expanded', abrirAhora ? 'true' : 'false');
  try { localStorage.setItem('sidebarGroup:' + key, abrirAhora ? 'open' : 'closed'); } catch (e) {}
}

let flyoutPadreOriginal = null; // dónde vive normalmente el panel abierto, para devolverlo al cerrar

function cerrarFlyoutSidebar() {
  const abierto = document.querySelector('.sidebar-group-items.sidebar-flyout-open');
  if (!abierto) return;
  abierto.classList.remove('sidebar-flyout-open');
  abierto.style.top = ''; abierto.style.left = '';
  const header = document.querySelector('[data-group-toggle="' + abierto.getAttribute('data-group-key') + '"]');
  if (header) header.setAttribute('aria-expanded', 'false');
  // Lo regresa a su lugar original dentro del sidebar (ver por qué se
  // mueve, en toggleFlyoutSidebar).
  if (flyoutPadreOriginal) { flyoutPadreOriginal.appendChild(abierto); flyoutPadreOriginal = null; }
}

function toggleFlyoutSidebar(key, header, items) {
  const yaAbierto = items.classList.contains('sidebar-flyout-open');
  cerrarFlyoutSidebar();
  if (yaAbierto) return; // era el mismo: solo lo cerramos

  items.setAttribute('data-group-key', key);
  // El panel usa position:fixed para "flotar" sobre toda la página,
  // pero el <aside class="sidebar"> tiene will-change:transform (y en
  // móvil, transform real para abrir/cerrar) — eso lo convierte en el
  // contenedor de referencia para cualquier hijo fixed, así que el
  // panel quedaría recortado dentro del propio sidebar en vez de
  // flotar. Por eso se saca temporalmente al <body> mientras está
  // abierto, y se regresa a su sitio al cerrarlo.
  flyoutPadreOriginal = items.parentElement;
  document.body.appendChild(items);
  items.classList.add('sidebar-flyout-open');
  header.setAttribute('aria-expanded', 'true');

  // Posiciona el panel a la derecha del ícono, alineado con su borde
  // superior, sin salirse de la pantalla por abajo.
  const rectHeader = header.getBoundingClientRect();
  const sidebarEl = document.getElementById('sidebar');
  const left = (sidebarEl ? sidebarEl.getBoundingClientRect().right : rectHeader.right) + 8;
  items.style.left = left + 'px';
  items.style.top = rectHeader.top + 'px';
  // Ajuste si se sale por abajo (se mide después de mostrarlo)
  requestAnimationFrame(function () {
    const rectItems = items.getBoundingClientRect();
    const exceso = rectItems.bottom - (window.innerHeight - 12);
    if (exceso > 0) items.style.top = Math.max(12, rectHeader.top - exceso) + 'px';
  });
}

function inicializarGruposSidebar() {
  document.querySelectorAll('.sidebar-group').forEach(function (grupo) {
    const key    = grupo.getAttribute('data-group');
    const items  = document.getElementById('sidebarGroup-' + key);
    const header = grupo.querySelector('.sidebar-group-header');
    if (!key || !items || !header) return;

    const tieneItemActivo = !!items.querySelector('.sidebar-nav-item.active');
    let guardado = null;
    try { guardado = localStorage.getItem('sidebarGroup:' + key); } catch (e) {}

    const abrir = tieneItemActivo || guardado !== 'closed';
    items.classList.toggle('sidebar-group-collapsed', !abrir);
    header.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    header.addEventListener('click', function (e) {
      if (document.body.classList.contains('sidebar-collapsed')) {
        e.stopPropagation();
        toggleFlyoutSidebar(key, header, items);
      } else {
        toggleSidebarGroup(key);
      }
    });
  });

  // Cierra el panel flotante al hacer clic fuera, con Escape, o al
  // redimensionar la ventana (su posición ya no sería correcta).
  document.addEventListener('click', function (e) {
    const abierto = document.querySelector('.sidebar-group-items.sidebar-flyout-open');
    if (abierto && !abierto.contains(e.target)) cerrarFlyoutSidebar();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') cerrarFlyoutSidebar();
  });
  window.addEventListener('resize', cerrarFlyoutSidebar);
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar) return;

  sidebarOpen = !sidebarOpen;
  sidebar.classList.toggle('open', sidebarOpen);
  if (overlay) overlay.classList.toggle('active', sidebarOpen);

  // Bloquea scroll del body cuando sidebar está abierto en móvil
  document.body.style.overflow = sidebarOpen ? 'hidden' : '';
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar || !sidebarOpen) return;

  sidebarOpen = false;
  sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

// ─── Cierra sidebar al hacer clic en overlay ───
document.addEventListener('DOMContentLoaded', function () {
  const overlay = document.getElementById('sidebarOverlay');
  if (overlay) overlay.addEventListener('click', closeSidebar);

  // Sincroniza el botón de modo nocturno con el estado ya aplicado
  // (el estado en sí se aplica antes, en un script inline en el
  // <head>, para evitar parpadeo al cargar la página).
  actualizarBotonTema(document.documentElement.getAttribute('data-theme') === 'dark');
  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  // Sincroniza el ícono/tooltip del botón contraer con el estado ya
  // aplicado (el estado en sí se aplica antes, en un script inline en
  // el <head>/<body>, para evitar parpadeo al cargar la página).
  if (document.body.classList.contains('sidebar-collapsed')) {
    const icon = document.getElementById('sidebarToggleIcon');
    const btn = document.getElementById('sidebarToggleBtn');
    if (icon) icon.setAttribute('data-lucide', 'panel-left-open');
    if (btn) btn.title = 'Expandir menú';
  }

  // Cierra sidebar al navegar (en móvil)
  document.querySelectorAll('.sidebar-nav-item').forEach(function (item) {
    item.addEventListener('click', function () {
      if (window.innerWidth < 1024) closeSidebar();
    });
  });

  // Abre/cierra los grupos colapsables del sidebar (Boletaje, General,
  // Administración, Desarrollador) y deja abierto el que contiene la
  // página actual.
  inicializarGruposSidebar();

  // Cierra sidebar si se redimensiona a desktop
  window.addEventListener('resize', function () {
    if (window.innerWidth >= 1024) {
      closeSidebar();
      document.body.style.overflow = '';
    }
  });

  // Tecla ESC cierra sidebar
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSidebar();
  });

  // ─── Flash messages: auto-dismiss en 4s ───
  document.querySelectorAll('.flash').forEach(function (flash) {
    setTimeout(function () {
      flash.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      flash.style.opacity   = '0';
      flash.style.transform = 'translateY(-8px)';
      setTimeout(function () { flash.remove(); }, 400);
    }, 4000);
  });

  // ─── Inicializa íconos Lucide ───
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // ─── Swipe para abrir/cerrar sidebar en móvil ───
  let touchStartX = 0;
  let touchStartY = 0;

  document.addEventListener('touchstart', function (e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    if (window.innerWidth >= 1024) return; // Solo en móvil/tablet

    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;

    // Verifica que sea swipe horizontal (no vertical)
    if (Math.abs(dx) < Math.abs(dy) || Math.abs(dx) < 50) return;

    if (dx > 0 && touchStartX < 30 && !sidebarOpen) {
      // Swipe derecha desde el borde izquierdo → abre sidebar
      toggleSidebar();
    } else if (dx < 0 && sidebarOpen) {
      // Swipe izquierda → cierra sidebar
      closeSidebar();
    }
  }, { passive: true });

});
