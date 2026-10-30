# Перекодирует картинки для одиночной сборки в WebP (втрое легче JPEG при том же виде).
# Использование: python3 tools/webp.py <папка> <макс. ширина> <качество> — печатает JSON {имя: data-URI}.
import sys, os, io, json, base64
from PIL import Image
d, w, q = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
out = {}
for f in sorted(os.listdir(d)):
    if not f.endswith('.jpg'):
        continue
    im = Image.open(os.path.join(d, f)).convert('RGB')
    if im.width > w:
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, 'WEBP', quality=q, method=6)
    out[f[:-4]] = 'data:image/webp;base64,' + base64.b64encode(b.getvalue()).decode()
print(json.dumps(out))
