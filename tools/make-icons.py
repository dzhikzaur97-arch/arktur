# Иконки приложения Void Frontier: тёмный космос, планета с кольцом и корабль с огнём двигателя.
# Использование: python3 tools/make-icons.py <папка>  →  icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
import sys, os, math, random
from PIL import Image, ImageDraw, ImageFilter

def draw(size, safe=1.0):
    S = 1024
    im = Image.new('RGB', (S, S), (4, 8, 18))
    px = im.load()
    # туманность: мягкий радиальный градиент
    for y in range(0, S, 2):
        for x in range(0, S, 2):
            dx, dy = (x - S * 0.32) / S, (y - S * 0.30) / S
            d = math.sqrt(dx * dx + dy * dy)
            k = max(0.0, 1 - d * 1.8)
            r, g, b = int(4 + 40 * k * k), int(8 + 70 * k * k), int(18 + 120 * k)
            for ox in (0, 1):
                for oy in (0, 1):
                    if x + ox < S and y + oy < S:
                        px[x + ox, y + oy] = (r, g, b)
    d = ImageDraw.Draw(im, 'RGBA')
    rnd = random.Random(7)
    for _ in range(220):
        x, y, r = rnd.randrange(S), rnd.randrange(S), rnd.choice([1, 1, 1, 2, 2, 3])
        a = rnd.randrange(120, 255)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, a))
    c = S / 2
    sc = safe
    # планета
    pr = 250 * sc
    pc = (c + 90 * sc, c + 70 * sc)
    for i in range(int(pr), 0, -2):
        t = i / pr
        col = (int(40 + 120 * (1 - t)), int(90 + 110 * (1 - t)), int(170 + 70 * (1 - t)))
        d.ellipse([pc[0] - i - 30 * (1 - t), pc[1] - i - 30 * (1 - t), pc[0] + i - 30 * (1 - t), pc[1] + i - 30 * (1 - t)], fill=col)
    # тень планеты
    sh = Image.new('L', (S, S), 0)
    sd = ImageDraw.Draw(sh)
    sd.ellipse([pc[0] - pr + 90 * sc, pc[1] - pr + 60 * sc, pc[0] + pr + 160 * sc, pc[1] + pr + 140 * sc], fill=150)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).ellipse([pc[0] - pr, pc[1] - pr, pc[0] + pr, pc[1] + pr], fill=255)
    from PIL import ImageChops
    sh = ImageChops.multiply(sh.filter(ImageFilter.GaussianBlur(40)), mask)
    im.paste((2, 4, 12), (0, 0), sh)
    d = ImageDraw.Draw(im, 'RGBA')
    # кольцо: передняя половина поверх планеты (задняя скрыта планетой, по краям видна тонкой линией)
    box = [pc[0] - 430 * sc, pc[1] - 95 * sc, pc[0] + 430 * sc, pc[1] + 95 * sc]
    d.arc(box, 180, 360, fill=(220, 180, 110, 150), width=int(8 * sc))
    d.arc(box, 0, 180, fill=(255, 222, 150, 255), width=int(16 * sc))
    # корабль: стреловидный силуэт и огонь двигателя
    sx, sy = c - 160 * sc, c - 170 * sc
    ang = math.radians(-35)
    def rot(x, y):
        return (sx + (x * math.cos(ang) - y * math.sin(ang)) * sc, sy + (x * math.sin(ang) + y * math.cos(ang)) * sc)
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    ex, ey = rot(-150, 0)
    for r, a in ((110, 40), (70, 90), (40, 200)):
        gd.ellipse([ex - r * sc, ey - r * sc, ex + r * sc, ey + r * sc], fill=(90, 190, 255, a))
    glow = glow.filter(ImageFilter.GaussianBlur(18))
    im.paste(glow, (0, 0), glow)
    d = ImageDraw.Draw(im, 'RGBA')
    k = 1.25
    P = lambda pts: [rot(x * k, y * k) for x, y in pts]
    d.polygon(P([(200, 0), (-10, -34), (-95, -115), (-70, -28), (-125, 0), (-70, 28), (-95, 115), (-10, 34)]), fill=(228, 234, 244))
    d.polygon(P([(200, 0), (-10, -34), (-95, -115), (-70, -28)]), fill=(168, 182, 204))  # затенённое крыло
    d.polygon(P([(120, 0), (40, -16), (40, 16)]), fill=(90, 205, 255))  # кабина
    return im.resize((size, size), Image.LANCZOS)

out = sys.argv[1] if len(sys.argv) > 1 else 'icons'
os.makedirs(out, exist_ok=True)
draw(192).save(os.path.join(out, 'icon-192.png'))
draw(512).save(os.path.join(out, 'icon-512.png'))
draw(512, safe=0.78).save(os.path.join(out, 'icon-maskable-512.png'))  # с полями для круглых иконок Android
draw(180).save(os.path.join(out, 'apple-touch-icon.png'))
print('иконки готовы:', out)
