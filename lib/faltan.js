/* Pantalla «Faltan»: ponerse al día con los tickets que faltan de meses anteriores.
   Abre la lista que prepara el PC (07_GASTOS/FALTAN-TICKETS.json), lee los tickets con el MISMO lector y análisis del
   flujo normal (window.__app.leeDocs, sin tocar la Bandeja ni el registro) y los casa CONTRA la lista por código H,
   importe y fecha. Cada movimiento tiene 4 estados: falta · propuesto (lo casó el PC, por confirmar) · a elegir (varios
   candidatos) · recuperado (ya tiene ticket). El titular confirma/rechaza los propuestos, elige en los «a elegir» y sube
   tickets nuevos; todo se guarda en iCloud (RECUPERADOS + DECISIONES) para que el PC lo aplique. Nada se envía. */
(function () {
  'use strict';
  if (!window.Motor || !window.__app) return;
  var M = window.Motor, A = window.__app;
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var CLAVE = 'rendiconto.faltan.v2';
  // los meses que reclama antes la sede van arriba
  var PRIORIDAD = { '2026-04': 0, '2026-08': 1 };

  // estado persistido: lista + candidatos «a elegir» + qué se ha hecho (subido) + decisiones de revisión (confirmar/rechazar/elegir)
  var SF = { lista: [], aElegir: [], hecho: {}, decididos: { confirma: {}, rechaza: {}, elige: {} }, nombreArchivo: '' };
  var recuperados = {}; // id -> {file, ext, mov, mes, fecha, importe, nombreSalida}  (tickets subidos, con bytes)
  var seq = 0;
  // paquete de PDFs de los tickets propuestos que prepara el PC (PROPUESTOS-REVISAR.zip): para VER el ticket antes de
  // confirmarlo. files: nombre de archivo -> File (PDF o imagen). vistos: id del movimiento -> true (visor abierto).
  var propBundle = { files: {}, nombre: '' };
  var vistos = {};
  function propDe(e) { return (e.propuesto && e.propuesto.archivo && propBundle.files[e.propuesto.archivo]) || null; }

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
    var f = iso(e.fecha); if (f) return f.slice(0, 7);
    var m = String(e.mes || '').match(/(\d{4})[-\/.](\d{1,2})/); if (m) return m[1] + '-' + String(+m[2]).padStart(2, '0');
    return String(e.mes || '????-??');
  }
  function guarda() { try { localStorage.setItem(CLAVE, JSON.stringify(SF)); } catch (e) { /* almacenamiento lleno o bloqueado */ } }
  function carga() {
    try {
      var o = JSON.parse(localStorage.getItem(CLAVE) || 'null');
      if (o && o.lista) SF = { lista: o.lista, aElegir: o.aElegir || [], hecho: o.hecho || {},
        decididos: { confirma: (o.decididos || {}).confirma || {}, rechaza: (o.decididos || {}).rechaza || {}, elige: (o.decididos || {}).elige || {} },
        nombreArchivo: o.nombreArchivo || '' };
    } catch (e) { /* nada guardado */ }
  }

  // ---------- normaliza la lista (acepta los dos esquemas) ----------
  // 1) plano (diseño 158): {entradas:[{id,mes,n,fecha,comercio,importe,codigo,enviado,propuesto,recuperado}]}
  // 2) anidado (lo que genera el PC): {meses:{"AAAA-MM":{totale, faltantes:[{n,fechaOp,codigo,importe,descripcion,propuesto,recuperado}]}}}
  // Ambos pueden traer top-level «a_elegir»: [{origen,pagina,via,leido,opciones:[{id,mes,n,...}]}].
  function entrada(f, mes, i) {
    return {
      id: f.id || ((mes || mesDe(f)) + '-' + (f.n != null ? f.n : i + 1)),
      mes: mes || f.mes, n: f.n != null ? f.n : i + 1,
      fecha: iso(f.fecha || f.fechaOp), comercio: limpiaComercio(f.comercio || f.descripcion || ''),
      importe: num(f.importe), codigo: f.codigo ? String(f.codigo).toUpperCase() : null,
      enviado: !!(f.enviado), propuesto: f.propuesto || null, recuperado: f.recuperado || null
    };
  }
  function normaliza(j) {
    var out = [];
    if (Array.isArray(j)) j = { entradas: j };
    if (j && j.meses && typeof j.meses === 'object') {
      Object.keys(j.meses).forEach(function (mes) {
        var m = j.meses[mes] || {};
        (m.faltantes || []).forEach(function (f, i) { var e = entrada(f, mes, i); e.enviado = e.enviado || !!m.enviado; out.push(e); });
      });
    } else if (j && Array.isArray(j.entradas)) {
      j.entradas.forEach(function (f, i) { out.push(entrada(f, null, i)); });
    }
    // descarta las que no tienen importe legible (no se podrían casar)
    return out.filter(function (e) { return e.importe != null; });
  }
  function normalizaElegir(j) {
    var arr = (j && Array.isArray(j.a_elegir)) ? j.a_elegir : [];
    return arr.map(function (x, i) {
      return { key: x.key || ('ae' + i + '-' + (x.origen || '') + '-' + (x.pagina != null ? x.pagina : '')),
        origen: x.origen || x.nombre || '', pagina: x.pagina, via: x.via || '', leido: x.leido || {},
        opciones: (x.opciones || []).map(function (o) { return { id: o.id || (o.mes + '-' + o.n), mes: o.mes, n: o.n,
          fecha: iso(o.fecha), comercio: limpiaComercio(o.comercio || ''), importe: num(o.importe), codigo: o.codigo || null }; }) };
    }).filter(function (x) { return x.opciones.length; });
  }

  // ---------- estado de cada movimiento ----------
  function grupoResuelto(x) { return x.opciones.some(function (o) { return SF.decididos.elige[o.id]; }); }
  // solo los grupos «a elegir» SIN resolver pintan sus opciones como «a elegir»; al elegir una, las demás vuelven a «falta»
  function idsElegir() { var s = {}; SF.aElegir.forEach(function (x) { if (!grupoResuelto(x)) x.opciones.forEach(function (o) { s[o.id] = x; }); }); return s; }
  function estadoDe(e, mapaElegir) {
    if (SF.hecho[e.id] || e.recuperado || SF.decididos.confirma[e.id] || SF.decididos.elige[e.id]) return 'recuperado';
    if (e.propuesto && !SF.decididos.rechaza[e.id]) return 'propuesto';
    if ((mapaElegir || idsElegir())[e.id]) return 'elegir';
    return 'falta';
  }

  // ---------- casación de UN ticket leído contra la lista ----------
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
  // pendientes = ni recuperadas ni ya casadas en esta sesión. Devuelve
  // {estado:'ok',entry,via,yaPropuesto?} | {estado:'elegir',opciones,via} | {estado:'sinmov'}
  function casa(x) {
    var d = datosDoc(x);
    var mapa = idsElegir();
    var pend = SF.lista.filter(function (e) {
      var st = estadoDe(e, mapa);
      return st !== 'recuperado';          // se puede casar algo que esté «falta» o «propuesto» (confirma el propuesto)
    });
    // 1) código de operación (H + cifras): la clave más fiable
    for (var i = 0; i < d.codigos.length; i++) {
      var c = d.codigos[i];
      var mc = pend.filter(function (e) { return e.codigo && e.codigo === c; });
      if (mc.length === 1) return resultadoOk(mc[0], 'código ' + c);
      if (mc.length > 1) return { estado: 'elegir', opciones: mc.slice(0, 3), via: 'código ' + c };
    }
    // 2) importe en una línea de total; la fecha solo desempata
    for (var j = 0; j < d.importes.length; j++) {
      var v = d.importes[j];
      var mi = pend.filter(function (e) { return M.cents(e.importe) === M.cents(v); });
      if (!mi.length) continue;
      if (mi.length === 1) return resultadoOk(mi[0], 'importe ' + M.eur(v));
      var conF = mi.filter(function (e) { return e.fecha && d.fechas.indexOf(e.fecha) >= 0; });
      if (conF.length === 1) return resultadoOk(conF[0], 'importe y fecha');
      return { estado: 'elegir', opciones: (conF.length >= 2 ? conF : mi).slice(0, 3), via: 'importe ' + M.eur(v) };
    }
    return { estado: 'sinmov' };
  }
  function resultadoOk(entry, via) { return { estado: 'ok', entry: entry, via: via, yaPropuesto: !!(entry.propuesto && !SF.decididos.rechaza[entry.id]) }; }

  // ---------- marcar y recuperar (ticket subido con bytes) ----------
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
    // subir un ticket que casa con un movimiento ya «propuesto» lo deja por confirmado de hecho: no se vuelve a proponer
    delete SF.decididos.rechaza[entry.id];
    guarda();
  }

  // ---------- revisión de propuestos y «a elegir» (decisiones, sin bytes: el ticket ya está en el PC) ----------
  function confirmaPropuesto(e) { if (!e.propuesto) return; SF.decididos.confirma[e.id] = { mes: e.mes, n: e.n, archivo: (e.propuesto && e.propuesto.archivo) || null }; delete SF.decididos.rechaza[e.id]; guarda(); }
  function rechazaPropuesto(e) { SF.decididos.rechaza[e.id] = { mes: e.mes, n: e.n }; delete SF.decididos.confirma[e.id]; guarda(); }
  function eligeOpcion(aeKey, opt) { SF.decididos.elige[opt.id] = { key: aeKey, mes: opt.mes, n: opt.n }; guarda(); }
  function nDecisiones() { return Object.keys(SF.decididos.confirma).length + Object.keys(SF.decididos.rechaza).length + Object.keys(SF.decididos.elige).length; }

  // ---------- pintado ----------
  function mesesUnicos() {
    var s = {}; SF.lista.forEach(function (e) { s[mesDe(e)] = 1; });
    SF.aElegir.forEach(function (x) { x.opciones.forEach(function (o) { if (o.mes) s[o.mes] = 1; }); });
    return Object.keys(s).sort(function (a, b) { var pa = (a in PRIORIDAD) ? PRIORIDAD[a] : 9, pb = (b in PRIORIDAD) ? PRIORIDAD[b] : 9; return pa - pb || (a < b ? -1 : a > b ? 1 : 0); });
  }
  function cuenta() {
    var mapa = idsElegir();
    var c = { falta: 0, propuesto: 0, elegir: 0, recuperado: 0 };
    SF.lista.forEach(function (e) { c[estadoDe(e, mapa)]++; });
    return c;
  }
  var ETIQUETA = {
    falta: '<span class="estado mal">falta</span>',
    propuesto: '<span class="estado aviso">propuesto</span>',
    elegir: '<span class="estado aviso">a elegir</span>',
    recuperado: '<span class="estado ok">✔ recuperado</span>'
  };
  function pintaEstadoLista() {
    $('#faltanNombre').textContent = SF.nombreArchivo ? '· ' + SF.nombreArchivo : '';
    var hay = SF.lista.length > 0;
    $('#faltanVacio').hidden = hay;
    $('#faltanPanel').hidden = !hay;
    if (!hay) { $('#faltanEstadoLista').innerHTML = ''; return; }
    var c = cuenta();
    $('#faltanEstadoLista').innerHTML = '<div class="cuadre ok">Lista cargada: ' + SF.lista.length + ' movimiento(s) sin ticket, en ' + mesesUnicos().length + ' mes(es). ' +
      c.recuperado + ' recuperado(s) · ' + c.propuesto + ' propuesto(s) · ' + c.elegir + ' a elegir · ' + c.falta + ' falta(n).</div>';
  }
  function pinta() {
    pintaEstadoLista();
    if (!SF.lista.length) { pintaElegir(); return; }
    var q = ($('#faltanBuscar').value || '').trim().toLowerCase();
    var soloNoEnv = $('#faltanSoloNoEnv').checked;
    var mapa = idsElegir();
    var totalFalta = SF.lista.filter(function (e) { return estadoDe(e, mapa) === 'falta'; }).length;
    var totalPend = SF.lista.filter(function (e) { var s = estadoDe(e, mapa); return s !== 'recuperado'; }).length;
    $('#faltanContador').textContent = totalPend + ' sin recuperar (de ' + SF.lista.length + '), ' + totalFalta + ' sin ninguna pista' + (q || soloNoEnv ? ' · con filtro' : '');
    var filtra = function (e) {
      if (soloNoEnv && e.enviado) return false;
      if (!q) return true;
      return (e.comercio || '').toLowerCase().indexOf(q) >= 0 || M.eurNum(e.importe).indexOf(q) >= 0 || String(e.importe).indexOf(q) >= 0;
    };
    var html = '';
    mesesUnicos().forEach(function (mes) {
      var ent = SF.lista.filter(function (e) { return mesDe(e) === mes && filtra(e); });
      if (!ent.length) return;
      var cm = { falta: 0, propuesto: 0, elegir: 0, recuperado: 0 };
      ent.forEach(function (e) { cm[estadoDe(e, mapa)]++; });
      html += '<h3>' + esc(mes) + ' · <span class="estado ok">' + cm.recuperado + ' rec.</span> <span class="estado aviso">' + cm.propuesto + ' prop.</span> <span class="estado aviso">' + cm.elegir + ' eleg.</span> <span class="estado mal">' + cm.falta + ' falta</span></h3>' +
        '<div class="scroll"><table><thead><tr><th>Nº</th><th>Fecha</th><th>Comercio</th><th class="num">Importe</th><th>Estado</th><th></th></tr></thead><tbody>';
      ent.sort(function (a, b) { return (a.n || 0) - (b.n || 0); }).forEach(function (e) {
        var st = estadoDe(e, mapa);
        var acc = '';
        if (st === 'propuesto') {
          if (propDe(e)) acc += '<button class="btn sec peq" data-ver="' + esc(e.id) + '">' + (vistos[e.id] ? '▲ ocultar' : '👁 ver ticket') + '</button> ';
          acc += '<button class="btn peq" data-conf="' + esc(e.id) + '">✔ Confirmar</button> <button class="btn sec peq" data-rech="' + esc(e.id) + '">✗ Rechazar</button>';
        }
        var detalle = (st === 'propuesto' && e.propuesto) ? '<div class="ayuda">propuesto por el PC · ' + esc(e.propuesto.via || '') + (e.propuesto.archivo ? ' · <code>' + esc(e.propuesto.archivo) + '</code>' : '') + '</div>' : '';
        html += '<tr' + (st === 'recuperado' ? ' style="opacity:.6;text-decoration:line-through"' : '') + '><td>' + esc(e.n) + '</td><td>' + esc(e.fecha ? M.fechaDMY(e.fecha) : '—') + '</td><td>' + esc(e.comercio || '—') + (e.codigo ? ' <code>' + esc(e.codigo) + '</code>' : '') + detalle + '</td><td class="num">' + M.eur(e.importe) + '</td><td>' + ETIQUETA[st] + (e.enviado ? ' <span class="estado aviso" title="ese mes ya se envió">env.</span>' : '') + '</td><td>' + acc + '</td></tr>';
        if (st === 'propuesto' && vistos[e.id] && propDe(e)) html += '<tr class="visor-row"><td colspan="6"><div class="visor" data-visor="' + esc(e.id) + '"><span class="ayuda">Mostrando el ticket…</span></div></td></tr>';
      });
      html += '</tbody></table></div>';
    });
    $('#faltanLista').innerHTML = html || '<div class="ayuda">Nada coincide con el filtro.</div>';
    // engancha los botones Confirmar/Rechazar/ver ticket
    $('#faltanLista').querySelectorAll('[data-conf]').forEach(function (b) { b.onclick = function () { var e = SF.lista.filter(function (x) { return x.id === b.dataset.conf; })[0]; if (e) { confirmaPropuesto(e); pinta(); } }; });
    $('#faltanLista').querySelectorAll('[data-rech]').forEach(function (b) { b.onclick = function () { var e = SF.lista.filter(function (x) { return x.id === b.dataset.rech; })[0]; if (e) { rechazaPropuesto(e); pinta(); } }; });
    $('#faltanLista').querySelectorAll('[data-ver]').forEach(function (b) { b.onclick = function () { vistos[b.dataset.ver] = !vistos[b.dataset.ver]; pinta(); }; });
    pintaVisores();
    pintaElegir();
    var nRec = Object.keys(recuperados).length, nDec = nDecisiones();
    var b = $('#btnFaltanGuardar'); b.disabled = !nRec; b.textContent = nRec ? '⬇ Guardar en iCloud ' + nRec + ' ticket(s) subido(s)' : '⬇ Guardar en iCloud los tickets subidos';
    var bd = $('#btnFaltanDecisiones'); if (bd) { bd.disabled = !nDec; bd.textContent = nDec ? '⬇ Guardar ' + nDec + ' revisión(es) (confirmar/rechazar/elegir)' : '⬇ Guardar las revisiones'; }
  }
  // sección «A elegir»: un ticket escaneado que cuadra con varios movimientos; el titular escoge cuál
  function pintaElegir() {
    var cont = $('#faltanElegir'); if (!cont) return;
    var pend = SF.aElegir.filter(function (x) { return !x.opciones.some(function (o) { return SF.decididos.elige[o.id]; }); });
    if (!SF.aElegir.length) { cont.innerHTML = ''; return; }
    var html = '<h3>A elegir · ' + pend.length + ' sin resolver (de ' + SF.aElegir.length + ')</h3>' +
      '<div class="ayuda">Un ticket escaneado cuadra con varios movimientos. Mira el ticket y elige cuál es.</div>';
    SF.aElegir.forEach(function (x) {
      var resuelto = x.opciones.filter(function (o) { return SF.decididos.elige[o.id]; })[0];
      html += '<div class="caja" style="border-left:4px solid var(--' + (resuelto ? 'ok' : 'aviso') + ')"><b>' + esc(x.origen || 'ticket') + (x.pagina != null ? ' · pág. ' + (x.pagina + 1) : '') + '</b>' +
        ' <span class="ayuda">leído ' + (x.leido && x.leido.importe != null ? M.eur(x.leido.importe) : '—') + (x.via ? ' · ' + esc(x.via) : '') + '</span><div class="barra" data-ae="' + esc(x.key) + '">';
      if (resuelto) html += '<span class="estado ok">✔ elegido Mov. ' + esc(resuelto.n) + ' · ' + esc(resuelto.mes) + '</span>';
      else html += x.opciones.map(function (o, i) { return '<button class="btn peq" data-i="' + i + '">Mov. ' + esc(o.n) + ' · ' + esc(o.mes) + ' · ' + esc(o.comercio || '—') + ' · ' + M.eur(o.importe) + '</button>'; }).join('') + '<button class="btn sec peq" data-i="-1">Ninguno</button>';
      html += '</div></div>';
    });
    cont.innerHTML = html;
    cont.querySelectorAll('[data-ae]').forEach(function (barra) {
      var x = SF.aElegir.filter(function (y) { return y.key === barra.dataset.ae; })[0]; if (!x) return;
      barra.querySelectorAll('button').forEach(function (bt) { bt.onclick = function () { var i = +bt.dataset.i; if (i >= 0) eligeOpcion(x.key, x.opciones[i]); else x.opciones.forEach(function (o) { delete SF.decididos.elige[o.id]; }); guarda(); pinta(); }; });
    });
  }

  // pinta el PDF/imagen de cada ticket propuesto con el visor abierto (reutiliza pdf.js de la app; solo mostrar, no analiza)
  function pintaVisores() {
    $('#faltanLista').querySelectorAll('[data-visor]').forEach(function (div) {
      var e = SF.lista.filter(function (x) { return x.id === div.dataset.visor; })[0];
      var f = e && propDe(e); if (!f) { div.innerHTML = '<span class="ayuda">El PDF de este ticket no está en el paquete.</span>'; return; }
      A.vistaDoc(f).then(function (el) { div.innerHTML = ''; div.appendChild(el); })
        .catch(function (err) { div.innerHTML = '<span class="estado mal">No se pudo mostrar el ticket (' + esc(err.message) + ').</span>'; console.error(err); });
    });
  }
  // carga el paquete PROPUESTOS-REVISAR.zip del PC (manifiesto propuestos.json + un PDF/imagen por ticket propuesto)
  async function abrePropuestos(file) {
    if (!window.JSZip) await cargaScript('lib/jszip.min.js');
    var zip = await window.JSZip.loadAsync(file);
    var files = {};
    var nombres = Object.keys(zip.files);
    for (var i = 0; i < nombres.length; i++) {
      var name = nombres[i], entry = zip.files[name];
      if (entry.dir) continue;
      var base = name.split('/').pop();
      if (base === 'propuestos.json' || !base) continue;
      files[base] = new File([await entry.async('blob')], base);
    }
    propBundle = { files: files, nombre: file.name };
    // ¿cuántos de los propuestos de la lista cargada tienen ya su PDF en el paquete?
    var casan = SF.lista.filter(function (e) { return e.propuesto && propBundle.files[e.propuesto.archivo]; }).length;
    var total = Object.keys(files).length;
    $('#faltanPropuestosEstado').innerHTML = '<div class="cuadre ok">Paquete de propuestos cargado: <b>' + total + '</b> ticket(s)' +
      (SF.lista.length ? ' · ' + casan + ' casan con los propuestos de la lista. Pulsa «👁 ver ticket» en cada propuesto.' :
        '. Abre también la lista (<code>FALTAN-TICKETS.json</code>) para revisarlos.') + '</div>';
    pinta();
  }

  // ---------- añadir tickets (subida con bytes) ----------
  function progreso(f, t) { var p = $('#progFaltan'); p.classList.add('on'); p.querySelector('.barra-p div').style.width = Math.round(f * 100) + '%'; p.querySelector('.txt').textContent = t || ''; }
  function finProg() { $('#progFaltan').classList.remove('on'); }

  function tarjetaResultado(x, res) {
    var id = 'fr' + (seq++);
    var mini = x.mini ? '<img class="mini" src="' + x.mini + '" style="cursor:zoom-in">' : '';
    var cab = '<div class="barra" style="margin:0 0 6px">' + mini + '<b>' + esc(x.nombre) + '</b></div>';
    var cuerpo, clase;
    if (res.estado === 'ok') {
      clase = 'ok'; var e = res.entry;
      cuerpo = '<span class="estado ok">✔ casado (' + esc(res.via) + ')</span> con Mov. ' + esc(e.n) + ' · ' + esc(mesDe(e)) + ' · ' + esc(e.comercio || '—') + ' · <b>' + M.eur(e.importe) + '</b>' +
        (res.yaPropuesto ? ' <span class="estado aviso">(el PC ya lo había propuesto: no se duplica, queda confirmado)</span>' : '') +
        (e.enviado ? ' <span class="estado aviso">(ese mes ya se envió: para enviar aparte)</span>' : '');
    } else if (res.estado === 'elegir') {
      clase = 'aviso';
      cuerpo = '<span class="estado aviso">⚠ hay ' + res.opciones.length + ' movimientos con ese ' + (/código/.test(res.via) ? 'código' : 'importe') + ': ¿cuál es?</span><div class="barra" data-elige="' + id + '">' +
        res.opciones.map(function (e, i) { return '<button class="btn peq" data-i="' + i + '">Mov. ' + esc(e.n) + ' · ' + esc(mesDe(e)) + ' · ' + esc(e.comercio || '—') + ' · ' + M.eur(e.importe) + '</button>'; }).join('') +
        '<button class="btn sec peq" data-i="-1">Ninguno</button></div>';
    } else {
      clase = 'mal';
      cuerpo = '<span class="estado mal">sin movimiento</span>: este ticket (' + (x.importe != null ? M.eur(x.importe) : 'importe no leído') + ') no está en la lista. Si es de un mes sin desglose todavía (octubre/noviembre), guárdalo en iCloud y el PC lo dejará en su mes para cuando llegue el extracto. ' +
        '<button class="btn sec peq" data-sinmov="' + id + '">Guardar en su mes (sin movimiento)</button>';
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
    if (res.estado === 'sinmov') { var bt = div.querySelector('[data-sinmov]'); if (bt) bt.onclick = function () { guardaSinMov(x); div.style.borderLeftColor = 'var(--aviso)'; div.querySelector('div').innerHTML = '<span class="estado aviso">guardado sin movimiento</span>: irá a su mes (por la fecha del ticket) para casarlo cuando llegue el extracto.'; pinta(); }; }
  }

  // guardar un ticket que no casa con ningún movimiento (mes sin desglose aún): va a su mes como «sin movimiento»
  var sinMov = {}; // key -> {file, nombreSalida, mes}
  function guardaSinMov(x) {
    var f = iso(x.fecha), mes;
    if (f) mes = f.slice(0, 7); else mes = new Date().toISOString().slice(0, 7);
    var ext = extDe(x.nombre, x.tipo);
    var dd = f ? f.slice(8, 10) : '00', mm = mes.slice(5, 7), yyyy = mes.slice(0, 4);
    var nombre = mes + '_SINMOV_' + dd + '-' + mm + '-' + yyyy + '_' + (x.importe != null ? M.eurNum(x.importe) : 'sinimporte') + '.' + ext;
    sinMov['sm' + (seq++)] = { file: x.file, nombreSalida: nombre, mes: mes, importe: x.importe, fecha: x.fecha };
    guarda();
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

  // ---------- guardar en iCloud ----------
  function cargaScript(src) { return new Promise(function (ok, ko) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { ko(new Error('No se pudo cargar ' + src)); }; document.head.appendChild(s); }); }
  async function guardaICloud() {
    var ids = Object.keys(recuperados), sm = Object.keys(sinMov);
    if (!ids.length && !sm.length) return;
    if (!window.JSZip) await cargaScript('lib/jszip.min.js');
    var zip = new window.JSZip();
    var usados = {};
    function nombreUnico(nombre) { while (usados[nombre]) { nombre = nombre.replace(/(\.[^.]+)$/, '_b$1'); } usados[nombre] = 1; return nombre; }
    var hechos = ids.map(function (id) {
      var r = recuperados[id], nombre = nombreUnico(r.nombreSalida);
      zip.file(nombre, r.file);
      if (SF.hecho[id]) SF.hecho[id].archivo = nombre;
      return { id: id, mes: r.mes, n: r.n, fecha: r.fecha, importe: r.importe, enviado: !!r.enviado, archivo: nombre };
    });
    var sinmov = sm.map(function (k) { var r = sinMov[k], nombre = nombreUnico(r.nombreSalida); zip.file(nombre, r.file); return { mes: r.mes, fecha: r.fecha, importe: r.importe, archivo: nombre, sin_movimiento: true }; });
    zip.file('FALTAN-TICKETS-hecho.json', JSON.stringify({ generado: new Date().toISOString(), hechos: hechos, sin_movimiento: sinmov }, null, 2));
    var blob = await zip.generateAsync({ type: 'blob' });
    var hoy = new Date().toISOString().slice(0, 10);
    A.descarga('RECUPERADOS-' + hoy + '.zip', blob, 'application/zip');
    guarda();
    $('#faltanAvisos').innerHTML = '<div class="cuadre ok">Guardado <b>RECUPERADOS-' + hoy + '.zip</b> con ' + hechos.length + ' ticket(s) casado(s)' + (sinmov.length ? ' y ' + sinmov.length + ' sin movimiento' : '') + '. Descomprímelo en iCloud Drive ▸ 07_GASTOS ▸ RECUPERADOS.</div>';
  }
  // las revisiones (confirmar/rechazar/elegir) no llevan bytes: el ticket ya está en el PC (tickets-propuestos)
  function guardaDecisiones() {
    var d = SF.decididos;
    var payload = {
      generado: new Date().toISOString(),
      confirmados: Object.keys(d.confirma).map(function (id) { return d.confirma[id]; }),
      rechazados: Object.keys(d.rechaza).map(function (id) { return d.rechaza[id]; }),
      elegidos: Object.keys(d.elige).map(function (id) { return d.elige[id]; })
    };
    A.descarga('FALTAN-DECISIONES-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(payload, null, 2), 'application/json');
    $('#faltanAvisos').innerHTML = '<div class="cuadre ok">Guardado <b>FALTAN-DECISIONES.json</b> (' + payload.confirmados.length + ' confirmado(s), ' + payload.rechazados.length + ' rechazado(s), ' + payload.elegidos.length + ' elegido(s)). Llévalo a iCloud Drive ▸ 07_GASTOS ▸ RECUPERADOS: el PC lo aplica en la siguiente pasada.</div>';
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
        var ids = {}; lista.forEach(function (e) { ids[e.id] = 1; });
        var keep = function (o) { var r = {}; Object.keys(o || {}).forEach(function (k) { if (ids[k]) r[k] = o[k]; }); return r; };
        SF = { lista: lista, aElegir: normalizaElegir(j),
          hecho: keep(SF.hecho),
          decididos: { confirma: keep(SF.decididos.confirma), rechaza: keep(SF.decididos.rechaza), elige: keep(SF.decididos.elige) },
          nombreArchivo: file.name };
        guarda(); recuperados = {}; sinMov = {}; vistos = {}; pinta();
      });
    };
    $('#fFaltanPropuestos').onchange = function () {
      var file = this.files[0]; this.value = '';
      if (!file) return;
      $('#faltanPropuestosEstado').innerHTML = '<div class="cuadre">Abriendo el paquete…</div>';
      abrePropuestos(file).catch(function (e) { $('#faltanPropuestosEstado').innerHTML = '<div class="cuadre mal">No se pudo abrir el paquete: ' + esc(e.message) + '</div>'; console.error(e); });
    };
    $('#faltanBuscar').oninput = pinta;
    $('#faltanSoloNoEnv').onchange = pinta;
    $('#fFaltanTicket').onchange = function () { var fs = Array.prototype.slice.call(this.files); this.value = ''; anade(fs); };
    $('#fabFaltan').onclick = function () { $('#fFaltanTicket').click(); };
    $('#btnFaltanGuardar').onclick = function () { guardaICloud().catch(function (e) { $('#faltanAvisos').innerHTML = '<div class="cuadre mal">Error al guardar: ' + esc(e.message) + '</div>'; console.error(e); }); };
    var bd = $('#btnFaltanDecisiones'); if (bd) bd.onclick = function () { try { guardaDecisiones(); } catch (e) { $('#faltanAvisos').innerHTML = '<div class="cuadre mal">Error al guardar: ' + esc(e.message) + '</div>'; console.error(e); } };
    // el botón flotante «+ Ticket» solo se ve en la pantalla «Faltan»; su visibilidad la controla muestra() en app.js
    pinta();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  // para las pruebas automáticas
  window.Faltan = { normaliza: normaliza, normalizaElegir: normalizaElegir, casa: casa, nombreSalida: nombreSalida, datosDoc: datosDoc,
    estadoDe: function (e) { return estadoDe(e); }, cuenta: cuenta,
    confirma: confirmaPropuesto, rechaza: rechazaPropuesto, elige: eligeOpcion, decisiones: function () { return SF.decididos; },
    estado: function () { return SF; }, recuperados: function () { return recuperados; }, sinMov: function () { return sinMov; },
    abrePropuestos: abrePropuestos, propBundle: function () { return propBundle; }, vistos: function () { return vistos; },
    cargaLista: function (j) { SF = { lista: normaliza(j), aElegir: normalizaElegir(j), hecho: {}, decididos: { confirma: {}, rechaza: {}, elige: {} }, nombreArchivo: 'test' }; recuperados = {}; sinMov = {}; vistos = {}; pinta(); return SF.lista; } };
})();
