"""Genera los datos de ejemplo INVENTADOS de ejemplo/: «Desglose de ejemplo.pdf» (un desglose escaneado de 10 movimientos
que suma 185,62 €) y «Foto ticket copisteria.jpg». Es el script con el que se hicieron en el chat (3/11/2026).

Uso: python genera_desglose_y_copisteria.py
Usa DejaVu si está instalada (Linux); si no, Verdana y Consolas de Windows: el resultado es equivalente, no idéntico.
"""
import os
import random
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageFilter
OUT=os.path.dirname(os.path.abspath(__file__))+os.sep
def fuente(*nombres):
    for n in nombres:
        for d in ('/usr/share/fonts/truetype/dejavu/', 'C:/Windows/Fonts/'):
            if os.path.exists(d + n):
                return d + n
    raise SystemExit('Falta la fuente ' + nombres[0])
FS, FB, FM = fuente('DejaVuSans.ttf', 'verdana.ttf'), fuente('DejaVuSans-Bold.ttf', 'verdanab.ttf'), fuente('DejaVuSansMono.ttf', 'consola.ttf')
sans=lambda s: ImageFont.truetype(FS, s); bold=lambda s: ImageFont.truetype(FB, s)
mono=lambda s: ImageFont.truetype(FM, s)
random.seed(7)
# movimientos inventados: (reg, ref, desc, op, importe)
M=[('03.11.26','H10001','Pagamento Contactless AUTOPISTA EJEMPLO NORTE','02.11.26','4,10'),
   ('03.11.26','H10002','Pagamento Contactless HOTEL PRUEBA CENTRO OVIEDO','02.11.26','68,00'),
   ('04.11.26','H10003','Pagamento Contactless RESTAURANTE INVENTADO LEON','03.11.26','18,50'),
   ('04.11.26','H10004','Acquisto Carburante ESTACION DEMO SL BURGOS','03.11.26','61,27'),
   ('05.11.26','H10005','Pagamento Contactless PARKING FICTICIO VIGO','04.11.26','2,65'),
   ('05.11.26','H10006','Pagamento Contactless PARKING FICTICIO VIGO','04.11.26','2,65'),
   ('06.11.26','H10007','Pagamento E-Commerce MENSAJERIA DEMO Madrid','05.11.26','12,40'),
   ('07.11.26','H10008','Pagamento Contactless CAFETERIA EJEMPLO GIJON','06.11.26','7,30'),
   ('10.11.26','','Pagamento AUTOPISTAS DE PRUEBA LEON','08.11.26','5,55'),
   ('10.11.26','H10010','Pagamento Contactless COPISTERIA DEMO OVIEDO','09.11.26','3,20')]
tot=sum(float(x[4].replace(',','.')) for x in M)
W,H=2480,3508; im=Image.new('RGB',(W,H),'white'); d=ImageDraw.Draw(im)
d.text((240,180),'DESGLOSE DE EJEMPLO (datos inventados)',font=bold(54),fill='black')
d.text((240,260),'Numero carta: **** **** **** 0000     Intestata a: TITOLARE DI PROVA',font=sans(36),fill='black')
xs=[244,468,690,1514,1750,1898,2076,2282]; y=420; rowh=104
def grid_row(y0,y1):
    d.line([(xs[0],y0),(xs[-1],y0)],fill='black',width=3); d.line([(xs[0],y1),(xs[-1],y1)],fill='black',width=3)
    for x in xs: d.line([(x,y0),(x,y1)],fill='black',width=3)
heads=['Data\nRegistrazione','Riferimento\nOperazione','Descrizione','Importo in\ndivisa estera','Divisa','Cambio','Importo\nin Euro']
grid_row(y,y+110)
for i,h in enumerate(heads): d.multiline_text((xs[i]+12,y+12),h,font=bold(34),fill='black',spacing=2)
y+=110
for i,(reg,ref,desc,op,imp) in enumerate(M):
    if i%2==0: d.rectangle([xs[0],y,xs[-1],y+rowh],fill=(236,240,246))
    grid_row(y,y+rowh)
    d.text((xs[0]+40,y+32),reg,font=sans(38),fill='black'); d.text((xs[1]+50,y+32),ref,font=sans(38),fill='black')
    words=(desc+' '+op).split(); l1=''; 
    while words and d.textlength(l1+words[0]+' ',font=sans(36))<800: l1+=words.pop(0)+' '
    d.text((xs[2]+10,y+8),l1.strip(),font=sans(36),fill='black'); d.text((xs[2]+10,y+52),' '.join(words),font=sans(36),fill='black')
    w=d.textlength(imp,font=sans(38)); d.text((xs[7]-14-w,y+32),imp,font=sans(38),fill='black')
    y+=rowh
d.line([(xs[0],y),(xs[-1],y)],fill='black',width=3); d.line([(xs[0],y+66),(xs[-1],y+66)],fill='black',width=3)
d.line([(xs[0],y),(xs[0],y+66)],fill='black',width=3); d.line([(xs[-1],y),(xs[-1],y+66)],fill='black',width=3); d.line([(xs[6],y),(xs[6],y+66)],fill='black',width=3)
d.text((xs[0]+12,y+12),'Totale',font=bold(38),fill='black'); ts=f"{tot:,.2f}".replace(',','X').replace('.',',').replace('X','.')
w=d.textlength(ts,font=bold(38)); d.text((xs[7]-14-w,y+12),ts,font=bold(38),fill='black')
# fosforito amarillo sobre el combustible, como en los desgloses reales
ov=Image.new('RGB',(W,H),'white'); od=ImageDraw.Draw(ov); yy=420+110+3*rowh; od.rectangle([xs[2]+5,yy+10,xs[2]+420,yy+50],fill=(255,240,60)); od.rectangle([xs[6]+60,yy+25,xs[7]-5,yy+80],fill=(255,240,60))
im=ImageChops.darker(im,ov)  # el fosforito queda debajo del texto: mínimo píxel a píxel
im=im.rotate(0.15,expand=False,fillcolor='white').filter(ImageFilter.GaussianBlur(0.3))
im.save(OUT+'Desglose de ejemplo.pdf',resolution=300)
print('total',tot)
# ---------- tickets ----------
def ticket(lines,width=560):
    f=mono(30); h=60+len(lines)*44
    t=Image.new('RGB',(width,h),(255,255,255)); td=ImageDraw.Draw(t)
    for i,l in enumerate(lines):
        if isinstance(l,tuple): td.text((24,30+i*44),l[0],font=mono(38) if l[1]=='big' else f,fill='black')
        else: td.text((24,30+i*44),l,font=f,fill='black')
    return t
# foto suelta de la copisteria (movimiento 10), simulando una foto de movil
f=ticket(['COPISTERIA DEMO','OVIEDO','09/11/2026','20 copias color',('TOTAL  3,20 EUR','big'),'AUT H10010'],600)
ph=Image.new('RGB',(1200,1500),(196,190,182)); ph.paste(f.rotate(2,expand=True,fillcolor=(196,190,182)),(280,330)); ph=ph.filter(ImageFilter.GaussianBlur(1))
ph.save(OUT+'Foto ticket copisteria.jpg',quality=88)
print('ok')
