# Картинки для страницы в Google Play: баннер 1024×500 и значок 512×512.
# Запуск: python3 tools/make-store-art.py  →  publish/google-play/store/
import os, sys, subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'publish/google-play/store')
os.makedirs(OUT, exist_ok=True)
FONT = '/usr/share/fonts/opentype/inter/'
def font(name, size):
    for f in (FONT + name, '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        try: return ImageFont.truetype(f, size)
        except Exception: pass
    return ImageFont.load_default()

# баннер: фото флагмана, затемнение слева, название и подзаголовок
ph = Image.open(os.path.join(ROOT, 'public/img/photos/serafim.jpg')).convert('RGB')
W, H = 1024, 500
k = 1.45
ph = ph.resize((round(ph.width * k), round(ph.height * k)), Image.LANCZOS)
bg = Image.new('RGB', (W, H), (3, 6, 14))
ox, oy = 740 - ph.width // 2, (H - ph.height) // 2      # корабль — в правой части
bg.paste(ph, (ox, oy))
shade = Image.new('L', (W, H))
sd = ImageDraw.Draw(shade)
for x in range(W):
    t = x / W
    a = 250 if t < 0.36 else int(250 * max(0.0, 1 - (t - 0.36) / 0.3) ** 1.6)
    sd.line([(x, 0), (x, H)], fill=a)
bg.paste(Image.new('RGB', (W, H), (3, 6, 14)), (0, 0), shade)
d = ImageDraw.Draw(bg)
title = font('InterDisplay-Light.otf', 104)
d.text((58, 150), 'ARK', font=title, fill=(235, 242, 250))
w = d.textlength('ARK', font=title)
d.text((58 + w, 150), 'TUR', font=font('InterDisplay-SemiBold.otf', 104), fill=(95, 200, 232))
sub = font('Inter-Regular.otf', 30)
d.text((62, 290), 'Space sandbox · Космическая песочница', font=sub, fill=(190, 205, 222))
d.text((62, 338), 'Mining · Trade · Battles · Precursors', font=font('Inter-Regular.otf', 24), fill=(140, 160, 182))
bg.save(os.path.join(OUT, 'feature-graphic.png'))

# значок 512 — из генератора значков приложения
tmp = os.path.join(OUT, '_icons')
subprocess.run([sys.executable, os.path.join(ROOT, 'tools/make-icons.py'), tmp], check=True)
Image.open(os.path.join(tmp, 'icon-512.png')).convert('RGB').save(os.path.join(OUT, 'icon-512.png'))
for f in os.listdir(tmp): os.remove(os.path.join(tmp, f))
os.rmdir(tmp)
print('готово:', OUT)
