"""Genera ejemplo/FALTAN-TICKETS.json con datos INVENTADOS para la pantalla «Faltan».

Son los mismos 10 movimientos del «Desglose de ejemplo.pdf» (que suma 185,62 €), repartidos en dos meses inventados, en
el esquema plano del diseño 158. Así, al abrir esta lista en la pantalla «Faltan» y añadir los tickets digitales de
ejemplo, se tachan los que casan (factura del hotel 68,00 → mov 2; mensajería UBL 12,40 → mov 7; recibo de parking
H10006 2,65 → mov 6) y la FatturaPA de 45,00 €, que no está en la lista, queda «sin movimiento».

Sin datos reales: comercios y ciudades inventados, sin NIF, IBAN, tarjeta ni correos. Uso: python genera_faltan.py
"""
import json
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'FALTAN-TICKETS.json')

# (n, codigo, comercio, importe, enviado) — los mismos importes/códigos del desglose de ejemplo
MOVS = [
    (1, 'H10001', 'AUTOPISTA EJEMPLO NORTE', 4.10, True),   # ya enviado: para probar el filtro «solo no enviados»
    (2, 'H10002', 'HOTEL PRUEBA CENTRO OVIEDO', 68.00, False),
    (3, 'H10003', 'RESTAURANTE INVENTADO LEON', 18.50, False),
    (4, 'H10004', 'ESTACION DEMO SL BURGOS', 61.27, False),
    (5, 'H10005', 'PARKING FICTICIO VIGO', 2.65, False),
    (6, 'H10006', 'PARKING FICTICIO VIGO', 2.65, False),
    (7, 'H10007', 'MENSAJERIA DEMO MADRID', 12.40, False),
    (8, 'H10008', 'CAFETERIA EJEMPLO GIJON', 7.30, False),
    (9, None, 'AUTOPISTAS DE PRUEBA LEON', 5.55, False),
    (10, 'H10010', 'COPISTERIA DEMO OVIEDO', 3.20, False),
]
# mes inventado y día dentro del mes (dd) para cada movimiento
MESES = {1: ('2026-08', 12), 2: ('2026-08', 13), 3: ('2026-08', 14), 4: ('2026-08', 15), 5: ('2026-08', 16),
         6: ('2026-09', 3), 7: ('2026-09', 4), 8: ('2026-09', 5), 9: ('2026-09', 8), 10: ('2026-09', 9)}


def main():
    entradas = []
    for n, codigo, comercio, importe, enviado in MOVS:
        mes, dd = MESES[n]
        e = {
            'id': '%s-%d' % (mes, n),
            'mes': mes,
            'n': n,
            'fecha': '%s-%02d' % (mes, dd),
            'comercio': comercio,
            'importe': round(importe, 2),
            'codigo': codigo,
            'enviado': enviado,
            'pista': 'dato inventado',
        }
        # mov 2: el PC ya le propuso un ticket (estado «propuesto»); mov 4: ya está recuperado (estado «recuperado»)
        if n == 2:
            e['propuesto'] = {'archivo': '2026-08_mov2_13-08-2026_68,00.pdf', 'origen': 'escaneo-ejemplo.pdf',
                              'pagina': 1, 'via': 'importe 68,00 €', 'instruccion': 165, 'estado': 'propuesto',
                              'fuente': 'escaneo de ejemplo'}
        if n == 4:
            e['recuperado'] = '2026-08_mov4_15-08-2026_61,27.pdf'
        entradas.append(e)
    # «a elegir»: un ticket escaneado de ejemplo que cuadra con dos movimientos (mov 3 y mov 10): el titular elige
    a_elegir = [{
        'key': 'ae-ejemplo-1', 'origen': 'escaneo-ejemplo.pdf', 'pagina': 2, 'via': 'importe',
        'leido': {'importe': 18.50, 'codigo': None, 'fecha': None},
        'opciones': [
            {'id': '2026-08-3', 'mes': '2026-08', 'n': 3, 'importe': 18.50, 'comercio': 'RESTAURANTE INVENTADO LEON', 'fecha': '2026-08-14', 'codigo': 'H10003'},
            {'id': '2026-09-10', 'mes': '2026-09', 'n': 10, 'importe': 3.20, 'comercio': 'COPISTERIA DEMO OVIEDO', 'fecha': '2026-09-09', 'codigo': 'H10010'},
        ],
    }]
    doc = {'generado': '2026-01-01T00:00:00', 'entradas': entradas, 'a_elegir': a_elegir}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('escrito', OUT, '·', len(entradas), 'entradas')


if __name__ == '__main__':
    main()
