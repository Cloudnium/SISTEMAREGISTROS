/* =============================================
   public/js/croquis-manifiesto-print.js
   Generadores de impresión para Croquis de Pasajeros y Manifiesto de
   Usuarios, en base a los formatos de ejemplo de la empresa.
   ============================================= */
(function (window) {
  'use strict';

  function formatearFecha(iso) {
    if (!iso) return '—';
    var meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    return p[2] + '-' + meses[parseInt(p[1], 10) - 1] + '.-' + p[0];
  }

  function abrirVentana(html, w, h) {
    var win = window.open('', '_blank', 'width=' + (w || 900) + ',height=' + (h || 700));
    if (!win) { alert('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para este sitio.'); return null; }
    win.document.write(html);
    win.document.close();
    return win;
  }

  // ═══════════════ CROQUIS DE PASAJEROS ═══════════════
  function generarCroquisHTML(datos) {
    var prog = datos.programacion;
    var bus = datos.bus || {};
    var vendidos = (datos.boletos || []).filter(function (b) { return b.estado !== 'anulado'; });

    var celdas = vendidos.map(function (b) {
      var numBoleto = (b.serie && b.correlativo) ? (b.serie + '-' + String(b.correlativo).padStart(7, '0')) : '—';
      return (
        '<div class="celda">' +
        '<div class="celda-top"><span class="asiento">' + b.numero_asiento + '</span><span class="serie">' + numBoleto + '</span></div>' +
        '<div class="nom">Nom. ' + (b.nombre_completo || '—') + '</div>' +
        '<div class="dest">Dest. ' + (b.agencia_llegada ? b.agencia_llegada.nombre : (prog.ciudad_destino || '—')) + '</div>' +
        '<div class="emb">Embarque: ' + (b.agencia_embarque ? b.agencia_embarque.nombre : (prog.ciudad_origen || '—')) + '</div>' +
        '</div>'
      );
    }).join('');

    return (
      '<html><head><title>Croquis de Pasajeros</title><style>' +
      'body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:16px;}' +
      '.header{text-align:center;font-weight:700;margin-bottom:10px}' +
      '.meta{display:flex;flex-wrap:wrap;gap:14px;border:1px solid #333;padding:8px;margin-bottom:10px;font-size:11px}' +
      '.meta div{flex:1;min-width:150px}' +
      '.meta b{display:block;font-size:9px;color:#555;text-transform:uppercase}' +
      '.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}' +
      '.celda{border:1px solid #999;padding:5px;font-size:9.5px;min-height:60px}' +
      '.celda-top{display:flex;justify-content:space-between;font-weight:700;border-bottom:1px solid #ccc;margin-bottom:3px;padding-bottom:2px}' +
      '.asiento{background:#333;color:#fff;padding:0 5px;border-radius:3px}' +
      '.serie{font-size:9px;color:#555}' +
      '.nom{font-weight:600}' +
      '.dest,.emb{color:#444}' +
      '@media print{ .no-print{display:none} }' +
      '</style></head><body>' +
      '<div class="header">' +
      'Croquis de Pasajeros — Fecha Imp: ' + formatearFecha(new Date().toISOString().slice(0, 10)) +
      '</div>' +
      '<div class="meta">' +
      '<div><b>Empresa</b>' + (bus.empresa || '—') + '</div>' +
      '<div><b>Placa</b>' + (bus.placa || '—') + '</div>' +
      '<div><b>Hora</b>' + (prog.hora || '—') + '</div>' +
      '<div><b>Fecha Viaje</b>' + formatearFecha(prog.fecha_salida) + '</div>' +
      '<div><b>Punto Partida</b>' + (prog.ciudad_origen || '—') + '</div>' +
      '<div><b>Destino</b>' + (prog.ciudad_destino || '—') + '</div>' +
      '<div><b>Total Asientos</b>' + (bus.total_asientos || '—') + '</div>' +
      '<div><b>Cant. Pasajeros</b>' + vendidos.length + '</div>' +
      '<div><b>Servicio</b>' + (prog.servicio || '—') + '</div>' +
      '</div>' +
      '<div class="grid">' + celdas + '</div>' +
      '</body></html>'
    );
  }

  function imprimirCroquis(datos) {
    var win = abrirVentana(generarCroquisHTML(datos), 1000, 750);
    if (win) { win.focus(); win.print(); }
  }

  // ═══════════════ MANIFIESTO DE USUARIOS ═══════════════
  function generarManifiestoHTML(datos) {
    var prog = datos.programacion;
    var bus = datos.bus || {};
    var vendidos = (datos.boletos || []).filter(function (b) { return b.estado !== 'anulado'; });
    var totalImporte = vendidos.reduce(function (s, b) { return s + Number(b.precio || 0); }, 0);

    function nombreCompleto(p) { return p ? ((p.nombres || '') + ' ' + (p.apellidos || '')).trim() : '—'; }

    var filas = vendidos.map(function (b, i) {
      var numBoleto = (b.serie && b.correlativo) ? (b.serie + '-' + String(b.correlativo).padStart(7, '0')) : '—';
      return (
        '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + (b.nombre_completo || '—') + '</td>' +
        '<td>' + (b.tipo_documento || '') + ' ' + (b.numero_documento || '—') + '</td>' +
        '<td>' + (b.edad != null ? b.edad : '—') + '</td>' +
        '<td>' + numBoleto + '</td>' +
        '<td>' + (b.agencia_embarque ? b.agencia_embarque.nombre : (prog.ciudad_origen || '—')) + '</td>' +
        '<td>' + (b.agencia_llegada ? b.agencia_llegada.nombre : (prog.ciudad_destino || '—')) + '</td>' +
        '<td>' + b.numero_asiento + '</td>' +
        '<td>' + Number(b.precio || 0).toFixed(2) + '</td>' +
        '</tr>'
      );
    }).join('');

    var numManifiesto = datos.manifiesto && datos.manifiesto.serie
      ? (datos.manifiesto.serie + '-' + String(datos.manifiesto.correlativo).padStart(8, '0'))
      : '—';

    return (
      '<html><head><title>Manifiesto de Usuarios</title><style>' +
      'body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:16px;}' +
      '.center{text-align:center}.bold{font-weight:700}' +
      '.header{text-align:center;margin-bottom:8px}' +
      '.header .empresa{font-weight:700;font-size:13px}' +
      '.meta{display:flex;flex-wrap:wrap;gap:10px;border:1px solid #333;padding:8px;margin:10px 0;font-size:10.5px}' +
      '.meta div{flex:1;min-width:150px}' +
      '.meta b{display:block;font-size:9px;color:#555;text-transform:uppercase}' +
      'table{width:100%;border-collapse:collapse;font-size:9.5px;margin-top:8px}' +
      'th,td{border:1px solid #999;padding:3px 5px;text-align:left}' +
      'th{background:#eee}' +
      '.firma{display:flex;justify-content:space-around;margin-top:40px;font-size:10.5px}' +
      '.firma div{border-top:1px solid #333;padding-top:4px;width:220px;text-align:center}' +
      '.foot{margin-top:14px;font-size:9px;color:#444}' +
      '</style></head><body>' +
      '<div class="header">' +
      '<div class="empresa">' + (bus.empresa_razon_social || '—') + (bus.empresa_ruc ? ('  RUC: ' + bus.empresa_ruc) : '') + '</div>' +
      '<div class="bold">MANIFIESTO DE USUARIOS</div>' +
      '<div class="bold">Nro: ' + numManifiesto + '</div>' +
      '</div>' +
      '<div class="meta">' +
      '<div><b>Ómnibus / Placa</b>' + (bus.placa || '—') + ' — ' + (bus.marca || '') + '</div>' +
      '<div><b>Tarj. Circulación</b>' + (bus.tarjeta_circulacion || '—') + '</div>' +
      '<div><b>Total Asientos</b>' + (bus.total_asientos || '—') + '</div>' +
      '<div><b>Fecha Viaje</b>' + formatearFecha(prog.fecha_salida) + '</div>' +
      '<div><b>Punto Partida</b>' + (prog.ciudad_origen || '—') + '</div>' +
      '<div><b>Destino</b>' + (prog.ciudad_destino || '—') + '</div>' +
      '<div><b>Piloto</b>' + nombreCompleto(datos.piloto) + (datos.piloto && datos.piloto.licencia ? (' — Brevete: ' + datos.piloto.licencia) : '') + '</div>' +
      '<div><b>Co-Piloto 1</b>' + nombreCompleto(datos.copiloto1) + (datos.copiloto1 && datos.copiloto1.licencia ? (' — Brevete: ' + datos.copiloto1.licencia) : '') + '</div>' +
      '<div><b>Co-Piloto 2</b>' + nombreCompleto(datos.copiloto2) + (datos.copiloto2 && datos.copiloto2.licencia ? (' — Brevete: ' + datos.copiloto2.licencia) : '') + '</div>' +
      '<div><b>Terramoza</b>' + nombreCompleto(datos.terramoza) + (datos.terramoza && datos.terramoza.dni ? (' — DNI: ' + datos.terramoza.dni) : '') + '</div>' +
      '<div><b>Ayudante</b>' + nombreCompleto(datos.ayudante) + (datos.ayudante && datos.ayudante.dni ? (' — DNI: ' + datos.ayudante.dni) : '') + '</div>' +
      '<div><b>Cant. Pasajeros</b>' + vendidos.length + '</div>' +
      '</div>' +
      '<table><thead><tr>' +
      '<th>#</th><th>Nombre y Apellido</th><th>Docto. Identidad</th><th>Edad</th>' +
      '<th>Docto. Viaje</th><th>Origen</th><th>Destino</th><th>Asiento</th><th>Importe S/.</th>' +
      '</tr></thead><tbody>' + filas +
      '<tr><td colspan="8" style="text-align:right;font-weight:700">TOTAL</td><td style="font-weight:700">' + totalImporte.toFixed(2) + '</td></tr>' +
      '</tbody></table>' +
      '<div class="firma">' +
      '<div>Firma Piloto</div>' +
      '<div>Firma Co-Piloto</div>' +
      '</div>' +
      '<div class="foot">Manifiesto generado por el sistema — ' + new Date().toLocaleString('es-PE') + '</div>' +
      '</body></html>'
    );
  }

  function imprimirManifiesto(datos) {
    var win = abrirVentana(generarManifiestoHTML(datos), 1050, 750);
    if (win) { win.focus(); win.print(); }
  }

  window.CroquisManifiestoPrint = {
    imprimirCroquis: imprimirCroquis,
    imprimirManifiesto: imprimirManifiesto,
    generarCroquisHTML: generarCroquisHTML,
    generarManifiestoHTML: generarManifiestoHTML
  };
})(window);
