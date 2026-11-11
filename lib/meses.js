/* Pestaña «Meses» (instrucción 169): «un solo archivo». El titular carga UN paquete que prepara el PC
   (07_GASTOS/RENDICONTO-TODO.zip) y ve cada mes como un rendiconto ya hecho: una tarjeta por movimiento (fecha ·
   comercio · importe · categoría) con la miniatura del ticket al lado. Colores: verde = confirmado; amarillo =
   propuesto (✔/✗); naranja = a elegir o a revisar; rojo = falta (con 📷 «Añadir foto»). En los restaurantes, el
   selector Comida/Cena y «con quién». Al final, UN botón «Enviar al PC» genera CAMBIOS-<fecha>.zip (decisiones +
   fotos nuevas + comidas/cenas) para iCloud ▸ 07_GASTOS ▸ RECUPERADOS. Nada se envía a nadie. */
(function () {
  'use strict';
  if (!window.Motor || !window.__app) return;
  var M = window.Motor, A = window.__app;
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var CLAVE_DEC = 'rendiconto.meses.dec.v1';

  // paquete en memoria + decisiones del titular (persisten hasta «Enviar al PC»)
  var PKG = { version: '', generado: '', meses: [] };
  var tickets = {};                                   // relpath dentro del zip -> File
  var dec = { confirma: {}, rechaza: {}, elige: {}, categoria: {} };  // key = "mes#n"
  var fotos = {};                                     // key -> {file, ext, mes, n, fecha, importe, nombreSalida, ocr}
  var mesAbierto = null;                              // null = lista de meses; "AAAA-MM" = pantalla de ese mes
  var soloFalta = false;

  // ---------- utilidades ----------
  function kDe(mes, n) { return mes + '#' + n; }
  function num(x) { return typeof x === 'number' ? x : M.parseImporte(x); }
  function eur(v) { return v == null ? '—' : M.eurNum(v); }   // número sin símbolo: la plantilla añade ' €' una sola vez (170)
  function dmy(iso) { return iso ? M.fechaDMY(iso) : '—'; }
  function esResto(cat) { return cat === 'COMIDA' || cat === 'CENA'; }

  function guardaDec() {
    try { localStorage.setItem(CLAVE_DEC, JSON.stringify({ version: PKG.version, dec: dec })); } catch (e) { /* lleno */ }
  }
  function cargaDec() {
    try {
      var o = JSON.parse(localStorage.getItem(CLAVE_DEC) || 'null');
      if (o && o.version === PKG.version && o.dec) dec = {
        confirma: o.dec.confirma || {}, rechaza: o.dec.rechaza || {}, elige: o.dec.elige || {}, categoria: o.dec.categoria || {}
      };
    } catch (e) { /* nada */ }
  }

  // ---------- persistencia del paquete (IndexedDB, best-effort: solo para recordarlo entre sesiones) ----------
  function idb() {
    return new Promise(function (ok, ko) {
      var r;
      try { r = indexedDB.open('rendiconto-meses', 1); } catch (e) { return ko(e); }
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { ko(r.error); };
    });
  }
  function idbSet(k, v) { return idb().then(function (db) { return new Promise(function (ok, ko) { var t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = function () { ok(); }; t.onerror = function () { ko(t.error); }; }); }); }
  function idbGet(k) { return idb().then(function (db) { return new Promise(function (ok, ko) { var t = db.transaction('kv', 'readonly'); var rq = t.objectStore('kv').get(k); rq.onsuccess = function () { ok(rq.result); }; rq.onerror = function () { ko(rq.error); }; }); }); }

  // ---------- estado efectivo de un movimiento (manifiesto + decisiones del titular) ----------
  function estadoEf(mes, mv) {
    var k = kDe(mes, mv.n);
    if (dec.confirma[k] || dec.elige[k] || fotos[k]) return 'confirmado';
    if (dec.rechaza[k]) return 'falta';
    return mv.estado;
  }
  function categoriaEf(mes, mv) {
    var k = kDe(mes, mv.n);
    if (dec.categoria[k] && dec.categoria[k].tipo) return dec.categoria[k];
    if (mv.categoria_elegida && mv.categoria_elegida.tipo) return mv.categoria_elegida;
    return null;
  }
  function progresoMes(m) {
    var c = { total: 0, conTicket: 0, falta: 0, propuesto: 0, revisar: 0, elegir: 0, confirmado: 0 };
    m.movimientos.forEach(function (mv) {
      c.total++;
      var st = estadoEf(m.mes, mv);
      c[st]++;
      if (st === 'confirmado' || st === 'propuesto' || st === 'revisar') c.conTicket++;
    });
    return c;
  }
  function nCambios() {
    return Object.keys(dec.confirma).length + Object.keys(dec.rechaza).length + Object.keys(dec.elige).length +
      Object.keys(dec.categoria).filter(function (k) { return dec.categoria[k] && dec.categoria[k].tipo; }).length +
      Object.keys(fotos).length;
  }

  // ---------- cargar el paquete ----------
  function cargaScript(src) { return new Promise(function (ok, ko) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { ko(new Error('No se pudo cargar ' + src)); }; document.head.appendChild(s); }); }

  async function abreZip(file) {
    if (!window.JSZip) await cargaScript('lib/jszip.min.js');
    var zip = await window.JSZip.loadAsync(file);
    var manifFile = zip.file('rendiconto-todo.json');
    if (!manifFile) throw new Error('el paquete no tiene rendiconto-todo.json (¿es RENDICONTO-TODO.zip?)');
    var manif = JSON.parse(await manifFile.async('string'));
    var nuevos = {};
    var nombres = Object.keys(zip.files);
    for (var i = 0; i < nombres.length; i++) {
      var name = nombres[i], entry = zip.files[name];
      if (entry.dir || name === 'rendiconto-todo.json') continue;
      nuevos[name] = new File([await entry.async('blob')], name.split('/').pop());
    }
    aplicaPaquete(manif, nuevos);
    // best-effort: recordarlo entre sesiones
    idbSet('paquete', { version: PKG.version, manifest: manif, files: nuevos }).catch(function () { /* IDB no disponible */ });
    return manif;
  }

  function aplicaPaquete(manif, filesMap) {
    var versionVieja = PKG.version;
    PKG = { version: manif.version || '', generado: manif.generado || '', meses: manif.meses || [] };
    tickets = filesMap || {};
    fotos = {};
    if (versionVieja !== PKG.version) { dec = { confirma: {}, rechaza: {}, elige: {}, categoria: {} }; }
    cargaDec();
    mesAbierto = null;
    pinta();
  }

  // ---------- pintado: inicio / lista de meses / pantalla de mes ----------
  function pintaInicio() {
    var hay = PKG.meses.length > 0;
    $('#mesesInicio').hidden = hay && mesAbierto !== 'inicio';
    var btn = $('#btnCargarMeses');
    if (btn) btn.textContent = hay ? '↻ Actualizar (del ' + esc(PKG.generado) + ')' : 'Cargar mis rendicontos (archivo RENDICONTO-TODO de 07_GASTOS)';
  }

  function barraProgreso(c) {
    var pct = c.total ? Math.round(100 * (c.conTicket) / c.total) : 0;
    return '<div class="barra-p" style="margin:6px 0"><div style="width:' + pct + '%"></div></div>';
  }

  function pinta() {
    cargaDec();
    pintaInicio();
    var lista = $('#mesesLista'), pantalla = $('#mesPantalla');
    var hay = PKG.meses.length > 0;
    $('#mesesVacio').hidden = hay;
    lista.hidden = !hay || !!mesAbierto;
    pantalla.hidden = !mesAbierto;
    if (!hay) { lista.innerHTML = ''; pantalla.innerHTML = ''; actualizaBotonEnviar(); return; }
    if (mesAbierto) pintaMes(mesAbierto); else pintaLista();
    actualizaBotonEnviar();
  }

  function pintaLista() {
    var html = '<div class="ayuda">Paquete del ' + esc(PKG.generado) + '. Toca un mes para verlo y aportar lo que falta.</div>';
    PKG.meses.forEach(function (m) {
      var c = progresoMes(m);
      var pend = c.propuesto + c.revisar + c.elegir;
      var etq = m.reclamado_sede ? '<span class="pill aviso" title="la sede lo reclama antes">Reclamado por la sede</span> ' : '';
      html += '<button class="mes-tarjeta" data-mes="' + esc(m.mes) + '">' +
        '<div class="mes-cab"><b>' + esc(m.nombre) + '</b> ' + etq + '</div>' +
        barraProgreso(c) +
        '<div class="ayuda">' + c.conTicket + '/' + c.total + ' con ticket' +
        (c.propuesto ? ' · <span class="estado aviso">' + c.propuesto + ' propuesto</span>' : '') +
        (c.revisar ? ' · <span class="estado aviso">⚠ ' + c.revisar + ' revisar</span>' : '') +
        (c.elegir ? ' · <span class="estado aviso">' + c.elegir + ' a elegir</span>' : '') +
        (c.falta ? ' · <span class="estado mal">' + c.falta + ' falta</span>' : '') +
        (m.enviado ? ' · <span class="estado aviso">ese mes ya se envió</span>' : '') +
        '</div></button>';
    });
    $('#mesesLista').innerHTML = html;
    $('#mesesLista').querySelectorAll('[data-mes]').forEach(function (b) {
      b.onclick = function () { mesAbierto = b.dataset.mes; soloFalta = false; window.scrollTo(0, 0); pinta(); };
    });
  }

  var COLOR = { confirmado: 'ok', propuesto: 'aviso', revisar: 'aviso', elegir: 'aviso', falta: 'mal' };

  function pintaMes(mes) {
    var m = PKG.meses.filter(function (x) { return x.mes === mes; })[0];
    if (!m) { mesAbierto = null; pinta(); return; }
    var c = progresoMes(m);
    var movs = m.movimientos.filter(function (mv) { return !soloFalta || estadoEf(mes, mv) === 'falta'; });
    var html = '<div class="mes-barra">' +
      '<button class="icono" id="volverMeses" aria-label="Volver a los meses"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>' +
      '<b style="flex:1">' + esc(m.nombre) + (m.reclamado_sede ? ' <span class="pill aviso">Reclamado por la sede</span>' : '') + '</b></div>' +
      '<div class="cuadre ok">' + c.conTicket + '/' + c.total + ' con ticket · ' + c.falta + ' falta · ' + c.propuesto + ' propuesto · ' + (c.revisar + c.elegir) + ' a revisar/elegir' +
      (m.totale != null ? ' · total ' + eur(m.totale) + ' €' : '') + '</div>' +
      '<div class="barra"><label class="check"><input type="checkbox" id="mesSoloFalta"' + (soloFalta ? ' checked' : '') + '> Solo lo que falta</label></div>';
    movs.forEach(function (mv) { html += tarjetaMov(mes, mv); });
    if (!movs.length) html += '<div class="vacio">Nada que mostrar con este filtro.</div>';
    if (m.sinMovimiento && m.sinMovimiento.length) {
      html += '<h3>Tickets sin movimiento (' + m.sinMovimiento.length + ')</h3><div class="ayuda">Tickets de este mes que no están en el desglose; se envían aparte.</div>';
      m.sinMovimiento.forEach(function (sm) {
        html += '<div class="mov-card"><div class="mov-txt"><div class="mov-cab">' + esc(sm.nombre || 'ticket') + '</div><div class="ayuda">' + (sm.importe != null ? eur(sm.importe) + ' €' : 'importe no leído') + '</div></div>' +
          '<div class="mov-mini" data-tk="' + esc(sm.archivo) + '"></div></div>';
      });
    }
    $('#mesPantalla').innerHTML = html;
    engancha(mes);
  }

  function tarjetaMov(mes, mv) {
    var st = estadoEf(mes, mv);
    var k = kDe(mes, mv.n);
    var color = COLOR[st] || 'mal';
    var h = '<div class="mov-card ' + color + '" data-k="' + esc(k) + '">';
    h += '<div class="mov-txt">';
    h += '<div class="mov-cab"><b>' + esc(mv.comercio || '—') + '</b> <span class="estado ' + color + '">' + etiquetaEstado(st, mv) + '</span></div>';
    h += '<div class="ayuda">Mov. ' + esc(mv.n) + ' · ' + dmy(mv.fecha) + ' · <b>' + eur(mv.importe) + ' €</b>' + (mv.codigo ? ' · <code>' + esc(mv.codigo) + '</code>' : '') + ' · ' + esc(mv.categoria) + '</div>';
    // restaurantes: comida/cena + con quién (siempre visible)
    if (esRestaurante(mv)) h += bloqueComida(mes, mv);
    // estado-dependiente
    if (st === 'propuesto' || st === 'revisar') {
      if (st === 'revisar' && mv.ticket && mv.ticket.motivo_qc) h += '<div class="cuadre aviso" style="margin:6px 0">⚠ ' + esc(mv.ticket.motivo_qc) + '. Míralo y decide.</div>';
      h += '<div class="mov-acc"><button class="btn" data-conf="' + esc(k) + '">✔ Confirmar</button> <button class="btn sec" data-rech="' + esc(k) + '">✗ Rechazar</button></div>';
    } else if (st === 'elegir' && mv.aElegir) {
      h += '<div class="mov-acc" data-ae="' + esc(k) + '">' + mv.aElegir.opciones.map(function (o, i) {
        return '<button class="btn peq" data-i="' + i + '">Mov. ' + esc(o.n) + ' · ' + esc(o.mes) + ' · ' + eur(o.importe) + ' €</button>';
      }).join('') + '<button class="btn sec peq" data-i="-1">Ninguno</button></div>';
    } else if (st === 'falta') {
      h += '<div class="mov-acc"><label class="btn"><span>📷 Añadir foto</span><input type="file" accept="application/pdf,.pdf,image/*,.jpg,.jpeg,.png,.heic,.heif,.webp" data-foto="' + esc(k) + '" hidden></label>';
      if (fotos[k]) h += ' <span class="estado ok">foto añadida</span>';
      h += '</div>';
    } else if (st === 'confirmado') {
      h += '<div class="mov-acc"><button class="btn sec peq" data-deshace="' + esc(k) + '">↶ Deshacer</button></div>';
    }
    h += '</div>';                 // .mov-txt
    h += '<div class="mov-mini" data-k="' + esc(k) + '"></div>';
    h += '</div>';
    return h;
  }

  function etiquetaEstado(st, mv) {
    if (st === 'confirmado') return '✔ listo';
    if (st === 'propuesto') return '🟡 propuesto';
    if (st === 'revisar') return '⚠ revisar';
    if (st === 'elegir') return 'a elegir';
    return '✗ falta';
  }

  function esRestaurante(mv) {
    var cat = (mv.categoria || '').toUpperCase();
    return cat === 'COMIDA' || cat === 'CENA' || esRestoTexto(mv.comercio);
  }
  function esRestoTexto(s) { return /\b(rest|bar|cafe|cerveceri|taberna|mes[oó]n|pizz|burger)/i.test(String(s || '')); }

  function bloqueComida(mes, mv) {
    var k = kDe(mes, mv.n);
    var ce = categoriaEf(mes, mv) || {};
    var tipo = ce.tipo || '';
    var quien = ce.conQuien || '';
    return '<div class="mov-comida"><span class="ayuda">Restaurante · administración pide comida/cena y con quién:</span>' +
      '<div class="barra" style="margin:4px 0">' +
      '<select data-comida="' + esc(k) + '"><option value=""' + (tipo ? '' : ' selected') + '>— elegir —</option>' +
      '<option value="COMIDA"' + (tipo === 'COMIDA' ? ' selected' : '') + '>Comida</option>' +
      '<option value="CENA"' + (tipo === 'CENA' ? ' selected' : '') + '>Cena</option></select>' +
      '<input type="text" data-quien="' + esc(k) + '" placeholder="con quién" value="' + esc(quien) + '" style="flex:1 1 140px">' +
      '</div></div>';
  }

  // ---------- acciones ----------
  function confirma(mes, mv) { var k = kDe(mes, mv.n); dec.confirma[k] = { mes: mes, n: mv.n, archivo: (mv.ticket && basename(mv.ticket.archivo)) || null }; delete dec.rechaza[k]; guardaDec(); }
  function rechaza(mes, mv) { var k = kDe(mes, mv.n); dec.rechaza[k] = { mes: mes, n: mv.n }; delete dec.confirma[k]; guardaDec(); }
  function elige(mes, mv, opt) { var k = kDe(opt.mes, opt.n); dec.elige[k] = { key: mv.aElegir && mv.aElegir.key, mes: opt.mes, n: opt.n }; guardaDec(); }
  function deshace(k) { delete dec.confirma[k]; delete dec.elige[k]; delete fotos[k]; guardaDec(); }
  function fijaCategoria(mes, n, tipo, quien) {
    var k = kDe(mes, n);
    if (!tipo && !quien) delete dec.categoria[k]; else dec.categoria[k] = { tipo: tipo || '', conQuien: quien || '' };
    guardaDec();
  }
  function basename(p) { return String(p || '').split('/').pop(); }

  // añadir una foto a un movimiento concreto (sin casación a ciegas; si el OCR lee otro importe, avisa)
  function nombreFoto(mes, mv, ext) {
    var f = mv.fecha, dd = '00', mm = mes.slice(5, 7), yyyy = mes.slice(0, 4);
    if (f && /^\d{4}-\d{2}-\d{2}/.test(f)) { dd = f.slice(8, 10); mm = f.slice(5, 7); yyyy = f.slice(0, 4); }
    return mes + '_mov' + mv.n + '_' + dd + '-' + mm + '-' + yyyy + '_' + M.eurNum(mv.importe) + '.' + ext;
  }
  function extDe(nombre, tipo) { var m = String(nombre || '').match(/\.([A-Za-z0-9]{1,5})$/); if (m) return m[1].toLowerCase(); return { imagen: 'jpg', pdf: 'pdf' }[tipo] || 'dat'; }

  async function anadeFoto(mes, mv, file) {
    var k = kDe(mes, mv.n);
    var aviso = $('#mesAvisos'); aviso.innerHTML = '<div class="cuadre">Leyendo la foto…</div>';
    var leidos = await A.leeDocs([file]);
    var x = leidos[0] || {};
    var ext = extDe(file.name, x.tipo);
    fotos[k] = { file: file, ext: ext, mes: mes, n: mv.n, fecha: mv.fecha, importe: mv.importe, nombreSalida: nombreFoto(mes, mv, ext), ocr: x.importe };
    guardaDec();
    var msg = 'Foto añadida al Mov. ' + mv.n + ' (' + eur(mv.importe) + ' €).';
    if (x.importe != null && M.cents(x.importe) !== M.cents(mv.importe)) {
      msg += ' <b>Aviso:</b> en la foto se lee ' + eur(x.importe) + ' €, distinto del cargo del banco. Se guarda igual para ese movimiento (tú mandas); revísalo.';
      aviso.innerHTML = '<div class="cuadre aviso">' + msg + '</div>';
    } else {
      aviso.innerHTML = '<div class="cuadre ok">' + msg + '</div>';
    }
    pinta();
    // 172: pide la categoría de la foto recién añadida (misma hoja que «Ticket de hoy»); NO bloquea el retorno: al elegir,
    // se guarda en las decisiones (viaja al PC en FALTAN-CATEGORIAS) y se repinta la tarjeta.
    if (A.pideCategoria) {
      var tk = { nombreFuente: x.nombre || file.name, nombre: x.nombre || '', texto: x.texto || '', hora: x.hora || null, importe: mv.importe };
      A.pideCategoria([tk], function (t, tipo, quien) {
        fijaCategoria(mes, mv.n, tipo, (tipo === 'COMIDA' || tipo === 'CENA') ? quien : '');
      }).then(function () { pinta(); }).catch(function () { /* si la hoja falla, se edita en la tarjeta */ });
    }
  }

  // ---------- miniaturas (96×128, legibles; se tocan para verlas a pantalla completa) ----------
  function ticketFile(mes, mv) {
    if (!mv) return null;
    var k = kDe(mes, mv.n);
    var rel = mv.ticket && mv.ticket.archivo, f = rel && tickets[rel];
    if (!f && fotos[k]) f = fotos[k].file;   // sin ticket del PC pero el titular añadió una foto
    return f || null;
  }
  function pintaMinis() {
    var m = PKG.meses.filter(function (x) { return x.mes === mesAbierto; })[0];
    $('#mesPantalla').querySelectorAll('.mov-mini[data-k]').forEach(function (div) {
      if (!m) return;
      var mv = m.movimientos.filter(function (x) { return kDe(mesAbierto, x.n) === div.dataset.k; })[0];
      var f = ticketFile(mesAbierto, mv);
      pintaMini(div, f, function () { verGrande(mesAbierto, mv); });
    });
    $('#mesPantalla').querySelectorAll('.mov-mini[data-tk]').forEach(function (div) {
      var f = tickets[div.dataset.tk];
      pintaMini(div, f, function () { verGrandeFile(f, 'Ticket'); });
    });
  }
  function pintaMini(div, f, onTap) {
    if (!f) { div.innerHTML = ''; div.removeAttribute('role'); div.onclick = null; return; }
    A.vistaDoc(f).then(function (el) {
      el.classList.add('mini-el');
      el.onclick = null; el.style.cursor = 'inherit'; el.style.pointerEvents = 'none';   // el toque lo recoge el contenedor
      div.innerHTML = ''; div.appendChild(el);
      div.setAttribute('role', 'button'); div.setAttribute('aria-label', 'Ver el ticket a pantalla completa');
      div.onclick = onTap;
    }).catch(function (err) { div.innerHTML = '<span class="ayuda">no se pudo ver</span>'; console.error(err); });
  }

  // ---------- visor a pantalla completa (pellizcar para el zoom; ✔/✗ abajo en propuesto/revisar) ----------
  function visor() {
    var ov = document.getElementById('mesesVisor');
    if (!ov) { ov = document.createElement('div'); ov.id = 'mesesVisor'; ov.className = 'hoja'; document.body.appendChild(ov); }
    return ov;
  }
  function cabVisor(titulo) {
    return '<div class="hoja-cab"><button class="icono" id="visorCerrar" aria-label="Volver"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button><b>' + esc(titulo) + '</b></div>';
  }
  function muestraEn(ov, f, maxAlto) {
    A.vistaDoc(f).then(function (el) { el.style.maxWidth = '96vw'; el.style.maxHeight = maxAlto; var c = ov.querySelector('#visorImg'); if (c) { c.innerHTML = ''; c.appendChild(el); } });
  }
  function verGrande(mes, mv) {
    var f = ticketFile(mes, mv); if (!f) return;
    var st = estadoEf(mes, mv);
    var ov = visor(); ov.hidden = false;
    var acc = (st === 'propuesto' || st === 'revisar')
      ? '<button class="btn" id="visorConf">✔ Confirmar</button><button class="btn sec" id="visorRech">✗ Rechazar</button>'
      : '<button class="btn sec" id="visorCerrar2">Cerrar</button>';
    var motivo = (st === 'revisar' && mv.ticket && mv.ticket.motivo_qc) ? '<div class="cuadre aviso" style="margin:8px 0">⚠ ' + esc(mv.ticket.motivo_qc) + '</div>' : '';
    ov.innerHTML = cabVisor((mv.comercio || 'Ticket') + ' · ' + eur(mv.importe) + ' €') + motivo +
      '<div id="visorImg" style="text-align:center;min-height:40vh"></div><div class="mov-visor-acc">' + acc + '</div>';
    muestraEn(ov, f, '70vh');
    var cerrar = function () { ov.hidden = true; };
    ['#visorCerrar', '#visorCerrar2'].forEach(function (s) { var b = ov.querySelector(s); if (b) b.onclick = cerrar; });
    var cf = ov.querySelector('#visorConf'); if (cf) cf.onclick = function () { confirma(mes, mv); cerrar(); pintaMes(mes); };
    var rc = ov.querySelector('#visorRech'); if (rc) rc.onclick = function () { rechaza(mes, mv); cerrar(); pintaMes(mes); };
  }
  function verGrandeFile(f, titulo) {
    if (!f) return;
    var ov = visor(); ov.hidden = false;
    ov.innerHTML = cabVisor(titulo || 'Ticket') + '<div id="visorImg" style="text-align:center;min-height:40vh"></div><div class="mov-visor-acc"><button class="btn sec" id="visorCerrar2">Cerrar</button></div>';
    muestraEn(ov, f, '78vh');
    var cerrar = function () { ov.hidden = true; };
    ['#visorCerrar', '#visorCerrar2'].forEach(function (s) { var b = ov.querySelector(s); if (b) b.onclick = cerrar; });
  }

  // ---------- enganches del DOM de la pantalla de mes ----------
  function engancha(mes) {
    var m = PKG.meses.filter(function (x) { return x.mes === mes; })[0]; if (!m) return;
    var movDe = function (k) { return m.movimientos.filter(function (x) { return kDe(mes, x.n) === k; })[0]; };
    var P = $('#mesPantalla');
    var v = $('#volverMeses'); if (v) v.onclick = function () { mesAbierto = null; window.scrollTo(0, 0); pinta(); };
    var sf = $('#mesSoloFalta'); if (sf) sf.onchange = function () { soloFalta = sf.checked; pintaMes(mes); };
    P.querySelectorAll('[data-conf]').forEach(function (b) { b.onclick = function () { var mv = movDe(b.dataset.conf); if (mv) { confirma(mes, mv); pintaMes(mes); } }; });
    P.querySelectorAll('[data-rech]').forEach(function (b) { b.onclick = function () { var mv = movDe(b.dataset.rech); if (mv) { rechaza(mes, mv); pintaMes(mes); } }; });
    P.querySelectorAll('[data-deshace]').forEach(function (b) { b.onclick = function () { deshace(b.dataset.deshace); pintaMes(mes); }; });
    P.querySelectorAll('[data-ae]').forEach(function (barra) {
      var mv = movDe(barra.dataset.ae); if (!mv || !mv.aElegir) return;
      barra.querySelectorAll('button').forEach(function (bt) { bt.onclick = function () { var i = +bt.dataset.i; if (i >= 0) elige(mes, mv, mv.aElegir.opciones[i]); pintaMes(mes); }; });
    });
    P.querySelectorAll('[data-foto]').forEach(function (inp) {
      inp.onchange = function () { var f = this.files[0]; this.value = ''; if (!f) return; var mv = movDe(inp.dataset.foto); if (mv) anadeFoto(mes, mv, f).catch(function (e) { $('#mesAvisos').innerHTML = '<div class="cuadre mal">Error con la foto: ' + esc(e.message) + '</div>'; console.error(e); }); };
    });
    P.querySelectorAll('[data-comida]').forEach(function (sel) {
      sel.onchange = function () { var k = sel.dataset.comida, p = k.split('#'); var quien = (P.querySelector('[data-quien="' + CSS.escape(k) + '"]') || {}).value || ''; fijaCategoria(p[0], +p[1], sel.value, quien); actualizaBotonEnviar(); };
    });
    P.querySelectorAll('[data-quien]').forEach(function (inp) {
      inp.oninput = function () { var k = inp.dataset.quien, p = k.split('#'); var sel = P.querySelector('[data-comida="' + CSS.escape(k) + '"]'); fijaCategoria(p[0], +p[1], sel ? sel.value : '', inp.value); actualizaBotonEnviar(); };
    });
    pintaMinis();
  }

  // ---------- «Enviar al PC»: CAMBIOS-<fecha>.zip ----------
  function actualizaBotonEnviar() {
    var b = $('#btnEnviarPC'); if (!b) return;
    var n = nCambios();
    b.disabled = !n;
    b.textContent = n ? '📤 Enviar al PC (' + n + ' cambio' + (n > 1 ? 's' : '') + ')' : '📤 Enviar al PC';
  }

  async function enviaPC() {
    var n = nCambios(); if (!n) return;
    if (!window.JSZip) await cargaScript('lib/jszip.min.js');
    var zip = new window.JSZip();
    var hoy = new Date().toISOString().slice(0, 10);
    // 1) fotos nuevas (a su movimiento) + FALTAN-TICKETS-hecho.json
    var usados = {};
    function unico(nombre) { while (usados[nombre]) nombre = nombre.replace(/(\.[^.]+)$/, '_b$1'); usados[nombre] = 1; return nombre; }
    var hechos = Object.keys(fotos).map(function (k) {
      var r = fotos[k], nombre = unico(r.nombreSalida);
      zip.file(nombre, r.file);
      return { id: r.mes + '-' + r.n, mes: r.mes, n: r.n, fecha: r.fecha, importe: r.importe, enviado: mesEnviado(r.mes), archivo: nombre };
    });
    if (hechos.length) zip.file('FALTAN-TICKETS-hecho.json', JSON.stringify({ generado: new Date().toISOString(), instruccion: 169, hechos: hechos }, null, 1));
    // 2) decisiones (confirmar/rechazar/elegir)
    var d = dec;
    var payload = {
      generado: new Date().toISOString(), instruccion: 169,
      confirmados: Object.keys(d.confirma).map(function (k) { return d.confirma[k]; }),
      rechazados: Object.keys(d.rechaza).map(function (k) { return d.rechaza[k]; }),
      elegidos: Object.keys(d.elige).map(function (k) { return d.elige[k]; })
    };
    if (payload.confirmados.length || payload.rechazados.length || payload.elegidos.length)
      zip.file('FALTAN-DECISIONES-' + hoy + '.json', JSON.stringify(payload, null, 1));
    // 3) comidas/cenas + con quién
    var cats = Object.keys(d.categoria).filter(function (k) { return d.categoria[k] && d.categoria[k].tipo; }).map(function (k) {
      var p = k.split('#'); return { mes: p[0], n: +p[1], tipo: d.categoria[k].tipo, conQuien: d.categoria[k].conQuien || '' };
    });
    if (cats.length) zip.file('FALTAN-CATEGORIAS-' + hoy + '.json', JSON.stringify({ generado: new Date().toISOString(), instruccion: 169, categorias: cats }, null, 1));

    var blob = await zip.generateAsync({ type: 'blob' });
    A.descarga('CAMBIOS-' + hoy + '.zip', blob, 'application/zip');
    $('#mesAvisos').innerHTML = '<div class="cuadre ok">Hecho (' + hechos.length + ' foto(s), ' +
      (payload.confirmados.length + payload.rechazados.length + payload.elegidos.length) + ' decisión(es), ' + cats.length + ' comida/cena). ' +
      'Guarda el archivo en <b>iCloud ▸ 07_GASTOS ▸ RECUPERADOS</b>. El PC lo recoge solo y te deja los meses actualizados.</div>';
  }
  function mesEnviado(mes) { var m = PKG.meses.filter(function (x) { return x.mes === mes; })[0]; return !!(m && m.enviado); }

  // ---------- arranque ----------
  function init() {
    $('#fMesesZip').onchange = function () {
      var file = this.files[0]; this.value = ''; if (!file) return;
      $('#mesesEstado').innerHTML = '<div class="cuadre">Abriendo el paquete…</div>';
      abreZip(file).then(function (manif) { $('#mesesEstado').innerHTML = '<div class="cuadre ok">Paquete cargado: ' + (manif.meses || []).length + ' mes(es), del ' + esc(manif.generado || '') + '.</div>'; })
        .catch(function (e) { $('#mesesEstado').innerHTML = '<div class="cuadre mal">No se pudo abrir el paquete: ' + esc(e.message) + '</div>'; console.error(e); });
    };
    $('#btnEnviarPC').onclick = function () { enviaPC().catch(function (e) { $('#mesAvisos').innerHTML = '<div class="cuadre mal">Error al enviar: ' + esc(e.message) + '</div>'; console.error(e); }); };
    // recordar el paquete de la última sesión (IndexedDB)
    idbGet('paquete').then(function (p) { if (p && p.manifest && !PKG.meses.length) aplicaPaquete(p.manifest, p.files || {}); }).catch(function () { /* IDB no disponible */ });
    pinta();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  // para las pruebas automáticas
  window.Meses = {
    aplicaPaquete: aplicaPaquete,
    estado: function () { return { version: PKG.version, meses: PKG.meses, dec: dec, fotos: Object.keys(fotos) }; },
    progresoMes: function (mes) { var m = PKG.meses.filter(function (x) { return x.mes === mes; })[0]; return m ? progresoMes(m) : null; },
    estadoEf: function (mes, n) { var m = PKG.meses.filter(function (x) { return x.mes === mes; })[0]; var mv = m && m.movimientos.filter(function (x) { return x.n === n; })[0]; return mv ? estadoEf(mes, mv) : null; },
    abre: function (mes) { mesAbierto = mes; pinta(); },
    confirma: function (mes, n) { var mv = mvDe(mes, n); if (mv) confirma(mes, mv); pinta(); },
    rechaza: function (mes, n) { var mv = mvDe(mes, n); if (mv) rechaza(mes, mv); pinta(); },
    elige: function (mes, n, i) { var mv = mvDe(mes, n); if (mv && mv.aElegir) elige(mes, mv, mv.aElegir.opciones[i]); pinta(); },
    fijaCategoria: fijaCategoria,
    anadeFoto: function (mes, n, file) { var mv = mvDe(mes, n); return mv ? anadeFoto(mes, mv, file) : Promise.reject(new Error('no existe el mov')); },
    nCambios: nCambios, abreZip: abreZip, enviaPC: enviaPC,
    cambios: function () { return { dec: dec, fotos: fotos }; }
  };
  function mvDe(mes, n) { var m = PKG.meses.filter(function (x) { return x.mes === mes; })[0]; return m && m.movimientos.filter(function (x) { return x.n === n; })[0]; }
})();
