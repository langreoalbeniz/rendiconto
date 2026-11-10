"""Genera un paquete RENDICONTO-TODO.zip de ejemplo con datos INVENTADOS para la pestaña «Meses» (instrucción 169).

Monta un 07_GASTOS falso (FALTAN-TICKETS.json con dos meses inventados + un par de tickets propuestos en PDF, uno con
el importe correcto y otro con el importe cambiado para que el control de calidad lo rebaje a «⚠ revisar») y llama al
empaquetador real `empaqueta_rendiconto.empaqueta`. Así el zip de ejemplo se construye por el mismo camino que el de
iCloud. Sin datos reales: comercios y ciudades inventados, sin NIF, IBAN, tarjeta ni correos.

Uso:  python genera_rendiconto_todo.py [--salida RUTA.zip]      (por defecto, ./RENDICONTO-TODO-ejemplo.zip)
"""
import argparse
import json
import os
import sys
import tempfile

# empaqueta_rendiconto vive en herramientas\asistente
AQUI = os.path.dirname(os.path.abspath(__file__))
ASIST = os.path.normpath(os.path.join(AQUI, '..', '..', 'asistente'))
sys.path.insert(0, ASIST)
import empaqueta_rendiconto as ER  # noqa: E402


def _pdf_una_pagina(ruta, texto):
    """PDF mínimo de UNA página (control de calidad: «una página = un ticket»). Sin dependencias externas."""
    contenido = ('BT /F1 18 Tf 72 720 Td (%s) Tj ET' % texto).encode('latin-1', 'replace')
    objs = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        b'<< /Length %d >>\nstream\n%s\nendstream' % (len(contenido), contenido),
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    out = b'%PDF-1.4\n'
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b'%d 0 obj\n%s\nendobj\n' % (i, o)
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)
    for off in offs:
        out += b'%010d 00000 n \n' % off
    out += b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF' % (len(objs) + 1, xref)
    with open(ruta, 'wb') as f:
        f.write(out)


def monta_gastos(base):
    """FALTAN-TICKETS.json inventado + sus tickets. Dos meses: agosto (reclamado por la sede) y septiembre."""
    # agosto: mov1 propuesto OK · mov2 propuesto con importe cambiado (QC lo rebaja a revisar) · mov3 falta (restaurante)
    # septiembre: mov1 confirmado (recuperado) · mov2 «a elegir» · mov3 sin movimiento (ticket suelto)
    propu_ago = os.path.join(base, '2026-08', 'RENDICONTO', 'tickets-propuestos')
    ent_ago = os.path.join(base, '2026-08', 'ENTRANTES')
    ent_sep = os.path.join(base, '2026-09', 'ENTRANTES')
    for d in (propu_ago, ent_ago, ent_sep):
        os.makedirs(d, exist_ok=True)
    # propuesto OK: nombre con importe = 68,00 (= banco) y fecha dentro de la ventana
    _pdf_una_pagina(os.path.join(propu_ago, '2026-08_mov1_13-08-2026_68,00.pdf'), 'HOTEL PRUEBA CENTRO OVIEDO 68,00')
    # propuesto KO: el ticket dice 80,00 pero el banco 24,50 → el QC lo rebaja a «revisar»
    _pdf_una_pagina(os.path.join(propu_ago, '2026-08_mov2_13-08-2026_80,00.pdf'), 'TIENDA DEMO 80,00')
    # confirmado de septiembre (ya recuperado)
    _pdf_una_pagina(os.path.join(ent_sep, '2026-09_mov1_03-09-2026_12,40.pdf'), 'MENSAJERIA DEMO MADRID 12,40')
    # sin movimiento de septiembre
    _pdf_una_pagina(os.path.join(ent_sep, '2026-09_SINMOV_09-09-2026_45,00.pdf'), 'FACTURA DEMO 45,00 (sin cargo)')

    idx = {'generado': '2026-01-01T00:00:00', 'meses': {
        '2026-08': {'totale': 111.00, 'faltantes': [
            {'n': 1, 'fechaOp': '2026-08-13', 'codigo': 'H10001', 'importe': 68.00,
             'descripcion': 'HOTEL PRUEBA CENTRO OVIEDO',
             'propuesto': {'archivo': '2026-08_mov1_13-08-2026_68,00.pdf', 'via': 'importe 68,00 €', 'estado': 'propuesto'}},
            {'n': 2, 'fechaOp': '2026-08-13', 'codigo': 'H10002', 'importe': 24.50,
             'descripcion': 'TIENDA DEMO GIJON',
             'propuesto': {'archivo': '2026-08_mov2_13-08-2026_80,00.pdf', 'via': 'importe 80,00 €', 'estado': 'propuesto'}},
            {'n': 3, 'fechaOp': '2026-08-14', 'codigo': 'H10003', 'importe': 18.50,
             'descripcion': 'RESTAURANTE INVENTADO LEON'}]},
        '2026-09': {'totale': 33.90, 'faltantes': [
            {'n': 1, 'fechaOp': '2026-09-03', 'codigo': 'H10007', 'importe': 12.40,
             'descripcion': 'MENSAJERIA DEMO MADRID', 'recuperado': '2026-09_mov1_03-09-2026_12,40.pdf'},
            {'n': 2, 'fechaOp': '2026-09-04', 'codigo': None, 'importe': 3.20,
             'descripcion': 'COPISTERIA DEMO OVIEDO'},
            {'n': 3, 'fechaOp': '2026-09-05', 'codigo': 'H10008', 'importe': 18.30,
             'descripcion': 'CAFETERIA EJEMPLO GIJON'}]}},
        'a_elegir': [{'key': 'ae-ejemplo-1', 'origen': 'escaneo-ejemplo.pdf', 'pagina': 1, 'via': 'importe',
                      'leido': {'importe': 3.20}, 'opciones': [
                          {'id': '2026-09-2', 'mes': '2026-09', 'n': 2, 'importe': 3.20,
                           'comercio': 'COPISTERIA DEMO OVIEDO', 'fecha': '2026-09-04', 'codigo': None}]}]}
    with open(os.path.join(base, 'FALTAN-TICKETS.json'), 'w', encoding='utf-8') as f:
        json.dump(idx, f, ensure_ascii=False, indent=1)


def genera(salida):
    tmp = tempfile.mkdtemp(prefix='rendiconto-todo-ej-')
    base = os.path.join(tmp, '07_GASTOS')
    os.makedirs(base)
    monta_gastos(base)
    dest = os.path.dirname(os.path.abspath(salida)) or '.'
    os.makedirs(dest, exist_ok=True)
    zip_path, resumen = ER.empaqueta(base, dest_dir=tmp)
    # el empaquetador siempre escribe RENDICONTO-TODO.zip; lo movemos al nombre pedido
    import shutil
    if os.path.abspath(zip_path) != os.path.abspath(salida):
        shutil.copy2(zip_path, salida)
    return salida, resumen


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--salida', default=os.path.join(AQUI, 'RENDICONTO-TODO-ejemplo.zip'))
    a = ap.parse_args()
    salida, resumen = genera(a.salida)
    print('escrito', salida)
    print(json.dumps({k: v for k, v in resumen.items() if k != 'zip'}, ensure_ascii=False, indent=1))
    return 0


if __name__ == '__main__':
    if sys.stdout:
        sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
