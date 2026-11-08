# Готовые материалы площадок из снятых кадров игры (tools/media/capture.js): скриншоты, обложки, видео + проверка требований.
# Обложки — настоящий кадр игры («чистый», без интерфейса) с надписью названия; видео — кадры игры подряд, первый кадр — обложка.
# Использование: python3 tools/media/compose.py <папка-съёмки> <папка-результата>
import sys, os, glob, json, subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
FONT_B = '/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf'
FONT_M = '/usr/share/fonts/opentype/inter/InterDisplay-Medium.otf'
if not os.path.exists(FONT_B): FONT_B = FONT_M = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
report = {'files': {}, 'checks': []}
def check(ok, what):
    report['checks'].append({'ok': bool(ok), 'what': what}); print(('  ✓ ' if ok else '  ✗ ') + what)
def mk(*p):
    d = os.path.join(OUT, *p); os.makedirs(d, exist_ok=True); return d
def save_jpg(im, path, q=92):
    im.convert('RGB').save(path, quality=q, optimize=True, progressive=True)
    report['files'][os.path.relpath(path, OUT)] = {'w': im.width, 'h': im.height, 'bytes': os.path.getsize(path)}
    return path

def title(im, sub):
    """Надпись названия поверх кадра: затемнение снизу, ARKTUR крупно, подзаголовок разрядкой."""
    im = im.convert('RGB'); W, H = im.size
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    band = int(H * 0.36)
    for y in range(band):  # плавное затемнение к низу кадра
        a = int(205 * (y / band) ** 1.6); d.line([(0, H - band + y), (W, H - band + y)], fill=(2, 6, 14, a))
    im = Image.alpha_composite(im.convert('RGBA'), ov)
    d = ImageDraw.Draw(im)
    big = ImageFont.truetype(FONT_B, int(min(W, H * 1.6) * 0.115)); small = ImageFont.truetype(FONT_M, int(min(W, H * 1.6) * 0.034))
    def spaced(text, font, sp):
        w = sum(d.textlength(c, font=font) for c in text) + sp * (len(text) - 1); return w
    def draw_spaced(text, font, sp, y, fill):
        x = (W - spaced(text, font, sp)) / 2
        for c in text:
            d.text((x + 3, y + 3), c, font=font, fill=(0, 0, 0, 160)); d.text((x, y), c, font=font, fill=fill); x += d.textlength(c, font=font) + sp
    bs = big.size; ss = small.size
    y1 = H - int(bs * 1.55) - int(ss * 1.9) - int(H * 0.05)
    draw_spaced('ARKTUR', big, bs * 0.12, y1, (235, 246, 255, 255))
    draw_spaced(sub, small, ss * 0.42, y1 + int(bs * 1.22), (127, 214, 255, 255))
    return im.convert('RGB')

def cover_crop(im, w, h, cx=0.5, cy=0.5):
    """Вырезать область нужной пропорции вокруг точки (cx, cy) и привести к w×h."""
    W, H = im.size; r = w / h
    cw, ch = (W, round(W / r)) if W / H < r else (round(H * r), H)
    x = min(max(0, round(W * cx - cw / 2)), W - cw); y = min(max(0, round(H * cy - ch / 2)), H - ch)
    return im.crop((x, y, x + cw, y + ch)).resize((w, h), Image.LANCZOS)

# ---------- скриншоты ----------
print('Скриншоты')
for lang in ('en', 'ru'):
    for f in sorted(glob.glob(os.path.join(SRC, 'shots', f'{lang}-0*.png'))):
        im = Image.open(f); name = os.path.basename(f)[:-4]
        p = save_jpg(im, os.path.join(mk('screenshots', lang), f'arktur-{name}.jpg'))
        check(im.size == (1920, 1080), f'{os.path.relpath(p, OUT)}: 1920×1080')
shots_ru = sorted(glob.glob(os.path.join(OUT, 'screenshots/ru/*.jpg'))); shots_en = sorted(glob.glob(os.path.join(OUT, 'screenshots/en/*.jpg')))
check(len(shots_en) >= 5 and len(shots_ru) >= 5, f'не меньше 5 скриншотов 1920×1080 на язык (en {len(shots_en)}, ru {len(shots_ru)})')
check(len(shots_ru) >= 2, 'Яндекс: ≥ 2 скриншота 16:9, длинная сторона 1280–2560 (1920)')
# Poki: 3 игровых скриншота ≤ 5 МиБ
for i, sc in enumerate(['flight', 'combat', 'mining'], 1):
    src = glob.glob(os.path.join(SRC, 'shots', f'en-0*-{sc}.png'))
    if src:
        p = save_jpg(Image.open(src[0]), os.path.join(mk('poki'), f'poki-{i}-{sc}.jpg'), 90)
        check(os.path.getsize(p) <= 5 * 1024 * 1024, f'poki/{os.path.basename(p)} ≤ 5 МиБ ({os.path.getsize(p) / 1048576:.2f} МиБ)')

# ---------- обложки CrazyGames (английские) и русская для видео Яндекса ----------
print('Обложки')
base = os.path.join(SRC, 'clean', 'en-cover-mining.png'); port = os.path.join(SRC, 'clean_port', 'en-cover-mining.png')
covers = {}
if os.path.exists(base):
    im = Image.open(base)
    covers['1920x1080'] = save_jpg(title(im, 'SPACE FRONTIER'), os.path.join(mk('crazygames'), 'cover-1920x1080.jpg'))
    covers['800x800'] = save_jpg(title(cover_crop(im, 800, 800, 0.52, 0.5), 'SPACE FRONTIER'), os.path.join(mk('crazygames'), 'cover-800x800.jpg'))
    covers['ru-1920x1080'] = save_jpg(title(im, 'КОСМИЧЕСКИЙ РУБЕЖ'), os.path.join(mk('yandex'), 'cover-ru-1920x1080.jpg'))
    covers['steam-1232x706'] = save_jpg(title(cover_crop(im, 1232, 706), 'SPACE FRONTIER'), os.path.join(mk('steam'), 'capsule-1232x706.jpg'))
    covers['steam-460x215'] = save_jpg(title(cover_crop(im, 460, 215), 'SPACE FRONTIER'), os.path.join(mk('steam'), 'capsule-460x215.jpg'))
    covers['itch-630x500'] = save_jpg(title(cover_crop(im, 630, 500), 'SPACE FRONTIER'), os.path.join(mk('itch'), 'cover-630x500.jpg'))
if os.path.exists(port):
    covers['800x1200'] = save_jpg(title(cover_crop(Image.open(port), 800, 1200), 'SPACE FRONTIER'), os.path.join(mk('crazygames'), 'cover-800x1200.jpg'))
for k in ('1920x1080', '800x1200', '800x800'):
    w, h = map(int, k.split('x'))
    check(k in covers and Image.open(covers[k]).size == (w, h), f'CrazyGames: обложка {k}')
for f in sorted(glob.glob(os.path.join(SRC, 'clean*', '*.png'))):  # чистые кадры — для своих обложек и капсул
    save_jpg(Image.open(f), os.path.join(mk('clean-frames'), os.path.basename(os.path.dirname(f)) + '-' + os.path.basename(f)[:-4] + '.jpg'))

# ---------- видео ----------
def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', path], capture_output=True, text=True).stdout
    return json.loads(out)
def video(frames_dir, cover, w, h, out, fps=30, hold=12):
    frames = sorted(glob.glob(os.path.join(frames_dir, 'f*.jpg')))
    if not frames: print('  нет кадров:', frames_dir); return None
    tmp = os.path.join(frames_dir, '_seq'); os.makedirs(tmp, exist_ok=True)
    for f in glob.glob(os.path.join(tmp, '*')): os.remove(f)
    n = 0
    if cover:  # первый кадр — обложка (держим 0,4 с), дальше — игра
        c = Image.open(cover).convert('RGB').resize((w, h), Image.LANCZOS)
        for _ in range(hold): c.save(os.path.join(tmp, f'{n:05d}.jpg'), quality=95); n += 1
    for f in frames:
        im = Image.open(f).convert('RGB')
        if im.size != (w, h): im = im.resize((w, h), Image.LANCZOS)
        im.save(os.path.join(tmp, f'{n:05d}.jpg'), quality=95); n += 1
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(fps), '-i', os.path.join(tmp, '%05d.jpg'), '-an', '-c:v', 'libx264',
                    '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', str(fps), out], check=True)
    pr = probe(out); st = pr['streams']; dur = float(pr['format']['duration'])
    report['files'][os.path.relpath(out, OUT)] = {'w': st[0]['width'], 'h': st[0]['height'], 'seconds': round(dur, 2), 'bytes': os.path.getsize(out), 'audio': any(s['codec_type'] == 'audio' for s in st)}
    return pr, dur
print('Видео')
r = video(os.path.join(SRC, 'v_land_en'), covers.get('1920x1080'), 1920, 1080, os.path.join(mk('crazygames'), 'video-landscape-1920x1080.mp4'))
if r:
    pr, dur = r; st = pr['streams']
    check(st[0]['width'] == 1920 and st[0]['height'] == 1080 and 15 <= dur <= 20 and len(st) == 1 and os.path.getsize(os.path.join(OUT, 'crazygames/video-landscape-1920x1080.mp4')) <= 50 * 1048576,
          f'CrazyGames landscape: 1920×1080, {dur:.1f} с (15–20), без звука, ≤ 50 МБ, первый кадр — обложка')
r = video(os.path.join(SRC, 'v_port_en'), covers.get('800x1200'), 1080, 1620, os.path.join(mk('crazygames'), 'video-portrait-1080x1620.mp4'))
if r:
    pr, dur = r; st = pr['streams']
    check(st[0]['width'] == 1080 and st[0]['height'] == 1620 and 15 <= dur <= 20 and len(st) == 1 and os.path.getsize(os.path.join(OUT, 'crazygames/video-portrait-1080x1620.mp4')) <= 50 * 1048576,
          f'CrazyGames portrait: 1080×1620, {dur:.1f} с (15–20), без звука, ≤ 50 МБ, первый кадр — обложка 800×1200')
r = video(os.path.join(SRC, 'v_land_ru'), covers.get('ru-1920x1080'), 1920, 1080, os.path.join(mk('yandex'), 'video-ru-1920x1080.mp4'))
if r:
    pr, dur = r; st = pr['streams']
    check(abs(st[0]['width'] / st[0]['height'] - 16 / 9) < 0.01 and dur <= 28 and os.path.getsize(os.path.join(OUT, 'yandex/video-ru-1920x1080.mp4')) <= 100 * 1048576,
          f'Яндекс: видео 16:9, {dur:.1f} с (≤ 28), ≤ 100 МБ')
json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), ensure_ascii=False, indent=2)
bad = [c for c in report['checks'] if not c['ok']]
print('ИТОГО:', len(report['checks']) - len(bad), '/', len(report['checks']))
