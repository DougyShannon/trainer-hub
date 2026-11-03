# Draws the PLACEHOLDER pixel-art battle sprites for Frenko's Pokémon (64 x 64, GBA size) from
# simple shapes, based on Dougy's pictures. Run with: python3 scripts/frenko-draw-pokemon.py
# (needs Pillow). It writes the PNGs into public/art/frenko/pokemon/. Milton's real art replaces these.

import math
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "art", "frenko", "pokemon")
S=64
def new(): 
    im=Image.new('RGBA',(S,S),(0,0,0,0)); return im, ImageDraw.Draw(im)
def blob(d,cx,cy,rx,ry,base,shade,light,outline,ring=True):
    if ring: d.ellipse([cx-rx-1,cy-ry-1,cx+rx+1,cy+ry+1],fill=outline)
    d.ellipse([cx-rx,cy-ry,cx+rx,cy+ry],fill=shade)
    d.ellipse([cx-rx,cy-ry,cx+rx-2,cy+ry-3],fill=base)
    hx,hy=cx-rx//2,cy-ry//2
    d.ellipse([hx-rx//4,hy-ry//5,hx+rx//4,hy+ry//5],fill=light)
def tri(d,pts,fill,outline):
    # outline by drawing polygon slightly bigger is awkward; draw then outline pass handles outer edge
    d.polygon(pts,fill=fill,outline=outline)
def outline_pass(im,col):
    px=im.load(); w,h=im.size
    add=[]
    for y in range(h):
        for x in range(w):
            if px[x,y][3]==0:
                for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    X,Y=x+dx,y+dy
                    if 0<=X<w and 0<=Y<h and px[X,Y][3]>0: add.append((x,y)); break
    for x,y in add: px[x,y]=col
    return im
def save(im,name):
    outline_pass(im,(32,40,48,255))
    im.save(os.path.join(OUT, f'{name}.png'))

# --- Spikecoon: teal segmented caterpillar with spikes, head on the left
im,d=new()
T=(56,184,176,255); Ts=(32,128,128,255); Tl=(136,232,216,255); O=(24,72,80,255)
SP=(40,150,140,255); SPl=(110,220,200,255)
segs=[(56,40,7,7),(49,37,8,9),(41,35,9,10),(32,35,10,11),(23,37,10,11)]
for cx,cy,rx,ry in segs:
    # legs
    d.rectangle([cx-3,cy+ry-2,cx,cy+ry+3],fill=Ts); 
    blob(d,cx,cy,rx,ry,T,Ts,Tl,O)
    # spikes on top
    d.polygon([(cx-3,cy-ry+2),(cx+2,cy-ry+2),(cx+3,cy-ry-8)],fill=SP)
    d.line([(cx-1,cy-ry+1),(cx+2,cy-ry-6)],fill=SPl)
    d.polygon([(cx+rx-3,cy-2),(cx+rx-1,cy+3),(cx+rx+5,cy-3)],fill=SP)
# head
hx,hy=12,43
d.line([(9,30),(11,36)],fill=O,width=2); d.line([(16,29),(15,35)],fill=O,width=2)
d.rectangle([8,28,10,30],fill=T); d.rectangle([15,27,17,29],fill=T)
blob(d,hx,hy,10,9,T,Ts,Tl,O)
d.rectangle([5,40,8,43],fill=(248,248,248,255)); d.rectangle([5,41,6,43],fill=(24,24,32,255))
d.rectangle([13,40,16,43],fill=(248,248,248,255)); d.rectangle([13,41,14,43],fill=(24,24,32,255))
d.line([(4,39),(8,40)],fill=O); d.line([(13,39),(17,40)],fill=O)
d.rectangle([7,49,8,52],fill=Tl); d.rectangle([12,49,13,52],fill=Tl)
d.line([(8,47),(12,47)],fill=Ts)
save(im,'spikecoon')

# --- Gully: white seagull, facing left
im,d=new()
W=(248,248,248,255); Ws=(208,212,220,255); Wl=(255,255,255,255); G=(150,160,176,255); Gs=(110,120,140,255)
Y=(248,200,40,255); Ys=(216,152,24,255); OR=(240,160,48,255); K=(40,40,48,255)
# legs
d.line([(27,50),(26,58)],fill=OR,width=2); d.line([(34,50),(35,58)],fill=OR,width=2)
d.polygon([(22,58),(29,58),(26,56)],fill=OR); d.polygon([(32,58),(39,58),(35,56)],fill=OR)
# tail
d.polygon([(44,38),(60,34),(58,42),(46,44)],fill=K)
d.polygon([(44,38),(56,36),(55,40),(46,42)],fill=W)
blob(d,31,40,15,12,W,Ws,Wl,(60,60,70,255))
# wing
d.polygon([(28,34),(48,33),(55,40),(46,46),(32,45)],fill=G)
d.line([(32,38),(50,37)],fill=Gs); d.line([(33,42),(50,41)],fill=Gs)
d.polygon([(48,38),(57,39),(52,44)],fill=K)
# head
blob(d,22,24,9,9,W,Ws,Wl,(60,60,70,255))
d.polygon([(14,24),(5,26),(6,28),(14,28)],fill=Y); d.line([(6,28),(14,28)],fill=Ys); d.point((8,27),fill=(220,60,40,255))
d.rectangle([18,21,20,23],fill=K); d.point((18,21),fill=W)
save(im,'gully')

# --- Cheektounge: blue-grey blue-tongue lizard, facing left, tongue out, tail curling up
im,d=new()
B=(120,150,176,255); Bs=(84,108,136,255); Bl=(168,192,212,255); St=(80,96,120,255)
TG=(56,112,232,255); TGl=(120,170,255,255)
# tail curling up on the right
for i in range(40):
    t=i/39
    x=46+14*math.sin(t*1.9); y=42-26*t; r=6.5-4*t
    d.ellipse([x-r,y-r,x+r,y+r],fill=Bs)
    d.ellipse([x-r,y-r,x+r-1.5,y+r-1.5],fill=B)
# back legs
d.rectangle([40,44,44,52],fill=Bs); d.rectangle([38,51,45,53],fill=Bs)
d.rectangle([20,44,24,52],fill=Bs); d.rectangle([17,51,24,53],fill=Bs)
blob(d,33,40,15,9,B,Bs,Bl,(40,52,68,255))
# stripes
for x in (24,30,36,42): d.line([(x,33),(x+2,46)],fill=St,width=2)
# front leg
d.rectangle([27,45,30,54],fill=B); d.rectangle([24,53,31,55],fill=B)
# head
blob(d,15,36,12,9,B,Bs,Bl,(40,52,68,255))
d.rectangle([9,31,12,34],fill=(248,248,248,255)); d.rectangle([9,32,10,34],fill=(40,24,24,255))
d.point((5,34),fill=St)
# open mouth + tongue
d.polygon([(4,39),(16,40),(4,42)],fill=(140,60,70,255))
d.polygon([(4,40),(13,41),(12,46),(9,51),(4,52),(1,48),(2,43)],fill=TG)
d.polygon([(4,42),(8,42),(6,47),(3,47)],fill=TGl)
d.line([(7,43),(7,50)],fill=(40,80,190,255))
save(im,'cheektounge')
