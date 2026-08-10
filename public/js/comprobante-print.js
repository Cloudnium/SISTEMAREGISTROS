/* =============================================
   public/js/comprobante-print.js
   Generador ÚNICO del diseño de Boleta/Factura impresa.
   Usado por Boletaje (al vender) y por Comprobantes (al reimprimir),
   para que ambos SIEMPRE impriman exactamente el mismo diseño —
   antes cada vista tenía su propia copia del HTML y se desincronizaban.
   ============================================= */
(function (window) {
  'use strict';

  // Valores de reserva por si algún comprobante muy antiguo no trae
  // empresa (no debería pasar tras la migración multiempresa).
  var EMPRESA_POR_DEFECTO = {
    nombre: '—', ruc: '—', direccion1: '', direccion2: '',
    web: '', seguro: '', logo: null
  };

  function formatearFecha(iso) {
    if (!iso) return '—';
    var p = String(iso).split('-');
    return p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0]) : iso;
  }

  // ── Convierte un monto a letras (Soles) ──
  function numeroALetras(monto) {
    monto = Math.max(0, Number(monto) || 0);
    var entero = Math.floor(monto);
    var centavos = Math.round((monto - entero) * 100);
    var UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
    var ESPECIALES = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
    var DECENAS = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
    var CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

    function bloque(n) {
      if (n === 0) return '';
      if (n === 100) return 'CIEN';
      var s = '';
      var c = Math.floor(n / 100), r = n % 100;
      if (c > 0) s += CENTENAS[c] + ' ';
      if (r >= 10 && r < 20) {
        s += ESPECIALES[r - 10];
      } else {
        var d = Math.floor(r / 10), u = r % 10;
        if (d > 0) s += DECENAS[d];
        if (d > 0 && u > 0) s += ' Y ';
        if (u > 0 || d === 0) s += UNIDADES[u];
      }
      return s.trim();
    }

    var texto;
    if (entero === 0) {
      texto = 'CERO';
    } else if (entero < 1000) {
      texto = bloque(entero);
    } else if (entero < 1000000) {
      var miles = Math.floor(entero / 1000), resto = entero % 1000;
      texto = (miles === 1 ? 'MIL' : bloque(miles) + ' MIL') + (resto > 0 ? ' ' + bloque(resto) : '');
    } else {
      texto = String(entero); // fuera de rango práctico para boletos
    }
    return texto + ' Y ' + String(centavos).padStart(2, '0') + '/100 SOLES';
  }

  // ── Arma el HTML completo del comprobante ──
  // datos = {
  //   serie, correlativo,              // número de boleto/factura
  //   ruc, razonSocial,                // solo si es factura
  //   agenciaEmbarqueNombre, agenciaEmbarqueDireccion,
  //   fechaSalida, horaSalida,
  //   ciudadOrigen, ciudadDestino, servicio,
  //   precio,
  //   numeroAsiento, piso,
  //   pax, tipoDocumento, numeroDocumento,
  //   usuario,
  //   polizaBus,
  //   anulado (bool)
  // }
  function generarHTML(datos) {
    var empresa = datos.empresa || EMPRESA_POR_DEFECTO;
    var esFactura = !!(datos.ruc && String(datos.ruc).trim() !== '');
    var tipoComprobante = esFactura ? 'FACTURA ELECTRONICA' : 'BOLETA DE VENTA ELECTRONICA';
    var numComprobante = (datos.serie && datos.correlativo)
      ? (datos.serie + '-' + String(datos.correlativo).padStart(7, '0'))
      : 'PENDIENTE DE EMISION';
    var ahora = new Date();

    var datosFacturaHTML = '';
    if (esFactura) {
      datosFacturaHTML =
        '<div class="small">RUC: ' + datos.ruc + '</div>' +
        '<div class="small">RAZON SOCIAL: ' + (datos.razonSocial || '—') + '</div>';
    }

    var logoHTML = empresa.logo_data_url
      ? '<div class="center" style="margin-bottom:4px"><img src="' + empresa.logo_data_url + '" style="max-width:120px;max-height:70px" /></div>'
      : '';

    return (
      '<html><head><title>' + tipoComprobante + '</title><style>' +
      'body{font-family:"Courier New",monospace;width:300px;margin:0 auto;padding:16px;color:#111;font-size:12px;}' +
      '.center{text-align:center}.bold{font-weight:700}.line{border-top:1px dashed #333;margin:8px 0}' +
      '.row{display:flex;justify-content:space-between;gap:8px}' +
      '.big{font-size:14px}.small{font-size:10px}' +
      'table{width:100%;border-collapse:collapse;font-size:11px}' +
      'td{vertical-align:top;padding:1px 0}' +
      '</style></head><body>' +
      logoHTML +
      '<div class="center bold big">' + (empresa.razon_social || empresa.nombre || '—') + '</div>' +
      '<div class="center">RUC: ' + (empresa.ruc || '—') + '</div>' +
      (empresa.domicilio_fiscal ? '<div class="center">' + empresa.domicilio_fiscal + '</div>' : '') +
      (empresa.direccion1 ? '<div class="center">' + empresa.direccion1 + '</div>' : '') +
      (empresa.direccion2 ? '<div class="center">' + empresa.direccion2 + '</div>' : '') +
      '<div class="center bold" style="margin-top:6px">' + tipoComprobante + '</div>' +
      '<div class="center bold big">' + numComprobante + (datos.anulado ? '  [ANULADO]' : '') + '</div>' +
      datosFacturaHTML +
      '<div class="line"></div>' +
      '<div class="center bold small">INFORMACION DE EMBARQUE</div>' +
      '<div class="center small">AGENCIA EMBARQUE:</div>' +
      '<div class="center bold big">' + (datos.agenciaEmbarqueNombre || datos.ciudadOrigen || '—') + '</div>' +
      (datos.agenciaEmbarqueDireccion ? '<div class="center small">' + datos.agenciaEmbarqueDireccion + '</div>' : '') +
      '<div class="line"></div>' +
      '<div class="row"><span>F.VIAJE: ' + formatearFecha(datos.fechaSalida) + '</span>' +
      '<span>H.VIAJE: ' + (datos.horaSalida || '—') + '</span></div>' +
      '<div class="line"></div>' +
      '<table><tr><td style="width:8%">#</td><td>DETALLE</td><td style="width:20%;text-align:right">TOTAL</td></tr>' +
      '<tr><td>1</td><td>SERVICIO DE TRANSPORTE EN LA<br/>RUTA: ' + (datos.ciudadOrigen || '—') + ' - ' + (datos.ciudadDestino || '—') +
      '<br/>SERVICIO: ' + (datos.servicio || '—') + '</td>' +
      '<td style="text-align:right">' + Number(datos.precio || 0).toFixed(2) + '</td></tr></table>' +
      '<div style="margin-top:6px">ASIENTO: ' + (datos.numeroAsiento || '—') + ' (Piso ' + (datos.piso || 1) + ')</div>' +
      '<div>PAX: ' + (datos.pax || '—') + '</div>' +
      '<div>' + (datos.tipoDocumento || 'DNI') + ': ' + (datos.numeroDocumento || '—') + '</div>' +
      '<div class="line"></div>' +
      '<div class="row"><span>OPERACION NO GRAVADA</span><span>' + Number(datos.precio || 0).toFixed(2) + '</span></div>' +
      '<div class="row"><span>IGV</span><span>0.00</span></div>' +
      '<div class="row bold"><span>TOTAL (S/.)</span><span>' + Number(datos.precio || 0).toFixed(2) + '</span></div>' +
      '<div class="small">SON: ' + numeroALetras(datos.precio) + '</div>' +
      '<div class="line"></div>' +
      '<div class="small">FECHA EMISION: ' + ahora.toLocaleDateString('es-PE') + '</div>' +
      '<div class="small">USUARIO: ' + (datos.usuario || '—') + '</div>' +
      '<div class="small">HORA IMPRES: ' + ahora.toLocaleTimeString('es-PE', { hour: 'numeric', minute: '2-digit' }) + '</div>' +
      (datos.polizaBus ? '<div class="line"></div><div class="small center">Los Pasajeros viajan asegurados — Poliza SOAT: ' + datos.polizaBus + '</div>' : '') +
      '<div class="line"></div>' +
      '<div class="small" style="margin-top:8px">Al recibir el presente DOCUMENTO, acepto todos los términos y condiciones del contrato del servicio de transporte detallado en el mismo.</div>' +
      '</body></html>'
    );
  }

  // ── Abre una ventana nueva, escribe el comprobante y lanza imprimir ──
  function imprimir(datos) {
    var win = window.open('', '_blank', 'width=380,height=680');
    if (!win) { alert('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para este sitio.'); return; }
    win.document.write(generarHTML(datos));
    win.document.close();
    win.focus();
    win.print();
  }

  window.ComprobantePrint = {
    generarHTML: generarHTML,
    imprimir: imprimir,
    numeroALetras: numeroALetras,
    formatearFecha: formatearFecha
  };
})(window);
