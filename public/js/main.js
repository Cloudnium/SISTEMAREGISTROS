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
