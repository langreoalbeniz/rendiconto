# -*- coding: utf-8 -*-
"""Genera ejemplo/Tickets lado a lado.pdf: un «escaneo» inventado con tickets colocados LADO A LADO (2 columnas × 2 filas
+ dos tickets contiguos con poco hueco). El `Tickets varios por pagina.pdf` los apila en vertical, donde el corte por
columnas 1D sí los separa; este escaneo estresa la separación horizontal que necesita la 175 (componentes conexas 2D).

Comercios ficticios y tarjeta ****0000. Expone `tickets()` con la posición y el total de cada ticket para la prueba.
Uso: python genera_lado_a_lado.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

AQUI = os.path.dirname(os.path.abspath(__file__))
FUENTE = 'C:/Windows/Fonts/consola.ttf'
DPI = 200
W, H = 1654, 2339  # A4 a 200 ppp
ANCHO = 560        # ancho de cada ticket

# (x, y, total, líneas) — el total va en la línea que empieza por «!»
TICKETS = [
    (90, 150, 4.10, ['AUTOPISTA EJEMPLO NORTE', '02/11/2026 09:12', '', '!Importe peaje: 4,10 EUR', 'Tarjeta ****0000', 'Aut: H10001']),
    # misma fila, a la derecha, con poco hueco horizontal (el caso que funde el corte 1D)
    (1010, 150, 68.00, ['HOTEL PRUEBA CENTRO', 'Factura simpl. 0042', '02/11/2026', 'Base 61,82  IVA 6,18', '!TOTAL  68,00 EUR', 'C.Aut: H10002']),
    (90, 900, 18.50, ['RESTAURANTE INVENTADO LEON', '03/11/2026 14:35', '1 Menu del dia   16,00', '1 Agua            2,50', '!Total  18,50', 'Tarjeta ****0000']),
    (1010, 900, 12.40, ['MENSAJERIA DEMO MADRID', '05/11/2026 12:20', '', 'Envio urgente 24h', '!TOTAL  12,40', 'Aut: H10007']),
    # fila de abajo: dos tickets bajos y anchos, contiguos
    (90, 1650, 5.55, ['AUTOPISTAS DE PRUEBA', 'LEON 08/11/2026 19:20', '!Importe peaje: 5,55 EUR', 'Tarjeta ****0000']),
    (1010, 1650, 7.30, ['CAFETERIA EJEMPLO GIJON', '06/11/2026 08:15', '2 Cafe con leche  3,00', '1 Tostada  4,30', '!TOTAL   7,30']),
]


def _ticket_img(lineas):
    f, fg = ImageFont.truetype(FUENTE, 28), ImageFont.truetype(FUENTE, 38)
    alto = 40 + sum(52 if l.startswith('!') else 40 for l in lineas) + 30
    t = Image.new('RGB', (ANCHO, alto), (255, 255, 255))
    d = ImageDraw.Draw(t)
    d.rectangle((0, 0, t.width - 1, t.height - 1), outline=(205, 205, 205), width=2)
    y = 30
    for l in lineas:
        grande = l.startswith('!')
        d.text((30, y), l.lstrip('!'), font=fg if grande else f, fill=(22, 22, 25))
        y += 52 if grande else 40
    return t


def pinta_hoja():
    """La hoja escaneada (PIL.Image) con los tickets colocados lado a lado."""
    hoja = Image.new('RGB', (W, H), (247, 247, 245))
    for (x, y, _total, lineas) in TICKETS:
        t = _ticket_img(lineas)
        hoja.paste(t, (x, y))
    return hoja


def tickets():
    """Ground truth para la prueba: por ticket, su total y el centro aproximado en la hoja (para comprobar la caja)."""
    out = []
    for (x, y, total, lineas) in TICKETS:
        t = _ticket_img(lineas)
        out.append({'total': total, 'cx': x + t.width // 2, 'cy': y + t.height // 2,
                    'x0': x, 'y0': y, 'x1': x + t.width, 'y1': y + t.height})
    return out


def genera():
    salida = os.path.join(AQUI, 'Tickets lado a lado.pdf')
    pinta_hoja().save(salida, 'PDF', resolution=DPI, title='Tickets lado a lado (ejemplo inventado)')
    print(salida)
    return salida


if __name__ == '__main__':
    genera()
