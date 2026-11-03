"""Genera ejemplo/Tickets varios por pagina.pdf: un «escaneo» inventado de 2 páginas A4 con 5 tickets cada una.

Casos de prueba: dos tickets muy juntos, uno algo solapado sobre otro, un importe (18,50) que en otro ticket de la
misma página sale como subtotal, dos parkings de 2,65 € del mismo día sin código (la pregunta de seguridad) y una
cafetería con el total tapado por una mancha gris (la etiqueta a mano). Comercios ficticios y tarjeta ****0000.
Uso: python genera_varios.py
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

AQUI = os.path.dirname(os.path.abspath(__file__))
FUENTE = 'C:/Windows/Fonts/consola.ttf'
DPI = 200
W, H = 1654, 2339  # A4 a 200 ppp

# (x, y, giro, líneas, mancha sobre la línea n.º) — la línea que empieza por «!» va en grande
PAGINAS = [
    [
        (110, 140, 0.8, ['AUTOPISTA EJEMPLO NORTE', '02/11/2026 09:12', '', 'Importe peaje: 4,10 EUR', 'Tarjeta ****0000', 'Aut: H10001'], None),
        (880, 120, -0.6, ['HOTEL PRUEBA CENTRO', 'Factura simpl. 0042', '02/11/2026', '', 'Base 61,82  IVA 6,18', '!TOTAL  68,00 EUR', 'C.Autorizacion: H10002'], None),
        (110, 820, -0.4, ['RESTAURANTE INVENTADO LEON', '03/11/2026 14:35', '', '1 Menu del dia   16,00', '1 Agua            2,50', '!Total  18,50', 'Tarjeta ****0000'], None),
        # muy junto al restaurante: el 18,50 sale aquí como subtotal
        (110, 1245, 0.5, ['BAR DE PRUEBA EL CRUCE', '03/11/2026 23:10', '', 'Subtotal 18,50', 'Propina   1,50', '!TOTAL  20,00', 'Tarjeta ****0000'], None),
        # algo solapado sobre el del hotel
        (900, 500, 1.2, ['ESTACION DEMO SL', 'BURGOS 03/11/2026 18:02', '', 'Diesel 40,85 l x 1,500', '!Total tarjeta: 61,27', 'N. Autor: H10004'], None),
    ],
    [
        (110, 140, -0.7, ['PARKING FICTICIO VIGO', '04/11/2026 10:01', '', 'Entrada 08:12', '!Importe: 2,65 EUR', 'Tarjeta ****0000'], None),
        (880, 160, 0.6, ['PARKING FICTICIO VIGO', '04/11/2026 17:40', '', 'Entrada 15:02', '!Importe: 2,65 EUR', 'Tarjeta ****0000'], None),
        (110, 860, 0.3, ['MENSAJERIA DEMO MADRID', '05/11/2026 12:20', '', 'Envio urgente 24h', '!TOTAL  12,40', 'Aut: H10007'], None),
        (880, 880, -0.9, ['CAFETERIA EJEMPLO GIJON', '06/11/2026 08:15', '', '2 Cafe con leche  3,00', '1 Tostada         4,30', '!TOTAL   7,30'], 5),
        (110, 1520, 0.4, ['AUTOPISTAS DE PRUEBA', 'LEON 08/11/2026 19:20', '', 'Importe peaje: 5,55 EUR'], None),
    ],
]


def ticket(lineas, mancha):
    f, fg = ImageFont.truetype(FUENTE, 30), ImageFont.truetype(FUENTE, 40)
    alto = 60 + sum(56 if l.startswith('!') else 42 for l in lineas) + 40
    t = Image.new('RGBA', (640, alto), (255, 255, 255, 255))
    d = ImageDraw.Draw(t)
    d.rectangle((0, 0, t.width - 1, t.height - 1), outline=(200, 200, 200, 255), width=2)
    y = 40
    for i, l in enumerate(lineas):
        grande = l.startswith('!')
        d.text((36, y), l.lstrip('!'), font=fg if grande else f, fill=(25, 25, 28, 255))
        if mancha == i:  # mancha gris de rotulador sobre el importe
            d.rounded_rectangle((250, y - 8, 470, y + 52), radius=18, fill=(110, 110, 112, 255))
        y += 56 if grande else 42
    return t


def lineas_ticket(lineas, mancha):
    """Posición de cada línea dentro del ticket (sin girar): texto, caja [x0, y0, x1, y1], base, tamaño y si va tapada."""
    f, fg = ImageFont.truetype(FUENTE, 30), ImageFont.truetype(FUENTE, 40)
    out, y = [], 40
    for i, l in enumerate(lineas):
        grande = l.startswith('!')
        fu, txt = (fg if grande else f), l.lstrip('!')
        if txt:
            b = fu.getbbox(txt)
            out.append({'texto': txt, 'caja': [36 + b[0], y + b[1], 36 + b[2], y + b[3]], 'base': y + fu.getmetrics()[0], 'px': fu.size, 'tapada': mancha == i})
        y += 56 if grande else 42
    return out


def gira_punto(px, py, w, h, giro):
    """Dónde cae (px, py) de una imagen w×h tras Image.rotate(giro, expand=True) (giro antihorario, en grados)."""
    a = math.radians(giro)
    nw = abs(w * math.cos(a)) + abs(h * math.sin(a)); nh = abs(w * math.sin(a)) + abs(h * math.cos(a))
    dx, dy = px - w / 2, py - h / 2
    return nw / 2 + dx * math.cos(a) + dy * math.sin(a), nh / 2 - dx * math.sin(a) + dy * math.cos(a)


def pinta_hojas():
    """Las hojas escaneadas (imágenes) y, para cada una, sus líneas de texto con la posición en la hoja."""
    hojas = []
    for n, tickets in enumerate(PAGINAS):
        rnd = random.Random(7 + n)
        hoja = Image.new('RGB', (W, H), (246, 246, 244))
        lineas_hoja = []
        for (x, y, giro, lineas, mancha) in tickets:
            t0 = ticket(lineas, mancha)
            t = t0.rotate(giro, resample=Image.BICUBIC, expand=True, fillcolor=(0, 0, 0, 0))
            hoja.paste(t, (x, y), t)
            for l in lineas_ticket(lineas, mancha):
                c = l['caja']
                esq = [gira_punto(px, py, t0.width, t0.height, giro) for px, py in ((c[0], c[1]), (c[2], c[1]), (c[0], c[3]), (c[2], c[3]))]
                bx, by = gira_punto(c[0], l['base'], t0.width, t0.height, giro)
                lineas_hoja.append(dict(l, caja=[x + min(p[0] for p in esq), y + min(p[1] for p in esq), x + max(p[0] for p in esq), y + max(p[1] for p in esq)], base=y + by, x=x + bx))
        # ruido de escáner
        px = hoja.load()
        for _ in range(60000):
            i, j = rnd.randrange(W), rnd.randrange(H)
            v = rnd.randint(-18, 4)
            r, g, b = px[i, j]
            px[i, j] = (max(0, r + v), max(0, g + v), max(0, b + v))
        hojas.append((hoja.filter(ImageFilter.GaussianBlur(0.6)), lineas_hoja))
    return hojas


def genera():
    hojas = [h for h, _ in pinta_hojas()]
    salida = os.path.join(AQUI, 'Tickets varios por pagina.pdf')
    hojas[0].save(salida, 'PDF', resolution=DPI, save_all=True, append_images=hojas[1:], quality=80, title='Tickets varios por pagina (ejemplo inventado)')
    print(salida)


if __name__ == '__main__':
    genera()
