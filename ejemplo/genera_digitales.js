// Genera ejemplo/digitales/recibo-parking-app.pdf: un recibo inventado en PDF con texto (no escaneado).
// Uso: node ejemplo/genera_digitales.js   (las facturas XML de esa carpeta se escriben a mano)
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('../lib/pdf-lib.min.js');

(async () => {
  const doc = await PDFDocument.create();
  doc.setTitle('Recibo de pago - Parking Ficticio Vigo'); doc.setProducer('ejemplo inventado'); doc.setCreator('ejemplo inventado');
  const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const p = doc.addPage([300, 430]);
  let y = 390;
  const linea = (s, fuente = f, t = 11) => { p.drawText(s, { x: 24, y, size: t, font: fuente, color: rgb(0.1, 0.1, 0.12) }); y -= t + 9; };
  linea('PARKING FICTICIO VIGO', fb, 15);
  linea('App de aparcamiento (ejemplo)');
  linea('Recibo de pago n.º 2026-000123');
  y -= 8;
  linea('Fecha: 04/11/2026 17:40');
  linea('Entrada: 15:02   Salida: 17:40');
  linea('Duración: 2 h 38 min');
  y -= 8;
  linea('Importe pagado: 2,65 EUR', fb, 14);
  linea('IVA incluido');
  y -= 8;
  linea('Tarjeta ************0000');
  linea('Autorización: H10006');
  linea('NIF emisor: B00000000');
  fs.mkdirSync(path.join(__dirname, 'digitales'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'digitales', 'recibo-parking-app.pdf'), await doc.save({ updateFieldAppearances: false }));
  console.log('recibo-parking-app.pdf');
})();
