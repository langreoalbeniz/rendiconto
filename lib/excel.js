/* Relleno de la plantilla del rendiconto (xlsx con el mismo formato que la plantilla .xls de la empresa).
   Uso: Excel.genera(JSZip, plantillaArrayBuffer, datos) -> Promise<Uint8Array>
   datos = { cognome, nome, daData:'11/02/2026', aData:'25/02/2026', varie:[{desc, importe, fecha:'11.02.2026', comentario, ref}], carburante:[...] }
   (desc → B, importe → I, fecha → J, comentario → K, ref → N, fuera del área de impresión) */
(function (root) {
  'use strict';
  // Estructura de la plantilla original
  const T = {
    varieIni: 30, varieFin: 85, totVarie: 86, carbHead: 88, carbIni: 89, carbFin: 92, totCarb: 93,
    totGen: 101, resto: 103, ultima: 116, printFin: 112,
  };
  const COLS_TOT = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function filasDe(xml) {
    const m = {}; const re = /<row r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g; let x;
    while ((x = re.exec(xml))) m[+x[1]] = x[0];
    return m;
  }
  function renumera(rowXml, nuevo) {
    return rowXml.replace(/<row r="\d+"/, '<row r="' + nuevo + '"').replace(/(<c r="[A-Z]+)\d+"/g, '$1' + nuevo + '"');
  }
  function ponCelda(rowXml, col, r, contenido) {
    // contenido: {texto} o {numero} o {formula, valor}
    const re = new RegExp('<c r="' + col + r + '"([^>]*?)(?:/>|>[\\s\\S]*?</c>)');
    const m = rowXml.match(re);
    let attrs = m ? m[1].replace(/\s*t="[^"]*"/, '') : '';
    let inner;
    if (contenido.texto !== undefined) { attrs += ' t="inlineStr"'; inner = '<is><t xml:space="preserve">' + esc(contenido.texto) + '</t></is>'; }
    else if (contenido.formula !== undefined) { attrs += ' t="n"'; inner = '<f>' + esc(contenido.formula) + '</f><v>' + (contenido.valor || 0) + '</v>'; }
    else { attrs += ' t="n"'; inner = '<v>' + contenido.numero + '</v>'; }
    const nueva = '<c r="' + col + r + '"' + attrs + '>' + inner + '</c>';
    if (m) return rowXml.replace(re, nueva);
    // la celda no existe: insertar en orden de columna
    const cols = 'ABCDEFGHIJKLMN';
    const celdas = rowXml.match(/<c r="([A-Z]+)\d+"/g) || [];
    for (let i = 0; i < celdas.length; i++) {
      const c = celdas[i].match(/<c r="([A-Z]+)/)[1];
      if (cols.indexOf(c) > cols.indexOf(col)) { const pos = rowXml.indexOf(celdas[i]); return rowXml.slice(0, pos) + nueva + rowXml.slice(pos); }
    }
    return rowXml.replace('</row>', nueva + '</row>');
  }
  function r2(x) { return Math.round(x * 100) / 100; }

  async function genera(JSZip, plantilla, d) {
    const zip = await JSZip.loadAsync(plantilla);
    const ruta = 'xl/worksheets/sheet1.xml';
    let xml = await zip.file(ruta).async('string');
    const F = filasDe(xml);
    const nV = Math.max(T.varieFin - T.varieIni + 1, d.varie.length);
    const nC = Math.max(T.carbFin - T.carbIni + 1, d.carburante.length);
    const dV = nV - (T.varieFin - T.varieIni + 1), dC = nC - (T.carbFin - T.carbIni + 1);
    // mapa de filas nuevas: [filaOrigen, filaNueva]
    const plan = []; let n = 1;
    for (let r = 1; r < T.varieIni; r++) plan.push([r, n++]);
    const iniV = n;
    for (let k = 0; k < nV; k++) {
      // la última fila del bloque conserva su estilo (borde inferior); las añadidas copian una intermedia
      const src = k === nV - 1 ? T.varieFin : (k < T.varieFin - T.varieIni ? T.varieIni + k : T.varieFin - 1);
      plan.push([src, n++]);
    }
    const finV = n - 1;
    for (let r = T.varieFin + 1; r < T.carbIni; r++) plan.push([r, n++]);
    const iniC = n;
    for (let k = 0; k < nC; k++) {
      const src = k === nC - 1 ? T.carbFin : (k < T.carbFin - T.carbIni ? T.carbIni + k : T.carbFin - 1);
      plan.push([src, n++]);
    }
    const finC = n - 1;
    for (let r = T.carbFin + 1; r <= T.ultima; r++) plan.push([r, n++]);
    const nueva = function (orig) { return orig + (orig > T.varieFin ? dV : 0) + (orig > T.carbFin ? dC : 0); };
    const rTotV = nueva(T.totVarie), rTotC = nueva(T.totCarb), rTotG = nueva(T.totGen), rResto = nueva(T.resto);

    const sumV = r2(d.varie.reduce(function (s, x) { return s + x.importe; }, 0));
    const sumC = r2(d.carburante.reduce(function (s, x) { return s + x.importe; }, 0));
    const filas = [];
    plan.forEach(function (p) {
      if (!F[p[0]]) return;
      let row = renumera(F[p[0]], p[1]); const r = p[1];
      if (r === 6 && d.cognome) row = ponCelda(row, 'D', r, { texto: d.cognome });
      if (r === 8 && d.nome) row = ponCelda(row, 'D', r, { texto: d.nome });
      if (r === 12) row = ponCelda(row, 'D', r, { texto: d.daData });
      if (r === 14) row = ponCelda(row, 'D', r, { texto: d.aData });
      const escribe = function (x) {
        row = ponCelda(row, 'B', r, { texto: x.desc });
        row = ponCelda(row, 'I', r, { numero: r2(x.importe) });
        if (x.fecha) row = ponCelda(row, 'J', r, { texto: x.fecha });
        if (x.comentario) row = ponCelda(row, 'K', r, { texto: x.comentario });
        if (x.ref) row = ponCelda(row, 'N', r, { texto: x.ref });
      };
      if (r >= iniV && r <= finV && d.varie[r - iniV]) escribe(d.varie[r - iniV]);
      if (r >= iniC && r <= finC && d.carburante[r - iniC]) escribe(d.carburante[r - iniC]);
      if (r === rTotV) COLS_TOT.forEach(function (c) { row = ponCelda(row, c, r, { formula: 'SUM(' + c + iniV + ':' + c + finV + ')', valor: c === 'I' ? sumV : 0 }); });
      if (r === rTotC) COLS_TOT.forEach(function (c) { row = ponCelda(row, c, r, { formula: 'SUM(' + c + iniC + ':' + c + finC + ')', valor: c === 'I' ? sumC : 0 }); });
      if (r === rTotG) COLS_TOT.forEach(function (c) { row = ponCelda(row, c, r, { formula: c + rTotV + '+' + c + rTotC, valor: c === 'I' ? r2(sumV + sumC) : 0 }); });
      if (r === rResto) {
        ['D', 'E', 'F', 'G'].forEach(function (c) { row = ponCelda(row, c, r, { formula: c + '27-' + c + rTotG, valor: 0 }); });
        row = ponCelda(row, 'H', r, { formula: 'H20-H' + rTotG, valor: 0 });
      }
      filas.push(row);
    });
    const ini = xml.indexOf('<sheetData>') + '<sheetData>'.length, fin = xml.indexOf('</sheetData>');
    xml = xml.slice(0, ini) + filas.join('') + xml.slice(fin);
    // celdas combinadas
    const merges = [];
    (xml.match(/<mergeCell ref="[^"]+"\/>/g) || []).forEach(function (m) {
      const ref = m.match(/ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/);
      const a = +ref[2], b = +ref[4];
      if (a >= T.varieIni && a <= T.varieFin) return; // se regeneran
      merges.push('<mergeCell ref="' + ref[1] + nueva(a) + ':' + ref[3] + nueva(b) + '"/>');
    });
    for (let r = iniV; r <= finV; r++) merges.push('<mergeCell ref="K' + r + ':L' + r + '"/>');
    xml = xml.replace(/<mergeCells count="\d+">[\s\S]*?<\/mergeCells>/, '<mergeCells count="' + merges.length + '">' + merges.join('') + '</mergeCells>');
    xml = xml.replace(/<pageSetUpPr fitToPage="false"\/>/, '<pageSetUpPr fitToPage="true"/>');
    xml = xml.replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="A1:N' + nueva(T.ultima) + '"/>');
    zip.file(ruta, xml);
    let wb = await zip.file('xl/workbook.xml').async('string');
    wb = wb.replace(/\$A\$1:\$M\$\d+/, '$A$1:$M$' + nueva(T.printFin));
    wb = wb.replace(/<calcPr /, '<calcPr fullCalcOnLoad="1" ');
    zip.file('xl/workbook.xml', wb);
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  const api = { genera: genera, T: T };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Excel = api;
})(this);
