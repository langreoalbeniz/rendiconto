"""Genera las fotos sintéticas de ejemplo (tickets inventados) en ejemplo/fotos/.

Fotos de móvil simuladas: ticket girado sobre madera o fondo oscuro, a veces con una «mano» tapando un borde.
Todo inventado: comercios ficticios y tarjeta ****0000. Uso: python genera_fotos.py
"""
import math
import os
import random

from PIL import ExifTags, Image, ImageDraw, ImageFilter, ImageFont

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.join(AQUI, 'fotos')
FUENTE = 'C:/Windows/Fonts/consola.ttf'
W, H = 1500, 2000

# nombre, fondo, giro, mano, fecha EXIF, líneas del ticket (la que empieza por «!» va en grande)
FOTOS = [
    ('foto-hotel.jpg', 'madera', 4, None, None, [
        'HOTEL PRUEBA CENTRO', 'C/ Inventada 1 - Oviedo', 'Factura simplificada 0042', '02/11/2026 09:40', '',
        '1 noche hab. individual', 'Base 61,82  IVA 10% 6,18', '!TOTAL  68,00 EUR', '', 'Tarjeta ************0000', 'C.Autorizacion: H10002']),
    ('foto-restaurante.jpg', 'oscuro', -6, 'izquierda', None, [
        'RESTAURANTE INVENTADO', 'LEON', '03/11/2026 14:35', '', '1 Menu del dia   16,00', '1 Agua            2,50', '',
        '!Total  18,50', 'Tarjeta ****0000', 'Aut: H10003']),
    ('foto-gasolinera.jpg', 'madera', 7, None, '2026:11:03 18:02:11', [
        'ESTACION DEMO SL', 'BURGOS', '', 'Diesel  40,85 l x 1,500', '', '!Total tarjeta: 61,27', '', 'Tarjeta ****0000', 'N. Autor: H10004']),
    ('foto-parking.jpg', 'oscuro', -3, 'abajo', None, [
        'PARKING FICTICIO VIGO', '04/11/2026 10:01', '', 'Entrada 08:12', 'Salida  10:01', '', '!Importe: 2,65 EUR', 'Tarjeta ****0000', 'Aut. H10005']),
    ('foto-mensajeria.jpg', 'oscuro', 5, None, None, [
        'MENSAJERIA DEMO', 'Madrid', '05/11/2026 12:20', '', 'Envio urgente 24h', '', '!TOTAL  12,40', 'Tarjeta ****0000', 'Aut: H10007']),
    ('foto-cafeteria.jpg', 'madera', -8, None, None, [
        'CAFETERIA EJEMPLO', 'GIJON', '', '2 Cafe con leche  3,00', '1 Tostada         4,30', '', '!TOTAL  7,30']),
    ('foto-bar.jpg', 'madera', 3, None, None, [
        'BAR INVENTADO EL RINCON', '07/11/2026 21:05', '', '3 Canas            7,50', '1 Racion           2,40', '', '!TOTAL  9,90', 'Tarjeta ****0000']),
]


def fondo(tipo, rnd):
    img = Image.new('RGB', (W, H))
    px = img.load()
    if tipo == 'madera':
        fase = [rnd.uniform(0, 6.28) for _ in range(3)]
        for y in range(H):
            for x in range(0, W):
                v = math.sin(x / 23.0 + 3 * math.sin(y / 180.0 + fase[0])) * 0.5 + math.sin(x / 7.0 + fase[1]) * 0.15
                r = int(150 + 28 * v + rnd.randint(-6, 6))
                px[x, y] = (r, int(r * 0.66), int(r * 0.40))
    else:
        for y in range(H):
            for x in range(W):
                n = rnd.randint(-7, 7)
                px[x, y] = (38 + n, 39 + n, 44 + n)
    return img


def ticket(lineas):
    f = ImageFont.truetype(FUENTE, 36)
    fg = ImageFont.truetype(FUENTE, 52)
    alto = 90 + sum(70 if l.startswith('!') else 48 for l in lineas) + 70
    t = Image.new('RGBA', (720, alto), (246, 244, 236, 255))
    d = ImageDraw.Draw(t)
    y = 60
    for l in lineas:
        if l.startswith('!'):
            d.text((50, y), l[1:], font=fg, fill=(20, 20, 24, 255)); y += 70
        else:
            d.text((50, y), l, font=f, fill=(35, 35, 40, 255)); y += 48
    return t


def mano(img, donde, caja):
    d = ImageDraw.Draw(img)
    piel, sombra = (221, 170, 138), (190, 140, 110)
    x0, y0, x1, y1 = caja
    if donde == 'izquierda':
        cy = (y0 + y1) // 2
        d.ellipse((x0 - 420, cy - 120, x0 + 40, cy + 330), fill=piel)
        for i, dy in enumerate((-60, 20, 100)):
            d.rounded_rectangle((x0 - 60, cy + dy, x0 + 95 - i * 8, cy + dy + 62), radius=30, fill=piel, outline=sombra, width=3)
    else:
        cx = (x0 + x1) // 2
        d.ellipse((cx - 260, y1 - 30, cx + 240, H + 200), fill=piel)
        d.rounded_rectangle((cx - 40, y1 - 120, cx + 30, y1 + 40), radius=33, fill=piel, outline=sombra, width=3)


def genera():
    os.makedirs(SALIDA, exist_ok=True)
    for i, (nombre, tipo, giro, donde, exif, lineas) in enumerate(FOTOS):
        rnd = random.Random(100 + i)
        img = fondo(tipo, rnd)
        t = ticket(lineas).rotate(giro, resample=Image.BICUBIC, expand=True)
        x, y = (W - t.width) // 2 + rnd.randint(-80, 80), (H - t.height) // 2 + rnd.randint(-80, 80)
        sombra = Image.new('RGBA', t.size, (0, 0, 0, 0))
        sombra.putalpha(t.getchannel('A').point(lambda a: 110 if a else 0))
        img.paste((0, 0, 0), (x + 14, y + 18), sombra.filter(ImageFilter.GaussianBlur(10)).getchannel('A'))
        img.paste(t, (x, y), t)
        if donde:
            mano(img, donde, (x, y, x + t.width, y + t.height))
        # luz desigual, como en una foto de móvil
        luz = Image.linear_gradient('L').resize((W, H)).point(lambda v: 255 - v // 5)
        img = Image.composite(img, Image.new('RGB', (W, H), (0, 0, 0)), luz).filter(ImageFilter.GaussianBlur(0.8))
        kw = {'quality': 82}
        if exif:
            e = Image.Exif()
            e.get_ifd(ExifTags.IFD.Exif)[ExifTags.Base.DateTimeOriginal] = exif
            kw['exif'] = e
        img.save(os.path.join(SALIDA, nombre), **kw)
        print(nombre)


if __name__ == '__main__':
    genera()
