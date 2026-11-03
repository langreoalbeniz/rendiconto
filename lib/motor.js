/* Motor de Rendiconto (tickets de la tarjeta).
   Funciones puras (sin DOM): lectura del desglose, lectura de tickets, casación, formatos.
   Se usa en el navegador (window.Motor) y en Node para las pruebas (module.exports). */
(function (root) {
  'use strict';

  // ---------- formatos ----------
  function eur(n) {
    if (n === null || n === undefined || isNaN(n)) return '';
    const neg = n < 0; n = Math.abs(n);
    const [e, d] = n.toFixed(2).split('.');
    return (neg ? '-' : '') + e.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d + ' €';
  }
  function eurNum(n) { return eur(n).replace(' €', ''); }
  function parseImporte(s) {
    // "1.234,56" / "1234,56" / "12.71" / "0.35" -> número
    if (s === null || s === undefined) return null;
    s = String(s).trim().replace(/[€\s]/g, '').replace(/EUR/i, '');
    if (!s) return null;
    let m = s.match(/^-?\d{1,3}(\.\d{3})+,\d{2}$/) || s.match(/^-?\d+,\d{2}$/);
    if (m) return round2(parseFloat(s.replace(/\./g, '').replace(',', '.')));
    m = s.match(/^-?\d{1,3}(,\d{3})+\.\d{2}$/);
    if (m) return round2(parseFloat(s.replace(/,/g, '')));
    m = s.match(/^-?\d+\.\d{2}$/);
    if (m) return round2(parseFloat(s));
    return null;
  }
  function round2(x) { return Math.round(x * 100) / 100; }
  function cents(x) { return Math.round(x * 100); }
  // fecha interna: 'aaaa-mm-dd'
  function fechaDMY(iso, sep) { if (!iso) return ''; const [a, m, d] = iso.split('-'); return d + (sep || '/') + m + (sep || '/') + a; }
  function isoDesdeDMY(d, m, a) {
    d = parseInt(d, 10); m = parseInt(m, 10); a = parseInt(a, 10);
    if (a < 100) a += 2000;
    if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && a >= 2020 && a <= 2099)) return null;
    return a + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  const MESES = ['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'];
  const MESES_ES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

  // ---------- TSV de tesseract ----------
  function parseTSV(tsv) {
    const words = [];
    tsv.split('\n').forEach(function (l) {
      const c = l.split('\t');
      if (c.length < 12 || c[0] !== '5') return;
      const t = c.slice(11).join('\t').trim();
      if (!t) return;
      words.push({ block: +c[2], par: +c[3], line: +c[4], x: +c[6], y: +c[7], w: +c[8], h: +c[9], conf: +c[10], t: t });
    });
    return words;
  }

  // Corrige errores típicos del OCR en el código de operación (H + 5 cifras).
  function normalizaCodigo(t) {
    if (!t) return null;
    let s = t.replace(/[^A-Za-z0-9]/g, '');
    if (s.length !== 6) return null;
    if (!/^[Hh]/.test(s)) return null;
    const mapa = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', i: '1', '|': '1', Z: '2', z: '2', S: '5', s: '5', B: '8', a: '4', A: '4', g: '9', q: '9', G: '6', b: '6', T: '7' };
    let r = 'H';
    for (let k = 1; k < 6; k++) { const ch = s[k]; if (/\d/.test(ch)) r += ch; else if (mapa[ch]) r += mapa[ch]; else return null; }
    return r;
  }

  // ---------- rejilla de la tabla del desglose (formato de tabla del extracto del banco) ----------
  // gray: Uint8Array (0-255) de w*h. Devuelve filas [{y0,y1,celdas:[[x0,x1],...]}]
  function rejilla(gray, w, h) {
    const oscuro = function (i) { return gray[i] < 140; };
    const oscuroL = function (i) { return gray[i] < 185; };
    // línea horizontal = tramo largo casi continuo de píxeles oscuros (huecos de hasta 8 px),
    // mirando ±2 filas para tolerar una ligera inclinación del escaneo
    const racha = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      let mejor = 0, ini = -1, ultimo = -100;
      for (let x = 0; x < w; x++) {
        let dk = false;
        for (let k = -2; k <= 2 && !dk; k++) { const yy = y + k; if (yy >= 0 && yy < h && oscuroL(yy * w + x)) dk = true; }
        if (dk) {
          if (x - ultimo > 8) ini = x;
          ultimo = x;
          if (x - ini > mejor) mejor = x - ini;
        }
      }
      racha[y] = mejor;
    }
    const lineas = [];
    for (let y = 0; y < h; y++) {
      if (racha[y] > 0.30 * w) {
        const ult = lineas[lineas.length - 1];
        if (ult && y - ult[1] <= 3) ult[1] = y; else lineas.push([y, y]);
      }
    }
    const filas = [];
    for (let i = 0; i + 1 < lineas.length; i++) {
      const y0 = lineas[i][1] + 1, y1 = lineas[i + 1][0] - 1;
      const alto = y1 - y0;
      if (alto < h * 0.008) continue;
      const a = y0 + Math.round(alto * 0.1), b = y1 - Math.round(alto * 0.1);
      const col = new Int32Array(w);
      for (let y = a; y <= b; y++) for (let x = 0; x < w; x++) if (oscuro(y * w + x)) col[x]++;
      const sep = [];
      for (let x = 0; x < w; x++) {
        if (col[x] >= 0.85 * (b - a + 1)) {
          const u = sep[sep.length - 1];
          if (u && x - u[1] <= 3) u[1] = x; else sep.push([x, x]);
        }
      }
      const celdas = [];
      for (let k = 0; k + 1 < sep.length; k++) {
        const x0 = sep[k][1] + 1, x1 = sep[k + 1][0] - 1;
        if (x1 - x0 > w * 0.01) celdas.push([x0, x1]);
      }
      filas.push({ y0: y0, y1: y1, celdas: celdas });
    }
    // plantilla de columnas: la configuración de 7 celdas más repetida; se aplica a filas con
    // bordes perdidos (p. ej. subrayado con fosforito o borde débil en el escaneo)
    const siete = filas.filter(function (f) { return f.celdas.length === 7; });
    if (siete.length >= 2) {
      const med = function (arr) { arr = arr.slice().sort(function (a, b) { return a - b; }); return arr[Math.floor(arr.length / 2)]; };
      const plantilla = [];
      for (let k = 0; k < 7; k++) plantilla.push([med(siete.map(function (f) { return f.celdas[k][0]; })), med(siete.map(function (f) { return f.celdas[k][1]; }))]);
      filas.forEach(function (f) {
        if (f.celdas.length >= 4 && f.celdas.length !== 7 && Math.abs(f.celdas[0][0] - plantilla[0][0]) < w * 0.01 && Math.abs(f.celdas[1][0] - plantilla[1][0]) < w * 0.01) {
          f.celdas = plantilla.map(function (c) { return c.slice(); }); f.reconstruida = true;
        }
      });
    }
    return filas;
  }

  // Recorte simple con margen blanco
  function recorte(gray, W, x0, y0, x1, y1, pad) {
    pad = pad === undefined ? 12 : pad;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, ow = cw + 2 * pad, oh = ch + 2 * pad, out = new Uint8Array(ow * oh).fill(255);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) out[(y + pad) * ow + x + pad] = gray[(y0 + y) * W + x0 + x];
    return { w: ow, h: oh, data: out };
  }
  // Solo la banda del texto de una celda: las filas con más tinta (sin la raya de la tabla ni las manchas que deja el
  // fosforito al arrastrar el tóner) y las columnas con tinta. u: umbral de tinta; bin: si se da, binariza con ese umbral.
  function recorteBanda(gray, W, x0, y0, x1, y1, u, bin) {
    const filas = [];
    for (let y = y0; y <= y1; y++) { let n = 0; for (let x = x0; x <= x1; x++) if (gray[y * W + x] < u) n++; filas.push(n); }
    const pico = Math.max.apply(null, filas); if (!pico) return recorte(gray, W, x0, y0, x1, y1);
    let a = filas.indexOf(pico), b = a;
    while (a > 0 && filas[a - 1] > pico * 0.25) a--;
    while (b < filas.length - 1 && filas[b + 1] > pico * 0.25) b++;
    let xa = x1, xb = x0;
    for (let y = y0 + a; y <= y0 + b; y++) for (let x = x0; x <= x1; x++) if (gray[y * W + x] < u) { if (x < xa) xa = x; if (x > xb) xb = x; }
    const r = recorte(gray, W, Math.max(x0, xa - 4), y0 + Math.max(0, a - 3), Math.min(x1, xb + 4), y0 + Math.min(filas.length - 1, b + 3));
    if (bin) for (let i = 0; i < r.data.length; i++) r.data[i] = r.data[i] < bin ? 0 : 255;
    return r;
  }
  // la misma imagen al doble de tamaño (vecino más próximo): Tesseract confunde menos el 6 y el 8 en cifras pequeñas
  function amplia(img, k) {
    const w = img.w * k, h = img.h * k, d = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = img.data[Math.floor(y / k) * img.w + Math.floor(x / k)];
    return { w: w, h: h, data: d };
  }
  // Solo el negro puro (las impresoras Canon guardan el texto en una capa negra aparte del fosforito)
  function recorteNegro(gray, W, x0, y0, x1, y1, pad) {
    const r = recorte(gray, W, x0, y0, x1, y1, pad);
    for (let i = 0; i < r.data.length; i++) r.data[i] = r.data[i] < 100 ? 0 : 255;
    return r;
  }
  // Recorta una zona y la binariza dividiendo por el fondo local (quita fosforito, sombreado
  // de filas y manchas grises). Devuelve {w,h,data} con margen blanco.
  function recorteLimpio(gray, W, x0, y0, x1, y1, pad, radio) {
    pad = pad === undefined ? 12 : pad; radio = radio || 12;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const src = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) src[y * cw + x] = gray[(y0 + y) * W + x0 + x];
    const tmp = new Uint8Array(cw * ch), bg = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let m = 0; const a = Math.max(0, x - radio), b = Math.min(cw - 1, x + radio);
      for (let k = a; k <= b; k++) if (src[y * cw + k] > m) m = src[y * cw + k];
      tmp[y * cw + x] = m;
    }
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let m = 0; const a = Math.max(0, y - radio), b = Math.min(ch - 1, y + radio);
      for (let k = a; k <= b; k++) if (tmp[k * cw + x] > m) m = tmp[k * cw + x];
      bg[y * cw + x] = m;
    }
    const ow = cw + 2 * pad, oh = ch + 2 * pad, out = new Uint8Array(ow * oh).fill(255);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const v = src[y * cw + x], b = Math.max(bg[y * cw + x], 1);
      out[(y + pad) * ow + x + pad] = (v / b < 0.62 && b - v > 40) ? 0 : 255;
    }
    return { w: ow, h: oh, data: out };
  }

  // ---------- factura electrónica XML: Facturae (España) y UBL ----------
  // doc: Document ya parseado. Busca por nombre local de etiqueta, sin depender de los prefijos de espacio de nombres.
  // Devuelve {formato, importe, fecha:'AAAA-MM-DD', emisor, numero}; formato null si no es un formato conocido.
  function facturaXml(doc) {
    const raiz = doc && doc.documentElement;
    if (!raiz) return { formato: null, importe: null, fecha: null, emisor: null, numero: null };
    const todos = function (el, n) { return Array.prototype.slice.call(el.getElementsByTagNameNS('*', n)); };
    const uno = function (el) {
      let xs = [el];
      for (let i = 1; i < arguments.length; i++) { const n = arguments[i]; xs = xs.reduce(function (acc, e) { return acc.concat(todos(e, n)); }, []); }
      return xs[0] || null;
    };
    const hijo = function (el, n) { return Array.prototype.slice.call(el.children).find(function (e) { return e.localName === n; }) || null; };
    const txt = function (e) { return e && e.textContent.trim() ? e.textContent.trim().replace(/\s+/g, ' ') : null; };
    const num = function (s) { if (!s) return null; const v = parseFloat(s.replace(/\s/g, '').replace(',', '.')); return isFinite(v) ? round2(v) : null; };
    const fecha = function (s) { const m = s && s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[1] + '-' + m[2] + '-' + m[3] : null; };
    if (raiz.localName === 'Facturae') {
      const vend = uno(raiz, 'SellerParty');
      const persona = vend && [txt(uno(vend, 'Name')), txt(uno(vend, 'FirstSurname')), txt(uno(vend, 'SecondSurname'))].filter(Boolean).join(' ');
      return {
        formato: 'Facturae',
        importe: num(txt(uno(raiz, 'TotalExecutableAmount')) || txt(uno(raiz, 'InvoiceTotals', 'InvoiceTotal'))),
        fecha: fecha(txt(uno(raiz, 'InvoiceIssueData', 'IssueDate'))),
        emisor: vend ? txt(uno(vend, 'CorporateName')) || txt(uno(vend, 'TradeName')) || persona || null : null,
        numero: [txt(uno(raiz, 'InvoiceHeader', 'InvoiceSeriesCode')), txt(uno(raiz, 'InvoiceHeader', 'InvoiceNumber'))].filter(Boolean).join('-') || null,
      };
    }
    if (raiz.localName === 'FatturaElettronica') {
      // FatturaPA (Italia): DatiGeneraliDocumento con ImportoTotaleDocumento, Data y Numero; emisor en CedentePrestatore
      const dgd = uno(raiz, 'DatiGeneraliDocumento'), ced = uno(raiz, 'CedentePrestatore');
      return {
        formato: 'FatturaPA',
        importe: dgd ? num(txt(uno(dgd, 'ImportoTotaleDocumento'))) : null,
        fecha: dgd ? fecha(txt(uno(dgd, 'Data'))) : null,
        emisor: ced ? txt(uno(ced, 'Denominazione')) || [txt(uno(ced, 'Nome')), txt(uno(ced, 'Cognome'))].filter(Boolean).join(' ') || null : null,
        numero: dgd ? txt(uno(dgd, 'Numero')) : null,
      };
    }
    if (raiz.localName === 'Invoice' || raiz.localName === 'CreditNote') {
      const prov = uno(raiz, 'AccountingSupplierParty');
      return {
        formato: 'UBL',
        importe: num(txt(uno(raiz, 'LegalMonetaryTotal', 'PayableAmount'))),
        fecha: fecha(txt(hijo(raiz, 'IssueDate'))),
        emisor: prov ? txt(uno(prov, 'Name')) || txt(uno(prov, 'RegistrationName')) : null,
        numero: txt(hijo(raiz, 'ID')),
      };
    }
    return { formato: null, importe: null, fecha: null, emisor: null, numero: null };
  }

  // ---------- EXIF mínimo: fecha de la foto (DateTimeOriginal) de un JPEG ----------
  // bytes: Uint8Array con el principio del archivo. Devuelve {fecha:'AAAA-MM-DD', hora:'hh:mm'} o null.
  function fechaExif(bytes) {
    return exifDe(bytes, function (busca, texto, ifd0, ex) {
      let s = null;
      if (ex) s = texto(busca(ex.valor, 0x9003)) || texto(busca(ex.valor, 0x9004));
      if (!s) s = texto(busca(ifd0, 0x0132));
      const x = s && s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
      return x && x[1] !== '0000' ? { fecha: x[1] + '-' + x[2] + '-' + x[3], hora: x[4] + ':' + x[5] } : null;
    });
  }
  // ¿la imagen trae datos de cámara (marca, modelo, exposición)? Una captura de pantalla no los lleva.
  function camaraExif(bytes) {
    return !!exifDe(bytes, function (busca, texto, ifd0, ex) {
      return busca(ifd0, 0x010F) || busca(ifd0, 0x0110) || (ex && (busca(ex.valor, 0x829A) || busca(ex.valor, 0x829D) || busca(ex.valor, 0x8827)));
    });
  }
  // recorre la cabecera EXIF de un JPEG y llama a fn(busca, texto, ifd0, exif) con ella; null si no hay EXIF
  function exifDe(bytes, fn) {
    const b = bytes;
    if (!b || b.length < 12 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
    let p = 2;
    while (p + 4 < b.length && b[p] === 0xFF) {
      const marca = b[p + 1], largo = (b[p + 2] << 8) | b[p + 3];
      if (marca === 0xE1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) {
        const t = p + 10, le = b[t] === 0x49; // 'II' little endian, 'MM' big endian
        const u16 = function (o) { return le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]; };
        const u32 = function (o) { return le ? (b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16)) + b[t + o + 3] * 16777216 : b[t + o] * 16777216 + ((b[t + o + 1] << 16) | (b[t + o + 2] << 8) | b[t + o + 3]); };
        const busca = function (ifd, tag) {
          if (t + ifd + 2 > b.length) return null;
          const nE = u16(ifd);
          for (let i = 0; i < nE; i++) { const e = ifd + 2 + i * 12; if (t + e + 12 > b.length) return null; if (u16(e) === tag) return { tipo: u16(e + 2), n: u32(e + 4), valor: u32(e + 8) }; }
          return null;
        };
        const texto = function (e) { if (!e || e.tipo !== 2) return null; let s = ''; for (let i = 0; i < e.n - 1 && t + e.valor + i < b.length; i++) s += String.fromCharCode(b[t + e.valor + i]); return s; };
        const ifd0 = u32(4), ex = busca(ifd0, 0x8769);
        return fn(busca, texto, ifd0, ex);
      }
      if (marca === 0xDA) break; // empieza la imagen: no hay más cabeceras
      p += 2 + largo;
    }
    return null;
  }

  // filas: [{celdas:[texto,...]}] ya leídas por OCR (solo filas de 7 celdas o la de Totale)
  function interpretaFilas(filas) {
    const movs = []; let totale = null;
    filas.forEach(function (f) {
      const c = f.textos;
      if (!c || !c.length) return;
      if (/^\s*totale\s*$/i.test(c[0]) || (c.length <= 3 && /totale/i.test(c[0]) && !/importo|transaz/i.test(c[0]))) {
        const v = importeCelda(c[c.length - 1]);
        if (v !== null) totale = v;
        return;
      }
      if (c.length < 7) return;
      if (/registr|riferim|descriz|importo|operaz/i.test(c.join(' '))) return; // cabecera de la tabla
      const cod = normalizaCodigo((c[1] || '').replace(/\s/g, ''));
      const hayAlgo = cod || importeCelda(c[c.length - 1]) !== null || /\d{2}[.,]\d{2}[.,]\d{2}/.test(c[0] || '') || (c[2] || '').trim().length > 5;
      if (!hayAlgo) return;
      const desc = (c[2] || '').replace(/\s+/g, ' ').trim();
      const mReg = (c[0] || '').match(/(\d{2})[.,](\d{2})[.,](\d{2,4})/);
      const fs = []; const reF = /(\d{2})[.,](\d{2})[.,](\d{2})\b/g; let mm;
      while ((mm = reF.exec(desc))) fs.push(mm);
      const mOp = fs.length ? fs[fs.length - 1] : null;
      const impV = importeCelda(c[c.length - 1]);
      const mov = {
        pagina: f.pagina, caja: f.caja, codigo: cod, origen: f,
        fechaReg: mReg ? isoDesdeDMY(mReg[1], mReg[2], mReg[3]) : null,
        fechaOp: mOp ? isoDesdeDMY(mOp[1], mOp[2], mOp[3]) : null,
        descripcion: desc, comercio: limpiaComercio(desc),
        importe: impV,
        combustible: /carburante/i.test(desc),
        divisa: (c[3] || '').trim() !== '' || (c[4] || '').trim() !== '',
        dudoso: [],
      };
      if (cod && (c[1] || '').replace(/[^A-Za-z0-9]/g, '') !== cod) mov.dudoso.push('código leído como "' + c[1].trim() + '"');
      if (!cod && (c[1] || '').replace(/[^A-Za-z0-9]/g, '').length > 2) mov.dudoso.push('código ilegible');
      if (!mov.fechaReg) mov.dudoso.push('fecha de registro');
      if (!mov.fechaOp) mov.dudoso.push('fecha de operación');
      if (mov.importe === null) mov.dudoso.push('importe');
      if (mov.divisa) mov.dudoso.push('pago en divisa extranjera');
      movs.push(mov);
    });
    movs.forEach(function (m, i) { m.n = i + 1; });
    const suma = round2(movs.reduce(function (s, m) { return s + (m.importe || 0); }, 0));
    return { movimientos: movs, totaleImpreso: totale, suma: suma, cuadra: totale !== null && cents(suma) === cents(totale) };
  }

  // importe de una celda de la columna "Importo in Euro": siempre 2 decimales al final,
  // el OCR confunde a veces la coma con un punto ("3.15")
  function importeCelda(t) {
    t = (t || '').replace(/[^0-9.,]/g, '');
    const m = t.match(/^(\d{1,3}(?:[.,]\d{3})*|\d+)[.,](\d{2})$/);
    if (!m) return null;
    const v = round2(parseFloat(m[1].replace(/[.,]/g, '') + '.' + m[2]));
    return v > 0 ? v : null; // un cargo de tarjeta nunca es 0
  }

  // Si no cuadra y hay filas con lecturas alternativas, busca la ÚNICA combinación que hace cuadrar
  function combinaAlternativas(movs, totale) {
    const conAlt = movs.filter(function (m) { return m.importe !== null && m.alternativas && m.alternativas.length; });
    if (!conAlt.length || conAlt.length > 12 || totale === null) return null;
    const base = movs.reduce(function (s, m) { return s + (m.importe ? cents(m.importe) : 0); }, 0);
    const objetivo = cents(totale) - base; const sols = [];
    const rec = function (i, acum, cambios) {
      if (sols.length > 1) return;
      if (i === conAlt.length) { if (acum === objetivo && cambios.length) sols.push(cambios.slice()); return; }
      rec(i + 1, acum, cambios);
      conAlt[i].alternativas.forEach(function (v) { cambios.push({ n: conAlt[i].n, de: conAlt[i].importe, a: v }); rec(i + 1, acum + cents(v) - cents(conAlt[i].importe), cambios); cambios.pop(); });
    };
    rec(0, 0, []);
    return sols.length === 1 ? sols[0] : null;
  }

  // Si el desglose no cuadra, ¿qué filas pueden tener un dígito mal leído que explique la diferencia?
  const CONFUSIONES = { '0': '689', '1': '47', '2': '7', '3': '85', '4': '19', '5': '683', '6': '0589', '7': '12', '8': '03569', '9': '048' };
  function sospechosas(movs, dif) {
    const res = [];
    movs.forEach(function (m) {
      if (m.importe === null) return;
      const s = m.importe.toFixed(2);
      for (let i = 0; i < s.length; i++) {
        const d = s[i]; if (!CONFUSIONES[d]) continue;
        for (const o of CONFUSIONES[d]) {
          const v = parseFloat(s.slice(0, i) + o + s.slice(i + 1));
          if (cents(v - m.importe) === cents(dif)) res.push({ n: m.n, leido: m.importe, posible: round2(v) });
        }
      }
    });
    return res;
  }

  function limpiaComercio(desc) {
    return desc.replace(/^(Pagamento|Pegamento|Acquisto|Acguisto)\s+/i, '')
      .replace(/^(E-?Commerce|Contact\w*|Carburante)\s+/i, '')
      .replace(/\s*\d{2}[.,]\d{2}[.,]\d{2}\s*$/, '')
      .replace(/\s+/g, ' ').trim();
  }

  // ---------- categorías ----------
  const CATEGORIAS = ['HOTEL', 'COMIDA', 'CENA', 'COMBUSTIBLE', 'PEAJE', 'PARKING', 'ALQUILER COCHE', 'FOTOCOPIAS', 'CORREOS', 'VARIOS'];
  const REGLAS = [
    [/carburante|\bE\.?S\.?\b|gasoleo|repsol|cepsa|moeve|galp|petronor|shell|bp\b|estacion serv/i, 'COMBUSTIBLE'],
    [/audasa|autoestradas|aucalsa|bidegi|autopista|peaje|camp\.?\.?\s*leon|leon\s*\.?\s*camp|interbiak|s\/ap|vasco aragonesa|eulsa|aulesa|autopistas/i, 'PEAJE'],
    [/park|\bpk|aparcamiento|telpark|easypark|\bora\b|\bota\b|indigo|empark|saba|trafi|aena|zona azul|estacionamiento/i, 'PARKING'],
    [/hotel|apartamento|booking|residencia|suites|centrotel|eurostars|\bexe\b|hostal|rooms|nh\b|ibis|parador|posada/i, 'HOTEL'],
    [/sixt|europcar|avis|hertz|enterprise|goldcar|renting|nolegg/i, 'ALQUILER COCHE'],
    [/\bups|correos|mrw|seur|dhl|\bgls|nacex|fedex|mensajer|paqueter|envio/i, 'CORREOS'],
    [/copister|fotocop|copy|reprograf/i, 'FOTOCOPIAS'],
    [/bar\b|rest|taberna|meson|mesón|cafe|cafeteria|bk\b|burger|mostrador|pizz|poke|tonino|vinoteca|bakery|panader|sidrer|cervecer|asador|grill|bigote|furancho|kvras|mirador|enpasbe|froiz|cafespir|kebab|sushi|mcdonald|telepizza/i, 'COMIDA'],
  ];
  function sugiereCategoria(texto, horaTicket) {
    for (let i = 0; i < REGLAS.length; i++) {
      if (REGLAS[i][0].test(texto)) {
        let c = REGLAS[i][1];
        if (c === 'COMIDA' && horaTicket && parseInt(horaTicket, 10) >= 17) c = 'CENA';
        return c;
      }
    }
    return 'VARIOS';
  }

  // ---------- tickets ----------
  // A partir del texto OCR de un ticket: importe total, fecha, hora, código de autorización.
  function analizaTicket(texto) {
    // "78, 00€" -> "78,00€" (el OCR mete espacios dentro de los importes)
    texto = String(texto || '').replace(/(\d)\s*([.,])\s+(\d{2})(?!\d)/g, '$1$2$3');
    const lineas = texto.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    const res = { importe: null, puntos: -99, candidatos: [], fecha: null, hora: null, codigo: null, nombre: lineas.slice(0, 3).join(' ').slice(0, 60) };
    const puntua = [];
    lineas.forEach(function (l, i) {
      const nums = importesDeLinea(l).map(function (o) { return o.v; });
      if (!nums.length) return;
      const p = puntosLinea(l);
      nums.forEach(function (v) { puntua.push({ v: v, p: p, i: i, l: l }); });
    });
    if (puntua.length) {
      // a igualdad de puntos gana el mayor (el total suele ser el mayor del ticket)
      puntua.sort(function (a, b) { return b.p - a.p || b.v - a.v; });
      res.importe = puntua[0].v; res.puntos = puntua[0].p;
      const vistos = {};
      res.candidatos = puntua.map(function (x) { return x.v; }).filter(function (v) { if (vistos[v]) return false; vistos[v] = 1; return true; }).slice(0, 6);
    }
    const mF = texto.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2}|\d{2})\b/) || texto.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (mF) res.fecha = mF[1].length === 4 ? isoDesdeDMY(mF[3], mF[2], mF[1]) : isoDesdeDMY(mF[1], mF[2], mF[3]);
    const mH = texto.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)(?::[0-5]\d)?\b(?![.,]\d{2}\b)/);
    if (mH) res.hora = mH[1].padStart(2, '0') + ':' + mH[2];
    // código de autorización: H + 5 caracteres cerca de "aut"
    const cand = texto.match(/(?:aut\w*|n\.?\s*autor\w*|c\.?\s*autoriz\w*|autorizaci\w*)[\s.:#]*([Hh][A-Za-z0-9]{5})\b/i)
      || texto.match(/\b(H\d{5})\b/);
    if (cand) res.codigo = normalizaCodigo(cand[1]);
    return res;
  }

  // ---------- casación por anclas: un documento (o una página con varios tickets) puede justificar varios movimientos ----------
  // Nada se recorta: se busca en el texto de cada página dónde está el código o el importe de cada movimiento.
  const RE_IMPORTE = /(\d{1,3}(?:[.,]\d{3})*\s?[.,]\s?\d{2})(?!\d)/g;
  // importes de una línea: [{v, ini, fin}] (sin fechas tipo 17.02 / 23.02.2026)
  function importesDeLinea(l) {
    const out = []; let m; RE_IMPORTE.lastIndex = 0;
    while ((m = RE_IMPORTE.exec(l))) {
      const after = l.slice(m.index + m[1].length, m.index + m[1].length + 3);
      if (/^[.\/-]\d/.test(after)) continue;
      const before = l.slice(Math.max(0, m.index - 1), m.index);
      if (/[.\/-]/.test(before) && /\d/.test(l.slice(Math.max(0, m.index - 3), m.index - 1))) continue;
      const v = parseImporte(m[1].replace(/\s/g, ''));
      if (v !== null && v > 0 && v < 5000) out.push({ v: v, ini: m.index, fin: m.index + m[1].length });
    }
    return out;
  }
  // cuánto parece una línea de total: «total», «importe», «tarjeta», «€» suman; «base», «IVA», «subtotal»… restan
  function puntosLinea(l) {
    let p = 0;
    if (/total\s*(tarjeta|venta|factura|c\/?iva|euros?|a pagar|importe)?/i.test(l)) p += 5;
    if (/^\s*total\b/i.test(l)) p += 2;
    if (/importe|import|pagado|tarjeta|venta|cobrar|eur\b|€/i.test(l)) p += 2;
    // resguardo de la tarjeta y recibos de apps: «IMPORTE: 12,50 EUR», «Importe pagado», «Pagado» son el cargo
    if (/^\s*importe\b|\bimporte\s*(total|pagado|a pagar|cobrado|:)|\bpagado\b|\bimporte\b.*(\beur\b|€)/i.test(l)) p += 3;
    // recibos de apps y correos: «Cargo», «Amount», «Importo», «Total charged»
    if (/\bcargo\b|\bcargado\b|\bamount\b|\bcharged\b|\bimporto\b|\bpagato\b/i.test(l)) p += 5;
    // saldo de monedero, bonos o «Dinero electrónico»: no es un cargo en la tarjeta
    if (/saldo|monedero|\bbono\b|dinero electr|wallet|balance/i.test(l)) p -= 8;
    // «IVA incluido» no es una línea de impuestos: no resta
    if (/base|iva(?!\s*incl)|cuota|imp\.?\s*iva(?!\s*incl)|subtotal|neto|bruto|precio|unid|litros|€\/l|cambio|entregado|propina/i.test(l)) p -= 4;
    return p;
  }
  // TSV de Tesseract -> líneas con la caja de cada palabra (en píxeles de la imagen original: se quita el margen y la escala)
  function lineasDeTSV(tsv, pad, k) {
    const grupos = {}, orden = [];
    String(tsv || '').split('\n').forEach(function (fila) {
      const c = fila.split('\t');
      if (c.length < 12 || c[0] !== '5') return;
      const t = c.slice(11).join(' ').trim(); if (!t) return;
      const x = (+c[6] - pad) / k, y = (+c[7] - pad) / k;
      const g = c[1] + '.' + c[2] + '.' + c[3] + '.' + c[4];
      if (!grupos[g]) { grupos[g] = []; orden.push(g); }
      grupos[g].push({ t: t, caja: [x, y, x + (+c[8]) / k, y + (+c[9]) / k] });
    });
    return orden.map(function (g) { return lineaDePalabras(grupos[g]); });
  }
  function lineaDePalabras(ps) {
    ps = ps.slice().sort(function (a, b) { return a.caja[0] - b.caja[0]; });
    let texto = ''; const palabras = [];
    ps.forEach(function (p, i) { if (i) texto += ' '; palabras.push({ t: p.t, caja: p.caja, ini: texto.length, fin: texto.length + p.t.length }); texto += p.t; });
    return { texto: texto, caja: union(ps.map(function (p) { return p.caja; })), palabras: palabras };
  }
  function union(cs) {
    if (!cs.length) return null;
    return [Math.min.apply(null, cs.map(function (c) { return c[0]; })), Math.min.apply(null, cs.map(function (c) { return c[1]; })),
      Math.max.apply(null, cs.map(function (c) { return c[2]; })), Math.max.apply(null, cs.map(function (c) { return c[3]; }))];
  }
  // agrupa las líneas de una página en zonas (tickets): líneas cercanas en vertical que se solapan en horizontal
  function zonasDeLineas(lineas) {
    if (!lineas.length) return [];
    const altos = lineas.map(function (l) { return l.caja[3] - l.caja[1]; }).sort(function (a, b) { return a - b; });
    const hm = altos[Math.floor(altos.length / 2)] || 20;
    const padre = lineas.map(function (_, i) { return i; });
    const raiz = function (i) { while (padre[i] !== i) i = padre[i] = padre[padre[i]]; return i; };
    for (let i = 0; i < lineas.length; i++) for (let j = i + 1; j < lineas.length; j++) {
      const a = lineas[i].caja, b = lineas[j].caja;
      const solapaX = Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > -hm;
      const hueco = Math.max(a[1], b[1]) - Math.min(a[3], b[3]);
      if (solapaX && hueco < hm * 2.5) padre[raiz(i)] = raiz(j);
    }
    const g = {};
    lineas.forEach(function (l, i) { (g[raiz(i)] = g[raiz(i)] || []).push(l); });
    return Object.keys(g).map(function (k) { return { lineas: g[k], caja: union(g[k].map(function (l) { return l.caja; })) }; });
  }
  // total de una zona: el importe de su mejor línea de total (puntos ≥ 5), o null si no tiene
  function totalDeZona(z) {
    let mejor = null;
    z.lineas.forEach(function (l) {
      const p = puntosLinea(l.texto), vs = importesDeLinea(l.texto);
      if (p >= 5 && vs.length && (!mejor || p > mejor.p)) mejor = { p: p, v: vs[vs.length - 1].v };
    });
    return mejor ? mejor.v : null;
  }
  // ¿la página (o la imagen) lleva varios tickets? Dos o más zonas con línea de total y con importes distintos.
  // (Un solo ticket que repite su total, por ejemplo en el resguardo de la tarjeta, no se parte.)
  function variosTickets(lineas) {
    const totales = {};
    zonasDeLineas(lineas).forEach(function (z) { const v = totalDeZona(z); if (v !== null) totales[cents(v)] = 1; });
    return Object.keys(totales).length >= 2;
  }
  // calidad de una lectura con posiciones: palabras con sentido y líneas de total (para elegir la orientación buena)
  function calidadLectura(lineas) {
    let palabras = 0, validas = 0, totales = 0, conLetras = 0, verticales = 0;
    lineas.forEach(function (l) {
      // una línea más alta que ancha es texto de lado: la página está girada (Tesseract a veces la lee igual)
      if (l.caja && l.texto.length >= 5 && l.caja[3] - l.caja[1] > (l.caja[2] - l.caja[0]) * 1.5) { verticales++; return; }
      l.texto.split(/\s+/).forEach(function (w) {
        if (!w) return; palabras++;
        if (/[A-Za-zÀ-ÿ0-9]/.test(w)) conLetras++;
        if (/^[A-Za-zÀ-ÿ]{3,}[.,:]?$/.test(w) || /^\*{0,4}\d+([.,:\/-]\d+)*[.,:]?$/.test(w)) validas++;
      });
      if (puntosLinea(l.texto) >= 5 && importesDeLinea(l.texto).length) totales++;
    });
    return { palabras: palabras, validas: validas, totales: totales, verticales: verticales, valor: validas + 8 * totales,
      pobre: validas < 12 || !totales || verticales > lineas.length / 3, proporcion: palabras ? conLetras / palabras : 0,
      // ¿merece la pena probar otras orientaciones? Solo si se lee muy poco o el texto va de lado (que falte «total» no basta:
      // en los tickets reales el OCR a menudo no lo lee y probar 4 giros cuesta 3 lecturas más de la página)
      deLado: validas < 12 || verticales > lineas.length / 3 };
  }
  // ¿la página no es un ticket? El extracto del banco (filas «fecha + código H…») o el rendiconto impreso traen TODOS los
  // importes y códigos del mes: si entran como ticket, casan con todo. Devuelve el motivo o null.
  function paginaNoTicket(lineas) {
    let filasBanco = 0; const cods = {};
    lineas.forEach(function (l) {
      if (/\d{2}[.\/]\d{2}[.\/]\d{2,4}\b.*\bH\s?\d{5}\b|\bH\s?\d{5}\b.*\d{2}[.\/]\d{2}[.\/]\d{2,4}\b/.test(l.texto)) filasBanco++;
      l.texto.split(/\s+/).forEach(function (w) { const c = /^[Hh]/.test(w) ? normalizaCodigo(w) : null; if (c) cods[c] = 1; });
    });
    if (filasBanco >= 3 || Object.keys(cods).length >= 8) return 'extracto del banco';
    const t = lineas.map(function (l) { return l.texto; }).join('\n');
    // el extracto y el rendiconto llevan docenas de fechas cortas «dd.mm.aa» (dos por fila); un ticket, casi nunca
    if ((t.match(/\b\d{2}\.\d{2}\.\d{2}\b/g) || []).length >= 10) return 'extracto del banco o rendiconto';
    const palabras = {}; (t.match(/rendiconto|spese|descrizione|carburante|cognome|dichiar|responsabile|anticipi|missione/gi) || []).forEach(function (w) { palabras[w.toLowerCase()] = 1; });
    if (Object.keys(palabras).length >= 2) return 'rendiconto';
    if ((t.match(/data registrazione|riferimento operazione|importo in (euro|divisa)|data operazione|dati della carta|estratto conto/gi) || []).length >= 2) return 'extracto del banco';
    // la última página del extracto, corta: algún código y las palabras de la cabecera de la tabla
    const cabecera = {}; (t.match(/riferimento|importo|divisa|cambio|registrazione/gi) || []).forEach(function (w) { cabecera[w.toLowerCase()] = 1; });
    if (Object.keys(cods).length && Object.keys(cabecera).length >= 2) return 'extracto del banco';
    if ((t.match(/descrizione spese|totale spese|rendiconto spese|nota spese|firma del dichiar|totale generale/gi) || []).length >= 2) return 'rendiconto';
    return null;
  }
  // lo que sirve para casar de un trozo de texto (con posiciones si las hay)
  function datosZona(lineas) {
    const ocurrencias = [], codigos = [], fechas = [];
    lineas.forEach(function (l) {
      const p = puntosLinea(l.texto), aut = /aut|autoriz|n\.?\s*autor/i.test(l.texto);
      importesDeLinea(l.texto).forEach(function (o) {
        const ws = (l.palabras || []).filter(function (w) { return w.fin > o.ini && w.ini < o.fin; });
        ocurrencias.push({ v: o.v, p: p, caja: ws.length ? union(ws.map(function (w) { return w.caja; })) : (l.caja || null) });
      });
      (l.palabras && l.palabras.length ? l.palabras : l.texto.split(/\s+/).map(function (t) { return { t: t, caja: l.caja || null }; })).forEach(function (w) {
        const c = /^[Hh]/.test(w.t) ? normalizaCodigo(w.t) : null;
        if (c) codigos.push({ c: c, aut: aut, caja: w.caja });
      });
      let m; const re = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2}|\d{2})\b/g;
      while ((m = re.exec(l.texto))) { const f = isoDesdeDMY(m[1], m[2], m[3]); if (f) fechas.push(f); }
    });
    return { ocurrencias: ocurrencias, codigos: codigos, fechas: fechas, texto: lineas.map(function (l) { return l.texto; }).join('\n') };
  }
  function lineasDeTexto(texto) {
    return String(texto || '').replace(/(\d)\s*([.,])\s+(\d{2})(?!\d)/g, '$1$2$3').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) { return { texto: l, caja: null }; });
  }

  // dos zonas que son el mismo recibo visto en dos capturas: mismas fechas y mismas horas leídas (y alguna de las dos)
  function mismaCaptura(a, b) {
    const horas = function (z) { return (z.texto.match(/\b\d{1,2}:\d{2}\b/g) || []).sort().join(','); };
    const fechas = function (z) { return z.fechas.slice().sort().join(','); };
    return fechas(a) === fechas(b) && horas(a) === horas(b) && !!(fechas(a) || horas(a));
  }
  // movs: [{n, codigo, importe, fechaOp}]
  // docs: [{id, ignorar, zonas:[{id, pagina, caja, ocurrencias:[{v,p,caja}], codigos:[{c,aut,caja}], fechas:[iso], texto}], manual:[{mov, zona, pagina, caja}]}]
  // opc: {elecciones: {movN: 'docId|zonaId'}, quitadas: {'docId|zonaId|movN': true}}
  // Devuelve {anclas:[{mov, doc, zona, pagina, caja, origen, revisar}], preguntas:[{mov, opciones:[{doc, zona, pagina, caja, clave}]}], libres:{docId: n}}
  function anclas(movs, docs, opc) {
    opc = opc || {};
    const elecciones = opc.elecciones || {}, quitadas = opc.quitadas || {};
    const res = [], preguntas = [], porZona = {}, porMov = {};
    const vivos = docs.filter(function (d) { return !d.ignorar; });
    const pon = function (m, d, z, caja, origen, revisar) {
      const k = d.id + '|' + z.id + '|' + m.n;
      if (quitadas[k] || res.some(function (a) { return a.clave === k; })) return false;
      const a = { clave: k, mov: m.n, doc: d.id, zona: z.id, pagina: z.pagina, caja: caja || null, origen: origen, revisar: !!revisar, texto: z.texto };
      res.push(a); (porZona[d.id + '|' + z.id] = porZona[d.id + '|' + z.id] || []).push(a); (porMov[m.n] = porMov[m.n] || []).push(a);
      return true;
    };
    // 1) a mano (un toque en la página o el desplegable del documento)
    vivos.forEach(function (d) {
      (d.manual || []).forEach(function (x) {
        const m = movs.find(function (y) { return y.n === x.mov; }); if (!m) return;
        const z = d.zonas.find(function (y) { return y.id === x.zona; }) || { id: x.zona || 'mano', pagina: x.pagina || 0, texto: '' };
        pon(m, d, z, x.caja, 'a mano', false);
      });
    });
    // 2) código de operación (H + 5 cifras): exacto en cualquier sitio; con una cifra distinta, solo junto a «aut…» (y a revisar)
    const codigosDesglose = {}; movs.forEach(function (m) { if (m.codigo) codigosDesglose[m.codigo] = m.n; });
    movs.forEach(function (m) {
      if (!m.codigo) return;
      const exactos = [], cerca = [];
      vivos.forEach(function (d) { d.zonas.forEach(function (z) { z.codigos.forEach(function (c) {
        // con una cifra distinta, nunca si ese código es exactamente el de otro movimiento
        if (c.c === m.codigo) exactos.push([d, z, c]); else if (c.aut && !codigosDesglose[c.c] && distCodigo(c.c, m.codigo) === 1) cerca.push([d, z, c]);
      }); }); });
      (exactos.length ? exactos : cerca).forEach(function (x) {
        const z = x[1], imp = z.ocurrencias.find(function (o) { return m.importe !== null && cents(o.v) === cents(m.importe); });
        // la etiqueta va en el importe si está en la misma zona; si no, en el código
        pon(m, x[0], z, imp && imp.caja ? imp.caja : x[2].caja, 'código ' + m.codigo, !exactos.length || (z.ocurrencias.length > 0 && !imp));
      });
    });
    // 3) importe en una línea de total; la fecha solo desempata; si hay dudas, se pregunta
    const totales = function (z) { const vs = {}; z.ocurrencias.forEach(function (o) { if (o.p >= 5) vs[cents(o.v)] = 1; }); return Object.keys(vs).length; };
    const ocupada = function (d, z) { const n = (porZona[d.id + '|' + z.id] || []).length; return n > 0 && n >= Math.max(1, totales(z)); };
    const candidatos = function (m) {
      const zs = [];
      vivos.forEach(function (d) { d.zonas.forEach(function (z) {
        if (ocupada(d, z) || quitadas[d.id + '|' + z.id + '|' + m.n]) return;
        const os = z.ocurrencias.filter(function (o) { return cents(o.v) === cents(m.importe); });
        if (!os.length) return;
        const mejor = os.slice().sort(function (a, b) { return b.p - a.p; })[0];
        zs.push({ d: d, z: z, o: mejor, p: mejor.p, clave: d.id + '|' + z.id });
      }); });
      if (!zs.length) return [];
      const best = Math.max.apply(null, zs.map(function (x) { return x.p; }));
      return zs.filter(function (x) { return x.p >= best - 2; });
    };
    let cambio = true;
    while (cambio) {
      cambio = false;
      const pend = movs.filter(function (m) { return m.importe !== null && !porMov[m.n] && !preguntas.some(function (q) { return q.mov === m.n; }); })
        .map(function (m) { return { m: m, c: candidatos(m) }; }).filter(function (x) { return x.c.length; })
        .sort(function (a, b) { return a.c.length - b.c.length; });
      for (let i = 0; i < pend.length && !cambio; i++) {
        const m = pend[i].m, c = pend[i].c, elegida = elecciones[m.n];
        const e = elegida && c.find(function (x) { return x.clave === elegida; });
        if (e) { cambio = pon(m, e.d, e.z, e.o.caja, 'elegido por ti', false); continue; }
        if (c.length === 1) { cambio = pon(m, c[0].d, c[0].z, c[0].o.caja, 'importe', c[0].p < 2); continue; }
        // varias capturas de pantalla del mismo recibo (misma fecha y hora): van todas con el movimiento
        if (c.every(function (x) { return x.d.captura && mismaCaptura(x.z, c[0].z); })) {
          c.forEach(function (x) { if (pon(m, x.d, x.z, x.o.caja, 'importe (varias capturas)', x.p < 2)) cambio = true; }); continue;
        }
        const conFecha = c.filter(function (x) { return m.fechaOp && x.z.fechas.indexOf(m.fechaOp) >= 0; });
        if (conFecha.length === 1) { cambio = pon(m, conFecha[0].d, conFecha[0].z, conFecha[0].o.caja, 'importe y fecha', conFecha[0].p < 2); continue; }
      }
      if (!cambio) {
        // lo que queda con varias opciones parecidas: no se adivina, se pregunta
        pend.forEach(function (x) {
          if (x.c.length < 2) return;
          const conFecha = x.c.filter(function (y) { return x.m.fechaOp && y.z.fechas.indexOf(x.m.fechaOp) >= 0; });
          const ops = conFecha.length >= 2 ? conFecha : x.c;
          preguntas.push({ mov: x.m.n, opciones: ops.map(function (y) { return { doc: y.d.id, zona: y.z.id, pagina: y.z.pagina, caja: y.o.caja, clave: y.clave }; }) });
        });
      }
    }
    // 4) factura y ticket del mismo gasto: un documento suelto que no ha casado con nada, con el importe de un movimiento que
    //    ya tiene ticket y la fecha igual o a un día, va con ese movimiento como segundo documento (a revisar). Solo uno por
    //    movimiento de forma automática; si hay más, se pregunta. Nunca toca un documento ya casado (por código o por lo que sea).
    const dias = function (a, b) { return Math.abs(Date.parse(a) - Date.parse(b)) / 86400000; };
    const extras = {};
    vivos.forEach(function (d) {
      if (d.varios || d.zonas.length !== 1 || res.some(function (a) { return a.doc === d.id; })) return;
      const z = d.zonas[0], fuertes = z.ocurrencias.filter(function (o) { return o.p >= 5; });
      const cands = [];
      movs.forEach(function (m) {
        if (!porMov[m.n] || m.importe === null || !m.fechaOp || quitadas[d.id + '|' + z.id + '|' + m.n]) return;
        const o = fuertes.find(function (x) { return cents(x.v) === cents(m.importe); });
        if (o && z.fechas.some(function (f) { return dias(f, m.fechaOp) <= 1; })) cands.push({ m: m, o: o });
      });
      // si encaja con varios movimientos ya justificados, no se adivina: queda sin movimiento (se puede asignar a mano)
      if (cands.length === 1) (extras[cands[0].m.n] = extras[cands[0].m.n] || []).push({ d: d, z: z, o: cands[0].o, clave: d.id + '|' + z.id });
    });
    Object.keys(extras).forEach(function (n) {
      const m = movs.find(function (x) { return x.n === +n; }), c = extras[n], elegida = elecciones['extra' + n];
      const e = elegida && c.find(function (x) { return x.clave === elegida; });
      if (c.length === 1) pon(m, c[0].d, c[0].z, c[0].o.caja, 'segundo documento', true);
      else if (e) pon(m, e.d, e.z, e.o.caja, 'segundo documento elegido por ti', false);
      else preguntas.push({ mov: m.n, extra: true, opciones: c.map(function (y) { return { doc: y.d.id, zona: y.z.id, pagina: y.z.pagina, caja: y.o.caja, clave: y.clave }; }) });
    });
    // zonas con una línea de total que no han casado con nada (tickets sin movimiento). Si ese total es el importe de un
    // movimiento ya justificado por otro documento, es una copia del mismo ticket (foto y escaneo): no cuenta.
    const importes = {}; movs.forEach(function (m) { if (m.importe !== null) importes[cents(m.importe)] = 1; });
    const libres = {};
    vivos.forEach(function (d) { d.zonas.forEach(function (z) {
      if ((porZona[d.id + '|' + z.id] || []).length) return;
      if (z.ocurrencias.some(function (o) { return o.p >= 5 && !importes[cents(o.v)]; })) libres[d.id] = (libres[d.id] || 0) + 1;
    }); });
    return { anclas: res, preguntas: preguntas, libres: libres };
  }

  // ---------- casación ----------
  function distCodigo(a, b) {
    if (!a || !b || a.length !== b.length) return 99;
    let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d;
  }
  const api = { eur: eur, eurNum: eurNum, parseImporte: parseImporte, round2: round2, cents: cents, fechaDMY: fechaDMY, isoDesdeDMY: isoDesdeDMY,
    MESES: MESES, MESES_ES: MESES_ES, parseTSV: parseTSV, normalizaCodigo: normalizaCodigo, importeCelda: importeCelda, recorte: recorte, recorteNegro: recorteNegro, recorteBanda: recorteBanda, amplia: amplia, rejilla: rejilla, fechaExif: fechaExif, camaraExif: camaraExif, facturaXml: facturaXml, recorteLimpio: recorteLimpio, interpretaFilas: interpretaFilas, limpiaComercio: limpiaComercio,
    CATEGORIAS: CATEGORIAS, sugiereCategoria: sugiereCategoria, analizaTicket: analizaTicket, sospechosas: sospechosas, combinaAlternativas: combinaAlternativas, distCodigo: distCodigo,
    lineasDeTSV: lineasDeTSV, lineaDePalabras: lineaDePalabras, lineasDeTexto: lineasDeTexto, zonasDeLineas: zonasDeLineas, datosZona: datosZona, anclas: anclas, puntosLinea: puntosLinea,
    importesDeLinea: importesDeLinea, totalDeZona: totalDeZona, variosTickets: variosTickets, calidadLectura: calidadLectura, paginaNoTicket: paginaNoTicket };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Motor = api;
})(this);
