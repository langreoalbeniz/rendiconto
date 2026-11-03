"""Genera ejemplo/Tickets varios por pagina.pdf: un «escaneo» inventado de 2 páginas A4 con 5 tickets cada una.

Casos de prueba: dos tickets muy juntos, uno algo solapado sobre otro, un importe (18,50) que en otro ticket de la
misma página sale como subtotal, dos parkings de 2,65 € del mismo día sin código (la pregunta de seguridad) y una
cafetería con el total tapado por una mancha gris (la etiqueta a mano). Comercios ficticios y tarjeta ****0000.
Uso: python genera_varios.py
"""
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


def genera():
    hojas = []
    for n, tickets in enumerate(PAGINAS):
        rnd = random.Random(7 + n)
        hoja = Image.new('RGB', (W, H), (246, 246, 244))
        for (x, y, giro, lineas, mancha) in tickets:
            t = ticket(lineas, mancha).rotate(giro, resample=Image.BICUBIC, expand=True, fillcolor=(0, 0, 0, 0))
            hoja.paste(t, (x, y), t)
        # ruido de escáner
        px = hoja.load()
        for _ in range(60000):
            i, j = rnd.randrange(W), rnd.randrange(H)
            v = rnd.randint(-18, 4)
            r, g, b = px[i, j]
            px[i, j] = (max(0, r + v), max(0, g + v), max(0, b + v))
        hojas.append(hoja.filter(ImageFilter.GaussianBlur(0.6)))
    salida = os.path.join(AQUI, 'Tickets varios por pagina.pdf')
    hojas[0].save(salida, 'PDF', resolution=DPI, save_all=True, append_images=hojas[1:], quality=80, title='Tickets varios por pagina (ejemplo inventado)')
    print(salida)


if __name__ == '__main__':
    genera()
