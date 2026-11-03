"""Genera capturas de pantalla inventadas para probar la app (sin marcas reales: «ParkApp», «Hotel Ejemplo»…).

- parking-claro.png: recibo de una app de parking, iPhone 1179×2556, modo claro. La hora de la barra de estado (18:52)
  no es la del recibo (10:01).
- parking-oscuro.png: el mismo recibo en modo oscuro (dos capturas del mismo gasto).
- hotel-correo-pc.png: correo de confirmación de un hotel, captura de PC 1920×1080, con la fecha y la hora de la barra
  de tareas (que no son las del gasto).
- historial-parkapp.png: historial de la app con 3 operaciones (dos con tarjeta y una con dinero electrónico, que no es un
  cargo en la tarjeta).
- compra-larga.png: captura larga (1179×6000) de un pedido en una web, con el total al final.

Los importes casan con el desglose de ejemplo: parkings 2,65 € (Mov. 5 y 6), hotel 68,00 € (Mov. 2) y copistería 3,20 €
(Mov. 10). El desglose no cambia: sigue sumando 185,62 €.
Uso: python ejemplo/capturas/genera_capturas.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

AQUI = os.path.dirname(os.path.abspath(__file__))
F, FB = 'C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/segoeuib.ttf'


def fuente(t, negrita=False):
    return ImageFont.truetype(FB if negrita else F, t)


# ---------- iPhone ----------
def barra_estado(d, w, hora, claro):
    c = (0, 0, 0) if claro else (255, 255, 255)
    d.text((130, 52), hora, font=fuente(50, True), fill=c)
    x = w - 330  # cobertura, wifi y batería
    for i in range(4):
        d.rectangle((x + i * 26, 92 - i * 12, x + i * 26 + 16, 104), fill=c)
    d.pieslice((x + 120, 62, x + 180, 122), 225, 315, fill=c)
    d.rounded_rectangle((x + 200, 66, x + 290, 104), radius=10, outline=c, width=4)
    d.rounded_rectangle((x + 208, 74, x + 270, 96), radius=5, fill=c)


def movil(nombre, hora_barra, bloques, claro=True, alto=2556, w=1179):
    fondo, tarjeta = ((242, 242, 247), (255, 255, 255)) if claro else ((0, 0, 0), (28, 28, 30))
    texto, gris, acento = ((0, 0, 0), (110, 110, 115), (0, 105, 220)) if claro else ((255, 255, 255), (152, 152, 157), (64, 156, 255))
    im = Image.new('RGB', (w, alto), fondo); d = ImageDraw.Draw(im)
    barra_estado(d, w, hora_barra, claro)
    y = 230
    for b in bloques:
        if b[0] == 'titulo':
            d.text((70, y), b[1], font=fuente(84, True), fill=texto); y += 130
        elif b[0] == 'sub':
            d.text((70, y), b[1], font=fuente(52), fill=gris); y += 110
        elif b[0] == 'hueco':
            y += b[1]
        elif b[0] == 'tarjeta':
            lineas = b[1]; h = 60 + sum(96 if g else 76 for _, g in lineas)
            d.rounded_rectangle((50, y, w - 50, y + h), radius=36, fill=tarjeta)
            yy = y + 36
            for s, g in lineas:
                d.text((100, yy), s, font=fuente(60 if g else 50, g), fill=acento if g == 'acento' else texto)
                yy += 96 if g else 76
            y += h + 40
    d.rounded_rectangle((w // 2 - 200, alto - 40, w // 2 + 200, alto - 26), radius=7, fill=texto)  # barra de inicio
    im.save(os.path.join(AQUI, nombre), optimize=True)
    print(nombre, im.size)


RECIBO = [('titulo', 'ParkApp'), ('sub', 'Recibo de pago'),
          ('tarjeta', [('Parking Ficticio Vigo', True), ('Fecha: 04/11/2026', None), ('Entrada 08:12  ·  Salida 10:01', None),
                       ('Duración 1 h 49 min', None)]),
          ('tarjeta', [('Importe pagado: 2,65 €', 'acento'), ('Tarjeta ****0000', None), ('Autorización: H10005', None)]),
          ('sub', 'Gracias por usar ParkApp')]

HISTORIAL = [('titulo', 'ParkApp'), ('sub', 'Historial de pagos'),
             ('tarjeta', [('Parking Ficticio Vigo', True), ('04/11/2026  17:40', None), ('Importe pagado: 2,65 €', 'acento'), ('Tarjeta ****0000 · Aut. H10006', None)]),
             ('hueco', 260),
             ('tarjeta', [('Parking Ficticio Vigo', True), ('04/11/2026  10:01', None), ('Importe pagado: 2,65 €', 'acento'), ('Tarjeta ****0000 · Aut. H10005', None)]),
             ('hueco', 260),
             ('tarjeta', [('Parking Centro Ejemplo', True), ('06/11/2026  09:30', None), ('Dinero electrónico: 1,90 €', None), ('Saldo restante 12,10 €', None)])]


def compra_larga():
    w, alto = 1179, 6000
    im = Image.new('RGB', (w, alto), (255, 255, 255)); d = ImageDraw.Draw(im)
    barra_estado(d, w, '21:07', True)
    d.rectangle((0, 170, w, 300), fill=(245, 245, 245)); d.text((70, 200), 'copisteria-demo.test', font=fuente(48), fill=(90, 90, 90))
    y = 380
    d.text((70, y), 'Copistería Demo', font=fuente(84, True), fill=(0, 0, 0)); y += 140
    d.text((70, y), 'Tu pedido online', font=fuente(56), fill=(90, 90, 90)); y += 160
    for i in range(1, 21):
        d.text((70, y), f'Copia B/N A4, hoja {i}', font=fuente(48), fill=(0, 0, 0)); d.text((w - 260, y), '0,10 €', font=fuente(48), fill=(0, 0, 0)); y += 110
    d.text((70, y), 'Encuadernación espiral', font=fuente(48), fill=(0, 0, 0)); d.text((w - 260, y), '1,20 €', font=fuente(48), fill=(0, 0, 0)); y += 220
    for p in ['Recogida en tienda: calle Inventada 1, Oviedo.', 'Horario: de lunes a viernes, de 9 a 20.',
              'Conserva este resguardo hasta recoger el pedido.', 'Preguntas frecuentes', '¿Puedo cambiar el pedido?',
              'Sí, hasta que empiece la impresión.', '¿Hacéis factura?', 'Sí, pídela en la tienda con este resguardo.']:
        d.text((70, y), p, font=fuente(46), fill=(60, 60, 60)); y += 150
    y = max(y + 300, 5100)
    d.line((70, y, w - 70, y), fill=(200, 200, 200), width=3); y += 60
    d.text((70, y), 'Fecha del pedido: 09/11/2026', font=fuente(50), fill=(0, 0, 0)); y += 110
    d.text((70, y), 'Total pagado: 3,20 €', font=fuente(64, True), fill=(0, 0, 0)); y += 120
    d.text((70, y), 'Pago con tarjeta ****0000', font=fuente(50), fill=(0, 0, 0))
    im.save(os.path.join(AQUI, 'compra-larga.png'), optimize=True)
    print('compra-larga.png', im.size)


def hotel_pc():
    w, alto = 1920, 1080
    im = Image.new('RGB', (w, alto), (243, 243, 243)); d = ImageDraw.Draw(im)
    d.rectangle((0, 0, w, 40), fill=(32, 32, 32)); d.text((16, 9), 'Correo', font=fuente(17), fill=(230, 230, 230))
    d.rectangle((0, 40, 300, alto - 48), fill=(232, 232, 232))
    for i, s in enumerate(['Bandeja de entrada', 'Enviados', 'Borradores', 'Archivo']):
        d.text((24, 70 + i * 44), s, font=fuente(18), fill=(40, 40, 40))
    d.rectangle((300, 40, 780, alto - 48), fill=(250, 250, 250))
    for i, (de, asunto) in enumerate([('Hotel Ejemplo', 'Confirmación de su reserva'), ('Boletín', 'Novedades de noviembre')]):
        d.text((320, 64 + i * 90), de, font=fuente(18, True), fill=(20, 20, 20)); d.text((320, 92 + i * 90), asunto, font=fuente(17), fill=(80, 80, 80))
    x, y = 820, 70
    d.text((x, y), 'Confirmación de su reserva', font=fuente(30, True), fill=(20, 20, 20)); y += 56
    d.text((x, y), 'De: Hotel Ejemplo (reservas)', font=fuente(18), fill=(90, 90, 90)); y += 60
    for s, b in [('Hotel Ejemplo · Oviedo', True), ('Entrada: 02/11/2026   Salida: 03/11/2026', False), ('1 noche · Habitación doble', False),
                 ('Localizador: EJ-2026-0042', False), ('', False), ('Total cargado en su tarjeta: 68,00 €', True), ('Tarjeta ****0000', False),
                 ('', False), ('Gracias por su reserva. Le esperamos.', False)]:
        d.text((x, y), s, font=fuente(22, b), fill=(20, 20, 20)); y += 40
    d.rectangle((0, alto - 48, w, alto), fill=(225, 230, 240))  # barra de tareas con su fecha y hora
    d.text((w - 120, alto - 44), '9:15', font=fuente(16), fill=(20, 20, 20)); d.text((w - 140, alto - 24), '05/11/2026', font=fuente(16), fill=(20, 20, 20))
    im.save(os.path.join(AQUI, 'hotel-correo-pc.png'), optimize=True)
    print('hotel-correo-pc.png', im.size)


if __name__ == '__main__':
    movil('parking-claro.png', '18:52', RECIBO, claro=True)
    movil('parking-oscuro.png', '18:53', RECIBO, claro=False)
    hotel_pc()
    movil('historial-parkapp.png', '12:03', HISTORIAL, claro=True)
    compra_larga()
