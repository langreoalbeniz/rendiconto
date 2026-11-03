"""Genera los ejemplos de «varios tickets por página» en otros formatos (todo inventado, como genera_varios.py):

- «Tickets varios por pagina - con texto.pdf»: las mismas 2 hojas, con una capa de texto invisible encima, como la que
  deja un escáner con OCR (PDF «buscable»). El total tapado por la mancha no va en la capa: el escáner tampoco lo lee.
- «Tickets varios - foto.jpg»: 4 tickets sobre una mesa, algo girados (±5°) y con sombra; un dedo tapa una esquina de uno
  (nunca el importe). Se guarda de lado con la orientación EXIF 6, como sale del móvil.
- «Tickets varios - girado.pdf»: las 2 hojas con /Rotate 90. La 1.ª está guardada tumbada y /Rotate la pone derecha
  (lo normal en un escáner); la 2.ª está guardada derecha y /Rotate la tumba (la app tiene que encontrar la orientación).

Uso: python genera_varios_formatos.py
"""
import io
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

sys.dont_write_bytecode = True  # sin __pycache__: el .pyc guarda la ruta del PC y no debe acabar en ejemplo/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import genera_varios as gv  # noqa: E402

AQUI = gv.AQUI
PT = 72 / gv.DPI  # de píxel de la hoja a punto PDF


# ---------- PDF mínimo: páginas con una imagen JPEG y, si se pide, texto invisible (modo 3) ----------
def _esc(s):
    return s.encode('cp1252', 'replace').replace(b'\\', b'\\\\').replace(b'(', b'\\(').replace(b')', b'\\)')


def escribe_pdf(ruta, paginas, titulo):
    """paginas: [{'jpg': bytes, 'px': (w, h), 'caja': (W, H) en puntos, 'rotate': 0|90|180|270, 'texto': [(x, y, tam, escala, s)]}]"""
    objs = []

    def nuevo(contenido):
        objs.append(contenido)
        return len(objs)

    cat, pags, fuente = nuevo(None), nuevo(None), nuevo(b'<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>')
    hijos = []
    for i, p in enumerate(paginas):
        img = nuevo(b'<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n'
                    % (p['px'][0], p['px'][1], len(p['jpg'])) + p['jpg'] + b'\nendstream')
        W, H = p['caja']
        c = b'q %.2f 0 0 %.2f 0 0 cm /Im0 Do Q\n' % (W, H)
        for (x, y, tam, escala, s) in p.get('texto', []):
            c += b'BT 3 Tr /F1 %.2f Tf %.1f Tz 1 0 0 1 %.2f %.2f Tm (' % (tam, escala, x, y) + _esc(s) + b') Tj ET\n'
        cont = nuevo(b'<< /Length %d >>\nstream\n' % len(c) + c + b'\nendstream')
        hijos.append(nuevo(b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.2f %.2f] /Rotate %d /Resources << /XObject << /Im0 %d 0 R >> /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>'
                           % (pags, W, H, p.get('rotate', 0), img, fuente, cont)))
    objs[cat - 1] = b'<< /Type /Catalog /Pages %d 0 R >>' % pags
    objs[pags - 1] = b'<< /Type /Pages /Kids [' + b' '.join(b'%d 0 R' % h for h in hijos) + b'] /Count %d >>' % len(hijos)
    info = nuevo(b'<< /Title (' + _esc(titulo) + b') /Producer (ejemplo inventado) >>')
    out = io.BytesIO(); out.write(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'); pos = []
    for n, o in enumerate(objs, 1):
        pos.append(out.tell()); out.write(b'%d 0 obj\n' % n + o + b'\nendobj\n')
    x = out.tell()
    out.write(b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1) + b''.join(b'%010d 00000 n \n' % q for q in pos))
    out.write(b'trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, cat, info, x))
    with open(ruta, 'wb') as f:
        f.write(out.getvalue())
    print(ruta)


def jpeg(im, calidad=80):
    b = io.BytesIO(); im.save(b, 'JPEG', quality=calidad); return b.getvalue()


# ---------- 1) PDF buscable: hoja escaneada + capa de texto invisible ----------
def con_texto(hojas):
    paginas = []
    for hoja, lineas in hojas:
        texto = []
        for l in lineas:
            if l['tapada']:
                continue  # la mancha tapa el total: el OCR del escáner no lo lee
            tam = l['px'] * PT
            ancho = (l['caja'][2] - l['caja'][0]) * PT
            escala = 100 * ancho / (0.6 * tam * len(l['texto']))  # Courier: 0,6 em por letra
            texto.append((l['x'] * PT, (gv.H - l['base']) * PT, tam, escala, l['texto']))
        paginas.append({'jpg': jpeg(hoja), 'px': hoja.size, 'caja': (gv.W * PT, gv.H * PT), 'texto': texto})
    escribe_pdf(os.path.join(AQUI, 'Tickets varios por pagina - con texto.pdf'), paginas, 'Tickets varios por pagina, con capa de texto (ejemplo inventado)')


# ---------- 2) foto de 4 tickets sobre la mesa ----------
FOTO = [  # (ticket de PAGINAS: hoja, n.º), posición, giro
    ((0, 0), (260, 230), 4.0),     # autopista 4,10
    ((0, 1), (1560, 170), -5.0),   # hotel 68,00 (con el dedo en la esquina de arriba a la izquierda)
    ((0, 4), (300, 1250), -3.0),   # gasolinera 61,27
    ((1, 2), (1600, 1300), 5.0),   # mensajería 12,40
]


def foto():
    rnd = random.Random(16)
    Wf, Hf = 2800, 2100
    mesa = Image.new('RGB', (Wf, Hf), (150, 112, 78))
    d = ImageDraw.Draw(mesa)
    for y in range(0, Hf, 3):  # vetas de madera
        v = int(18 * ((y * 0.013) % 1) - 9 + rnd.randint(-6, 6))
        d.line([(0, y), (Wf, y + rnd.randint(-8, 8))], fill=(150 + v, 112 + v, 78 + v // 2), width=3)
    mesa = mesa.filter(ImageFilter.GaussianBlur(1.5))
    for (pag, n), (x, y), giro in FOTO:
        _, _, _, lineas, mancha = gv.PAGINAS[pag][n]
        t0 = gv.ticket(lineas, mancha)
        t = t0.resize((800, int(t0.height * 800 / t0.width)), Image.LANCZOS).rotate(giro, resample=Image.BICUBIC, expand=True, fillcolor=(0, 0, 0, 0))
        sombra = Image.new('RGBA', t.size, (0, 0, 0, 0)); sombra.putalpha(t.getchannel('A').point(lambda a: 110 if a else 0))
        sombra = sombra.filter(ImageFilter.GaussianBlur(14))
        mesa.paste((30, 22, 15), (x + 22, y + 26), sombra)
        mesa.paste(t, (x, y), t)
    # el dedo: una forma color piel sobre la esquina de arriba a la izquierda del ticket del hotel (lejos del total)
    dedo = Image.new('RGBA', (Wf, Hf), (0, 0, 0, 0)); dd = ImageDraw.Draw(dedo)
    dd.rounded_rectangle((1330, 120, 1690, 330), radius=105, fill=(224, 172, 140, 255))
    dd.ellipse((1545, 150, 1680, 300), fill=(236, 190, 165, 255))  # la uña
    mesa.paste(dedo, (0, 0), dedo.filter(ImageFilter.GaussianBlur(3)))
    luz = Image.radial_gradient('L').resize((Wf, Hf)).point(lambda v: 255 - v // 4)  # algo más oscuro en los bordes
    mesa = Image.composite(mesa, Image.new('RGB', (Wf, Hf), (60, 45, 30)), luz).filter(ImageFilter.GaussianBlur(0.8))
    # el móvil guarda la foto de lado y la marca con la orientación EXIF 6 (girar 90° a la derecha para verla)
    exif = Image.Exif(); exif[0x0112] = 6; exif[0x010F] = 'Ejemplo'; exif[0x0110] = 'Movil de prueba'
    ruta = os.path.join(AQUI, 'Tickets varios - foto.jpg')
    mesa.rotate(90, expand=True).save(ruta, 'JPEG', quality=86, exif=exif.tobytes())
    print(ruta)


# ---------- 3) PDF con /Rotate 90 ----------
def girado(hojas):
    h1, h2 = hojas[0][0], hojas[1][0]
    tumbada = h1.rotate(90, expand=True)  # guardada tumbada (antihorario); /Rotate 90 (horario) la pone derecha
    paginas = [{'jpg': jpeg(tumbada), 'px': tumbada.size, 'caja': (gv.H * PT, gv.W * PT), 'rotate': 90},
               {'jpg': jpeg(h2), 'px': h2.size, 'caja': (gv.W * PT, gv.H * PT), 'rotate': 90}]  # derecha: /Rotate la tumba
    escribe_pdf(os.path.join(AQUI, 'Tickets varios - girado.pdf'), paginas, 'Tickets varios, paginas giradas (ejemplo inventado)')


if __name__ == '__main__':
    hs = gv.pinta_hojas()
    con_texto(hs)
    foto()
    girado(hs)
