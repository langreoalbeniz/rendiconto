/* Pantalla «Faltan»: ponerse al día con los tickets que faltan de meses anteriores.
   Abre la lista que prepara el PC (07_GASTOS/FALTAN-TICKETS.json), lee los tickets con el MISMO lector y análisis del
   flujo normal (window.__app.leeDocs, sin tocar la Bandeja ni el registro) y los casa CONTRA la lista por código H,
   importe y fecha. Lo casado se tacha y se puede guardar en iCloud (RECUPERADOS) para que el PC lo meta en su mes.
   Todo local: nada se envía. */
(function () {
  'use strict';
  if (!window.Motor || !window.__app) return;
  var M = window.Motor, A = window.__app;
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var CLAVE = 'rendiconto.faltan.v1';

  // estado persistido (lista + qué ids se han tachado) y, solo en memoria, el archivo de cada ticket casado (para guardarlo)
  var SF = { lista: [], hecho: {}, nombreArchivo: '' };
  var recuperados = {}; // id -> {file, ext, mov, mes, fecha, importe, nombreSalida}
  var seq = 0;

  // ---------- utilidades ----------
  function num(x) { return typeof x === 'number' ? x : M.parseImporte(x); }
  function iso(f) {
    if (!f) return null;
    f = String(f).trim();
    var m = f.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = f.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/); if (m) return M.isoDesdeDMY(m[1], m[2], m[3]);
    return null;
  }
  function limpiaComercio(s) { return M.limpiaComercio ? M.limpiaComercio(String(s || '')) : String(s || ''); }
  function mesDe(e) {
    // «AAAA-MM» del movimiento: de su fecha si se puede; si no, del campo mes (acepta «AAAA-MM» o nombre+año no se usa aquí)
    var f = iso(e.fecha); if (f) return f.slice(0, 7);
    var m = String(e.mes || '').match(/(\d{4})[-\/.](\d{1,2})/); if (m) return m[1] + '-' + String(+m[2]).padStart(2, '0');
    return String(e.mes || '????-??');
  }
  function guarda() { try { localStorage.setItem(CLAVE, JSON.stringify(SF)); } catch (e) { /* almacenamiento lleno o bloqueado */ } }
  function carga() { try { var o = JSON.parse(localStorage.getItem(CLAVE) || 'null'); if (o && o.lista) SF = { lista: o.lista, hecho: o.hecho || {}, nombreArchivo: o.nombreArchivo || '' }; } catch (e) { /* nada guardado */ } }

  // ---------- normaliza la lista (acepta los dos esquemas) ----------
  // 1) plano (diseño 158): [{id,mes,n,fecha,comercio,importe,codigo,enviado,pista}] o {entradas:[...]}
  // 2) anidado (lo que genera el PC hoy): {meses:{"AAAA-MM":{totale, faltantes:[{n,fechaOp,codigo,importe,descripcion}]}}}
  function normaliza(j) {
    var out = [];
    if (Array.isArray(j)) j = { entradas: j };
    if (j && j.meses && typeof j.meses === 'object') {
      Object.keys(j.meses).forEach(function (mes) {
        var m = j.meses[mes] || {};
        (m.faltantes || []).forEach(function (f) {
          out.push({ id: f.id || (mes + '-' + f.n), mes: mes, n: f.n, fecha: iso(f.fecha || f.fechaOp),
            comercio: limpiaComercio(f.comercio || f.descripcion || ''), importe: num(f.importe),
            codigo: f.codigo ? String(f.codigo).toUpperCase() : null, enviado: !!(f.enviado || m.enviado) });
        });
      });
    } else if (j && Array.isArray(j.entradas)) {
      j.entradas.forEach(function (f, i) {
        out.push({ id: f.id || (mesDe(f) + '-' + (f.n != null ? f.n : i + 1)), mes: f.mes, n: f.n != null ? f.n : i + 1,
          fecha: iso(f.fecha || f.fechaOp), comercio: limpiaComercio(f.comercio || f.descripcion || ''),
          importe: num(f.importe), codigo: f.codigo ? String(f.codigo).toUpperCase() : null, enviado: !!f.enviado });
      });
    }
    // descarta las que no tienen importe legible (no se podrían casar)
    return out.filter(function (e) { return e.importe != null; });
  }

  // ---------- casación de UN ticket leído contra la lista ----------
  // reúne lo que sirve para casar de un documento leído (importes en líneas de total, códigos H y fechas)
  function datosDoc(x) {
    var cods = {}, imps = {}, fechas = {};
    ((x.doc && x.doc.zonas) || []).forEach(function (z) {
      (z.codigos || []).forEach(function (c) { cods[c.c] = 1; });
      (z.ocurrencias || []).forEach(function (o) { if (o.p >= 5) imps[M.cents(o.v)] = o.v; });
      (z.fechas || []).forEach(function (f) { fechas[f] = 1; });
    });
    if (x.codigo) cods[x.codigo] = 1;
    if (x.importe != null) imps[M.cents(x.importe)] = x.importe;
    if (x.fecha) fechas[x.fecha] = 1;
    return { codigos: Object.keys(cods), importes: Object.keys(imps).map(function (k) { return imps[k]; }), fechas: Object.keys(fechas) };
  }
  // pendientes = no tachadas aún. Devuelve {estado:'ok',entry,via} | {estado:'elegir',opciones,via} | {estado:'sinmov'}
  function casa(x) {
    var d = datosDoc(x);
    var pend = SF.lista.filter(function (e) { return !SF.hecho[e.id]; });
    // 1) código de operación (H + 5 cifras): la clave más fiable
    for (var i = 0; i < d.codigos.length; i++) {
      var c = d.codigos[i];
      var mc = pend.filter(function (e) { return e.codigo && e.codigo === c; });
      if (mc.length === 1) return { estado: 'ok', entry: mc[0], via: 'código ' + c };
      if (mc.length > 1) return { estado: 'elegir', opciones: mc.slice(0, 3), via: 'código ' + c };
    }
    // 2) importe en una línea de total; la fecha solo desempata
    for (var j = 0; j < d.importes.length; j++) {
      var v = d.importes[j];
      var mi = pend.filter(function (e) { return M.cents(e.importe) === M.cents(v); });
      if (!mi.length) continue;
      if (mi.length === 1) return { estado: 'ok', entry: mi[0], via: 'importe ' + M.eur(v) };
      var conF = mi.filter(function (e) { return e.fecha && d.fechas.indexOf(e.fecha) >= 0; });
      if (conF.length === 1) return { estado: 'ok', entry: conF[0], via: 'importe y fecha' };
      return { estado: 'elegir', opciones: (conF.length >= 2 ? conF : mi).slice(0, 3), via: 'importe ' + M.eur(v) };
    }
    return { estado: 'sinmov' };
  }

  // ---------- marcar y recuperar ----------
  function extDe(nombre, tipo) {
    var m = String(nombre || '').match(/\.([A-Za-z0-9]{1,5})$/); if (m) return m[1].toLowerCase();
    return { imagen: 'jpg', pdf: 'pdf', xml: 'xml', html: 'html', texto: 'txt' }[tipo] || 'dat';
  }
  function nombreSalida(e, ext) {
    var f = iso(e.fecha), yyyy, mm, dd;
    if (f) { yyyy = f.slice(0, 4); mm = f.slice(5, 7); dd = f.slice(8, 10); }
    else { var p = mesDe(e).split('-'); yyyy = p[0]; mm = (p[1] || '00'); dd = '00'; }
    return yyyy + '-' + mm + '_mov' + e.n + '_' + dd + '-' + mm + '-' + yyyy + '_' + M.eurNum(e.importe) + '.' + ext;
  }
  function marca(entry, x) {
    var ext = extDe(x.nombre, x.tipo);
    SF.hecho[entry.id] = { fecha: new Date().toISOString().slice(0, 10), importe: entry.importe, nombre: x.nombre, archivo: nombreSalida(entry, ext) };
    recuperados[entry.id] = { file: x.file, ext: ext, n: entry.n, mes: mesDe(entry), fecha: entry.fecha, importe: entry.importe, nombreSalida: nombreSalida(entry, ext), enviado: entry.enviado };
    guarda();
  }

  // ---------- pintado ----------
  function pendientes() { return SF.lista.filter(function (e) { return !SF.hecho[e.id]; }); }
  function pintaEstadoLista() {
    $('#faltanNombre').textContent = SF.nombreArchivo ? '· ' + SF.nombreArchivo : '';
    var hay = SF.lista.length > 0;
    $('#faltanVacio').hidden = hay;
    $('#faltanPanel').hidden = !hay;
    if (!hay) { $('#faltanEstadoLista').innerHTML = ''; return; }
    $('#faltanEstadoLista').innerHTML = '<div class="cuadre ok">Lista cargada: ' + SF.lista.length + ' movimiento(s) sin ticket, en ' + mesesUnicos().length + ' mes(es).</div>';
  }
  function mesesUnicos() { var s = {}; SF.lista.forEach(function (e) { s[mesDe(e)] = 1; }); return Object.keys(s).sort(); }
  function pinta() {
    pintaEstadoLista();
    if (!SF.lista.length) return;
    var q = ($('#faltanBuscar').value || '').trim().toLowerCase();
    var soloNoEnv = $('#faltanSoloNoEnv').checked;
    var totalPend = pendientes().length;
    $('#faltanContador').textContent = totalPend + ' de ' + SF.lista.length + ' pendientes' + (q || soloNoEnv ? ' (con filtro)' : '');
    var filtra = function (e) {
      if (soloNoEnv && e.enviado) return false;
      if (!q) return true;
      return (e.comercio || '').toLowerCase().indexOf(q) >= 0 || M.eurNum(e.importe).indexOf(q) >= 0 || String(e.importe).indexOf(q) >= 0;
    };
    var html = '';
    mesesUnicos().forEach(function (mes) {
      var ent = SF.lista.filter(function (e) { return mesDe(e) === mes && filtra(e); });
      if (!ent.length) return;
      var pend = ent.filter(function (e) { return !SF.hecho[e.id]; }).length;
      html += '<h3>' + esc(mes) + ' · ' + pend + ' de ' + ent.length + ' pendientes</h3><div class="scroll"><table><thead><tr><th>Nº</th><th>Fecha</th><th>Comercio</th><th class="num">Importe</th><th>Estado</th></tr></thead><tbody>';
      ent.sort(function (a, b) { return (a.n || 0) - (b.n || 0); }).forEach(function (e) {
        var h = SF.hecho[e.id];
        var est = h ? '<span class="estado ok">✔ recuperado</span>' : (e.enviado ? '<span class="estado aviso">ya enviado</span>' : '<span class="estado mal">falta</span>');
        html += '<tr' + (h ? ' style="opacity:.6;text-decoration:line-through"' : '') + '><td>' + esc(e.n) + '</td><td>' + esc(e.fecha ? M.fechaDMY(e.fecha) : '—') + '</td><td>' + esc(e.comercio || '—') + (e.codigo ? ' <code>' + esc(e.codigo) + '</code>' : '') + '</td><td class="num">' + M.eur(e.importe) + '</td><td>' + est + '</td></tr>';
      });
      html += '</tbody></table></div>';
    });
    $('#faltanLista').innerHTML = html || '<div class="ayuda">Nada coincide con el filtro.</div>';
    var nRec = Object.keys(recuperados).length;
    var b = $('#btnFaltanGuardar'); b.disabled = !nRec; b.textContent = nRec ? '⬇ Guardar en iCloud ' + nRec + ' ticket(s) casado(s)' : '⬇ Guardar en iCloud los tickets casados';
  }

  // ---------- añadir tickets ----------
  function progreso(f, t) { var p = $('#progFaltan'); p.classList.add('on'); p.querySelector('.barra-p div').style.width = Math.round(f * 100) + '%'; p.querySelector('.txt').textContent = t || ''; }
  function finProg() { $('#progFaltan').classList.remove('on'); }

  function tarjetaResultado(x, res) {
    var id = 'fr' + (seq++);
    var mini = x.mini ? '<img class="mini" src="' + x.mini + '" style="cursor:zoom-in">' : '';
    var cab = '<div class="barra" style="margin:0 0 6px">' + mini + '<b>' + esc(x.nombre) + '</b></div>';
    var cuerpo, clase;
    if (res.estado === 'ok') {
      clase = 'ok'; var e = res.entry;
      cuerpo = '<span class="estado ok">✔ casado (' + esc(res.via) + ')</span> con Mov. ' + esc(e.n) + ' · ' + esc(mesDe(e)) + ' · ' + esc(e.comercio || '—') + ' · <b>' + M.eur(e.importe) + '</b>' + (e.enviado ? ' <span class="estado aviso">(ese mes ya se envió: para enviar aparte)</span>' : '');
    } else if (res.estado === 'elegir') {
      clase = 'aviso';
      cuerpo = '<span class="estado aviso">⚠ hay ' + res.opciones.length + ' movimientos con ese ' + (/código/.test(res.via) ? 'código' : 'importe') + ': ¿cuál es?</span><div class="barra" data-elige="' + id + '">' +
        res.opciones.map(function (e, i) { return '<button class="btn peq" data-i="' + i + '">Mov. ' + esc(e.n) + ' · ' + esc(mesDe(e)) + ' · ' + esc(e.comercio || '—') + ' · ' + M.eur(e.importe) + '</button>'; }).join('') +
        '<button class="btn sec peq" data-i="-1">Ninguno</button></div>';
    } else {
      clase = 'mal';
      cuerpo = '<span class="estado mal">sin movimiento</span>: este ticket (' + (x.importe != null ? M.eur(x.importe) : 'importe no leído') + ') no está en la lista. Déjalo para su rendiconto normal.';
    }
    var div = document.createElement('div');
    div.className = 'caja'; div.id = id; div.style.borderLeft = '4px solid var(--' + clase + ')';
    div.innerHTML = cab + '<div>' + cuerpo + '</div>';
    $('#faltanResultado').insertBefore(div, $('#faltanResultado').firstChild);
    if (x.mini) div.querySelector('.mini').onclick = function () { A.zoom(x.full || x.mini); };
    if (res.estado === 'elegir') div.querySelectorAll('[data-elige] button').forEach(function (bt) {
      bt.onclick = function () {
        var i = +bt.dataset.i;
        if (i >= 0) { marca(res.opciones[i], x); div.style.borderLeftColor = 'var(--ok)'; div.querySelector('div').innerHTML = '<span class="estado ok">✔ casado con Mov. ' + esc(res.opciones[i].n) + '</span>'; }
        else { div.style.borderLeftColor = 'var(--mal)'; div.querySelector('div').innerHTML = '<span class="estado mal">sin casar (lo dejas para su rendiconto normal)</span>'; }
        pinta();
      };
    });
  }

  function anade(files) {
    files = Array.prototype.slice.call(files);
    if (!files.length) return;
    $('#faltanAvisos').innerHTML = '';
    progreso(0, 'Preparando…');
    A.leeDocs(files, function (f, t) { progreso(f, t); }).then(function (leidos) {
      finProg();
      var avisos = [];
      leidos.forEach(function (x) {
        if (x.error) { avisos.push(x.nombre + ': ' + x.error); return; }
        var res = casa(x);
        if (res.estado === 'ok') marca(res.entry, x);
        tarjetaResultado(x, res);
      });
      if (avisos.length) $('#faltanAvisos').innerHTML = '<div class="cuadre aviso">' + avisos.map(esc).join('<br>') + '</div>';
      pinta();
    }).catch(function (e) { finProg(); $('#faltanAvisos').innerHTML = '<div class="cuadre mal">Error leyendo los tickets: ' + esc(e.message) + '</div>'; console.error(e); });
  }

  // ---------- guardar en iCloud (un ZIP: fiable en el iPhone) ----------
  function cargaScript(src) { return new Promise(function (ok, ko) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { ko(new Error('No se pudo cargar ' + src)); }; document.head.appendChild(s); }); }
  async function guardaICloud() {
    var ids = Object.keys(recuperados); if (!ids.length) return;
    if (!window.JSZip) await cargaScript('lib/jszip.min.js');
    var zip = new window.JSZip();
    var usados = {};
    var hechos = ids.map(function (id) {
      var r = recuperados[id], nombre = r.nombreSalida;
      while (usados[nombre]) { nombre = nombre.replace(/(\.[^.]+)$/, '_b$1'); } // por si dos casan al mismo nombre
      usados[nombre] = 1;
      zip.file(nombre, r.file);
      if (SF.hecho[id]) SF.hecho[id].archivo = nombre;
      return { id: id, mes: r.mes, n: r.n, fecha: r.fecha, importe: r.importe, enviado: !!r.enviado, archivo: nombre };
    });
    zip.file('FALTAN-TICKETS-hecho.json', JSON.stringify({ generado: new Date().toISOString(), hechos: hechos }, null, 2));
    var blob = await zip.generateAsync({ type: 'blob' });
    var hoy = new Date().toISOString().slice(0, 10);
    A.descarga('RECUPERADOS-' + hoy + '.zip', blob, 'application/zip');
    guarda();
    $('#faltanAvisos').innerHTML = '<div class="cuadre ok">Guardado <b>RECUPERADOS-' + hoy + '.zip</b> con ' + hechos.length + ' ticket(s) y la lista de tachados. Descomprímelo en iCloud Drive ▸ 07_GASTOS ▸ RECUPERADOS.</div>';
  }

  // ---------- arranque ----------
  function init() {
    carga();
    $('#fFaltanLista').onchange = function () {
      var file = this.files[0]; this.value = '';
      if (!file) return;
      file.text().then(function (txt) {
        var j; try { j = JSON.parse(txt); } catch (e) { $('#faltanEstadoLista').innerHTML = '<div class="cuadre mal">No es un JSON válido.</div>'; return; }
        var lista = normaliza(j);
        if (!lista.length) { $('#faltanEstadoLista').innerHTML = '<div class="cuadre mal">La lista no tiene movimientos con importe (¿es FALTAN-TICKETS.json?).</div>'; return; }
        // conserva lo ya tachado cuyos id sigan en la lista nueva
        var ids = {}; lista.forEach(function (e) { ids[e.id] = 1; });
        var hecho = {}; Object.keys(SF.hecho).forEach(function (k) { if (ids[k]) hecho[k] = SF.hecho[k]; });
        SF = { lista: lista, hecho: hecho, nombreArchivo: file.name }; guarda(); recuperados = {}; pinta();
      });
    };
    $('#faltanBuscar').oninput = pinta;
    $('#faltanSoloNoEnv').onchange = pinta;
    $('#fFaltanTicket').onchange = function () { var fs = Array.prototype.slice.call(this.files); this.value = ''; anade(fs); };
    $('#fabFaltan').onclick = function () { $('#fFaltanTicket').click(); };
    $('#btnFaltanGuardar').onclick = function () { guardaICloud().catch(function (e) { $('#faltanAvisos').innerHTML = '<div class="cuadre mal">Error al guardar: ' + esc(e.message) + '</div>'; console.error(e); }); };
    // el botón flotante «+ Ticket» solo en esta pestaña
    Array.prototype.forEach.call(document.querySelectorAll('#nav button'), function (b) {
      b.addEventListener('click', function () { $('#fabFaltan').hidden = b.dataset.p !== 'p7'; });
    });
    pinta();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  // para las pruebas automáticas
  window.Faltan = { normaliza: normaliza, casa: casa, nombreSalida: nombreSalida, datosDoc: datosDoc,
    estado: function () { return SF; }, recuperados: function () { return recuperados; },
    cargaLista: function (j) { SF = { lista: normaliza(j), hecho: {}, nombreArchivo: 'test' }; recuperados = {}; pinta(); return SF.lista; } };
})();
