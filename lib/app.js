/* Interfaz de Rendiconto (tickets de la tarjeta). Todo local. */
(function () {
  'use strict';
  const M = window.Motor;
  const $ = function (s) { return document.querySelector(s); };
  const $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  const esc = function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  const pausa = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
  const DPI_DESGLOSE = 300, DPI_TICKETS = 220;
  const LECTOR = 2; // versión de la lectura de tickets: 2 = busca varios tickets por página en fotos y PDF con o sin texto
  const VERSION_APP = '09/11/2026 21:22'; // publicar/preparar.py lo reescribe con 'dd/mm/aaaa HH:MM' al publicar; vacío = en desarrollo (local)

  // ---------------- estado ----------------
  let S = nuevoEstado();
  function nuevoEstado() {
    return {
      version: 2,
      desglose: null,          // {archivo, movs:[...], totale, tiras:{n:dataURL}}
      fuentes: [],             // un archivo = un ticket: [{id, nombre, tipo, clave, rot, img|pdf(base64)|fuenteTexto, exif, xml, enviada}]
      tickets: [],             // [{id, fuente, tipo, mini, full, texto, importe, candidatos, fecha, fechaOrigen, hora, codigo, lectura, aviso, movManual, ignorar}]
      porMov: {},              // n -> {categoria, conQuien, desc}
      elecciones: {},          // movN -> 'docId|zonaId' elegido en una pregunta de seguridad
      mes: null, anio: null,
    };
  }
  let C = { anclas: [], preguntas: [], libres: {}, porMov: {}, porDoc: {} }; // resultado de la casación por anclas

  // ---------------- utilidades ----------------
  function progreso(id, frac, txt) {
    const p = $(id); p.classList.add('on');
    p.querySelector('.barra-p div').style.width = Math.round(frac * 100) + '%';
    p.querySelector('.txt').textContent = txt || '';
  }
  function finProgreso(id) { $(id).classList.remove('on'); }
  function descarga(nombre, datos, tipo) {
    const b = datos instanceof Blob ? datos : new Blob([datos], { type: tipo || 'application/octet-stream' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nombre;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function b64ABytes(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function cargaScript(src) {
    return new Promise(function (ok, ko) { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { ko(new Error('No se pudo cargar ' + src)); }; document.head.appendChild(s); });
  }
  function grisDeCanvas(cv) {
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const g = new Uint8Array(cv.width * cv.height);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) { const r = d[i], gg = d[i + 1], b = d[i + 2]; g[j] = r > gg ? (r > b ? r : b) : (gg > b ? gg : b); }
    return g; // máximo de los canales: el fosforito (amarillo, verde) se vuelve claro y el texto negro sigue negro
  }
  function imgDeDataURL(url) { return new Promise(function (ok, ko) { const i = new Image(); i.onload = function () { ok(i); }; i.onerror = ko; i.src = url; }); }
  function canvasDe(img, w, h) { const c = document.createElement('canvas'); c.width = w || img.width; c.height = h || img.height; c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height); return c; }
  function recorteCanvas(src, x0, y0, x1, y1, maxLado, calidad) {
    const w = x1 - x0, h = y1 - y0; let k = 1;
    if (maxLado && Math.max(w, h) > maxLado) k = maxLado / Math.max(w, h);
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, x0, y0, w, h, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', calidad || 0.85);
  }
  function fechaHoy() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  // ---------------- OCR (Tesseract en WebAssembly, sin internet) ----------------
  const OCR = {
    listo: false,
    async init(aviso) {
      if (this.listo) return;
      if (aviso) aviso('Preparando el lector de texto (OCR)…');
      const simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
      await cargaScript(simd ? 'lib/ocr-simd.js' : 'lib/ocr-basico.js');
      await cargaScript('lib/ocr-idioma-spa.js');
      this.M = await window.TesseractCore({});
      const gz = b64ABytes(window.OCR_SPA_GZ_B64);
      const datos = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      this.M.FS.writeFile('/spa.traineddata', datos);
      this.api = new this.M.TessBaseAPI();
      if (this.api.Init(null, 'spa', 1) !== 0) throw new Error('No se pudo iniciar el OCR');
      this.api.SetVariable('debug_file', '/dev/null');
      this.listo = true;
    },
    // img: {w,h,data} en grises
    // tsv: true para devolver también las posiciones de cada palabra (TSV de Tesseract)
    leer(img, psm, lista, tsv) {
      const cab = new TextEncoder().encode('P5 ' + img.w + ' ' + img.h + ' 255\n');
      const buf = new Uint8Array(cab.length + img.data.length); buf.set(cab); buf.set(img.data, cab.length);
      this.api.SetVariable('tessedit_pageseg_mode', String(psm));
      this.api.SetVariable('tessedit_char_whitelist', lista || '');
      this.M.FS.writeFile('/input', buf);
      this.api.SetImageFile(1, 0);
      this.api.Recognize(null);
      const t = this.api.GetUTF8Text(); const conf = this.api.MeanTextConf();
      const posiciones = tsv ? this.api.GetTSVText(0) : null;
      this.api.Clear();
      return { texto: (t || '').trim(), conf: conf, tsv: posiciones };
    },
  };

  // ---------------- librerías bajo demanda: la app abre rápido y cada librería se carga la primera vez que hace falta ----------------
  const LIBS = { pdf: ['lib/pdf.min.js', 'pdfjsLib'], worker: ['lib/pdf.worker.min.js', 'pdfjsWorker'], pdflib: ['lib/pdf-lib.min.js', 'PDFLib'], jszip: ['lib/jszip.min.js', 'JSZip'] };
  async function libs(nombres) { for (const n of nombres) if (!window[LIBS[n][1]]) await cargaScript(LIBS[n][0]); }

  // ---------------- PDF.js ----------------
  function pdfjs() {
    const L = window.pdfjsLib;
    if (L && !L.__ok) { L.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js'; L.__ok = true; }
    return L;
  }
  async function abrePdf(buf) { await libs(['pdf', 'worker']); return pdfjs().getDocument({ data: buf, isEvalSupported: false, useWorkerFetch: false }).promise; }
  async function renderPagina(pdf, n, dpi) { return (await paginaPdf(pdf, n, dpi)).cv; }
  // página pintada tal como se ve (pdf.js aplica /Rotate), con la página y la vista para leer posiciones del texto
  async function paginaPdf(pdf, n, dpi) {
    const pg = await pdf.getPage(n);
    const vp = pg.getViewport({ scale: dpi / 72 });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    return { cv: cv, pg: pg, vp: vp };
  }
  // canvas girado g grados en el sentido de las agujas del reloj (90, 180 o 270)
  function rotaCanvas(cv, g) {
    g = ((g % 360) + 360) % 360; if (!g) return cv;
    const o = document.createElement('canvas'); o.width = g === 180 ? cv.width : cv.height; o.height = g === 180 ? cv.height : cv.width;
    const ctx = o.getContext('2d', { willReadFrequently: true }); ctx.translate(o.width / 2, o.height / 2); ctx.rotate(g * Math.PI / 180); ctx.drawImage(cv, -cv.width / 2, -cv.height / 2);
    return o;
  }

  // ================= PASO 1: DESGLOSE =================
  const VALID = {
    codigo: function (t) { return /^H\d{5}$/.test(t.replace(/\s/g, '')); },
    fecha: function (t) { return /\d{2}[.,]\d{2}[.,]\d{2}/.test(t); },
    importe: function (t) { return M.importeCelda(t) !== null; },
  };
  // Lee una celda con 3 versiones de la imagen y vota; si no coinciden, devuelve también las alternativas
  function leeCelda(g, W, c, y0, y1, tipo) {
    const psm = 7, lista = { codigo: 'H0123456789', fecha: '0123456789.', importe: '0123456789.,' }[tipo];
    const x0 = c[0] + 3, x1 = c[1] - 3, a = y0 + 2, b = y1 - 2;
    const versiones = [M.recorte(g, W, x0, a, x1, b), M.recorteNegro(g, W, x0, a, x1, b), M.recorteLimpio(g, W, x0, a, x1, b)];
    const lecturas = versiones.map(function (v) { return OCR.leer(v, psm, lista).texto.replace(/\s/g, ''); });
    const norm = function (t) { if (tipo === 'importe') { const v = M.importeCelda(t); return v === null ? null : M.eurNum(v); } return t; };
    let validas = lecturas.filter(VALID[tipo]).map(norm).filter(function (x) { return x !== null; });
    if (!validas.length && tipo === 'importe') {
      // importe tapado con fosforito que arrastró el tóner (rayas debajo de las cifras): solo la banda del texto
      const banda = [M.recorteBanda(g, W, x0, a, x1, b, 130), M.recorteBanda(g, W, x0, a, x1, b, 130, 140), M.recorteBanda(g, W, x0, a, x1, b, 100)];
      validas = banda.map(function (v) { return OCR.leer(v, psm, lista).texto.replace(/\s/g, ''); }).filter(VALID[tipo]).map(norm).filter(function (x) { return x !== null; });
      if (validas.length) validas.fosforito = true;
    }
    // el importe al doble de tamaño: no vota, pero si lee otra cifra queda como lectura alternativa (sobre todo 6/8)
    let otra = null;
    if (tipo === 'importe' && validas.length) { const t = OCR.leer(M.amplia(versiones[0], 2), psm, lista).texto.replace(/\s/g, ''); otra = VALID[tipo](t) ? norm(t) : null; }
    if (!validas.length) return { texto: lecturas[0], alternativas: [] };
    const cuenta = {}; validas.forEach(function (t) { cuenta[t] = (cuenta[t] || 0) + 1; });
    const orden = Object.keys(cuenta).sort(function (p, q) { return cuenta[q] - cuenta[p]; });
    if (otra && orden.indexOf(otra) < 0) orden.push(otra);
    return { texto: orden[0], alternativas: orden.slice(1), unanime: orden.length === 1 && validas.length === 3 && !validas.fosforito, fosforito: !!validas.fosforito };
  }
  function tinta(g, W, c, y0, y1) {
    let n = 0; for (let y = y0 + 4; y < y1 - 4; y++) for (let x = c[0] + 4; x < c[1] - 4; x++) if (g[y * W + x] < 110) n++;
    return n;
  }

  async function leeDesglose(file) {
    $('#nomDesglose').textContent = file.name;
    const prog = function (f, t) { progreso('#prog1', f, t); };
    try {
      await OCR.init(function (t) { prog(0.02, t); });
      const pdf = await abrePdf(await file.arrayBuffer());
      const filasLeidas = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        prog((p - 1) / pdf.numPages, 'Leyendo página ' + p + ' de ' + pdf.numPages + '…');
        await pausa();
        const cv = await renderPagina(pdf, p, DPI_DESGLOSE);
        const g = grisDeCanvas(cv), W = cv.width;
        const filas = M.rejilla(g, W, cv.height);
        for (let i = 0; i < filas.length; i++) {
          const f = filas[i], c = f.celdas;
          prog((p - 1 + i / filas.length) / pdf.numPages, 'Página ' + p + ' de ' + pdf.numPages + ' · fila ' + (i + 1) + ' de ' + filas.length);
          await pausa();
          if (c.length >= 7) {
            const cod = leeCelda(g, W, c[1], f.y0, f.y1, 'codigo');
            if (/[A-Za-z]{3}/.test(cod.texto.replace(/^H/, ''))) continue; // cabecera
            const fec = leeCelda(g, W, c[0], f.y0, f.y1, 'fecha');
            const imp = leeCelda(g, W, c[c.length - 1], f.y0, f.y1, 'importe');
            const desc = OCR.leer(M.recorte(g, W, c[2][0] + 3, f.y0 + 2, c[2][1] - 3, f.y1 - 2), 6, '').texto;
            const divisa = tinta(g, W, c[3], f.y0, f.y1) > 30 || tinta(g, W, c[4], f.y0, f.y1) > 30;
            filasLeidas.push({ pagina: p, textos: [fec.texto, cod.texto, desc, divisa ? 'X' : '', '', '', imp.texto], alt: { codigo: cod.alternativas, fecha: fec.alternativas, importe: imp.alternativas }, fosforito: imp.fosforito,
              tira: recorteCanvas(cv, c[0][0] - 4, f.y0 - 3, c[c.length - 1][1] + 4, f.y1 + 3, 1100, 0.8) });
          } else if (c.length >= 1 && c.length <= 3) {
            const t0 = OCR.leer(M.recorte(g, W, c[0][0] + 3, f.y0 + 2, c[0][1] - 3, f.y1 - 2), 7, '').texto;
            if (/totale/i.test(t0) && !/importo|transaz/i.test(t0)) {
              const imp = leeCelda(g, W, c[c.length - 1], f.y0, f.y1, 'importe');
              filasLeidas.push({ pagina: p, textos: ['Totale', imp.texto] });
            }
          }
        }
      }
      const r = M.interpretaFilas(filasLeidas);
      // cada movimiento conserva la imagen de SU fila y las lecturas alternativas
      r.movimientos.forEach(function (m) {
        const f = m.origen; delete m.origen;
        if (f && f.alt) {
          if (f.fosforito) m.dudoso.push('el importe tiene fosforito encima y se ha leído con dificultad: compáralo con la imagen');
          if (f.alt.importe.length) m.dudoso.push('el importe también se leyó como ' + f.alt.importe.join(' / '));
          m.alternativas = f.alt.importe.map(M.parseImporte).filter(function (v) { return v !== null; });
          if (f.alt.codigo.length) m.dudoso.push('el código también se leyó como ' + f.alt.codigo.join(' / '));
        }
        m.tira = f ? f.tira : null;
        m.revisado = false;
      });
      S.desglose = { archivo: file.name, movs: r.movimientos, totale: r.totaleImpreso };
      S.porMov = {};
      S.mes = null; S.hecho = {};
      finProgreso('#prog1');
      pintaDesglose();
      recasa();
    } catch (e) {
      finProgreso('#prog1');
      $('#resDesglose').innerHTML = '<div class="caja err">Error leyendo el desglose: ' + esc(e.message) + '</div>';
      console.error(e);
    }
  }

  function sumaMovs() { return M.round2((S.desglose ? S.desglose.movs : []).reduce(function (s, m) { return s + (m.importe || 0); }, 0)); }
  function cuadra() { return S.desglose && S.desglose.totale !== null && S.desglose.movs.length && S.desglose.movs.every(function (m) { return m.importe !== null; }) && M.cents(sumaMovs()) === M.cents(S.desglose.totale); }

  function pintaCuadre() {
    const d = S.desglose; if (!d) return;
    const suma = sumaMovs();
    const faltan = d.movs.filter(function (m) { return m.importe === null; }).length;
    let html;
    if (cuadra()) html = '<div class="cuadre ok">✔ Cuadra: ' + d.movs.length + ' movimientos suman ' + M.eur(suma) + ' = Totale del desglose ' + M.eur(d.totale) + '</div>';
    else {
      const dif = d.totale !== null ? M.round2(d.totale - suma) : null;
      html = '<div class="cuadre mal">✖ No cuadra: ' + d.movs.length + ' movimientos suman ' + M.eur(suma) + ' · Totale del desglose: ' +
        (d.totale !== null ? M.eur(d.totale) : '<b>no leído</b>') + (dif !== null ? ' · diferencia ' + M.eur(dif) : '') +
        (faltan ? ' · ' + faltan + ' importe(s) sin leer' : '') + '. Revisa las filas en amarillo comparando con su imagen.';
      if (faltan === 1 && d.totale !== null) html += '<br>Si el resto de importes está bien, el que falta sería ' + M.eur(dif) + ' <button class="btn peq" id="btnFalta">Rellenarlo así (compruébalo con la imagen)</button>';
      const comb = !faltan ? M.combinaAlternativas(d.movs, d.totale) : null;
      if (comb) html += '<br>Hay una única combinación de lecturas alternativas que hace cuadrar: ' + comb.map(function (x) { return 'Nº ' + x.n + ' ' + M.eurNum(x.de) + ' → ' + M.eurNum(x.a); }).join(', ') +
        ' <button class="btn peq" id="btnComb">Aplicarla (compruébalo con las imágenes)</button>';
      if (!faltan && dif !== null && !comb) {
        const sos = M.sospechosas(d.movs, dif);
        if (sos.length && sos.length <= 8) html += '<br>Filas que podrían tener un dígito mal leído: ' + sos.map(function (x) { return 'Nº ' + x.n + ' (' + M.eurNum(x.leido) + ' → ¿' + M.eurNum(x.posible) + '?)'; }).join(', ') + '.';
      }
      html += '</div>';
    }
    $('#cuadre').innerHTML = html;
    const bc = $('#btnComb');
    if (bc) bc.onclick = function () { M.combinaAlternativas(d.movs, d.totale).forEach(function (x) { const m = d.movs[x.n - 1]; m.importe = x.a; m.alternativas = []; m.revisado = false; m.dudoso.push('importe cambiado a la lectura alternativa para cuadrar: compruébalo'); }); pintaDesglose(); recasa(); };
    const b = $('#btnFalta');
    if (b) b.onclick = function () { const m = d.movs.find(function (x) { return x.importe === null; }); m.importe = M.round2(d.totale - sumaMovs()); m.dudoso.push('importe calculado por diferencia con el Totale: compruébalo'); pintaDesglose(); recasa(); };
    $('#e1').innerHTML = cuadra() ? '<span class="pill ok" title="Cuadra con el Totale">✓</span>' : '<span class="pill mal" title="No cuadra: revisar">!</span>';
  }

  function pintaDesglose() {
    const d = S.desglose; if (!d) return;
    let h = '<div class="caja"><div class="barra"><b>' + esc(d.archivo) + '</b> · Totale impreso: <input type="text" class="imp" id="inTotale" value="' + (d.totale !== null ? M.eurNum(d.totale) : '') + '"> €' +
      ' <button class="btn sec peq" id="btnAddMov">+ Añadir fila</button></div><div id="cuadre"></div></div>';
    h += '<div class="scroll"><table><thead><tr><th>Nº</th><th>Imagen de la fila en el desglose</th><th>Registro</th><th>Código</th><th>Operación</th><th>Descripción del banco</th><th class="num">Importe €</th><th></th></tr></thead><tbody>';
    d.movs.forEach(function (m, i) {
      const dud = m.dudoso.length && !m.revisado;
      h += '<tr class="' + (dud ? 'dudoso' : '') + '" data-i="' + i + '"><td>' + m.n + '</td>' +
        '<td>' + (m.tira ? '<img class="tira" src="' + m.tira + '">' : '') + (dud ? '<div style="font-size:12px;color:#8a5a00">¿' + esc(m.dudoso.join('; ')) + '? <label class="check"><input type="checkbox" data-k="revisado"> revisado</label></div>' : '') + '</td>' +
        '<td><input type="text" class="fecha" data-k="fechaReg" value="' + M.fechaDMY(m.fechaReg) + '"></td>' +
        '<td><input type="text" class="cod" data-k="codigo" value="' + esc(m.codigo || '') + '"></td>' +
        '<td><input type="text" class="fecha" data-k="fechaOp" value="' + M.fechaDMY(m.fechaOp) + '"></td>' +
        '<td><input type="text" data-k="descripcion" style="width:100%;min-width:260px" value="' + esc(m.descripcion) + '"></td>' +
        '<td class="num"><input type="text" class="imp" data-k="importe" value="' + (m.importe !== null ? M.eurNum(m.importe) : '') + '"></td>' +
        '<td><button class="btn sec peq" data-borrar="' + i + '" title="Borrar fila">✕</button></td></tr>';
    });
    h += '</tbody></table></div>';
    $('#resDesglose').innerHTML = h;
    pintaCuadre();
    $('#inTotale').onchange = function () { d.totale = M.parseImporte(this.value); pintaCuadre(); };
    $('#btnAddMov').onclick = function () {
      d.movs.push({ n: d.movs.length + 1, codigo: null, fechaReg: null, fechaOp: null, descripcion: '', comercio: '', importe: null, combustible: false, dudoso: ['fila añadida a mano'], revisado: false });
      pintaDesglose(); recasa();
    };
    $$('#resDesglose tbody tr').forEach(function (tr) {
      const m = d.movs[+tr.dataset.i];
      tr.querySelectorAll('input[data-k]').forEach(function (inp) {
        inp.onchange = function () {
          const k = inp.dataset.k;
          if (k === 'revisado') { m.revisado = inp.checked; tr.classList.toggle('dudoso', !inp.checked); return; }
          if (k === 'importe') { m.importe = M.parseImporte(inp.value); if (m.importe === null && inp.value.trim()) inp.style.borderColor = 'red'; else { inp.style.borderColor = ''; inp.value = m.importe !== null ? M.eurNum(m.importe) : ''; } pintaCuadre(); }
          else if (k === 'fechaReg' || k === 'fechaOp') { const x = inp.value.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/); m[k] = x ? M.isoDesdeDMY(x[1], x[2], x[3]) : null; inp.value = M.fechaDMY(m[k]); }
          else if (k === 'codigo') { m.codigo = M.normalizaCodigo(inp.value) || (inp.value.trim() || null); }
          else if (k === 'descripcion') { m.descripcion = inp.value; m.comercio = M.limpiaComercio(inp.value); m.combustible = /carburante/i.test(inp.value); }
          setTimeout(recasa, 0);
        };
      });
    });
    $$('#resDesglose [data-borrar]').forEach(function (b) {
      b.onclick = function () { if (!confirm('¿Borrar la fila ' + (+b.dataset.borrar + 1) + '?')) return; d.movs.splice(+b.dataset.borrar, 1); d.movs.forEach(function (m, i) { m.n = i + 1; }); pintaDesglose(); recasa(); };
    });
    $$('#resDesglose img.tira').forEach(function (im) { im.onclick = function () { zoom(im.src); }; im.style.cursor = 'zoom-in'; });
  }

  // ================= PASO 2: TICKETS =================
  // Cada archivo es un ticket entero, sin recortes: fotos e imágenes tal cual (solo se respeta la orientación EXIF y el giro
  // de 90° que elija el usuario), PDF con todas sus páginas, facturas electrónicas XML (Facturae, UBL), HTML y TXT.
  let idSeq = 1;
  const R = window.Registro;
  let avisosCarga = [];
  function claveArchivo(file) { return file.name + '|' + file.size + '|' + file.lastModified; }
  function isoDeMs(ms) { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // valor efectivo de un campo del registro: la corrección del usuario manda sobre lo leído
  function valorRec(rec, k) { const c = rec.correcciones || {}; return c[k] !== undefined ? c[k] : (rec[k] !== undefined ? rec[k] : null); }
  function bytesAB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); }
  function fuenteDe(t) { return S.fuentes.find(function (f) { return f.id === t.fuente; }); }
  function tipoDe(file) {
    const n = file.name.toLowerCase(), t = (file.type || '').toLowerCase();
    if (/\.pdf$/.test(n) || t === 'application/pdf') return 'pdf';
    if (/\.xml$/.test(n) || /[/+]xml$/.test(t)) return 'xml';
    if (/\.html?$/.test(n) || t === 'text/html') return 'html';
    if (/\.txt$/.test(n) || t === 'text/plain') return 'texto';
    if (/\.(jpe?g|png|webp|heic|heif|gif|bmp)$/.test(n) || /^image\//.test(t)) return 'imagen';
    return null;
  }
  const NOMBRE_TIPO = { imagen: 'foto', pdf: 'PDF', xml: 'factura XML', html: 'HTML', texto: 'texto' };

  // desdeAlmacen: los archivos vienen del almacén del navegador (no hace falta volver a guardarlos)
  async function anadeTickets(files, desdeAlmacen) {
    const prog = function (f, t) { progreso('#prog2', f, t); };
    avisosCarga = [];
    await pidePersistencia(); // antes de la primera escritura
    for (let k = 0; k < files.length; k++) {
      const file = files[k];
      prog(k / files.length, 'Leyendo ticket ' + (k + 1) + ' de ' + files.length + '… (' + file.name + ')');
      await pausa();
      const tipo = tipoDe(file);
      if (!tipo) { avisosCarga.push(file.name + ': este formato no se puede leer: guárdalo como PDF (Imprimir → Guardar como PDF) y añádelo.'); continue; }
      const clave = claveArchivo(file);
      if (S.fuentes.some(function (f) { return f.clave === clave; })) { avisosCarga.push(file.name + ': ya estaba añadido.'); continue; }
      try {
        const rec = await R.get(clave).catch(function () { return null; });
        const f = { id: 'F' + (idSeq++), nombre: file.name, tipo: tipo, clave: clave, tamano: file.size, lastModified: file.lastModified, rot: rec && rec.rot ? rec.rot : 0 };
        if (rec && rec.estado === 'enviada') {
          // ya va en un rendiconto: no entra en la casación, se muestra aparte
          f.enviada = { rendiconto: rec.rendiconto, fechaEnvio: rec.fechaEnvio, mini: rec.mini, importe: valorRec(rec, 'importe') };
          S.fuentes.push(f); continue;
        }
        const error = await preparaFuente(f, file);
        if (error) { avisosCarga.push(error); continue; }
        if (!desdeAlmacen) await guardaArchivo(clave, file);
        // si se había borrado y se vuelve a añadir, deja de contar como borrado
        const bor = (await R.meta('borrados').catch(function () { return null; })) || [];
        if (bor.indexOf(clave) >= 0) await R.ponMeta('borrados', bor.filter(function (k) { return k !== clave; })).catch(function () {});
        S.fuentes.push(f);
        // fotos y PDF leídos con un lector anterior (sin buscar varios tickets por página) se vuelven a leer
        const reusar = rec && rec.leido && rec.tipo === tipo && (rec.rot || 0) === f.rot && ((tipo !== 'pdf' && tipo !== 'imagen') || rec.lector === LECTOR);
        S.tickets.push(reusar ? await ticketDeRegistro(f, rec) : await leeFuente(f, rec, function (t) { prog((k + 0.5) / files.length, file.name + ': ' + t); }));
      } catch (e) { avisosCarga.push(file.name + ': no se pudo abrir (' + e.message + ').'); console.error(e); }
    }
    finProgreso('#prog2');
    pintaCarga(); pintaTickets(); recasa(); pintaBandeja(); estadoAlmacen();
  }

  // ---------------- archivos guardados: el original de cada ticket, tal cual, en el navegador ----------------
  // Así el PDF se puede generar otro día (o tras cerrar la app) sin volver a elegir los archivos.
  function esCuota(e) { return !!e && (e.name === 'QuotaExceededError' || /quota|cuota/i.test(e.message || '')); }
  async function guardaArchivo(clave, file) {
    try {
      if (await R.archivo(clave)) return true;
      await R.ponArchivo(clave, file, file.name);
      return true;
    } catch (e) {
      avisosCarga.push(esCuota(e) ? file.name + ': no queda espacio en este dispositivo para guardar el archivo. El ticket queda en la bandeja sin archivo: libera espacio en Ajustes o vuelve a añadirlo cuando generes el PDF.' : file.name + ': no se pudo guardar el archivo (' + e.message + ').');
      return false;
    }
  }
  // un archivo guardado, como File: se lee igual que si se acabara de elegir (misma clave: nombre, tamaño y fecha)
  async function archivoGuardado(clave, nombre, lastModified) {
    const x = await R.archivo(clave).catch(function () { return null; });
    return x && x.blob ? new File([x.blob], nombre || x.nombre, { type: x.tipo || x.blob.type || '', lastModified: lastModified }) : null;
  }
  async function anadeDesdeAlmacen(recs) {
    const files = (await Promise.all(recs.map(function (r) { return archivoGuardado(r.clave, r.nombre, r.lastModified); }))).filter(Boolean);
    if (files.length) await anadeTickets(files, true);
  }
  // foto hecha con la cámara desde la app: nombre con la fecha y la hora del momento de la foto
  function fotoConNombre(f, i) {
    const d = new Date(), dos = function (n) { return String(n).padStart(2, '0'); };
    const ext = /png/i.test(f.type) ? '.png' : (/heic|heif/i.test(f.type) ? '.heic' : '.jpg');
    const nombre = 'foto-' + dos(d.getDate()) + '-' + dos(d.getMonth() + 1) + '-' + d.getFullYear() + '-' + dos(d.getHours()) + '-' + dos(d.getMinutes()) + '-' + dos(d.getSeconds()) + (i ? '-' + (i + 1) : '') + ext;
    return new File([f], nombre, { type: f.type || 'image/jpeg', lastModified: d.getTime() });
  }

  async function cargaImagen(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* probar con <img>: Safari abre HEIC así */ }
    const url = URL.createObjectURL(file);
    try { const im = await imgDeDataURL(url); return im.naturalWidth ? im : null; } catch (e) { return null; } finally { URL.revokeObjectURL(url); }
  }
  // guarda en la fuente lo necesario para leerla otra vez y para el PDF de salida. Devuelve un aviso si no se puede abrir.
  async function preparaFuente(f, file) {
    if (f.tipo === 'imagen') {
      const bmp = await cargaImagen(file);
      if (!bmp) return /hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type) ? file.name + ': esta foto está en HEIC y este navegador no la abre: añade al atajo la acción de convertir a JPEG o ábrela en el iPhone.' : file.name + ': este navegador no puede abrir la imagen.';
      const jpg = /jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name), cab = jpg ? new Uint8Array(await file.slice(0, 131072).arrayBuffer()) : null;
      f.exif = jpg ? M.fechaExif(cab) : null;
      f.captura = esCaptura(file, bmp.width, bmp.height, jpg && M.camaraExif(cab));
      // una captura se guarda a su resolución (la letra de pantalla es pequeña y las capturas largas son muy altas)
      const k = Math.min(1, (f.captura ? 8000 : 2400) / Math.max(bmp.width, bmp.height));
      f.img = canvasDe(bmp, Math.round(bmp.width * k), Math.round(bmp.height * k)).toDataURL('image/jpeg', f.captura ? 0.92 : 0.88);
    } else if (f.tipo === 'pdf') {
      f.pdf = bytesAB64(new Uint8Array(await file.arrayBuffer()));
    } else {
      f.fuenteTexto = await file.text();
    }
    return null;
  }
  // ¿es una captura de pantalla? Por el nombre (IMG_1234.PNG, «Captura de pantalla…», «Screenshot…»), por ser PNG sin datos
  // de cámara o por tener las medidas (o la forma alargada) de una pantalla sin datos de cámara
  const PANTALLAS = [[1170, 2532], [1179, 2556], [1290, 2796], [1206, 2622], [1320, 2868], [1125, 2436], [1242, 2688], [828, 1792], [750, 1334], [1242, 2208],
    [1080, 2340], [1080, 2400], [1440, 3200], [1920, 1080], [2560, 1440], [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1680, 1050], [2560, 1600], [2880, 1800], [3024, 1964], [3840, 2160]];
  function esCaptura(file, w, h, camara) {
    if (/^(img_\d{4}\.png|captura de pantalla|captura|screenshot|screen shot)/i.test(file.name)) return true;
    if (camara) return false;
    if (/png/i.test(file.type) || /\.png$/i.test(file.name)) return true;
    const pantalla = PANTALLAS.some(function (p) { return (p[0] === w && p[1] === h) || (p[0] === h && p[1] === w); });
    return pantalla || Math.max(w, h) / Math.min(w, h) >= 1.75;
  }
  // captura de pantalla: se lee a su resolución, en grises (invertida si es modo oscuro), sin la barra de estado del móvil
  // ni la barra de tareas del PC (solo para leer: la imagen sale entera); la letra pequeña del PC se amplía ×2 y las
  // capturas muy largas se leen por franjas solapadas
  function ocrCaptura(cv) {
    const W = cv.width, H = cv.height, movil = H > W * 1.4, k = !movil && W <= 2000 ? 2 : 1;
    const src = k === 1 ? cv : canvasDe(cv, W * k, H * k), Wk = src.width, Hk = src.height;
    // gris por luminancia (no por el canal más claro, que sirve contra el fosforito): el texto azul o de color de las apps
    // sobre fondo blanco tiene que quedar oscuro
    const px = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, Wk, Hk).data, g = new Uint8Array(Wk * Hk);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
    let suma = 0, n = 0; for (let i = 0; i < g.length; i += 7) { suma += g[i]; n++; }
    if (suma / n < 110) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i]; // modo oscuro
    // franja de arriba del móvil (hora, batería, cobertura) y barra de tareas del PC (con su fecha y hora): no se leen
    const arriba = movil ? Math.round(W * 0.15 * k) : 0, abajo = movil ? 0 : Math.round(H * 0.05 * k);
    g.fill(255, 0, arriba * Wk); if (abajo) g.fill(255, (Hk - abajo) * Wk);
    const alto = movil ? Math.round(Wk * 2.2) : Hk, paso = Math.round(alto * 0.85), lineas = [];
    for (let y0 = 0; y0 < Hk; y0 += paso) {
      const y1 = Math.min(Hk - 1, y0 + alto - 1), dy = y0 / k;
      const mueve = function (c) { return [c[0], c[1] + dy, c[2], c[3] + dy]; };
      M.lineasDeTSV(OCR.leer(M.recorte(g, Wk, 0, y0, Wk - 1, y1, 20), 3, '', true).tsv, 20, k).forEach(function (l) {
        const x = { texto: l.texto, caja: mueve(l.caja), palabras: l.palabras.map(function (p) { return Object.assign({}, p, { caja: mueve(p.caja) }); }) };
        // en el solape de dos franjas la misma línea sale dos veces: se queda una
        if (!lineas.some(function (o) { return o.texto === x.texto && Math.abs(o.caja[1] - x.caja[1]) < 14; })) lineas.push(x);
      });
      if (y1 >= Hk - 1) break;
    }
    return lineas;
  }
  // la imagen de la fuente con el giro de 90° elegido
  async function canvasDeImagen(f) {
    const im = await imgDeDataURL(f.img), r = ((f.rot || 0) % 360 + 360) % 360;
    if (!r) return canvasDe(im);
    const cv = document.createElement('canvas'); cv.width = r === 180 ? im.width : im.height; cv.height = r === 180 ? im.height : im.width;
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.translate(cv.width / 2, cv.height / 2); ctx.rotate(r * Math.PI / 180); ctx.drawImage(im, -im.width / 2, -im.height / 2);
    return cv;
  }
  // OCR de una imagen entera: normal, limpia y, si es grande, reducida (el fondo y las sombras molestan menos)
  function ocrImagen(cv) {
    const g = grisDeCanvas(cv);
    const r1 = OCR.leer(M.recorte(g, cv.width, 0, 0, cv.width - 1, cv.height - 1, 20), 6, '');
    let a = M.analizaTicket(r1.texto), texto = r1.texto;
    const mezcla = function (b, t) {
      if (b.importe !== null && b.puntos > a.puntos) { b.candidatos = Array.from(new Set(b.candidatos.concat(a.candidatos))); if (!b.codigo) b.codigo = a.codigo; if (!b.fecha) b.fecha = a.fecha; a = b; texto = t; }
      else { a.candidatos = Array.from(new Set(a.candidatos.concat(b.candidatos))); if (!a.codigo) a.codigo = b.codigo; if (!a.fecha) a.fecha = b.fecha; }
    };
    if (a.importe === null || a.puntos < 2) { const r2 = OCR.leer(M.recorteLimpio(g, cv.width, 0, 0, cv.width - 1, cv.height - 1, 20, 18), 6, ''); mezcla(M.analizaTicket(r2.texto), r2.texto); }
    if ((a.importe === null || a.puntos < 2) && Math.max(cv.width, cv.height) > 1800) {
      const kk = 1600 / Math.max(cv.width, cv.height), red = canvasDe(cv, Math.round(cv.width * kk), Math.round(cv.height * kk));
      const r3 = OCR.leer(M.recorteLimpio(grisDeCanvas(red), red.width, 0, 0, red.width - 1, red.height - 1, 20, 18), 6, ''); mezcla(M.analizaTicket(r3.texto), r3.texto);
    }
    return { a: a, texto: texto };
  }
  // texto de un PDF digital, línea a línea (pdf.js getTextContent agrupado por altura)
  async function textoPdf(pdf) {
    const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent(), lineas = [];
      tc.items.forEach(function (it) {
        if (!it.str || !it.str.trim()) return;
        const y = it.transform[5], x = it.transform[4];
        let l = lineas.find(function (z) { return Math.abs(z.y - y) < 3; });
        if (!l) { l = { y: y, partes: [] }; lineas.push(l); }
        l.partes.push({ x: x, s: it.str });
      });
      lineas.sort(function (a, b) { return b.y - a.y; }).forEach(function (l) { out.push(l.partes.sort(function (a, b) { return a.x - b.x; }).map(function (z) { return z.s; }).join(' ').replace(/\s+/g, ' ').trim()); });
    }
    return out.join('\n');
  }
  function textoDeHtml(src) {
    const marcado = src.replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/table)[^>]*>/gi, '$&\n').replace(/<\/t[dh]>/gi, '$& ');
    const doc = new DOMParser().parseFromString(marcado, 'text/html');
    doc.querySelectorAll('script,style,head').forEach(function (e) { e.remove(); });
    return (doc.body ? doc.body.textContent : '').split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join('\n');
  }
  // vista de un ticket sin imagen propia (XML, HTML, TXT): una tarjeta con su texto
  function vistaTexto(titulo, lineas) {
    const cv = document.createElement('canvas'); cv.width = 620; cv.height = 820;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#c5cad1'; ctx.strokeRect(1, 1, cv.width - 2, cv.height - 2);
    ctx.fillStyle = '#16325c'; ctx.font = 'bold 26px Segoe UI, Arial, sans-serif'; ctx.fillText(titulo, 28, 52);
    ctx.fillStyle = '#222'; ctx.font = '20px Consolas, monospace';
    let y = 100;
    lineas.forEach(function (l) { partirLinea(l, 50).forEach(function (s) { if (y < cv.height - 24) ctx.fillText(s, 28, y); y += 28; }); });
    return cv;
  }
  function partirLinea(s, n) { const out = []; s = String(s); while (s.length > n) { let i = s.lastIndexOf(' ', n); if (i < n / 2) i = n; out.push(s.slice(0, i)); s = s.slice(i).trim(); } out.push(s); return out; }
  function lineasXml(f) {
    const x = f.xml || {};
    return ['Emisor: ' + (x.emisor || '—'), 'Número: ' + (x.numero || '—'), 'Fecha: ' + (x.fecha ? M.fechaDMY(x.fecha) : '—'), 'Importe: ' + (x.importe !== null && x.importe !== undefined ? M.eur(x.importe) : '—'), '', 'Archivo: ' + f.nombre];
  }
  // miniatura y vista grande del ticket
  async function vistas(f) {
    let cv;
    if (f.tipo === 'imagen') cv = await canvasDeImagen(f);
    else if (f.tipo === 'pdf') cv = await renderPagina(await abrePdf(b64ABytes(f.pdf)), 1, 110);
    else if (f.tipo === 'xml') cv = vistaTexto('Factura electrónica' + (f.xml && f.xml.formato ? ' (' + f.xml.formato + ')' : ''), lineasXml(f));
    else cv = vistaTexto(f.nombre, (f.texto || '').split('\n').slice(0, 26));
    return { mini: recorteCanvas(cv, 0, 0, cv.width, cv.height, 520, 0.8), full: recorteCanvas(cv, 0, 0, cv.width, cv.height, 1600, 0.85), reg: recorteCanvas(cv, 0, 0, cv.width, cv.height, 240, 0.7) };
  }

  // lee un ticket (OCR, texto del PDF, XML…) y lo guarda en el registro.
  // noGuardar: no toca el registro (lo usa la pantalla «Faltan», que casa contra su propia lista y no llena la Bandeja)
  async function leeFuente(f, rec, aviso, noGuardar) {
    const t = { id: 'T' + (idSeq++), fuente: f.id, tipo: f.tipo, nombreFuente: f.nombre, clave: f.clave, anchoMm: 90, movManual: null, ignorar: false,
      importe: null, candidatos: [], fecha: null, fechaOrigen: null, hora: null, codigo: null, nombre: '', texto: '', lectura: null, aviso: null };
    const usa = function (a, texto, lectura) { t.importe = a.importe; t.candidatos = a.candidatos; t.fecha = a.fecha; t.hora = a.hora; t.codigo = a.codigo; t.nombre = a.nombre; t.texto = texto; t.lectura = lectura; };
    const variosDe = function (paginas, lectura) {
      t.modo = 'varios'; t.paginas = paginas; t.manual = []; t.quitadas = []; t.lectura = lectura;
      t.texto = paginas.map(function (pg) { return pg.lineas.map(function (l) { return l.texto; }).join('\n'); }).join('\n');
    };
    if (f.tipo === 'imagen' && f.captura) {
      // captura de pantalla: siempre con posiciones (una o varias operaciones), etiqueta junto a cada importe;
      // la fecha sale solo de lo que se lee (nunca del nombre, del archivo ni del EXIF: la captura se hace días después)
      await OCR.init(aviso);
      const t0 = Date.now(), cv = await canvasDeImagen(f);
      variosDe([{ w: cv.width, h: cv.height, lineas: ocrCaptura(cv), giro: 0, via: 'captura', ms: Date.now() - t0, img: imagenReducida(cv) }], 'ocr de captura');
      t.captura = true;
    } else if (f.tipo === 'imagen') {
      // imagen (foto, escaneo en JPG/PNG): se lee entera con posiciones; con dos o más tickets va por anclas, sin recortes
      await OCR.init(aviso);
      const pag = ocrPaginaOrientada(await canvasDeImagen(f));
      if (pag.giro) f.rot = ((f.rot || 0) + pag.giro) % 360; // estaba de lado: se queda derecha para verla y para el PDF
      const t0 = Date.now(); pag.lineas = releeZonas(pag.cv, pag.lineas); pag.ms += Date.now() - t0;
      if (M.variosTickets(pag.lineas)) variosDe([{ w: pag.w, h: pag.h, lineas: pag.lineas, giro: 0, via: pag.via, ms: pag.ms, img: imagenReducida(pag.cv) }], 'ocr con posiciones');
      else { const r = ocrImagen(pag.cv); usa(r.a, r.texto, 'ocr'); }
      // altura de la letra del ticket respecto a la foto (mediana de las líneas leídas): sirve para que en el PDF se lea
      const altos = pag.lineas.filter(function (l) { return l.texto.length >= 3; }).map(function (l) { return l.caja[3] - l.caja[1]; }).sort(function (x, y) { return x - y; });
      if (altos.length >= 3) t.letraRel = altos[Math.floor(altos.length / 2)] / pag.h;
    } else if (f.tipo === 'pdf') {
      const pdf = await abrePdf(b64ABytes(f.pdf)); f.paginas = pdf.numPages;
      const texto = await textoPdf(pdf), conTexto = /\d/.test(texto) && texto.replace(/\s/g, '').length >= 20;
      // cada página se lee entera con la posición de cada palabra: con la capa de texto si la tiene y es buena;
      // si no, con OCR (en la orientación buena). Un PDF escaneado va siempre por anclas, como en la 07;
      // un PDF con texto, solo si alguna página lleva dos o más tickets (si no, es un documento, como siempre).
      const paginas = []; let ocr = false;
      for (let p = 1; p <= pdf.numPages; p++) {
        if (aviso) aviso('Leyendo la página ' + p + ' de ' + pdf.numPages); await pausa();
        const t0 = Date.now(), pp = await paginaPdf(pdf, p, DPI_TICKETS);
        const lineas = conTexto ? await lineasTextoPdf(pp.pg, pp.vp) : null;
        if (lineas) { paginas.push({ w: pp.cv.width, h: pp.cv.height, lineas: lineas, giro: 0, via: 'texto', ms: Date.now() - t0, img: imagenReducida(pp.cv) }); continue; }
        await OCR.init(aviso); ocr = true;
        const pag = ocrPaginaOrientada(pp.cv);
        paginas.push({ w: pag.w, h: pag.h, lineas: pag.lineas, giro: pag.giro, via: 'ocr', ms: Date.now() - t0, img: imagenReducida(pag.cv) });
      }
      if (!conTexto) variosDe(paginas, 'ocr con posiciones');
      else if (paginas.some(function (pg) { return M.variosTickets(pg.lineas); })) {
        variosDe(paginas, ocr ? 'texto PDF y ocr con posiciones' : 'texto PDF con posiciones');
        t.unaPaginaConTexto = pdf.numPages === 1;
      } else usa(M.analizaTicket(texto), texto, 'texto PDF');
    } else if (f.tipo === 'xml') {
      const doc = new DOMParser().parseFromString(f.fuenteTexto, 'application/xml');
      const x = doc.getElementsByTagName('parsererror').length ? { formato: null, malFormado: true } : M.facturaXml(doc);
      f.xml = x;
      t.importe = x.importe !== undefined ? x.importe : null; t.fecha = x.fecha || null; t.nombre = x.emisor || ''; t.texto = [x.emisor, x.numero].filter(Boolean).join('\n');
      t.lectura = x.formato ? 'XML ' + x.formato : 'XML';
      if (!x.formato) t.aviso = (x.malFormado ? 'el XML está mal formado' : 'formato XML no reconocido') + ': escribe el importe';
    } else {
      f.texto = f.tipo === 'html' ? textoDeHtml(f.fuenteTexto) : f.fuenteTexto.replace(/\r/g, '');
      usa(M.analizaTicket(f.texto), f.texto, f.tipo === 'html' ? 'texto HTML' : 'texto');
    }
    if (t.importe === null && !t.aviso && t.lectura && t.modo !== 'varios') t.aviso = 'no se ha leído el importe: escríbelo';
    // fecha: la del ticket; si no se lee, la de la foto (EXIF); si no, la del nombre del archivo (el atajo la pone); si no, la del archivo
    const fFoto = f.nombre.match(/foto-(\d{2})-(\d{2})-(20\d{2})-(\d{2})-(\d{2})/);
    const fNombre = fFoto ? [null, fFoto[3], fFoto[2], fFoto[1], fFoto[4], fFoto[5]] : f.nombre.match(/(20\d{2})-(\d{2})-(\d{2})(?:\D+(\d{2})[.:](\d{2}))?/);
    if (t.modo === 'varios') { /* cada ticket de la página lleva su fecha: se busca en su zona al casar */ }
    else if (t.fecha) t.fechaOrigen = t.lectura;
    else if (f.exif) { t.fecha = f.exif.fecha; t.fechaOrigen = 'exif'; if (!t.hora) t.hora = f.exif.hora; }
    else if (fNombre) { t.fecha = fNombre[1] + '-' + fNombre[2] + '-' + fNombre[3]; t.fechaOrigen = 'nombre del archivo'; if (!t.hora && fNombre[4]) t.hora = fNombre[4] + ':' + fNombre[5]; }
    else { t.fecha = isoDeMs(f.lastModified); t.fechaOrigen = 'archivo'; }
    const v = await vistas(f); t.mini = v.mini; t.full = v.full;
    const r = rec || { clave: f.clave, alta: new Date().toISOString(), estado: 'pendiente', correcciones: {} };
    Object.assign(r, { nombre: f.nombre, tipo: f.tipo, tamano: f.tamano, lastModified: f.lastModified, rot: f.rot || 0, mini: v.reg, leido: true, actualizado: Date.now(),
      importe: t.importe, candidatos: t.candidatos, fecha: t.fecha, fechaOrigen: t.fechaOrigen, hora: t.hora, codigo: t.codigo, lectura: t.lectura, aviso: t.aviso,
      nombreTicket: t.nombre, texto: (t.texto || '').slice(0, 4000), xml: f.xml || null, modo: t.modo || 'unico', lector: LECTOR, unaPaginaConTexto: !!t.unaPaginaConTexto, captura: !!t.captura, letraRel: t.letraRel || null,
      paginas: t.paginas ? t.paginas.map(function (pg) { return { w: pg.w, h: pg.h, lineas: pg.lineas, giro: pg.giro || 0, via: pg.via, ms: pg.ms }; }) : null });
    delete r.caja; delete r.giro; // del flujo con recortes: ya no se usan
    if (noGuardar) return t;
    await R.put(r).catch(function (e) { console.warn('No se pudo guardar en el registro', e); });
    return aplicaCorrecciones(t, r);
  }
  function aplicaCorrecciones(t, rec) {
    const c = rec.correcciones || {};
    if (c.importe !== undefined) t.importe = c.importe;
    if (c.fecha !== undefined) { t.fecha = c.fecha; t.fechaOrigen = 'corregida'; }
    if (c.codigo !== undefined) t.codigo = c.codigo;
    if (c.ignorar !== undefined) t.ignorar = c.ignorar;
    if (t.modo === 'varios') { t.manual = (c.manual || []).slice(); t.quitadas = (c.quitadas || []).slice(); }
    return t;
  }
  // página entera, con la posición de cada palabra (psm 3: Tesseract separa solo los bloques de cada ticket)
  function ocrPagina(cv) {
    const r = OCR.leer(M.recorte(grisDeCanvas(cv), cv.width, 0, 0, cv.width - 1, cv.height - 1, 20), 3, '', true);
    return M.lineasDeTSV(r.tsv, 20, 1);
  }
  // OCR de la página en la orientación buena: si sale muy poco texto o de lado, se prueba girada 90, 180 y 270 grados
  // y se queda la que más palabras con sentido y líneas de total da (un ticket escaneado de lado entra así)
  function ocrPaginaOrientada(cv) {
    const t0 = Date.now();
    let mejor = { giro: 0, cv: cv, lineas: ocrPagina(cv) }; mejor.nota = M.calidadLectura(mejor.lineas);
    if (mejor.nota.deLado) [90, 180, 270].forEach(function (g) {
      const c = rotaCanvas(cv, g), l = ocrPagina(c), n = M.calidadLectura(l);
      if (n.valor > mejor.nota.valor * 1.3 + 2) mejor = { giro: g, cv: c, lineas: l, nota: n };
    });
    return { w: mejor.cv.width, h: mejor.cv.height, lineas: mejor.lineas, giro: mejor.giro, cv: mejor.cv, via: 'ocr', ms: Date.now() - t0 };
  }
  // en una imagen con varios tickets, cada uno se vuelve a leer en su zona como un bloque (psm 6): el giro propio de cada
  // ticket y el fondo de la mesa estorban menos. Solo para leer: la imagen sigue entera en el PDF, sin recortes.
  function releeZonas(cv, lineas) {
    const zonas = M.zonasDeLineas(lineas);
    if (zonas.filter(function (z) { return z.lineas.length >= 3; }).length < 2) return lineas;
    const out = [], m = 24;
    zonas.forEach(function (z) {
      if (z.lineas.length < 3) { out.push.apply(out, z.lineas); return; }
      const x0 = Math.max(0, Math.floor(z.caja[0] - m)), y0 = Math.max(0, Math.floor(z.caja[1] - m));
      const w = Math.min(cv.width, Math.ceil(z.caja[2] + m)) - x0, h = Math.min(cv.height, Math.ceil(z.caja[3] + m)) - y0;
      // el ticket se endereza con la inclinación de sus propias palabras antes de leerlo
      const a = -Math.atan(inclinacion(z.lineas)), cs = Math.cos(a), sn = Math.sin(a);
      const W2 = Math.ceil(Math.abs(w * cs) + Math.abs(h * sn)), H2 = Math.ceil(Math.abs(w * sn) + Math.abs(h * cs));
      const c = document.createElement('canvas'); c.width = W2; c.height = H2;
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W2, H2);
      ctx.translate(W2 / 2, H2 / 2); ctx.rotate(a); ctx.drawImage(cv, x0, y0, w, h, -w / 2, -h / 2, w, h);
      // de la imagen enderezada a la original: se deshace el giro y se suma la esquina de la zona
      const vuelve = function (px, py) { const dx = px - W2 / 2, dy = py - H2 / 2; return [x0 + w / 2 + dx * cs + dy * sn, y0 + h / 2 - dx * sn + dy * cs]; };
      const caja = function (k) { const p = [vuelve(k[0], k[1]), vuelve(k[2], k[1]), vuelve(k[0], k[3]), vuelve(k[2], k[3])]; return [Math.min.apply(null, p.map(function (q) { return q[0]; })), Math.min.apply(null, p.map(function (q) { return q[1]; })), Math.max.apply(null, p.map(function (q) { return q[0]; })), Math.max.apply(null, p.map(function (q) { return q[1]; }))]; };
      const ls = M.lineasDeTSV(OCR.leer(M.recorte(grisDeCanvas(c), W2, 0, 0, W2 - 1, H2 - 1, 20), 6, '', true).tsv, 20, 1).map(function (l) {
        return { texto: l.texto, caja: caja(l.caja), palabras: l.palabras.map(function (p) { return Object.assign({}, p, { caja: caja(p.caja) }); }) };
      });
      out.push.apply(out, M.calidadLectura(ls).valor > M.calidadLectura(z.lineas).valor ? ls : z.lineas);
    });
    return out;
  }
  // inclinación media (pendiente, y hacia abajo) de las líneas de una zona, por el centro de sus palabras
  function inclinacion(lineas) {
    const ps = [];
    lineas.forEach(function (l) {
      const ws = (l.palabras || []).map(function (p) { return [(p.caja[0] + p.caja[2]) / 2, (p.caja[1] + p.caja[3]) / 2]; });
      if (ws.length < 2 || ws[ws.length - 1][0] - ws[0][0] < 80) return;
      const mx = ws.reduce(function (s, q) { return s + q[0]; }, 0) / ws.length, my = ws.reduce(function (s, q) { return s + q[1]; }, 0) / ws.length;
      const num = ws.reduce(function (s, q) { return s + (q[0] - mx) * (q[1] - my); }, 0), den = ws.reduce(function (s, q) { return s + (q[0] - mx) * (q[0] - mx); }, 0);
      if (den) ps.push(num / den);
    });
    if (!ps.length) return 0;
    ps.sort(function (x, y) { return x - y; });
    const p = ps[Math.floor(ps.length / 2)];
    return Math.abs(p) < 0.2 ? p : 0; // más de unos 11°: no se fía
  }
  // líneas de una página de un PDF con texto (de un programa o de un escáner con OCR), con la caja de cada palabra
  // en píxeles de la página pintada (ya girada según /Rotate). Devuelve null si el texto no sirve.
  async function lineasTextoPdf(pg, vp) {
    const U = pdfjs().Util, tc = await pg.getTextContent(), palabras = [];
    let items = 0, torcidos = 0;
    tc.items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return; items++;
      const m = U.transform(vp.transform, it.transform), h = Math.hypot(m[2], m[3]);
      if (!(m[0] > 0) || Math.abs(m[1]) > Math.abs(m[0]) * 0.15 || !h) { torcidos++; return; } // solo texto en horizontal tal como se ve
      const ancho = (it.width || 0) * vp.scale || h * 0.55 * it.str.length, n = it.str.length;
      const re = /\S+/g; let w;
      while ((w = re.exec(it.str))) palabras.push({ t: w[0], h: h, base: m[5], caja: [m[4] + ancho * w.index / n, m[5] - h * 0.8, m[4] + ancho * (w.index + w[0].length) / n, m[5] + h * 0.2] });
    });
    if (!items || torcidos > items / 2) return null;
    // palabras -> líneas: misma altura de base y seguidas en horizontal (dos tickets lado a lado no se juntan)
    palabras.sort(function (a, b) { return a.base - b.base || a.caja[0] - b.caja[0]; });
    const lineas = [];
    palabras.forEach(function (w) {
      const l = lineas.find(function (x) { return Math.abs(x.base - w.base) < w.h * 0.5 && w.caja[0] - x.x1 < w.h * 2 && w.caja[0] > x.x0 - w.h; });
      if (l) { l.ps.push(w); l.x1 = Math.max(l.x1, w.caja[2]); } else lineas.push({ base: w.base, x0: w.caja[0], x1: w.caja[2], ps: [w] });
    });
    const out = lineas.map(function (l) { return M.lineaDePalabras(l.ps); });
    const nota = M.calidadLectura(out);
    // texto basura (una capa de OCR mala): menos de la mitad de palabras con letras o cifras, o ninguna línea de total
    return nota.proporcion < 0.5 || !nota.totales ? null : out;
  }
  // copia de la página a la mitad para verla y para el PDF de salida (las posiciones siguen en píxeles de la página entera)
  function imagenReducida(cv) { return recorteCanvas(cv, 0, 0, cv.width, cv.height, Math.round(Math.max(cv.width, cv.height) / 2), 0.8); }
  async function paginasDeVista(f, rec) {
    const vista = function (pg, cv) { return Object.assign({}, pg, { img: recorteCanvas(cv, 0, 0, cv.width, cv.height, Math.max(cv.width, cv.height), 0.8) }); };
    if (f.tipo === 'imagen') { const cv = await canvasDeImagen(f); return rec.paginas.map(function (pg) { return vista(pg, cv); }); }
    const pdf = await abrePdf(b64ABytes(f.pdf));
    return Promise.all(rec.paginas.map(async function (pg, i) { return vista(pg, rotaCanvas(await renderPagina(pdf, i + 1, DPI_TICKETS / 2), pg.giro || 0)); }));
  }
  // ticket ya leído en otra sesión: se rehace desde el registro, sin repetir la lectura
  async function ticketDeRegistro(f, rec) {
    if (f.tipo === 'xml') f.xml = rec.xml || null;
    if (f.tipo === 'html' || f.tipo === 'texto') f.texto = f.tipo === 'html' ? textoDeHtml(f.fuenteTexto) : f.fuenteTexto.replace(/\r/g, '');
    if (f.tipo === 'pdf') f.paginas = (await abrePdf(b64ABytes(f.pdf))).numPages;
    const v = await vistas(f);
    const varios = rec.modo === 'varios' && rec.paginas;
    return aplicaCorrecciones({ id: 'T' + (idSeq++), fuente: f.id, tipo: f.tipo, nombreFuente: f.nombre, clave: rec.clave, anchoMm: 90, mini: v.mini, full: v.full,
      texto: rec.texto || '', importe: rec.importe, candidatos: rec.candidatos || [], fecha: rec.fecha, fechaOrigen: rec.fechaOrigen, hora: rec.hora, codigo: rec.codigo,
      nombre: rec.nombreTicket || '', lectura: rec.lectura || null, aviso: rec.aviso || null, movManual: null, ignorar: false, recalculado: !!rec.recalculado,
      modo: varios ? 'varios' : undefined, paginas: varios ? await paginasDeVista(f, rec) : undefined, unaPaginaConTexto: !!rec.unaPaginaConTexto, captura: !!rec.captura, letraRel: rec.letraRel || null }, rec);
  }
  // corrección del usuario sobre un ticket: al registro
  async function corrige(clave, cambios) {
    const rec = await R.get(clave); if (!rec) return;
    rec.correcciones = Object.assign(rec.correcciones || {}, cambios); rec.actualizado = Date.now();
    await R.put(rec).catch(function (e) { console.warn(e); });
    pintaBandeja();
  }
  async function gira(t) {
    const f = fuenteDe(t); if (!f) return;
    f.rot = ((f.rot || 0) + 90) % 360;
    const rec = await R.get(f.clave).catch(function () { return null; });
    progreso('#prog2', 0.5, 'Girando y volviendo a leer ' + f.nombre + '…');
    const nuevo = await leeFuente(f, rec, null);
    nuevo.movManual = t.movManual;
    S.tickets[S.tickets.indexOf(t)] = nuevo;
    finProgreso('#prog2'); pintaTickets(); recasa(); pintaBandeja();
    if (detalleDe === t) abreDetalle(nuevo);
  }
  // ---------------- borrar un ticket del todo (bandeja, archivo guardado, rendiconto en curso y casaciones) ----------------
  // «Quitar» solo lo saca de este rendiconto (sigue en la bandeja); «Borrar» lo elimina de todas partes, con 5 s para deshacer.
  function preguntaBorrar(nombre) {
    return new Promise(function (ok) {
      let v = $('#veloBorrar');
      if (!v) { v = document.createElement('div'); v.className = 'velo'; v.id = 'veloBorrar'; document.body.appendChild(v); }
      v.innerHTML = '<div class="hoja-menu" role="alertdialog" aria-label="Borrar ticket"><b>¿Borrar este ticket? Sale de la bandeja, del rendiconto en curso y se borra su archivo. Tendrás 10 s para deshacer.</b><div class="ayuda">' + esc(nombre || '') +
        '</div><button class="btn grande" data-r="si" style="background:var(--mal)">Borrar</button><button class="btn sec" data-r="no">Cancelar</button></div>';
      v.hidden = false;
      const fin = function (r) { v.hidden = true; ok(r); };
      v.querySelector('[data-r=si]').onclick = function () { fin(true); };
      v.querySelector('[data-r=no]').onclick = function () { fin(false); };
      v.onclick = function (ev) { if (ev.target === v) fin(false); };
    });
  }
  // tostada de borrado con cola de «Deshacer» (10 s): si se borra otro ticket antes de que caduque, un solo «Deshacer»
  // recupera TODOS los borrados pendientes (si no, se perdería el deshacer del primero).
  var _undosBorrado = [], _nBorrado = 0;
  function tostadaBorrado(undo) {
    let d = $('#tostada');
    if (!d) { d = document.createElement('div'); d.id = 'tostada'; d.className = 'tostada'; d.setAttribute('role', 'status'); document.body.appendChild(d); }
    if (undo) { _undosBorrado.push(undo); _nBorrado++; }
    clearTimeout(d._t);
    const txt = _nBorrado <= 1 ? 'Ticket borrado.' : _nBorrado + ' tickets borrados.';
    d.innerHTML = '<span>' + esc(txt) + '</span><button class="btn sec peq" type="button">Deshacer</button>';
    d.hidden = false;
    d.querySelector('button').onclick = async function () {
      d.hidden = true; clearTimeout(d._t);
      const us = _undosBorrado.slice(); _undosBorrado = []; _nBorrado = 0;
      for (let i = us.length - 1; i >= 0; i--) { try { await us[i](); } catch (e) { console.warn(e); } }  // en orden inverso
    };
    d._t = setTimeout(function () { d.hidden = true; _undosBorrado = []; _nBorrado = 0; }, 10000);
  }
  async function borraTicket(clave, nombre, confirmar) {
    if (!clave || !(await (confirmar || preguntaBorrar)(nombre))) return;
    const rec = await R.get(clave).catch(function () { return null; }), arch = await R.archivo(clave).catch(function () { return null; });
    const f = S.fuentes.find(function (x) { return x.clave === clave; }), t = f && S.tickets.find(function (x) { return x.fuente === f.id; });
    // Si una parte ya se envió (enviada/parcial), NO se borra el registro: se perdería el historial de enviado y al
    // recargar el archivo se podría duplicar el gasto. Solo se borra el archivo y se marca descartado lo que quedaba.
    const protegido = rec && (rec.estado === 'enviada' || rec.estado === 'parcial');
    try {
      if (protegido) {
        await R.put(Object.assign({}, rec, { descartado: true, zonasSinCasar: 0 }));
        await R.borraArchivo(clave);
      } else {
        await R.borra(clave);
        await R.borraArchivo(clave);
        const bor = (await R.meta('borrados').catch(function () { return null; })) || []; bor.push(clave); await R.ponMeta('borrados', bor.slice(-500));
      }
    } catch (e) {
      alert('No se pudo borrar: ' + (e && e.message ? e.message : e));   // error claro; la sesión no se toca
      return;
    }
    if (f) { S.fuentes = S.fuentes.filter(function (x) { return x !== f; }); S.tickets = S.tickets.filter(function (x) { return x !== t; }); }
    if (t && detalleDe === t) cierraDetalle();
    pintaTickets(); recasa(); pintaBandeja(); estadoAlmacen(); guardaSesion();
    tostadaBorrado(async function () {
      if (rec) await R.put(rec).catch(function () {});                   // restaura el registro original (sin «descartado»)
      if (!protegido) { const b2 = (await R.meta('borrados').catch(function () { return null; })) || []; await R.ponMeta('borrados', b2.filter(function (k) { return k !== clave; })).catch(function () {}); }
      if (arch && arch.blob) await R.ponArchivo(clave, arch.blob, arch.nombre).catch(function () {});
      if (f) { S.fuentes.push(f); if (t) S.tickets.push(t); }
      pintaTickets(); recasa(); pintaBandeja(); estadoAlmacen(); guardaSesion();
    });
  }
  // al abrir: fuera las entradas huérfanas (claves de tickets ya borrados, registros sin archivo ni datos y archivos sin
  // registro), para que un ticket borrado no vuelva a salir en «otros días»
  async function limpiaHuerfanos() {
    try {
      const bor = (await R.meta('borrados')) || [], recs = await R.todos(), archs = await R.archivos();
      const conArchivo = {}; archs.forEach(function (x) { conArchivo[x.clave] = 1; });
      const conRec = {}; recs.forEach(function (r) { conRec[r.clave] = 1; });
      let n = 0;
      for (const r of recs) {
        if (r.estado === 'enviada' || r.estado === 'parcial') continue;   // nunca se borra lo enviado/parcial
        const vacio = !conArchivo[r.clave] && !r.mini && (r.importe === null || r.importe === undefined) && !r.leido;
        if (bor.indexOf(r.clave) >= 0 || vacio) { await R.borra(r.clave); n++; }
      }
      for (const a of archs) if (bor.indexOf(a.clave) >= 0 || !conRec[a.clave]) { await R.borraArchivo(a.clave); n++; }
      return n;
    } catch (e) { console.warn('No se pudo limpiar el registro', e); return 0; }
  }
  function quita(t) {
    if (!confirm('¿Quitar ' + t.nombreFuente + ' de este rendiconto? (sigue en la bandeja)')) return;
    S.tickets = S.tickets.filter(function (x) { return x !== t; });
    S.fuentes = S.fuentes.filter(function (f) { return f.id !== t.fuente; });
    if (detalleDe === t) cierraDetalle();
    pintaTickets(); recasa(); pintaBandeja();
  }

  // avisos de la carga y archivos ya enviados (aparte y plegados: no se casan)
  function pintaCarga() {
    const env = S.fuentes.filter(function (f) { return f.enviada; });
    $('#enviadasCarga').innerHTML = env.length ? '<details><summary>' + env.length + ' archivo(s) ya enviado(s) en un rendiconto: no se vuelven a casar</summary><div class="tickets" style="margin-top:8px">' +
      env.map(function (f) { return '<div class="ticket">' + (f.enviada.mini ? '<img src="' + f.enviada.mini + '" alt="ticket">' : '') + '<div class="fila"><b>' + esc(f.nombre) + '</b></div><div class="fila">' +
        (f.enviada.importe !== null && f.enviada.importe !== undefined ? M.eur(f.enviada.importe) + ' · ' : '') + 'enviado en ' + esc(f.enviada.rendiconto || '?') + (f.enviada.fechaEnvio ? ' el ' + M.fechaDMY(f.enviada.fechaEnvio.slice(0, 10)) : '') + '</div></div>'; }).join('') + '</div></details>' : '';
    $('#avisosCarga').innerHTML = avisosCarga.length ? '<div class="cuadre mal">' + avisosCarga.map(esc).join('<br>') + '</div>' : '';
  }

  // Bandeja: una ficha por ticket (miniatura, comercio, fecha, importe y estado); al tocarla se abre su detalle a pantalla completa
  function pintaTickets() {
    const cont = $('#listaTickets'); cont.innerHTML = '';
    $('#tituloTickets').style.display = S.tickets.length ? '' : 'none';
    $('#ayudaTickets').style.display = S.tickets.length ? '' : 'none';
    S.tickets.forEach(function (t, i) {
      const b = document.createElement('button'); b.className = 'ficha'; b.dataset.id = t.id; b.type = 'button';
      const comercio = t.modo === 'varios' ? t.nombreFuente : ((t.nombre || '').split(/\s{2,}|\n/)[0] || t.nombreFuente);
      const sub = t.captura ? '📱 captura de pantalla' : t.modo === 'varios' ? (t.tipo === 'imagen' ? 'imagen' : 'PDF con ' + t.paginas.length + ' pág.') + ' · varios tickets' : [t.fecha ? M.fechaDMY(t.fecha) : '', NOMBRE_TIPO[t.tipo] || t.tipo].filter(Boolean).join(' · ');
      b.innerHTML = '<img src="' + t.mini + '" alt="">' +
        '<span class="f-txt"><span class="f-com">' + esc(comercio) + '</span><span class="f-sub" style="display:block">' + esc(sub) + '</span><span class="estado" data-estado></span></span>' +
        '<span class="f-imp">' + (t.modo === 'varios' ? '' : (t.importe !== null ? M.eur(t.importe) : '—')) + '</span>';
      b.onclick = function () { abreDetalle(t); };
      cont.appendChild(b);
    });
    actualizaVacio();
    estadoTickets();
  }
  let hayPendientes = false;
  function actualizaVacio() { $('#vacioBandeja').hidden = S.tickets.length > 0 || hayPendientes; }
  let detalleDe = null;
  function abreDetalle(t) {
    detalleDe = t;
    const i = S.tickets.indexOf(t);
    $('#hojaTitulo').textContent = 'T' + (i + 1) + ' · ' + t.nombreFuente;
    const cuerpo = $('#hojaCuerpo'); cuerpo.innerHTML = '';
    cuerpo.appendChild(tarjeta(t, i));
    $('#hoja').hidden = false; $('#hoja').scrollTop = 0;
    $$('#hojaCuerpo .pagina-v').forEach(function (pv) { preparaPagina(pv, t, +pv.dataset.pag); });
    estadoTickets();
  }
  function cierraDetalle() { $('#hoja').hidden = true; $('#hojaCuerpo').innerHTML = ''; detalleDe = null; }
  // detalle de un ticket: imagen entera (con zoom), datos editables, girar, quitar; en un PDF de varios, sus páginas con las etiquetas
  function tarjeta(t, i) {
    const d = document.createElement('div'); d.className = 'ticket' + (t.modo === 'varios' ? ' varios' : ''); d.dataset.id = t.id;
    if (t.modo === 'varios') {
      d.innerHTML = '<div class="fila"><b>T' + (i + 1) + '</b> <span class="estado" data-estado></span></div>' +
        '<div class="fila ayuda">' + esc(t.nombreFuente) + ' · ' + (t.captura ? 'captura de pantalla' : t.tipo === 'imagen' ? 'imagen con varios tickets' : 'PDF, ' + t.paginas.length + ' pág.') + ' · leído por ' + esc(t.lectura) + '</div>' +
        '<div class="ayuda">Cada etiqueta marca dónde está el código o el importe de un movimiento. Toca una etiqueta para quitarla o moverla; toca un sitio vacío para poner una a mano (por ejemplo, un importe tapado).</div>' +
        '<div class="paginas">' + t.paginas.map(function (pg, pi) { return '<div class="pagina-v" data-pag="' + pi + '"><canvas></canvas><div class="menu-ancla" hidden></div><div class="ayuda">' + (t.tipo === 'imagen' ? 'Imagen entera' : 'Página ' + (pi + 1)) + (M.paginaNoTicket(pg.lineas) ? ' · ' + M.paginaNoTicket(pg.lineas) + ': no se usa como ticket' : '') + '</div></div>'; }).join('') + '</div>' +
        '<div class="fila"><label class="check"><input type="checkbox" data-k="ignorar"' + (t.ignorar ? ' checked' : '') + '> No enviar</label> <button class="btn sec peq" data-a="quitar">✕ Quitar de este rendiconto</button> <button class="btn sec peq" data-a="borrar">🗑 Borrar</button></div>';
      d.querySelector('[data-k=ignorar]').onchange = function () { t.ignorar = this.checked; if (t.clave) corrige(t.clave, { ignorar: t.ignorar }); setTimeout(recasa, 0); };
      d.querySelector('[data-a=quitar]').onclick = function () { quita(t); };
      d.querySelector('[data-a=borrar]').onclick = function () { borraTicket(t.clave, t.nombreFuente); };
      return d;
    }
    d.innerHTML = '<img src="' + t.full + '" alt="Ticket entero">' +
      '<div class="fila"><b>T' + (i + 1) + '</b> <span class="estado" data-estado></span></div>' +
      '<div class="fila ayuda">' + esc(t.nombreFuente) + ' · ' + (NOMBRE_TIPO[t.tipo] || t.tipo) + (t.lectura ? ' · leído por ' + esc(t.lectura) : '') + '</div>' +
      (t.recalculado ? '<div class="fila estado ok">recalculado (motor nuevo)</div>' : '') +
      (t.aviso ? '<div class="fila estado aviso">' + esc(t.aviso) + '</div>' : '') +
      '<div class="fila">Importe <input type="text" class="imp" inputmode="decimal" data-k="importe" value="' + (t.importe !== null ? M.eurNum(t.importe) : '') + '"> € · Fecha <input type="text" class="fecha" inputmode="numeric" data-k="fecha" value="' + M.fechaDMY(t.fecha) + '">' + (t.fechaOrigen ? ' <span class="ayuda" data-origen>(' + esc(t.fechaOrigen) + ')</span>' : '') + '</div>' +
      '<div class="fila">Código <input type="text" class="cod" data-k="codigo" value="' + esc(t.codigo || '') + '"> <label class="check"><input type="checkbox" data-k="ignorar"' + (t.ignorar ? ' checked' : '') + '> No enviar</label></div>' +
      (t.candidatos && t.candidatos.length > 1 ? '<div class="fila">Leídos: ' + t.candidatos.map(function (v) { return '<span class="chip" data-v="' + v + '">' + M.eurNum(v) + '</span>'; }).join('') + '</div>' : '') +
      '<div class="fila">Movimiento <select data-k="mov" style="max-width:100%"></select></div>' +
      '<div class="fila">' + (t.tipo === 'imagen' ? '<button class="btn sec peq" data-a="girar">↻ Girar 90°</button>' : '') + '<button class="btn sec peq" data-a="releer">🔄 Volver a leer</button> <button class="btn sec peq" data-a="quitar">✕ Quitar de este rendiconto</button> <button class="btn sec peq" data-a="borrar">🗑 Borrar</button></div>';
    d.querySelector('img').onclick = function () { zoom(t.full); };
    d.querySelectorAll('[data-k]').forEach(function (inp) {
      inp.onchange = function () {
        const k = inp.dataset.k;
        if (k === 'importe') { t.importe = M.parseImporte(inp.value); inp.value = t.importe !== null ? M.eurNum(t.importe) : ''; }
        if (k === 'fecha') { const x = inp.value.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/); t.fecha = x ? M.isoDesdeDMY(x[1], x[2], x[3]) : null; inp.value = M.fechaDMY(t.fecha); }
        if (k === 'codigo') t.codigo = M.normalizaCodigo(inp.value);
        if (k === 'ignorar') t.ignorar = inp.checked;
        if (k === 'mov') t.movManual = inp.value ? +inp.value : null;
        if (k === 'fecha') { t.fechaOrigen = t.fecha ? 'corregida' : null; const o = d.querySelector('[data-origen]'); if (o) o.textContent = '(corregida)'; }
        if (t.clave && (k === 'importe' || k === 'fecha' || k === 'codigo' || k === 'ignorar')) { const ch = {}; ch[k] = t[k]; corrige(t.clave, ch); }
        setTimeout(function () { recasa(); pintaTickets(); }, 0);
      };
    });
    d.querySelectorAll('.chip').forEach(function (ch) { ch.onclick = function () { t.importe = +ch.dataset.v; d.querySelector('[data-k=importe]').value = M.eurNum(t.importe); t.movManual = null; if (t.clave) corrige(t.clave, { importe: t.importe }); recasa(); pintaTickets(); }; });
    const bg = d.querySelector('[data-a=girar]'); if (bg) bg.onclick = function () { gira(t).catch(function (e) { finProgreso('#prog2'); alert('Error: ' + e.message); console.error(e); }); };
    const br = d.querySelector('[data-a=releer]'); if (br) br.onclick = function () { relee(t); };
    d.querySelector('[data-a=quitar]').onclick = function () { quita(t); };
    d.querySelector('[data-a=borrar]').onclick = function () { borraTicket(t.clave, t.nombreFuente); };
    return d;
  }

  // ---------------- páginas con varios tickets: etiquetas sobre la página entera ----------------
  const cacheImgPag = {};
  function imagenPagina(t, pi) { const k = t.id + '|' + pi; if (!cacheImgPag[k]) cacheImgPag[k] = imgDeDataURL(t.paginas[pi].img); return cacheImgPag[k]; }
  function cajaAmpliada(c, m) { return [c[0] - m, c[1] - m, c[2] + m, c[3] + m]; }
  function dentro(c, x, y) { return x >= c[0] && x <= c[2] && y >= c[1] && y <= c[3]; }
  // la etiqueta de cada ancla al lado del importe (o del código), sin taparlo y sin pisar otra
  function sitiosEtiquetas(anclas, w, ancho, alto) {
    const puestas = [];
    return anclas.map(function (a) {
      const c = a.caja, tw = ancho(a);
      let x = c[2] + alto * 0.4, y = c[1] + (c[3] - c[1]) / 2 - alto / 2;
      if (x + tw > w) x = Math.max(0, c[0] - tw - alto * 0.4);
      for (let i = 0; i < 12 && puestas.some(function (p) { return x < p[2] && x + tw > p[0] && y < p[3] && y + alto > p[1]; }); i++) y += alto + 2;
      const r = [x, y, x + tw, y + alto]; puestas.push(r); return r;
    });
  }
  async function dibujaPagina(cv, t, pi, resaltar) {
    const pg = t.paginas[pi], im = await imagenPagina(t, pi);
    const k = cv.width / pg.w; cv.height = Math.round(pg.h * k);
    const ctx = cv.getContext('2d'); ctx.drawImage(im, 0, 0, cv.width, cv.height);
    ctx.lineWidth = 2; ctx.font = 'bold 12px sans-serif';
    const as = (C.porDoc[t.id] || []).filter(function (a) { return a.pagina === pi && a.caja; });
    const sitios = sitiosEtiquetas(as.map(function (a) { return { caja: a.caja.map(function (v) { return v * k; }), a: a }; }), cv.width, function (x) { return ctx.measureText('Mov. ' + x.a.mov).width + 8; }, 16);
    as.forEach(function (a, i) {
      const c = a.caja.map(function (v) { return v * k; }), s = sitios[i];
      ctx.strokeStyle = a.revisar ? '#b26b00' : '#d0021b'; ctx.strokeRect(c[0] - 3, c[1] - 3, c[2] - c[0] + 6, c[3] - c[1] + 6);
      ctx.fillStyle = '#fff3a8'; ctx.fillRect(s[0], s[1], s[2] - s[0], s[3] - s[1]); ctx.strokeRect(s[0], s[1], s[2] - s[0], s[3] - s[1]);
      ctx.fillStyle = '#8a0010'; ctx.fillText('Mov. ' + a.mov, s[0] + 4, s[1] + 12);
    });
    (resaltar || []).forEach(function (o) {
      if (o.pagina !== pi || !o.caja) return;
      const c = o.caja.map(function (v) { return v * k; });
      ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 3; ctx.strokeRect(c[0] - 5, c[1] - 5, c[2] - c[0] + 10, c[3] - c[1] + 10);
      ctx.fillStyle = '#1d4ed8'; ctx.beginPath(); ctx.arc(c[0] - 14, c[1] + (c[3] - c[1]) / 2, 11, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.fillText(String(o.numero), c[0] - 18, c[1] + (c[3] - c[1]) / 2 + 5);
    });
    return k;
  }
  let moviendo = null; // {t, a}: la siguiente pulsación en la página coloca de nuevo esa etiqueta
  function preparaPagina(pv, t, pi) {
    const cv = pv.querySelector('canvas'), menu = pv.querySelector('.menu-ancla');
    cv.width = Math.min(560, Math.max(260, ($('main').clientWidth || 600) - 60));
    let k = 1;
    dibujaPagina(cv, t, pi).then(function (kk) { k = kk; });
    cv.onclick = function (ev) {
      const r = cv.getBoundingClientRect(), x = (ev.clientX - r.left) * cv.width / r.width / k, y = (ev.clientY - r.top) * cv.height / r.height / k;
      const cerrar = '<button class="btn sec peq" data-m="cerrar">✕</button>';
      menu.style.left = Math.min(ev.clientX - r.left, r.width - 230) + 'px'; menu.style.top = (ev.clientY - r.top + 8) + 'px';
      if (moviendo && moviendo.t === t) { const a = moviendo.a; moviendo = null; quitaAncla(t, a); ponAncla(t, pi, x, y, a.mov); return; }
      const a = (C.porDoc[t.id] || []).find(function (z) { return z.pagina === pi && z.caja && dentro(cajaAmpliada(z.caja, 30), x, y); });
      if (a) {
        menu.innerHTML = '<b>Mov. ' + a.mov + '</b> <span class="ayuda">(' + esc(a.origen) + ')</span><br><button class="btn peq" data-m="quitar">Quitar</button> <button class="btn sec peq" data-m="mover">Mover</button> ' + cerrar;
      } else {
        const movs = S.desglose ? S.desglose.movs : [];
        if (!movs.length) { menu.innerHTML = 'Primero carga el desglose. ' + cerrar; menu.hidden = false; menu.querySelector('[data-m=cerrar]').onclick = function () { menu.hidden = true; }; return; }
        menu.innerHTML = 'Etiqueta a mano aquí:<br><select data-m="mov">' + movs.map(function (m) { return '<option value="' + m.n + '">Mov. ' + m.n + ' · ' + M.eurNum(m.importe) + ' · ' + esc((m.comercio || '').slice(0, 18)) + '</option>'; }).join('') + '</select> <button class="btn peq" data-m="poner">Poner</button> ' + cerrar;
      }
      menu.hidden = false;
      menu.querySelector('[data-m=cerrar]').onclick = function () { menu.hidden = true; };
      const bq = menu.querySelector('[data-m=quitar]'); if (bq) bq.onclick = function () { menu.hidden = true; quitaAncla(t, a); };
      const bm = menu.querySelector('[data-m=mover]'); if (bm) bm.onclick = function () { menu.hidden = true; moviendo = { t: t, a: a }; pv.querySelector('.ayuda').textContent = 'Toca el sitio nuevo de la etiqueta Mov. ' + a.mov; };
      const bp = menu.querySelector('[data-m=poner]'); if (bp) bp.onclick = function () { menu.hidden = true; ponAncla(t, pi, x, y, +menu.querySelector('[data-m=mov]').value); };
    };
  }
  function ponAncla(t, pi, x, y, mov) {
    const z = (zonasDe[t.id] || []).find(function (zz) { return zz.pagina === pi && zz.caja && dentro(cajaAmpliada(zz.caja, 20), x, y); });
    t.manual.push({ mov: mov, pagina: pi, zona: z ? z.id : 'mano-' + pi + '-' + Math.round(x) + '-' + Math.round(y), caja: [x - 45, y - 16, x + 45, y + 16] });
    if (t.clave) corrige(t.clave, { manual: t.manual });
    recasa(); pintaTickets();
  }
  function quitaAncla(t, a) {
    if (a.origen === 'a mano') t.manual = t.manual.filter(function (m) { return !(m.mov === a.mov && m.pagina === a.pagina && String(m.caja) === String(a.caja)); });
    else t.quitadas.push(a.zona + '|' + a.mov);
    if (t.clave) corrige(t.clave, { manual: t.manual, quitadas: t.quitadas });
    recasa(); pintaTickets();
  }
  // recorte de la zona de una ancla para verla pequeña (no cambia nada: la página sale entera en el PDF)
  async function vistaAncla(t, pagina, caja, numero, maxLado) {
    if (t.modo !== 'varios' || !caja) return t.mini;
    const pg = t.paginas[pagina], im = await imagenPagina(t, pagina), k = im.width / pg.w;
    const x0 = Math.max(0, caja[0] - pg.w * 0.2), y0 = Math.max(0, caja[1] - pg.h * 0.12), x1 = Math.min(pg.w, caja[2] + pg.w * 0.1), y1 = Math.min(pg.h, caja[3] + pg.h * 0.05);
    const cv = document.createElement('canvas'), esc2 = Math.min(1, (maxLado || 260) / Math.max((x1 - x0) * k, (y1 - y0) * k));
    cv.width = Math.round((x1 - x0) * k * esc2); cv.height = Math.round((y1 - y0) * k * esc2);
    const ctx = cv.getContext('2d'); ctx.drawImage(im, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, 0, 0, cv.width, cv.height);
    const c = caja.map(function (v, i) { return ((v - (i % 2 ? y0 : x0)) * k * esc2); });
    ctx.strokeStyle = numero ? '#1d4ed8' : '#d0021b'; ctx.lineWidth = 2; ctx.strokeRect(c[0] - 3, c[1] - 3, c[2] - c[0] + 6, c[3] - c[1] + 6);
    if (numero) { ctx.fillStyle = '#1d4ed8'; ctx.font = 'bold 14px sans-serif'; ctx.fillText(String(numero), Math.max(2, c[0] - 16), c[1] + 12); }
    return cv.toDataURL('image/jpeg', 0.85);
  }

  function opcionesMov(sel, t) {
    const movs = S.desglose ? S.desglose.movs : [];
    const auto = (C.porDoc[t.id] || []).length && !t.movManual;
    let h = '<option value="">' + (auto ? '(automático)' : '— sin movimiento —') + '</option>';
    movs.forEach(function (m) { h += '<option value="' + m.n + '"' + (t.movManual === m.n ? ' selected' : '') + '>' + m.n + ' · ' + M.fechaDMY(m.fechaOp) + ' · ' + esc((m.comercio || '').slice(0, 26)) + ' · ' + M.eur(m.importe) + '</option>'; });
    sel.innerHTML = h;
  }
  function estadoTickets() {
    S.tickets.forEach(function (t) {
      document.querySelectorAll('[data-id="' + t.id + '"]').forEach(function (d) { estadoDe(d, t); });
    });
    const n = S.tickets.filter(function (t) { return !t.ignorar; }).length;
    $('#e2').innerHTML = S.tickets.length ? '<span class="pill ok">' + n + '</span>' : '';
  }
  function estadoDe(d, t) {
    {
      const e = d.querySelector('[data-estado]'), as = C.porDoc[t.id] || [], libres = C.libres[t.id] || 0;
      if (!e) return;
      const pregunta = C.preguntas.some(function (q) { return q.opciones.some(function (o) { return o.doc === t.id; }); });
      if (t.ignorar) { e.className = 'estado'; e.textContent = 'no se envía'; }
      else if (as.length) {
        const rev = as.some(function (a) { return a.revisar; });
        e.className = 'estado ' + (rev || libres ? 'aviso' : 'ok');
        e.textContent = '→ ' + as.map(function (a) { return 'Mov. ' + a.mov + ' (' + a.origen + ')'; }).join(', ') + (rev ? ' · revisar' : '') + (libres ? ' · ' + libres + ' zona(s) con un total sin casar' : '') + (pregunta ? ' · hay que elegir en «3 · Casar»' : '');
      }
      else if (pregunta) { e.className = 'estado aviso'; e.textContent = 'importe repetido: elige en «3 · Casar»'; }
      else { e.className = 'estado mal'; e.textContent = t.modo === 'varios' ? 'ningún ticket de la página casa con el desglose' : 'sin movimiento en el desglose'; }
      const sel = d.querySelector('select[data-k=mov]'); if (sel) opcionesMov(sel, t);
    }
  }

  // ================= PASO 3: CASAR =================
  // Casación por anclas: en cada documento (o en cada zona de una página con varios tickets) se busca el código o el importe
  let zonasDe = {};
  // movimientos distintos del desglose que casan con alguna zona: por código exacto o por un importe en línea de total
  function movsQueCasan(zonas) {
    return S.desglose.movs.filter(function (m) {
      return zonas.some(function (z) {
        return (m.codigo && z.codigos.some(function (c) { return c.c === m.codigo; })) ||
          (m.importe !== null && z.ocurrencias.some(function (o) { return o.p >= 5 && M.cents(o.v) === M.cents(m.importe); }));
      });
    }).length;
  }
  // un ticket leído -> documento para casar (zonas con importes, códigos y fechas). Lo usan la casación normal y la pantalla «Faltan».
  function docDeTicket(t) {
    let zonas;
    if (t.modo === 'varios') {
      zonas = [];
      // las páginas del extracto del banco o del rendiconto impreso no son tickets: no se casan (ni salen en el PDF)
      t.paginas.forEach(function (pg, pi) { if (M.paginaNoTicket(pg.lineas)) return; M.zonasDeLineas(pg.lineas).forEach(function (z, zi) { zonas.push(Object.assign({ id: 'p' + pi + 'z' + zi, pagina: pi, caja: z.caja }, M.datosZona(z.lineas))); }); });
      // en una captura, una zona sin fecha (la tarjeta del importe) toma la de la zona que tiene justo encima (la cabecera
      // del recibo con la fecha): la fecha sigue saliendo solo de lo que se ve en la captura
      if (t.captura) zonas.slice().sort(function (a, b) { return a.caja[1] - b.caja[1]; }).forEach(function (z, i, orden) {
        if (!z.fechas.length && i && orden[i - 1].fechas.length) z.fechas = orden[i - 1].fechas.slice();
      });
      // una factura digital de una página no se parte: si entre todas sus zonas solo casan con un movimiento
      // (por código, o por un importe en línea de total), es un documento con una sola zona
      if (t.unaPaginaConTexto && zonas.length > 1 && movsQueCasan(zonas) <= 1) {
        const ls = t.paginas[0].lineas;
        zonas = [Object.assign({ id: 'p0z0', pagina: 0, caja: M.zonasDeLineas(ls).reduce(function (c, z) { return c ? [Math.min(c[0], z.caja[0]), Math.min(c[1], z.caja[1]), Math.max(c[2], z.caja[2]), Math.max(c[3], z.caja[3])] : z.caja; }, null) }, M.datosZona(ls))];
      }
    } else {
      // un documento = un ticket: una sola zona; el importe y el código que se ven en la tarjeta (corregidos o no) mandan
      const z = Object.assign({ id: 'z0', pagina: 0, caja: null }, M.datosZona(M.lineasDeTexto(t.texto)));
      if (t.importe !== null) z.ocurrencias = [{ v: t.importe, p: 10, caja: null }].concat(z.ocurrencias.filter(function (o) { return M.cents(o.v) !== M.cents(t.importe); }).map(function (o) { return { v: o.v, p: Math.min(o.p, 1), caja: null }; }));
      if (t.codigo) z.codigos = [{ c: t.codigo, aut: true, caja: null }].concat(z.codigos.filter(function (c) { return c.c !== t.codigo; }));
      if (t.fecha && z.fechas.indexOf(t.fecha) < 0) z.fechas.push(t.fecha);
      zonas = [z];
    }
    const manual = t.modo === 'varios' ? (t.manual || []) : (t.movManual ? [{ mov: t.movManual, zona: 'z0', pagina: 0, caja: null }] : []);
    return { id: t.id, ignorar: t.ignorar, varios: t.modo === 'varios', captura: !!t.captura, zonas: zonas, manual: manual };
  }
  function docsParaCasar() {
    zonasDe = {};
    return S.tickets.map(function (t) {
      const d = docDeTicket(t);
      zonasDe[t.id] = d.zonas;
      return d;
    });
  }
  // Lee archivos (fotos, PDF, XML, HTML, TXT) con el mismo OCR y el mismo análisis que el flujo normal, pero SIN tocar el
  // registro ni el estado: la pantalla «Faltan» los casa contra su propia lista. Devuelve [{nombre, error} | {nombre, ticket, doc, importe, codigo, fecha, mini, full, tipo, file}].
  async function leeDocsFaltan(files, aviso) {
    const out = [];
    for (let k = 0; k < files.length; k++) {
      const file = files[k];
      if (aviso) aviso(k / files.length, 'Leyendo ' + (k + 1) + ' de ' + files.length + '… (' + file.name + ')');
      const tipo = tipoDe(file);
      if (!tipo) { out.push({ nombre: file.name, error: 'este formato no se puede leer: guárdalo como PDF y añádelo.' }); continue; }
      const f = { id: 'G' + (idSeq++), nombre: file.name, tipo: tipo, clave: claveArchivo(file), tamano: file.size, lastModified: file.lastModified, rot: 0 };
      try {
        const err = await preparaFuente(f, file);
        if (err) { out.push({ nombre: file.name, error: err }); continue; }
        const t = await leeFuente(f, null, aviso ? function (txt) { aviso((k + 0.5) / files.length, file.name + ': ' + txt); } : null, true);
        out.push({ nombre: file.name, ticket: t, doc: docDeTicket(t), importe: t.importe, codigo: t.codigo, fecha: t.fecha, mini: t.mini, full: t.full, tipo: tipo, file: file });
      } catch (e) { out.push({ nombre: file.name, error: 'no se pudo leer (' + e.message + ').' }); console.error(e); }
    }
    return out;
  }
  function recasa() {
    C = { anclas: [], preguntas: [], libres: {}, porMov: {}, porDoc: {} };
    if (!S.desglose) { estadoTickets(); return; }
    const quitadas = {};
    S.tickets.forEach(function (t) { (t.quitadas || []).forEach(function (q) { quitadas[t.id + '|' + q] = true; }); });
    const r = M.anclas(S.desglose.movs.map(function (m) { return { n: m.n, codigo: m.codigo, importe: m.importe, fechaOp: m.fechaOp, abono: m.abono, anulado: m.anulado }; }), docsParaCasar(), { elecciones: S.elecciones, quitadas: quitadas });
    // «zonas sin casar» solo tiene sentido en las páginas con varios tickets (un documento suelto sin ancla ya sale «sin movimiento»)
    C.anclas = r.anclas; C.preguntas = r.preguntas;
    Object.keys(r.libres).forEach(function (id) { const t = S.tickets.find(function (x) { return x.id === id; }); if (t && t.modo === 'varios') C.libres[id] = r.libres[id]; });
    r.anclas.forEach(function (a) { (C.porMov[a.mov] = C.porMov[a.mov] || []).push(a); (C.porDoc[a.doc] = C.porDoc[a.doc] || []).push(a); });
    S.desglose.movs.forEach(function (m) {
      const pm = S.porMov[m.n] || (S.porMov[m.n] = {});
      if (!pm.categoria || pm.auto) {
        // sugerencia: primero por el texto del banco; si no dice nada, por el texto del ticket (en una página con varios, el de su zona)
        const a = (C.porMov[m.n] || [])[0], t = a && S.tickets.find(function (x) { return x.id === a.doc; });
        const texto = t ? (t.modo === 'varios' ? a.texto || '' : (t.nombre || '') + '\n' + (t.texto || '').slice(0, 300)) : '';
        const hora = t ? (t.modo === 'varios' ? M.analizaTicket(a.texto || '').hora : t.hora) : null;
        let c = m.combustible ? 'COMBUSTIBLE' : M.sugiereCategoria(m.descripcion, hora);
        if (c === 'VARIOS' && t) c = M.sugiereCategoria(texto, hora);
        pm.categoria = c; pm.auto = true;
      }
    });
    estadoTickets(); pintaCasar(); pintaGenerar();
    $$('.ticket.varios').forEach(function (d) { const t = S.tickets.find(function (x) { return x.id === d.dataset.id; }); if (t) $$('.ticket[data-id="' + t.id + '"] .pagina-v canvas').forEach(function (cv, pi) { dibujaPagina(cv, t, pi); }); });
  }
  // documentos (sin repetir) que justifican el movimiento n
  function ticketsDe(n) {
    const ids = []; (C.porMov[n] || []).forEach(function (a) { if (ids.indexOf(a.doc) < 0) ids.push(a.doc); });
    return ids.map(function (id) { return S.tickets.find(function (t) { return t.id === id; }); }).filter(function (t) { return t && !t.ignorar; });
  }
  // en mayúsculas y sin tildes; la ñ se queda (como en los Excel que envía el usuario)
  function mayusSinTildes(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u0302\u0304-\u036f]/g, '').normalize('NFC').toUpperCase(); }
  // columna B del Excel: el texto del banco tal cual (operación, comercio y fecha), como en los Excel reales
  function descMov(m) {
    const pm = S.porMov[m.n] || {};
    return pm.desc || mayusSinTildes(m.descripcion || m.comercio || '');
  }
  // columna K: la categoría; en comidas y cenas, «CON <quién>» (lo pide administración; «solo» no lo escribe).
  // El combustible va en su propio bloque y, como en los Excel reales, sin nada en K.
  function comentarioMov(m) {
    const pm = S.porMov[m.n] || {}, cat = pm.categoria || 'VARIOS';
    if (cat === 'COMBUSTIBLE') return '';
    const quien = (pm.conQuien || '').trim();
    return (cat === 'COMIDA' || cat === 'CENA') && quien && !/^solo$/i.test(quien) ? cat + ' CON ' + mayusSinTildes(quien) : cat;
  }
  // comidas y cenas sin «con quién» (la norma 3: lo pide administración); «solo» cuenta como respuesta
  function sinConQuien() {
    return S.desglose ? S.desglose.movs.filter(function (m) { const pm = S.porMov[m.n] || {}; return (pm.categoria === 'COMIDA' || pm.categoria === 'CENA') && !(pm.conQuien || '').trim(); }) : [];
  }
  function pintaCasar() {
    if (!S.desglose) { $('#tablaCasar').innerHTML = '<div class="caja">Primero carga el desglose (paso 1).</div>'; return; }
    const movs = S.desglose.movs;
    // preguntas de seguridad: el mismo importe en varios sitios parecidos; no se adivina
    let he = '';
    if (C.preguntas.length) {
      he = '<div class="cuadre mal" style="background:#fff6d6;color:#7a4b00;border-color:#f0d58a"><b>No está claro: dime dónde está el ticket de cada movimiento.</b>';
      C.preguntas.forEach(function (q) {
        const m = movs[q.mov - 1];
        he += '<div class="pregunta" data-mov="' + q.mov + '"><div style="margin:8px 0 4px"><b>Mov. ' + q.mov + '</b> · ' + M.fechaDMY(m.fechaOp) + ' · ' + esc(m.comercio) + ' · <b>' + M.eur(m.importe) + '</b> — ' + (q.extra ? 'ya tiene ticket y hay ' + q.opciones.length + ' documentos más que encajan; ¿cuál va también con él?' : q.opciones.length + ' sitios posibles:') + '</div><div class="opciones">' +
          q.opciones.map(function (o, i) { return '<div class="opcion"><img class="vista-op" data-op="' + i + '" alt="opción ' + (i + 1) + '"><button class="btn peq" data-elige="' + i + '">Es la ' + (i + 1) + '</button></div>'; }).join('') + '</div></div>';
      });
      he += '</div>';
    }
    $('#empates').innerHTML = he;
    $$('#empates .pregunta').forEach(function (div) {
      const q = C.preguntas.find(function (x) { return x.mov === +div.dataset.mov; });
      q.opciones.forEach(function (o, i) {
        const t = S.tickets.find(function (x) { return x.id === o.doc; });
        vistaAncla(t, o.pagina, o.caja, i + 1, 320).then(function (src) { const im = div.querySelector('[data-op="' + i + '"]'); if (im) { im.src = src; im.onclick = function () { vistaAncla(t, o.pagina, o.caja, i + 1, 1200).then(zoom); }; } });
      });
      div.querySelectorAll('[data-elige]').forEach(function (b) { b.onclick = function () { S.elecciones[q.extra ? 'extra' + q.mov : q.mov] = q.opciones[+b.dataset.elige].clave; setTimeout(recasa, 0); }; });
    });
    // pendientes (122: ni los abonos/devoluciones ni el cargo anulado por una devolución piden ticket)
    const sinT = movs.filter(function (m) { return !ticketsDe(m.n).length && !m.abono && !m.anulado; });
    $('#sinTicket').innerHTML = sinT.length ? '<ul>' + sinT.map(function (m) { return '<li>Mov. ' + m.n + ' · ' + M.fechaDMY(m.fechaOp) + ' · ' + esc(m.comercio) + ' · <b>' + M.eur(m.importe) + '</b></li>'; }).join('') + '</ul>' : '<div class="estado ok" style="margin-top:6px">Ninguno ✔</div>';
    const sinM = S.tickets.filter(function (t) { return !t.ignorar && (!(C.porDoc[t.id] || []).length || C.libres[t.id]); });
    $('#sinMov').innerHTML = sinM.length ? '<div>' + sinM.map(function (t) {
      const libres = C.libres[t.id] || 0;
      return '<div class="barra" style="margin:4px 0"><img class="mini" src="' + t.mini + '" data-zoom="' + t.id + '"> T' + (S.tickets.indexOf(t) + 1) + ' · ' +
        (t.modo === 'varios' ? esc(t.nombreFuente) + ' · ' + libres + ' ticket(s) con un total que no casa' : (t.importe !== null ? M.eur(t.importe) : 'importe sin leer') + (t.fecha ? ' · ' + M.fechaDMY(t.fecha) : '')) + '</div>';
    }).join('') + '</div>' : '<div class="estado ok" style="margin-top:6px">Ninguno ✔</div>';
    // tabla
    let tj = '<div class="tarjetas-casar">';
    let h = '<div class="scroll tabla-casar"><table><thead><tr><th>Nº</th><th>Operación</th><th>Comercio (banco)</th><th class="num">Importe</th><th>Ticket(s)</th><th>Categoría</th><th>Con quién</th><th>Descripción en el Excel</th></tr></thead><tbody>';
    movs.forEach(function (m) {
      const as = (C.porMov[m.n] || []).filter(function (a) { const t = S.tickets.find(function (x) { return x.id === a.doc; }); return t && !t.ignorar; }), pm = S.porMov[m.n] || {};
      const rev = as.some(function (a) { return a.revisar; });
      // una captura sin fecha legible casa solo por código o importe: se avisa
      const sinFecha = as.some(function (a) { const t = S.tickets.find(function (x) { return x.id === a.doc; }), z = (zonasDe[a.doc] || []).find(function (x) { return x.id === a.zona; }); return t && t.captura && z && !z.fechas.length; });
      const anul = m.abono || m.anulado;                     // 122: abono/devolución o cargo anulado por ella: no pide ticket
      const etiqAbono = m.abono ? ('<span class="estado ok">abono / devolución' + (m.anuladoCon ? ' (anula mov. ' + m.anuladoCon + ')' : (m.sinCargo ? ' (sin cargo este mes)' : '')) + '</span>')
        : (m.anulado ? '<span class="estado ok">anulado por devolución (mov. ' + m.anuladoCon + ')</span>' : '');
      h += '<tr class="' + (anul ? 'abono' : (!as.length ? 'sinTicket' : (rev ? 'dudoso' : ''))) + '" data-n="' + m.n + '"><td>' + m.n + '</td><td>' + M.fechaDMY(m.fechaOp) + '</td><td>' + esc(m.comercio) + (m.codigo ? '<br><code>' + m.codigo + '</code>' : '') + '</td><td class="num">' + M.eur(m.importe) + '</td>' +
        '<td>' + (anul ? etiqAbono : (as.length ? as.map(function (a) { return '<img class="mini" data-ancla="' + esc(a.clave) + '" title="' + esc(a.origen) + '">'; }).join(' ') + (rev ? '<div class="estado aviso">revisar</div>' : '') + (sinFecha ? '<div class="estado aviso">fecha no leída en la captura</div>' : '') : '<span class="estado mal">SIN TICKET</span>')) + '</td>' +
        '<td><select data-k="categoria">' + M.CATEGORIAS.map(function (c) { return '<option' + (pm.categoria === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></td>' +
        '<td>' + ((pm.categoria === 'COMIDA' || pm.categoria === 'CENA') ? '<input type="text" data-k="conQuien" placeholder="p. ej. ALDO / CLIENTE X" value="' + esc(pm.conQuien || '') + '" style="width:150px">' + (!pm.conQuien ? '<div class="estado aviso">falta</div>' : '') : '') + '</td>' +
        '<td><input type="text" data-k="desc" style="width:100%;min-width:260px" value="' + esc(descMov(m)) + '" aria-label="Columna B"><div class="ayuda">K: ' + esc(comentarioMov(m) || '—') + '</div></td></tr>';
      // la misma fila como tarjeta (móvil)
      const origen = as.some(function (a) { return /^código/.test(a.origen); }) ? 'casado por código' : 'casado por importe';
      const estado = anul ? etiqAbono
        : (!as.length ? '<span class="estado mal">sin ticket</span>' : (rev ? '<span class="estado aviso">revisar</span> · ' + origen : '<span class="estado ok">' + origen + '</span>'));
      const comida = pm.categoria === 'COMIDA' || pm.categoria === 'CENA';
      tj += '<div class="tarjeta-mov' + (anul ? '' : (!as.length ? ' mal' : (rev || sinFecha || (comida && !pm.conQuien) ? ' aviso' : ''))) + '" data-n="' + m.n + '">' +
        '<div class="tm-cab"><span>Mov. ' + m.n + ' · ' + M.fechaDMY(m.fechaOp) + '</span><b>' + M.eur(m.importe) + '</b></div>' +
        '<button type="button" class="tm-com" title="Toca para verlo entero">' + esc(m.comercio) + (m.codigo ? ' <code>' + m.codigo + '</code>' : '') + '</button>' +
        (as.length ? '<div class="tm-tickets">' + as.map(function (a) { return '<img class="mini" data-ancla="' + esc(a.clave) + '" title="' + esc(a.origen) + '" alt="ticket">'; }).join('') + '</div>' : '') +
        '<div class="tm-estado">' + estado + (sinFecha ? ' · <span class="estado aviso">fecha no leída en la captura</span>' : '') + '</div>' +
        '<div class="tm-cat"><select data-k="categoria" aria-label="Categoría del movimiento ' + m.n + '">' + M.CATEGORIAS.map(function (c) { return '<option' + (pm.categoria === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>' +
        (comida ? '<input type="text" data-k="conQuien" aria-label="Con quién" placeholder="Con quién (o «solo»)" value="' + esc(pm.conQuien || '') + '">' : '') + '</div></div>';
    });
    h += '</tbody></table></div>';
    $('#tablaCasar').innerHTML = h + tj + '</div>';
    $$('#tablaCasar .tm-com').forEach(function (b) { b.onclick = function () { b.classList.toggle('abierto'); }; });
    $$('#tablaCasar tbody tr, #tablaCasar .tarjeta-mov').forEach(function (tr) {
      const n = +tr.dataset.n, pm = S.porMov[n];
      tr.querySelectorAll('[data-k]').forEach(function (inp) {
        inp.onchange = function () {
          const k = inp.dataset.k;
          if (k === 'categoria') { pm.categoria = inp.value; pm.auto = false; pm.desc = null; }
          if (k === 'conQuien') { pm.conQuien = inp.value.trim(); pm.desc = null; }
          if (k === 'desc') pm.desc = inp.value.trim() || null;
          setTimeout(function () { pintaCasar(); pintaGenerar(); }, 0);
        };
      });
    });
    $$('#tablaCasar img[data-ancla]').forEach(function (im) {
      const a = C.anclas.find(function (x) { return x.clave === im.dataset.ancla; }), t = a && S.tickets.find(function (x) { return x.id === a.doc; });
      if (!t) return;
      vistaAncla(t, a.pagina, a.caja, null, 160).then(function (src) { im.src = src; });
      im.onclick = function () { if (t.modo === 'varios') vistaAncla(t, a.pagina, a.caja, null, 1200).then(zoom); else zoom(t.full); };
    });
    $$('[data-zoom]').forEach(function (im) { im.onclick = function () { const t = S.tickets.find(function (x) { return x.id === im.dataset.zoom; }); zoom(t.full); }; });
    const nSin = sinT.length;
    $('#e3').innerHTML = C.preguntas.length ? '<span class="pill aviso" title="' + C.preguntas.length + ' por elegir">' + C.preguntas.length + '</span>' : (nSin ? '<span class="pill mal" title="' + nSin + ' sin ticket">' + nSin + '</span>' : (movs.length ? '<span class="pill ok" title="Todo casado">✓</span>' : ''));
  }

  // ================= PASO 4: GENERAR =================
  function periodo() {
    const movs = S.desglose ? S.desglose.movs : [];
    const fs = movs.map(function (m) { return m.fechaOp || m.fechaReg; }).filter(Boolean).sort();
    return { da: fs[0] || null, a: fs[fs.length - 1] || null };
  }
  function mesPorDefecto() {
    const movs = S.desglose ? S.desglose.movs : []; const c = {};
    movs.forEach(function (m) { const f = m.fechaReg || m.fechaOp; if (f) { const k = f.slice(0, 7); c[k] = (c[k] || 0) + 1; } });
    const k = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0];
    return k ? { mes: +k.slice(5, 7), anio: +k.slice(0, 4) } : { mes: new Date().getMonth() + 1, anio: new Date().getFullYear() };
  }
  function nombres() {
    const mes = M.MESES_ES[S.mes - 1] + ' ' + S.anio;
    return {
      excel: (AJ.prefijo.trim() || AJUSTES_DEF.prefijo) + ' - ' + mes + '.xlsx',
      pdf: 'Ricevute - ' + mes + '.pdf',
      lista: 'Originali - ' + mes + '.pdf',
      mesIt: M.MESES[S.mes - 1].charAt(0) + M.MESES[S.mes - 1].slice(1).toLowerCase() + ' ' + S.anio,
    };
  }
  function avisos() {
    const a = [];
    if (!S.desglose) return ['Falta cargar el desglose.'];
    if (!cuadra()) a.push('El desglose no cuadra con su Totale (paso 1).');
    if (!PLANTILLA) a.push('Carga la plantilla en Ajustes (sin ella no se puede generar el Excel).');
    if (!persona().completo) a.push('Faltan tus apellidos y nombre (en Ajustes).');
    if (!AJ.destinatario.trim()) a.push('Falta el destinatario de los originales (en Ajustes).');
    const sinFecha = S.desglose.movs.filter(function (m) { return !m.fechaOp; });
    if (sinFecha.length) a.push('Movimientos sin fecha de operación: ' + sinFecha.map(function (m) { return m.n; }).join(', ') + '.');
    if (C.preguntas.length) a.push('Hay ' + C.preguntas.length + ' movimiento(s) con el importe en varios sitios: elige cuál es en el paso 3.');
    const libres = Object.keys(C.libres).reduce(function (s, k) { return s + C.libres[k]; }, 0);
    if (libres) a.push(libres + ' ticket(s) de los PDF de varios por página no casan con el desglose (no se envían).');
    const sinQuien = sinConQuien();
    if (sinQuien.length) a.push('Comidas/cenas sin «con quién» (el Excel no se genera hasta rellenarlo; escribe «solo» si comiste solo): Mov. ' + sinQuien.map(function (m) { return m.n; }).join(', ') + '.');
    const varios = S.desglose.movs.filter(function (m) { return (S.porMov[m.n] || {}).categoria === 'VARIOS'; });
    if (varios.length) a.push('Movimientos en VARIOS (revísalos antes de enviar): ' + varios.map(function (m) { return m.n; }).join(', ') + '.');
    return a;
  }
  // ---------------- rendiconto en curso: se guarda solo (sin imágenes, que salen de los archivos guardados) ----------------
  let sesionLista = false, temporizadorSesion = null;
  function guardaSesion() {
    if (!sesionLista) return;
    clearTimeout(temporizadorSesion);
    temporizadorSesion = setTimeout(function () {
      const o = JSON.parse(JSON.stringify(S));
      o.fuentes.forEach(function (f) { delete f.img; delete f.pdf; delete f.fuenteTexto; });
      o.tickets.forEach(function (t) { delete t.mini; delete t.full; (t.paginas || []).forEach(function (pg) { delete pg.img; }); });
      R.ponMeta('sesion', o).catch(function (e) { console.warn('No se pudo guardar el rendiconto en curso', e); });
    }, 700);
  }
  async function restauraSesion() {
    try {
      const o = await R.meta('sesion').catch(function () { return null; });
      if (!o || o.version !== 2 || (!o.desglose && !o.fuentes.length)) return;
      progreso('#prog2', 0.1, 'Recuperando el rendiconto en curso…');
      const faltan = [], bor = (await R.meta('borrados').catch(function () { return null; })) || [];
      for (const f of o.fuentes.slice()) {
        if (f.enviada) continue;
        const t = o.tickets.find(function (x) { return x.fuente === f.id; });
        // un ticket borrado no vuelve con el rendiconto en curso (ni avisa de que falta su archivo)
        if (bor.indexOf(f.clave) >= 0) { o.fuentes = o.fuentes.filter(function (x) { return x !== f; }); o.tickets = o.tickets.filter(function (x) { return x !== t; }); continue; }
        const file = await archivoGuardado(f.clave, f.nombre, f.lastModified);
        if (!file || await preparaFuente(f, file)) {
          faltan.push(f.nombre);
          o.fuentes = o.fuentes.filter(function (x) { return x !== f; }); o.tickets = o.tickets.filter(function (x) { return x !== t; });
          continue;
        }
        if (t) {
          const v = await vistas(f); t.mini = v.mini; t.full = v.full;
          if (t.modo === 'varios') t.paginas = await paginasDeVista(f, { paginas: t.paginas });
        }
      }
      S = o; idSeq = 1000 + S.tickets.length + S.fuentes.length + Date.now() % 1000;
      // si el motor recalculó algún importe (OCR, no corregido a mano), que el rendiconto en curso lo coja también
      for (const t of S.tickets) {
        if (!t.clave || t.modo === 'varios') continue;
        const rec = await R.get(t.clave).catch(function () { return null; });
        if (rec && (rec.correcciones || {}).importe === undefined && rec.recalculado) { t.importe = rec.importe; t.candidatos = rec.candidatos || t.candidatos; t.recalculado = true; }
      }
      avisosCarga = faltan.map(function (n) { return 'Falta el archivo de ' + n + ': vuelve a añadirlo.'; });
      if (S.desglose) pintaDesglose();
      pintaCarga(); pintaTickets(); recasa(); pintaPasos();
    } catch (e) { console.warn('No se pudo recuperar el rendiconto en curso', e); }
    finally { finProgreso('#prog2'); sesionLista = true; pintaBandeja(); }
  }
  function nuevoRendiconto() {
    if (!confirm('¿Empezar un rendiconto nuevo? Se vacían el desglose y los tickets de este rendiconto. La bandeja y los archivos guardados se quedan.')) return;
    S = nuevoEstado(); avisosCarga = [];
    $('#resDesglose').innerHTML = ''; $('#nomDesglose').textContent = ''; $('#marcado').innerHTML = '';
    R.borraMeta('sesion').catch(function () {});
    pintaCarga(); pintaTickets(); recasa(); pintaBandeja(); pintaPasos();
  }
  function pintaGenerar() {
    guardaSesion();
    const sel = $('#selMes');
    if (!sel.options.length) M.MESES_ES.forEach(function (m, i) { const o = document.createElement('option'); o.value = i + 1; o.textContent = m; sel.appendChild(o); });
    if (S.desglose && !S.mes) { const d = mesPorDefecto(); S.mes = d.mes; S.anio = d.anio; }
    if (S.mes) { sel.value = S.mes; $('#inAnio').value = S.anio; }
    const p = periodo();
    $('#vDa').textContent = p.da ? M.fechaDMY(p.da) : '—'; $('#vA').textContent = p.a ? M.fechaDMY(p.a) : '—';
    $('#vTot').textContent = S.desglose ? M.eur(sumaMovs()) + ' (' + S.desglose.movs.length + ' mov.)' : '—';
    const av = avisos();
    const sinQuien = sinConQuien();
    $('#avisosGen').innerHTML = av.length ? '<div class="cuadre mal">' + av.map(esc).join('<br>') + (sinQuien.length ? '<br><button class="btn peq" id="irConQuien">Rellenar «con quién» en Casar</button>' : '') + '</div>' : (S.desglose ? '<div class="cuadre ok">Todo listo para generar.</div>' : '');
    const ir = $('#irConQuien');
    if (ir) ir.onclick = function () {
      document.querySelector('#nav button[data-p="p3"]').click();
      // el campo visible: el de la tabla (pantalla ancha) o el de la tarjeta (móvil)
      const inp = Array.prototype.find.call(document.querySelectorAll('#tablaCasar [data-n="' + sinQuien[0].n + '"] input[data-k="conQuien"]'), function (x) { return x.offsetParent !== null; });
      if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); }
    };
    const bloquea = !S.desglose || !cuadra() || C.preguntas.length > 0;
    ['#btnExcel', '#btnPdf', '#btnLista'].forEach(function (b) { $(b).disabled = bloquea; });
    if (!PLANTILLA || sinQuien.length) $('#btnExcel').disabled = true;
    $('#avisoPlantilla').textContent = PLANTILLA ? '' : 'Carga la plantilla en Ajustes';
    $('#vDestinatario').textContent = AJ.destinatario.trim() || '(sin rellenar: ponlo en Ajustes)';
    if (S.desglose && S.mes) pintaCorreo();
    $('#e4').innerHTML = S.desglose ? (av.length ? '<span class="pill aviso" title="' + av.length + ' aviso(s)">' + av.length + '</span>' : '<span class="pill ok" title="Listo">✓</span>') : '';
  }
  function pintaCorreo() {
    const N = nombres(), p = periodo(), movs = S.desglose.movs;
    const sinT = movs.filter(function (m) { return !ticketsDe(m.n).length; });
    const P = persona();
    $('#asunto').value = 'Rendiconto spese carta di credito – ' + N.mesIt + (P.completo ? ' – ' + P.completo : '');
    let c = (AJ.saludo.trim() || AJUSTES_DEF.saludo) + '\n\n' +
      'ti invio in allegato il rendiconto spese della ' + cartaDi() + ' relativo all\'estratto conto di ' + N.mesIt.toLowerCase() +
      ' (operazioni dal ' + M.fechaDMY(p.da) + ' al ' + M.fechaDMY(p.a) + ') e la scansione delle ricevute.\n\n' +
      'Il rendiconto riporta i ' + movs.length + ' movimenti dell\'estratto conto, per un totale di ' + M.eur(sumaMovs()) +
      ', che coincide con il totale dell\'estratto conto. Le ricevute sono nello stesso ordine dell\'estratto conto e su ognuna è indicato il numero del movimento.\n';
    if (sinT.length) {
      c += '\nPer ' + (sinT.length === 1 ? 'il seguente movimento non ho la ricevuta' : 'i seguenti movimenti non ho la ricevuta') + ':\n' +
        sinT.map(function (m) { return '- Mov. ' + m.n + ' – ' + M.fechaDMY(m.fechaOp) + ' – ' + m.comercio + ' – ' + M.eur(m.importe); }).join('\n') + '\n';
    }
    c += '\nGli originali li spedirò per posta ' + (AJ.empresa.trim() ? 'a ' + AJ.empresa.trim() : 'all\'azienda') + ' quando me li richiederai.\n\nUn saluto,' + (P.completo ? '\n' + P.completo : '');
    $('#cuerpo').value = c;
    $('#adjuntos').innerHTML = '<li>' + esc(N.excel) + '</li><li>' + esc(N.pdf) + '</li>';
  }

  // «carta di credito» y, si está en Ajustes, el banco de la tarjeta
  function cartaDi() { const b = (AJ.banco || '').trim(); return 'carta di credito' + (b ? ' ' + b : ''); }
  // la fuente estándar del PDF solo escribe WinAnsi (latín-1, comillas, guiones y €): lo demás sale como «?»
  function seguroLista(s) { return String(s).replace(/[^\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u20AC]/g, '?'); }
  function persona() {
    const a = AJ.apellidos.trim(), n = AJ.nombre.trim();
    return { apellidos: a, nombre: n, completo: (n + ' ' + a).trim() };
  }
  function datosExcel() {
    const p = periodo(), P = persona(); const varie = [], carb = [];
    S.desglose.movs.forEach(function (m) {
      const pm = S.porMov[m.n] || {};
      // B el texto del banco, I el importe, J la fecha de registro del banco (como en los Excel reales), K la categoría;
      // «Mov. n · código» en N, fuera del área de impresión (no sale en papel, pero queda para cotejar)
      const f = m.fechaReg || m.fechaOp;
      const fila = { desc: descMov(m), importe: m.importe, fecha: f ? M.fechaDMY(f, '.') : '', comentario: comentarioMov(m), ref: 'Mov. ' + m.n + (m.codigo ? ' · ' + m.codigo : '') };
      (pm.categoria === 'COMBUSTIBLE' ? carb : varie).push(fila);
    });
    return { cognome: P.apellidos, nome: P.nombre, daData: M.fechaDMY(p.da), aData: M.fechaDMY(p.a), varie: varie, carburante: carb };
  }
  async function generaExcel() {
    if (!PLANTILLA) { alert('Carga la plantilla en Ajustes'); return; }
    await libs(['jszip']);
    const out = await window.Excel.genera(window.JSZip, b64ABytes(PLANTILLA.b64), datosExcel());
    descarga(nombres().excel, out, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await preguntaMarcar();
  }

  async function generaPdfTickets() {
    await libs(['pdflib']);
    const PL = window.PDFLib; const doc = await PL.PDFDocument.create();
    const f = await doc.embedFont(PL.StandardFonts.HelveticaBold), f2 = await doc.embedFont(PL.StandardFonts.Helvetica);
    const A4 = [595.28, 841.89], mg = 26, cab = 22, sep = 12, et = 15;
    const colW = (A4[0] - 2 * mg - sep) / 2, altoUtil = A4[1] - 2 * mg - cab;
    const N = nombres(), P = persona(), movs = S.desglose.movs;
    // las fuentes estándar solo saben escribir WinAnsi: lo demás sale como «?»
    const cache = {};
    const seguro = function (s) { return String(s).replace(/[\t\r]/g, ' ').split('').map(function (c) { if (cache[c] === undefined) { try { f2.encodeText(c); cache[c] = c; } catch (e) { cache[c] = '?'; } } return cache[c]; }).join(''); };
    const textoEtiqueta = function (n) { const m = movs[n - 1]; return 'Mov. ' + n + ' · ' + M.fechaDMY(m.fechaOp) + ' · ' + M.eur(m.importe).replace(' €', ' EUR') + (m.codigo ? ' · ' + m.codigo : ''); };
    const etiqueta = function (pg, x, top, n) {
      const lab = textoEtiqueta(n), tw = f.widthOfTextAtSize(lab, 9.5);
      pg.drawRectangle({ x: x, y: top - et + 2, width: tw + 8, height: et - 2, color: PL.rgb(1, 0.93, 0.6), borderColor: PL.rgb(0.7, 0.1, 0.1), borderWidth: 0.6 });
      pg.drawText(lab, { x: x + 4, y: top - et + 6, size: 9.5, font: f, color: PL.rgb(0.6, 0.05, 0.05) });
    };
    // una página tal como se ve: medidas y paso de puntos «de pantalla» (x a la derecha, y hacia abajo) a los de la página,
    // que con /Rotate van girados (90: la x de pantalla es la y de la página…). Así etiquetas y número salen derechos.
    const vistaPagina = function (pg) {
      const r = ((pg.getRotation().angle || 0) % 360 + 360) % 360, mb = pg.getMediaBox(), W = mb.width, H = mb.height;
      const punto = function (dx, dy) {
        const p = r === 90 ? [dy, dx] : r === 180 ? [W - dx, dy] : r === 270 ? [W - dy, H - dx] : [dx, H - dy];
        return { x: mb.x + p[0], y: mb.y + p[1] };
      };
      const caja = function (x0, y0, x1, y1) { const a = punto(x0, y0), b = punto(x1, y1); return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }; };
      return { pg: pg, ancho: r % 180 ? H : W, alto: r % 180 ? W : H, punto: punto, caja: caja, giro: PL.degrees(r) };
    };
    // recuadro en cada importe (o código) y etiqueta «Mov. n» al lado, sin taparlo; conv: caja de la lectura -> puntos de pantalla
    const etiquetasVarios = function (v, delDoc, conv) {
      const alto = 13, conCaja = delDoc.filter(function (x) { return x.caja; });
      const sitios = sitiosEtiquetas(conCaja.map(function (x) { return { caja: conv(x.caja), a: x }; }), v.ancho, function (x) { return f.widthOfTextAtSize(textoEtiqueta(x.a.mov), 8) + 8; }, alto);
      conCaja.forEach(function (x, i) {
        const c = conv(x.caja), s = sitios[i], o = v.punto(s[0] + 4, s[3] - 3.5);
        v.pg.drawRectangle(Object.assign(v.caja(c[0] - 2, c[1] - 2, c[2] + 2, c[3] + 2), { borderColor: PL.rgb(0.8, 0.05, 0.1), borderWidth: 1.2 }));
        v.pg.drawRectangle(Object.assign(v.caja(s[0], s[1], s[2], s[3]), { color: PL.rgb(1, 0.93, 0.6), borderColor: PL.rgb(0.7, 0.1, 0.1), borderWidth: 0.6 }));
        v.pg.drawText(textoEtiqueta(x.mov), { x: o.x, y: o.y, size: 8, font: f, color: PL.rgb(0.6, 0.05, 0.05), rotate: v.giro });
      });
    };
    // índice al principio (una página cada 46 movimientos): se rellena al final, cuando ya se sabe en qué página va cada uno
    const nIndice = Math.max(1, Math.ceil(movs.length / 46)), indice = [];
    for (let i = 0; i < nIndice; i++) indice.push(doc.addPage(A4));
    const paginaDe = {}; // movN -> [números de página]
    const apunta = function (n, pg) { const num = doc.getPages().indexOf(pg) + 1; (paginaDe[n] = paginaDe[n] || []); if (paginaDe[n].indexOf(num) < 0) paginaDe[n].push(num); };
    const generadas = indice.slice(), faltan = [];
    let page = null, yCol = [0, 0];
    const medidas = []; window.__medidasPdf = medidas;
    const nuevaPagina = function () { page = doc.addPage(A4); generadas.push(page); yCol = [0, 0]; };
    // cada documento (o cada página de un PDF con varios tickets) sale una sola vez, donde va su primer movimiento
    const hechos = {};
    for (const m of movs) {
      for (const a of (C.porMov[m.n] || [])) {
        const t = S.tickets.find(function (x) { return x.id === a.doc; }); if (!t || t.ignorar) continue;
        const fu = fuenteDe(t), clave = t.modo === 'varios' ? t.id + '|' + a.pagina : t.id;
        if (hechos[clave]) continue; hechos[clave] = true;
        if (fu && !fu.img && !fu.pdf && fu.fuenteTexto === undefined) {
          const file = await archivoGuardado(fu.clave, fu.nombre, fu.lastModified);
          if (!file || await preparaFuente(fu, file)) { faltan.push(fu.nombre); continue; }
        }
        if (fu && !t.full && t.modo !== 'varios') { const v = await vistas(fu); t.mini = v.mini; t.full = v.full; }
        const delDoc = (C.porDoc[t.id] || []).filter(function (x) { return t.modo !== 'varios' || x.pagina === a.pagina; });
        const nums = delDoc.map(function (x) { return x.mov; }).filter(function (n, i, v) { return v.indexOf(n) === i; });
        if (t.modo === 'varios' && fu && fu.pdf) {
          // página entera, derecha (con su /Rotate y el giro que encontró el OCR), con un recuadro en cada importe
          // (o código) y su etiqueta al lado, sin taparlo
          const src = await PL.PDFDocument.load(b64ABytes(fu.pdf), { ignoreEncryption: true });
          const pg = (await doc.copyPages(src, [a.pagina]))[0]; doc.addPage(pg);
          const giro = (t.paginas[a.pagina] || {}).giro || 0;
          if (giro) pg.setRotation(PL.degrees(((pg.getRotation().angle || 0) + giro) % 360));
          const k = 72 / DPI_TICKETS, v = vistaPagina(pg);
          etiquetasVarios(v, delDoc, function (c) { return c.map(function (x) { return x * k; }); });
          nums.forEach(function (n) { apunta(n, pg); });
          page = null; continue;
        }
        if (t.modo === 'varios' && fu && fu.img) {
          // imagen con varios tickets: entera, una sola vez, en su propia página, con recuadros y etiquetas
          const cvI = await canvasDeImagen(fu), pgv = t.paginas[a.pagina] || t.paginas[0];
          const img = await doc.embedJpg(b64ABytes(recorteCanvas(cvI, 0, 0, cvI.width, cvI.height, 2200, 0.85).split(',')[1]));
          const tam = cvI.width > cvI.height ? [A4[1], A4[0]] : A4, pg = doc.addPage(tam);
          const kk = Math.min((tam[0] - 2 * mg) / pgv.w, (tam[1] - 2 * mg) / pgv.h), x0 = (tam[0] - pgv.w * kk) / 2, y0 = (tam[1] - pgv.h * kk) / 2;
          pg.drawImage(img, { x: x0, y: tam[1] - y0 - pgv.h * kk, width: pgv.w * kk, height: pgv.h * kk });
          etiquetasVarios(vistaPagina(pg), delDoc, function (c) { return [x0 + c[0] * kk, y0 + c[1] * kk, x0 + c[2] * kk, y0 + c[3] * kk]; });
          nums.forEach(function (n) { apunta(n, pg); });
          page = null; continue;
        }
        if (t.tipo === 'pdf' && fu && fu.pdf) {
          // PDF digital: sus páginas tal cual (vectoriales, nítidas), con la etiqueta encima de la primera
          const src = await PL.PDFDocument.load(b64ABytes(fu.pdf), { ignoreEncryption: true });
          const pags = await doc.copyPages(src, src.getPageIndices());
          pags.forEach(function (p, i) { doc.addPage(p); if (!i) { const sz = p.getSize(); nums.forEach(function (n, j) { etiqueta(p, 14, sz.height - 10 - j * et, n); }); nums.forEach(function (n) { apunta(n, p); }); } });
          page = null; continue;
        }
        if (fu && (t.tipo === 'xml' || t.tipo === 'html' || t.tipo === 'texto')) {
          // factura XML o ticket en texto: una página generada con su resumen
          const pg = doc.addPage(A4); generadas.push(pg);
          nums.forEach(function (n, j) { etiqueta(pg, mg, A4[1] - mg - cab - j * et, n); apunta(n, pg); });
          let y = A4[1] - mg - cab - et * nums.length - 26;
          const titulo = t.tipo === 'xml' ? 'Factura electrónica' + (fu.xml && fu.xml.formato ? ' (' + fu.xml.formato + ')' : '') : 'Ricevuta in formato testo';
          pg.drawText(seguro(titulo), { x: mg, y: y, size: 14, font: f, color: PL.rgb(0.09, 0.2, 0.36) }); y -= 26;
          const lineas = t.tipo === 'xml' ? lineasXml(fu) : (fu.texto || '').split('\n');
          lineas.forEach(function (l) { partirLinea(seguro(l), 95).forEach(function (s) { if (y > mg + 10) pg.drawText(s, { x: mg, y: y, size: t.tipo === 'xml' ? 12 : 9.5, font: f2, color: PL.rgb(0.1, 0.1, 0.1) }); y -= t.tipo === 'xml' ? 18 : 13; }); });
          page = null; continue;
        }
        // foto o imagen entera, con su etiqueta encima: como mucho 2 por página (arriba y abajo), cada una lo más grande que
        // quepa en su hueco; si aun así la letra del ticket quedaría por debajo de unos 7 pt, va sola en su página
        const img = await doc.embedJpg(b64ABytes(t.full.split(',')[1]));
        const alturaEt = et * nums.length, anchoMax = A4[0] - 2 * mg, medio = (altoUtil - sep) / 2;
        const encaja = function (alto) { const k = Math.min(anchoMax / img.width, (alto - alturaEt) / img.height); return { w: img.width * k, h: img.height * k }; };
        const letra = function (h) { return t.letraRel ? t.letraRel * h : null; };
        const enMedio = encaja(medio), entera = encaja(altoUtil);
        const sola = !!t.letraRel && letra(enMedio.h) < 7 && letra(entera.h) > letra(enMedio.h) + 0.5;
        if (sola || !page || yCol[0] > medio) nuevaPagina();
        const tam = sola ? entera : enMedio, y0 = yCol[0];
        const x = mg + (anchoMax - tam.w) / 2, top = A4[1] - mg - cab - y0;
        nums.forEach(function (n, j) { etiqueta(page, x, top - j * et, n); apunta(n, page); });
        page.drawImage(img, { x: x, y: top - alturaEt - tam.h, width: tam.w, height: tam.h });
        page.drawRectangle({ x: x, y: top - alturaEt - tam.h, width: tam.w, height: tam.h, borderColor: PL.rgb(0.75, 0.75, 0.75), borderWidth: 0.5 });
        yCol = sola ? [altoUtil + 1, altoUtil + 1] : [y0 + medio + sep, y0 + medio + sep];
        // medida para las pruebas: letra estimada ahora y con la maquetación anterior (columna de 90 mm)
        const antes = Math.min((t.anchoMm || 90) / 25.4 * 72, colW), altoAntes = Math.min(antes * img.height / img.width, altoUtil - alturaEt);
        medidas.push({ doc: t.nombreFuente, pagina: doc.getPages().indexOf(page) + 1, sola: sola, letraPt: letra(tam.h), letraAntesPt: letra(altoAntes) });
      }
    }
    // índice: «Mov. n → pag. p», para encontrar cada ticket aunque una página lleve varios
    indice.forEach(function (pg, i) {
      let y = A4[1] - mg - cab - 18;
      if (!i) { pg.drawText(seguro('Indice delle ricevute – ' + N.mesIt), { x: mg, y: y, size: 14, font: f, color: PL.rgb(0.09, 0.2, 0.36) }); y -= 24; }
      movs.slice(i * 46, (i + 1) * 46).forEach(function (m) {
        const ps = paginaDe[m.n];
        pg.drawText(seguro('Mov. ' + m.n + ' · ' + M.fechaDMY(m.fechaOp) + ' · ' + (m.comercio || '').slice(0, 44)), { x: mg, y: y, size: 9.5, font: f2, color: PL.rgb(0.1, 0.1, 0.1) });
        const imp = M.eur(m.importe).replace(' €', ' EUR'); pg.drawText(imp, { x: 400 - f2.widthOfTextAtSize(imp, 9.5), y: y, size: 9.5, font: f2 });
        pg.drawText(ps ? 'pag. ' + ps.join(', ') : 'senza ricevuta', { x: 420, y: y, size: 9.5, font: ps ? f : f2, color: ps ? PL.rgb(0.09, 0.2, 0.36) : PL.rgb(0.7, 0.1, 0.1) });
        y -= 15.5;
      });
    });
    const todas = doc.getPages();
    todas.forEach(function (pg, i) {
      const num = 'Pag. ' + (i + 1) + '/' + todas.length;
      if (generadas.indexOf(pg) >= 0) {
        pg.drawText(seguro((P.completo ? P.completo + ' – ' : '') + 'Ricevute carta di credito – ' + N.mesIt + ' – ordine dell\'estratto conto'), { x: mg, y: A4[1] - mg - 12, size: 10, font: f, color: PL.rgb(0.09, 0.2, 0.36) });
        pg.drawText(num, { x: A4[0] - mg - 50, y: A4[1] - mg - 12, size: 9, font: f2, color: PL.rgb(0.3, 0.3, 0.3) });
      } else {
        const v = vistaPagina(pg), o = v.punto(v.ancho - 52, v.alto - 6); // página copiada o imagen: solo el número, pequeño, abajo a la derecha
        pg.drawText(num, { x: o.x, y: o.y, size: 7, font: f2, color: PL.rgb(0.35, 0.35, 0.35), rotate: v.giro });
      }
    });
    doc.setTitle('Ricevute ' + N.mesIt); if (P.completo) doc.setAuthor(seguro(P.completo));
    descarga(N.pdf, await doc.save(), 'application/pdf');
    if (faltan.length) alert(faltan.map(function (n) { return 'Falta el archivo de ' + n + ': vuelve a añadirlo.'; }).join('\n') + '\nEl PDF se ha generado sin esos tickets.');
    await preguntaMarcar();
  }

  async function generaLista() {
    await libs(['pdflib']);
    const PL = window.PDFLib; const doc = await PL.PDFDocument.create();
    const f = await doc.embedFont(PL.StandardFonts.HelveticaBold), f2 = await doc.embedFont(PL.StandardFonts.Helvetica);
    const A4 = [595.28, 841.89], mg = 40; const N = nombres(), P = persona();
    let page = doc.addPage(A4), y = A4[1] - mg;
    const txt = function (s, x, sz, fuente, col) { page.drawText(seguroLista(s), { x: x, y: y, size: sz, font: fuente || f2, color: col || PL.rgb(0, 0, 0) }); };
    txt(seguroLista('Elenco ricevute originali – ' + cartaDi().charAt(0).toUpperCase() + cartaDi().slice(1) + ' – ' + N.mesIt), mg, 13, f); y -= 22;
    if (P.completo) { txt('Mittente: ' + P.completo, mg, 10); y -= 14; }
    txt('Destinatario:', mg, 10, f); y -= 13;
    AJ.destinatario.split('\n').forEach(function (l) { if (l.trim()) { txt(l.trim(), mg + 12, 10); y -= 13; } });
    y -= 8;
    txt('Stesso ordine dell\'estratto conto e del PDF delle ricevute. Data di preparazione: ' + M.fechaDMY(fechaHoy()), mg, 9); y -= 20;
    const cols = [mg, mg + 34, mg + 100, mg + 368, mg + 426, mg + 472];
    const cabecera = function () {
      page.drawRectangle({ x: mg - 4, y: y - 4, width: A4[0] - 2 * mg + 8, height: 16, color: PL.rgb(0.92, 0.94, 0.97) });
      ['Mov.', 'Data', 'Esercente (estratto conto)', 'Importo', 'Ricevuta', 'Inserita'].forEach(function (h, i) { txt(h, cols[i], 9, f); }); y -= 18;
    };
    cabecera();
    S.desglose.movs.forEach(function (m) {
      if (y < mg + 30) { page = doc.addPage(A4); y = A4[1] - mg; cabecera(); }
      const tk = ticketsDe(m.n).length;
      txt(String(m.n), cols[0], 9); txt(M.fechaDMY(m.fechaOp), cols[1], 9);
      let com = (m.comercio || '').slice(0, 52); txt(com, cols[2], 9);
      const imp = M.eur(m.importe).replace(' €', ' EUR'); txt(imp, cols[4] - 8 - f2.widthOfTextAtSize(imp, 9), 9);
      txt(tk ? 'Sì' : 'NO', cols[4], 9, tk ? f2 : f, tk ? PL.rgb(0, 0, 0) : PL.rgb(0.7, 0.1, 0.1));
      page.drawRectangle({ x: cols[5] + 6, y: y - 1, width: 9, height: 9, borderColor: PL.rgb(0, 0, 0), borderWidth: 0.8 });
      page.drawLine({ start: { x: mg - 4, y: y - 4 }, end: { x: A4[0] - mg + 4, y: y - 4 }, thickness: 0.3, color: PL.rgb(0.8, 0.8, 0.8) });
      y -= 15;
    });
    y -= 6; txt('Totale: ' + M.eur(sumaMovs()).replace(' €', ' EUR') + ' · ' + S.desglose.movs.length + ' movimenti · ricevute: ' + S.desglose.movs.filter(function (m) { return ticketsDe(m.n).length; }).length, mg, 10, f);
    descarga(N.lista, await doc.save(), 'application/pdf');
  }

  // ================= bandeja de fotos y registro de enviadas =================
  // tras descargar el Excel o el PDF: marcar como enviadas las fotos que van en este rendiconto
  async function preguntaMarcar() {
    if (!S.desglose) return;
    const rendiconto = nombres().mesIt;
    const docs = [];
    S.desglose.movs.forEach(function (m) { ticketsDe(m.n).forEach(function (t) { if (t.clave && docs.indexOf(t) < 0) docs.push(t); }); });
    const pares = (await Promise.all(docs.map(function (t) { return R.get(t.clave).then(function (r) { return [t, r]; }).catch(function () { return [t, null]; }); })))
      .filter(function (x) { return x[1] && !(x[1].rendiconto === rendiconto && (x[1].estado === 'enviada' || x[1].estado === 'parcial')); });
    if (!pares.length) return;
    const nTickets = pares.reduce(function (s, x) { return s + (C.porDoc[x[0].id] || []).length; }, 0);
    if (!confirm((pares.length === 1 ? '¿Marcar este archivo' : '¿Marcar estos ' + pares.length + ' archivos') + ' (' + nTickets + ' ticket(s)) como enviados en el rendiconto ' + rendiconto + '?')) return;
    const ahora = new Date().toISOString(), antes = [];
    for (const x of pares) {
      const t = x[0], r = x[1], libres = C.libres[t.id] || 0;
      antes.push({ clave: r.clave, estado: r.estado, rendiconto: r.rendiconto || null, fechaEnvio: r.fechaEnvio || null, anclas: r.anclas || null, zonasSinCasar: r.zonasSinCasar || 0 });
      // un PDF con varios tickets queda «parcial» si le quedan tickets sin movimiento (siguen pendientes en la bandeja)
      r.estado = t.modo === 'varios' && libres ? 'parcial' : 'enviada'; r.zonasSinCasar = libres;
      r.anclas = (C.porDoc[t.id] || []).map(function (a) { return { mov: a.mov, pagina: a.pagina, origen: a.origen }; });
      r.rendiconto = rendiconto; r.fechaEnvio = ahora; r.actualizado = Date.now();
      await R.put(r);
    }
    await R.ponMeta('ultimoMarcado', { rendiconto: rendiconto, fecha: ahora, antes: antes });
    $('#marcado').innerHTML = '<div class="cuadre ok">' + pares.length + ' archivo(s) (' + nTickets + ' ticket(s)) marcados como enviados en ' + esc(rendiconto) + '. <button class="btn sec peq" data-deshacer>Deshacer</button></div>';
    $('#marcado [data-deshacer]').onclick = deshacerMarcado;
    pintaBandeja();
  }
  async function deshacerMarcado() {
    const u = await R.meta('ultimoMarcado');
    if (!u) { alert('No hay ningún marcado que deshacer.'); return; }
    for (const a of u.antes) {
      const r = await R.get(a.clave); if (!r) continue;
      r.estado = a.estado; r.rendiconto = a.rendiconto; r.fechaEnvio = a.fechaEnvio; r.anclas = a.anclas; r.zonasSinCasar = a.zonasSinCasar; r.actualizado = Date.now();
      await R.put(r);
    }
    await R.borraMeta('ultimoMarcado');
    $('#marcado').innerHTML = '<div class="cuadre ok">Deshecho: ' + u.antes.length + ' ticket(s) del rendiconto ' + esc(u.rendiconto) + ' vuelven a su estado anterior.</div>';
    pintaBandeja();
  }

  async function pintaBandeja() {
    let recs, conArchivo = {};
    try { (await R.archivos()).forEach(function (x) { conArchivo[x.clave] = 1; }); } catch (e) { /* sin almacén de archivos */ }
    try { recs = await R.todos(); } catch (e) { $('#bandejaPend').innerHTML = '<div class="err">No se pudo leer el registro: ' + esc(e.message) + '</div>'; return; }
    const hoy = new Date(fechaHoy() + 'T00:00:00');
    const cargados = {}; S.fuentes.forEach(function (f) { cargados[f.clave] = 1; });
    const pend = recs.filter(function (r) { return r.estado !== 'enviada' && !cargados[r.clave]; }).sort(function (a, b) { return String(valorRec(a, 'fecha')).localeCompare(String(valorRec(b, 'fecha'))); });
    const env = recs.filter(function (r) { return r.estado === 'enviada'; });
    const nPend = pend.length + S.tickets.length;
    $('#e5').innerHTML = nPend ? '<span class="pill aviso">' + nPend + '</span>' : '';
    hayPendientes = pend.length > 0; actualizaVacio();
    $('#avisoRegistro').innerHTML = (await R.disponible()) ? '' : '<div class="cuadre mal">Este navegador no deja guardar el registro: la bandeja solo dura mientras la página esté abierta. Exporta el registro antes de cerrar.</div>';
    $('#bandejaPend').innerHTML = pend.length ? '<div class="tickets">' + pend.map(function (r) {
      const f = valorRec(r, 'fecha'), imp = valorRec(r, 'importe');
      const dias = f ? Math.max(0, Math.round((hoy - new Date(f + 'T00:00:00')) / 86400000)) : null;
      return '<div class="ticket" data-clave="' + esc(r.clave) + '">' + (r.mini ? '<img src="' + r.mini + '" alt="ticket">' : '') +
        '<div class="fila"><b>' + (r.captura ? '<span title="Captura de pantalla">📱</span> ' : '') + esc(r.nombre) + '</b></div>' +
        '<div class="fila">Importe <input type="text" class="imp" data-k="importe" value="' + (imp !== null ? M.eurNum(imp) : '') + '"> € · Fecha <input type="text" class="fecha" data-k="fecha" value="' + M.fechaDMY(f) + '"> <span class="ayuda">(' + esc(r.correcciones && r.correcciones.fecha !== undefined ? 'corregida' : (r.fechaOrigen || '?')) + ')</span></div>' +
        (conArchivo[r.clave] ? '<div class="fila"><button class="btn sec peq" data-a="anadir">+ Añadir a este rendiconto</button> <button class="btn sec peq" data-a="borrar">🗑 Borrar</button></div>' : '<div class="fila estado mal">Sin archivo guardado: vuelve a añadirlo con + Ticket.</div>') +
        '<div class="fila estado aviso">' + (r.estado === 'parcial' ? 'parcial: ' + (r.zonasSinCasar || 0) + ' ticket(s) sin casar (el resto enviado en ' + esc(r.rendiconto || '?') + ')' : (dias === null ? 'pendiente' : 'pendiente desde hace ' + dias + (dias === 1 ? ' día' : ' días'))) + (r.leido ? '' : ' · sin leer todavía') + '</div></div>';
    }).join('') + '</div>' : '<div class="ayuda">Ninguno: todo lo pendiente está en este rendiconto o ya se envió.</div>';
    const conA = pend.filter(function (r) { return conArchivo[r.clave]; });
    if (conA.length > 1) $('#bandejaPend').insertAdjacentHTML('afterbegin', '<div class="barra"><button class="btn" id="btnAnadirPend">Añadir los ' + conA.length + ' pendientes a este rendiconto</button></div>');
    const bp = $('#btnAnadirPend'); if (bp) bp.onclick = function () { anadeDesdeAlmacen(conA); };
    $$('#bandejaPend .ticket [data-a=borrar]').forEach(function (b) { const c = b.closest('.ticket').dataset.clave, r = pend.find(function (x) { return x.clave === c; }); b.onclick = function () { borraTicket(c, r && r.nombre); }; });
    $$('#bandejaPend .ticket [data-a=anadir]').forEach(function (b) { const r = pend.find(function (x) { return x.clave === b.closest('.ticket').dataset.clave; }); b.onclick = function () { anadeDesdeAlmacen([r]); }; });
    $$('#bandejaPend .ticket').forEach(function (d) {
      const clave = d.dataset.clave;
      d.querySelectorAll('[data-k]').forEach(function (inp) {
        inp.onchange = function () {
          const k = inp.dataset.k, ch = {};
          if (k === 'importe') ch.importe = M.parseImporte(inp.value);
          if (k === 'fecha') { const x = inp.value.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/); ch.fecha = x ? M.isoDesdeDMY(x[1], x[2], x[3]) : null; }
          // si la foto está cargada en esta sesión, el cambio llega también a la casación
          const t = S.tickets.find(function (x) { return x.clave === clave; });
          if (t) { Object.assign(t, ch); if (k === 'fecha') t.fechaOrigen = 'corregida'; pintaTickets(); recasa(); }
          corrige(clave, ch);
        };
      });
    });
    const porRend = {};
    env.forEach(function (r) { (porRend[r.rendiconto || '?'] = porRend[r.rendiconto || '?'] || []).push(r); });
    $('#bandejaEnv').innerHTML = env.length ? '<details><summary>' + env.length + ' ticket(s) enviados</summary>' + Object.keys(porRend).map(function (k) {
      return '<div style="margin:8px 0"><b>' + esc(k) + '</b><ul>' + porRend[k].map(function (r) { const imp = valorRec(r, 'importe'); return '<li>' + esc(r.nombre) + ' · ' + (imp !== null ? M.eur(imp) : '—') + ' · ' + M.fechaDMY(valorRec(r, 'fecha')) + '</li>'; }).join('') + '</ul></div>';
    }).join('') + '</details>' : '';
  }

  // registro-tickets.json: el registro (sin imágenes), los ajustes y la plantilla, para configurar el iPhone y el PC con un solo archivo
  async function datosExportados() {
    const recs = (await R.todos()).map(function (r) { const x = Object.assign({}, r); delete x.mini; return x; });
    return { herramienta: 'rendiconto', version: 2, exportado: new Date().toISOString(), ajustes: AJ, plantilla: PLANTILLA, fotos: recs };
  }
  async function exportaRegistro() {
    descarga('registro-tickets.json', JSON.stringify(await datosExportados(), null, 1), 'application/json');
  }
  // todo con los archivos originales: registro-tickets.json y una carpeta archivos/
  async function exportaZip() {
    await libs(['jszip']);
    const o = await datosExportados(), zip = new window.JSZip(), lista = await R.archivos();
    o.archivos = [];
    for (let i = 0; i < lista.length; i++) {
      const x = await R.archivo(lista[i].clave); if (!x || !x.blob) continue;
      const ruta = 'archivos/' + String(i + 1).padStart(4, '0') + '-' + (x.nombre || 'archivo').replace(/[\\/:*?"<>|]+/g, '_');
      zip.file(ruta, x.blob); o.archivos.push({ clave: x.clave, nombre: x.nombre, tipo: x.tipo, ruta: ruta });
    }
    zip.file('registro-tickets.json', JSON.stringify(o, null, 1));
    descarga('registro-tickets-con-archivos.zip', await zip.generateAsync({ type: 'blob', compression: 'STORE' }), 'application/zip');
  }
  async function importaRegistro(file) {
    try {
      let o, zip = null;
      if (/\.zip$/i.test(file.name) || /zip/i.test(file.type)) {
        await libs(['jszip']);
        zip = await window.JSZip.loadAsync(file);
        const j = zip.file('registro-tickets.json');
        if (!j) throw new Error('el .zip no lleva registro-tickets.json');
        o = JSON.parse(await j.async('string'));
      } else o = JSON.parse(await file.text());
      if (!o || typeof o.herramienta !== 'string' || !Array.isArray(o.fotos)) throw new Error('no es un registro de esta herramienta');
      let nuevos = 0, actualizados = 0, iguales = 0;
      for (const r of o.fotos) {
        if (!r || !r.clave) continue;
        const ya = await R.get(r.clave);
        // ante un mismo ticket, gana el más reciente
        if (ya && (ya.actualizado || 0) >= (r.actualizado || 0)) { iguales++; continue; }
        if (ya && ya.mini) r.mini = ya.mini;
        await R.put(r); if (ya) actualizados++; else nuevos++;
      }
      // ajustes y plantilla: también gana lo más reciente
      const extra = [];
      if (o.ajustes && (o.ajustes.actualizado || 0) > (AJ.actualizado || 0)) { AJ = Object.assign({}, AJUSTES_DEF, o.ajustes); await R.ponMeta('ajustes', AJ).catch(function () {}); lsPon('ajustes', AJ); extra.push('ajustes'); }
      if (o.plantilla && o.plantilla.b64 && (o.plantilla.actualizado || 0) > ((PLANTILLA && PLANTILLA.actualizado) || 0)) { await guardaPlantilla(o.plantilla); extra.push('plantilla'); }
      // archivos del .zip que aquí no estaban
      let nArch = 0;
      if (zip && Array.isArray(o.archivos)) for (const a of o.archivos) {
        if (!a || !a.clave || !a.ruta || await R.archivo(a.clave)) continue;
        const z = zip.file(a.ruta); if (!z) continue;
        try { await R.ponArchivo(a.clave, new Blob([await z.async('arraybuffer')], { type: a.tipo || '' }), a.nombre); nArch++; }
        catch (e) { if (esCuota(e)) { extra.push('sin espacio para más archivos'); break; } throw e; }
      }
      if (nArch) extra.push(nArch + ' archivo(s)');
      $('#msgRegistro').innerHTML = '<div class="cuadre ok">Importado: ' + nuevos + ' tickets nuevos, ' + actualizados + ' actualizados, ' + iguales + ' sin cambios (aquí estaban igual o más recientes)' + (extra.length ? '; también ' + extra.join(' y ') : '') + '.</div>';
      estadoAlmacen();
      pintaBandeja(); pintaAjustes(); pintaGenerar();
    } catch (e) { $('#msgRegistro').innerHTML = '<div class="cuadre mal">No se pudo importar: ' + esc(e.message) + '</div>'; }
  }

  // ================= ajustes: textos, nombres y plantilla (solo en este navegador, nunca en el código) =================
  // Se guardan en IndexedDB y, de reserva, en localStorage. Viajan entre dispositivos con «Exportar todo».
  const AJUSTES_DEF = { apellidos: '', nombre: '', saludo: 'Ciao,', empresa: '', banco: '', destinatario: '', prefijo: 'RENDICONTO' };
  const CAMPOS_AJUSTES = [
    ['apellidos', 'Apellidos', 'Van al Excel (COGNOME), al asunto y a la firma del correo, a los PDF.'],
    ['nombre', 'Nombre', 'Van al Excel (NOME), al asunto y a la firma del correo, a los PDF.'],
    ['saludo', 'Saludo del correo', 'Primera línea del correo. Si lo dejas vacío: «' + AJUSTES_DEF.saludo + '».'],
    ['empresa', 'Empresa', 'Se nombra en el correo («Gli originali li spedirò per posta a …»).'],
    ['banco', 'Banco de la tarjeta', 'Se nombra en el correo y en la lista («carta di credito <banco>»). Si lo dejas vacío: «carta di credito».'],
    ['destinatario', 'Destinatario de los originales', 'Una línea por renglón, tal como va en el sobre (siempre la empresa, no una persona).'],
    ['prefijo', 'Prefijo del nombre del Excel', 'El Excel se llama «<prefijo> - <MES AÑO>.xlsx». Si lo dejas vacío: «' + AJUSTES_DEF.prefijo + '».'],
  ];
  let AJ = Object.assign({}, AJUSTES_DEF), PLANTILLA = null; // PLANTILLA: {nombre, b64, actualizado}
  function lsLee(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsPon(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento o sin sitio */ } }
  async function cargaAjustes() {
    const a = (await R.meta('ajustes').catch(function () { return null; })) || lsLee('ajustes');
    if (a) AJ = Object.assign({}, AJUSTES_DEF, a);
    PLANTILLA = (await R.meta('plantilla').catch(function () { return null; })) || lsLee('plantilla');
    pintaAjustes(); pintaGenerar();
  }
  async function guardaAjustes() {
    AJ.actualizado = Date.now();
    await R.ponMeta('ajustes', AJ).catch(function (e) { console.warn(e); });
    lsPon('ajustes', AJ);
  }
  async function guardaPlantilla(p) {
    PLANTILLA = p;
    if (p) await R.ponMeta('plantilla', p).catch(function (e) { console.warn(e); }); else await R.borraMeta('plantilla').catch(function () {});
    lsPon('plantilla', p);
  }
  async function cargaPlantilla(file) {
    try {
      const u8 = new Uint8Array(await file.arrayBuffer());
      await libs(['jszip']);
      const zip = await window.JSZip.loadAsync(u8);
      if (!zip.file('xl/worksheets/sheet1.xml')) throw new Error('no parece un Excel .xlsx con la hoja del rendiconto');
      await guardaPlantilla({ nombre: file.name, b64: bytesAB64(u8), actualizado: Date.now() });
      $('#msgAjustes').innerHTML = '<div class="cuadre ok">Plantilla cargada: ' + esc(file.name) + '.</div>';
    } catch (e) { $('#msgAjustes').innerHTML = '<div class="cuadre mal">No se pudo cargar la plantilla: ' + esc(e.message) + '</div>'; }
    pintaAjustes(); pintaGenerar();
  }
  function pintaAjustes() {
    const cont = $('#formAjustes');
    if (!cont.dataset.hecho) {
      cont.innerHTML = CAMPOS_AJUSTES.map(function (c) {
        const campo = c[0] === 'destinatario' ? '<textarea id="aj_' + c[0] + '" style="min-height:96px"></textarea>' : '<input type="text" id="aj_' + c[0] + '" style="width:100%">';
        return '<div class="ajuste"><label for="aj_' + c[0] + '"><b>' + esc(c[1]) + '</b></label>' + campo + '<div class="ayuda">' + esc(c[2]) + '</div></div>';
      }).join('');
      CAMPOS_AJUSTES.forEach(function (c) {
        $('#aj_' + c[0]).onchange = function () { AJ[c[0]] = this.value; guardaAjustes(); pintaGenerar(); };
      });
      cont.dataset.hecho = '1';
    }
    CAMPOS_AJUSTES.forEach(function (c) { const el = $('#aj_' + c[0]); if (document.activeElement !== el) el.value = AJ[c[0]] || ''; });
    $('#estadoPlantilla').innerHTML = PLANTILLA ? '✔ Cargada: <b>' + esc(PLANTILLA.nombre) + '</b>' + (PLANTILLA.actualizado ? ' (' + M.fechaDMY(isoDeMs(PLANTILLA.actualizado)) + ')' : '') + ' <button class="btn sec peq" id="btnQuitaPlantilla">Quitar</button>' : '<span class="estado mal">Sin plantilla: el Excel no se puede generar.</span>';
    const q = $('#btnQuitaPlantilla'); if (q) q.onclick = function () { if (confirm('¿Quitar la plantilla de este navegador?')) guardaPlantilla(null).then(function () { pintaAjustes(); pintaGenerar(); }); };
    $('#e6').innerHTML = PLANTILLA && persona().completo ? '' : '<span class="pill aviso">!</span>';
    const vApp = $('#versionApp'); if (vApp) vApp.textContent = VERSION_APP ? 'Versión ' + VERSION_APP : 'En desarrollo (local, sin publicar)';
  }

  // ================= enviar: pasos con su estado =================
  function hecho(k) { S.hecho = S.hecho || {}; S.hecho[k] = true; pintaPasos(); }
  function pintaPasos() {
    $$('.paso[data-paso]').forEach(function (li, i) {
      const ok = !!(S.hecho && S.hecho[li.dataset.paso]);
      li.classList.toggle('hecho', ok);
      li.querySelector('.marca-paso').textContent = ok ? '✓' : String(i + 1);
      li.querySelector('.estado-paso').textContent = ok ? 'Hecho' : 'Pendiente';
    });
  }

  // ================= almacenamiento: que el navegador (sobre todo iOS) no borre la bandeja =================
  let persistenciaPedida = false;
  function pidePersistencia() {
    if (persistenciaPedida || !navigator.storage || !navigator.storage.persist) return Promise.resolve();
    persistenciaPedida = true;
    return navigator.storage.persisted().then(function (p) { return p || navigator.storage.persist(); }).then(function (ok) {
      $('#avisoPersist').innerHTML = ok ? '' : '<div class="cuadre aviso">Este navegador puede borrar la bandeja si le falta espacio. Exporta de vez en cuando (Ajustes → Exportar todo).</div>';
      estadoAlmacen();
    }).catch(function () { /* sin API de almacenamiento */ });
  }
  const MB = function (b) { return (b / 1048576).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' MB'; };
  async function estadoAlmacen() {
    const partes = [];
    try {
      if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); partes.push('Espacio usado: ' + MB(e.usage || 0) + ' de ' + MB(e.quota || 0) + '.'); }
      const xs = await R.archivos(); partes.push(xs.length + ' archivo(s) de tickets guardados (' + MB(xs.reduce(function (s, x) { return s + (x.tamano || 0); }, 0)) + ').');
      if (navigator.storage && navigator.storage.persisted) partes.push((await navigator.storage.persisted()) ? 'Almacenamiento protegido: el navegador no lo borrará.' : 'Almacenamiento sin proteger: si el navegador necesita espacio podría borrarlo; exporta de vez en cuando.');
    } catch (e) { /* sin API de almacenamiento */ }
    $('#estadoAlmacen').textContent = partes.join(' ');
  }
  // solo los archivos (no los datos) de tickets enviados hace más de 90 días, y siempre preguntando antes: nunca se borra nada solo
  async function liberaEspacio() {
    const limite = Date.now() - 90 * 86400000, recs = await R.todos(), xs = await R.archivos();
    const viejos = xs.filter(function (x) { const r = recs.find(function (y) { return y.clave === x.clave; }); return r && r.estado === 'enviada' && r.fechaEnvio && Date.parse(r.fechaEnvio) < limite; });
    if (!viejos.length) { $('#msgEspacio').innerHTML = '<div class="cuadre ok">No hay archivos de tickets enviados hace más de 90 días.</div>'; return; }
    const total = viejos.reduce(function (s, x) { return s + (x.tamano || 0); }, 0);
    if (!confirm('¿Quitar ' + viejos.length + ' archivo(s) (' + MB(total) + ') de tickets enviados hace más de 90 días? Los datos de esos tickets se quedan en el registro.')) return;
    for (const x of viejos) await R.borraArchivo(x.clave);
    $('#msgEspacio').innerHTML = '<div class="cuadre ok">Quitados ' + viejos.length + ' archivo(s): ' + MB(total) + ' liberados.</div>';
    estadoAlmacen(); pintaBandeja();
  }

  // ================= guardar / abrir trabajo =================
  function guardar() {
    const nombre = 'Trabajo tickets ' + (S.mes ? nombres().mesIt.replace(/ /g, '_') : fechaHoy()) + '.json';
    descarga(nombre, JSON.stringify(S), 'application/json');
  }
  async function abrir(file) {
    try {
      const o = JSON.parse(await file.text());
      if (o && o.version === 1) throw new Error('es un trabajo de la versión con recortes: vuelve a cargar el desglose y los tickets');
      if (!o || o.version !== 2) throw new Error('No es un archivo de trabajo de esta herramienta');
      S = o; idSeq = 1000 + S.tickets.length + S.fuentes.length;
      if (S.desglose) pintaDesglose(); else $('#resDesglose').innerHTML = '';
      avisosCarga = []; pintaCarga(); pintaTickets(); recasa();
    } catch (e) { alert('No se pudo abrir: ' + e.message); }
  }

  // ================= varios =================
  // zoom de una imagen: pellizco con dos dedos, arrastre, rueda del ratón y doble toque
  const Z = { s: 1, x: 0, y: 0, punteros: {}, base: null, movido: false };
  function aplicaZoom() { $('#modalImg').style.transform = 'translate(-50%, -50%) translate(' + Z.x + 'px,' + Z.y + 'px) scale(' + Z.s + ')'; }
  function zoom(src) { Z.s = 1; Z.x = 0; Z.y = 0; Z.punteros = {}; $('#modalImg').src = src; aplicaZoom(); $('#modal').classList.add('on'); }
  function cierraZoom() { $('#modal').classList.remove('on'); }
  (function () {
    const m = $('#modal');
    const dist = function () { const p = Object.values(Z.punteros); return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };
    m.addEventListener('pointerdown', function (ev) { if (ev.target.closest('.cerrar')) return; Z.punteros[ev.pointerId] = { x: ev.clientX, y: ev.clientY }; Z.base = { s: Z.s, x: Z.x, y: Z.y, d: dist(), px: ev.clientX, py: ev.clientY }; Z.movido = false; try { m.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura */ } });
    m.addEventListener('pointermove', function (ev) {
      if (!Z.punteros[ev.pointerId] || !Z.base) return;
      Z.punteros[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      const d = dist();
      if (d && Z.base.d) Z.s = Math.min(6, Math.max(1, Z.base.s * d / Z.base.d));
      else { Z.x = Z.base.x + ev.clientX - Z.base.px; Z.y = Z.base.y + ev.clientY - Z.base.py; }
      if (Math.abs(ev.clientX - Z.base.px) + Math.abs(ev.clientY - Z.base.py) > 6) Z.movido = true;
      aplicaZoom();
    });
    const suelta = function (ev) { delete Z.punteros[ev.pointerId]; Z.base = Object.keys(Z.punteros).length ? { s: Z.s, x: Z.x, y: Z.y, d: dist(), px: ev.clientX, py: ev.clientY } : null; };
    m.addEventListener('pointerup', suelta); m.addEventListener('pointercancel', suelta);
    m.addEventListener('wheel', function (ev) { ev.preventDefault(); Z.s = Math.min(6, Math.max(1, Z.s * (ev.deltaY < 0 ? 1.15 : 1 / 1.15))); if (Z.s === 1) { Z.x = 0; Z.y = 0; } aplicaZoom(); }, { passive: false });
    m.addEventListener('dblclick', function () { Z.s = Z.s > 1 ? 1 : 2.5; Z.x = 0; Z.y = 0; aplicaZoom(); });
    m.addEventListener('click', function (ev) { if (ev.target === m && !Z.movido && Z.s === 1) cierraZoom(); });
    $('#cierraZoom').onclick = cierraZoom;
  })();
  $$('#nav button').forEach(function (b) {
    b.onclick = function () {
      $$('#nav button').forEach(function (x) { x.classList.toggle('activo', x === b); });
      $$('main section').forEach(function (s) { s.classList.toggle('activo', s.id === b.dataset.p); });
      $('#fab').hidden = b.dataset.p !== 'p5'; window.scrollTo(0, 0);
      if (b.dataset.p === 'p3') pintaCasar();
      if (b.dataset.p === 'p4') pintaGenerar();
      if (b.dataset.p === 'p5') pintaBandeja();
      if (b.dataset.p === 'p6') pintaAjustes();
    };
  });
  $('#fDesglose').onchange = function () { if (this.files[0]) leeDesglose(this.files[0]); this.value = ''; };
  const alElegir = function () { let fs = Array.prototype.slice.call(this.files); this.value = ''; if (this.id === 'fFoto') fs = fs.map(fotoConNombre); $('#menuFab').hidden = true; if (fs.length) anadeTickets(fs).catch(function (e) { finProgreso('#prog2'); alert('Error añadiendo tickets: ' + e.message); console.error(e); }); };
  $('#fTickets').onchange = alElegir; $('#fFoto').onchange = alElegir;
  $('#fab').onclick = function () { $('#menuFab').hidden = false; };
  $('#cierraFab').onclick = function () { $('#menuFab').hidden = true; };
  $('#menuFab').onclick = function (ev) { if (ev.target === this) this.hidden = true; };
  $('#cierraHoja').onclick = cierraDetalle;
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { if ($('#modal').classList.contains('on')) cierraZoom(); else if (!$('#hoja').hidden) cierraDetalle(); else $('#menuFab').hidden = true; } });
  $('#selMes').onchange = function () { S.mes = +this.value; pintaGenerar(); };
  $('#inAnio').onchange = function () { S.anio = +this.value; pintaGenerar(); };
  $('#btnExcel').onclick = function () { generaExcel().then(function () { hecho('excel'); }).catch(function (e) { alert('Error: ' + e.message); console.error(e); }); };
  $('#btnPdf').onclick = function () { generaPdfTickets().then(function () { hecho('pdf'); }).catch(function (e) { alert('Error: ' + e.message); console.error(e); }); };
  $('#btnLista').onclick = function () { generaLista().then(function () { hecho('lista'); }).catch(function (e) { alert('Error: ' + e.message); console.error(e); }); };
  $('#btnGuardar').onclick = guardar;
  $('#btnExportaReg').onclick = function () { exportaRegistro().catch(function (e) { alert('Error: ' + e.message); }); };
  $('#btnExportaZip').onclick = function () { exportaZip().catch(function (e) { alert('Error: ' + e.message); console.error(e); }); };
  $('#btnLiberar').onclick = function () { liberaEspacio().catch(function (e) { alert('Error: ' + e.message); }); };
  $('#btnNuevo').onclick = nuevoRendiconto;
  $('#fRegistro').onchange = function () { if (this.files[0]) importaRegistro(this.files[0]); this.value = ''; };
  $('#btnDeshacer').onclick = function () { deshacerMarcado().catch(function (e) { alert('Error: ' + e.message); }); };
  $('#fPlantilla').onchange = function () { if (this.files[0]) cargaPlantilla(this.files[0]); this.value = ''; };
  $('#fTrabajo').onchange = function () { if (this.files[0]) abrir(this.files[0]); this.value = ''; };
  $$('.copiar').forEach(function (b) {
    const txt = b.textContent;
    b.onclick = function () { const el = $('#' + b.dataset.copia); el.select(); navigator.clipboard ? navigator.clipboard.writeText(el.value).catch(function () { document.execCommand('copy'); }) : document.execCommand('copy'); b.textContent = 'Copiado ✔'; setTimeout(function () { b.textContent = txt; }, 1500); hecho(b.dataset.copia); };
  });
  window.addEventListener('beforeunload', function (e) { if (S.desglose || S.tickets.length) { e.preventDefault(); e.returnValue = ''; } });
  // recalculaMotor() va antes de restaurar la sesión y pintar la bandeja: así los tickets ya se ven con el importe del motor nuevo
  pintaGenerar(); cargaAjustes(); pintaTickets(); pintaPasos();
  limpiaHuerfanos().then(recalculaMotor).then(function () { pintaBandeja(); estadoAlmacen(); restauraSesion(); });
  // app instalable: el manifiesto y el service worker solo cuando se sirve por https (o localhost); en file:// no hacen nada
  if (location.protocol !== 'file:' && window.isSecureContext) {
    const l = document.createElement('link'); l.rel = 'manifest'; l.href = 'manifest.webmanifest'; document.head.appendChild(l);
    if ('serviceWorker' in navigator) registraSW();
  }

  // ---------------- service worker: aviso de versión nueva ----------------
  let recargandoSW = false;
  function avisaActualizar(worker) {
    const bar = $('#barraActualizar'), btn = $('#btnActualizar');
    if (!bar || !btn || !worker) return;
    bar.hidden = false;
    btn.onclick = function () { bar.hidden = true; worker.postMessage({ tipo: 'actualizar' }); };
  }
  function registraSW() {
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      // ya hay una versión nueva esperando de una visita anterior
      if (reg.waiting && navigator.serviceWorker.controller) avisaActualizar(reg.waiting);
      reg.addEventListener('updatefound', function () {
        const w = reg.installing; if (!w) return;
        w.addEventListener('statechange', function () {
          // instalada y había una versión controlando antes → es una actualización, no la primera instalación
          if (w.state === 'installed' && navigator.serviceWorker.controller) avisaActualizar(w);
        });
      });
    }).catch(function (e) { console.warn('Service worker no registrado', e); });
    // cuando el worker nuevo toma el control (tras pulsar «Actualizar»), recargamos una vez para que entre el código nuevo
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (recargandoSW) return; recargandoSW = true; location.reload();
    });
  }

  // ---------------- recalcular los importes leídos por OCR al cambiar el motor ----------------
  // Cuando sube Motor.MOTOR_VERSION se vuelve a pasar analizaTicket sobre el texto OCR guardado de cada ticket
  // cuyo importe salió del OCR y el titular NO corrigió a mano. Lo que se escribió a mano no se toca nunca.
  async function recalculaMotor() {
    const actual = M.MOTOR_VERSION;
    let guardada;
    try { guardada = await R.meta('motorVersion'); } catch (e) { return; }
    if (guardada === actual) return;
    let recs;
    try { recs = await R.todos(); } catch (e) { return; }
    const sinTexto = []; let tocados = 0;
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      if (!rec || !rec.leido || rec.modo === 'varios' || rec.tipo === 'xml') continue;
      const c = rec.correcciones || {};
      if (c.importe !== undefined) { rec.motorVersion = actual; await R.put(rec).catch(function () {}); continue; } // a mano: no se toca
      if (!rec.texto) { sinTexto.push(rec); continue; }
      const antes = rec.importe, a = M.analizaTicket(rec.texto);
      if (a.importe !== null) {
        const cambia = (antes === null || antes === undefined || M.cents(a.importe) !== M.cents(antes));
        rec.importe = a.importe; rec.candidatos = a.candidatos || rec.candidatos || [];
        rec.recalculado = cambia; if (cambia) tocados++;
      }
      rec.motorVersion = actual;
      await R.put(rec).catch(function () {});
    }
    await R.ponMeta('motorVersion', actual).catch(function () {});
    if (sinTexto.length) await releeConMotorNuevo(sinTexto, actual);
    // si hay un rendiconto en curso, que sus tickets no corregidos a mano cojan el importe nuevo
    for (let i = 0; i < S.tickets.length; i++) {
      const t = S.tickets[i]; if (!t.clave || t.modo === 'varios') continue;
      const rec = await R.get(t.clave).catch(function () { return null; });
      if (rec && (rec.correcciones || {}).importe === undefined && rec.recalculado) {
        t.importe = rec.importe; t.candidatos = rec.candidatos || t.candidatos; t.recalculado = true; tocados++;
      }
    }
    if (tocados || sinTexto.length) { recasa(); pintaTickets(); pintaBandeja(); }
  }
  // tickets sin texto OCR guardado: se releen en segundo plano con su archivo original, si está guardado
  async function releeConMotorNuevo(recs, actual) {
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      try {
        const arch = await R.archivo(rec.clave);
        if (!arch || !arch.blob) continue;
        const file = new File([arch.blob], rec.nombre || arch.nombre || 'ticket',
          { type: arch.tipo || arch.blob.type || '', lastModified: rec.lastModified || Date.now() });
        const tipo = tipoDe(file); if (!tipo) continue;
        const f = { id: 'F' + (idSeq++), nombre: file.name, tipo: tipo, clave: rec.clave, tamano: file.size, lastModified: file.lastModified, rot: rec.rot || 0 };
        if (await preparaFuente(f, file)) continue;
        await leeFuente(f, rec, null); // vuelve a leer con el motor nuevo y lo guarda en el registro
        const r2 = await R.get(rec.clave).catch(function () { return null; });
        if (r2) { r2.motorVersion = actual; r2.recalculado = true; await R.put(r2).catch(function () {}); }
      } catch (e) { console.warn('No se pudo releer ' + rec.clave, e); }
    }
  }
  // «Volver a leer» desde la ficha del ticket: lo relee entero con el motor y el lector actuales (respeta lo corregido a mano)
  async function relee(t) {
    const f = fuenteDe(t); if (!f) return;
    const rec = await R.get(f.clave).catch(function () { return null; });
    progreso('#prog2', 0.5, 'Volviendo a leer ' + f.nombre + '…');
    try {
      const nuevo = await leeFuente(f, rec, null);
      nuevo.movManual = t.movManual;
      const i = S.tickets.indexOf(t); if (i >= 0) S.tickets[i] = nuevo;
      finProgreso('#prog2'); pintaTickets(); recasa(); pintaBandeja();
      if (detalleDe === t) abreDetalle(nuevo);
    } catch (e) { finProgreso('#prog2'); alert('Error al volver a leer: ' + e.message); console.error(e); }
  }

  // para pruebas automáticas y para la pantalla «Faltan» (lib/faltan.js)
  window.__app = { S: function () { return S; }, C: function () { return C; }, zonas: function () { return zonasDe; }, recasa: recasa, datosExcel: datosExcel, nombres: nombres, borraTicket: borraTicket, limpiaHuerfanos: limpiaHuerfanos, R: R,
    leeDocs: leeDocsFaltan, zoom: zoom, descarga: descarga, recalculaMotor: recalculaMotor, relee: relee };
})();
