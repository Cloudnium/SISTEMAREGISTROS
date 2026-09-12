// =============================================
// public/js/planilla-buscador.js — Buscador inteligente de trabajadores
// Reutilizado en Planilla > Resumen y Planilla > Vacaciones y Permisos.
//
// Uso:
//   PlanillaBuscador.iniciar({
//     inputId: 'idDelInput', listaId: 'idDelContenedorDeSugerencias',
//     onSeleccionar: function (trabajador) { ... }
//   });
// =============================================
(function (global) {
  function iniciar(opts) {
    var input = document.getElementById(opts.inputId);
    var lista = document.getElementById(opts.listaId);
    if (!input || !lista) return;
    var timeoutId = null;

    function render(resultados) {
      if (!resultados.length) {
        lista.innerHTML = '<div class="pln-sugerencia-vacio">Sin coincidencias</div>';
        lista.classList.add('show');
        return;
      }
      lista.innerHTML = resultados.map(function (r) {
        return '<div class="pln-sugerencia-item" data-id="' + r.id + '">' +
          '<div><div class="pln-sugerencia-nombre">' + r.nombreCompleto + '</div>' +
          '<div class="pln-sugerencia-meta">' + r.cargoMostrar + (r.area ? ' · ' + r.area : '') + (r.activo === false ? ' · Inactivo' : '') + '</div></div>' +
          '<div class="pln-sugerencia-meta">DNI ' + (r.dni || '—') + '</div></div>';
      }).join('');
      lista.classList.add('show');
      Array.prototype.forEach.call(lista.querySelectorAll('.pln-sugerencia-item'), function (el) {
        el.addEventListener('click', function () {
          var seleccionado = resultados.find(function (r) { return String(r.id) === el.getAttribute('data-id'); });
          lista.classList.remove('show');
          input.value = seleccionado.nombreCompleto;
          if (opts.onSeleccionar) opts.onSeleccionar(seleccionado);
        });
      });
    }

    input.addEventListener('input', function () {
      var q = input.value.trim();
      clearTimeout(timeoutId);
      if (q.length < 1) { lista.classList.remove('show'); return; }
      timeoutId = setTimeout(function () {
        fetch('/planilla/resumen/buscar?q=' + encodeURIComponent(q), { credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (data) { render(data.resultados || []); });
      }, 220);
    });

    document.addEventListener('click', function (e) {
      if (!lista.contains(e.target) && e.target !== input) lista.classList.remove('show');
    });
  }

  global.PlanillaBuscador = { iniciar: iniciar };
})(window);
