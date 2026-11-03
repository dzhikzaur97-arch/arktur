# Набор деталей для кораблей ARKTUR в Blender (подключается из ships.py).
# Единица — «радиус» корабля R=1: нос около +1.1 по Y, корма около -1.1, верх — +Z.
# Материалы называются так, чтобы игра узнала их и подставила свои: hull (окраска корпуса), hull2 (вторая окраска),
# dark (механика), glass (кабина), window (окна), glow (дюзы и подсветка), accent (цвет фракции), gold, crystal.
# Служебные пустышки (экспортируются в glTF как узлы с extras):
#   HP   — точка орудия (extras.hp = размер башни), в игре на неё ставится установленное оружие;
#   ENG  — дюза (extras.eng = радиус), в игре к ней приделывается факел;
#   LIGHT — огонь (extras.light = цвет), мигает в игре.
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

S = {'col': None, 'mats': {}}

def mat(name, color, metal=0.6, rough=0.4, emit=None, strength=5.0, alpha=1.0):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = strength
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha; m.blend_method = 'BLEND'
    return m

FACTION = {
    'player': dict(hull=(0.42, 0.46, 0.52), hull2=(0.26, 0.29, 0.34), accent=(0.16, 0.56, 0.82), glow=(0.25, 0.72, 1.0)),
    'cons':   dict(hull=(0.62, 0.6, 0.55), hull2=(0.3, 0.29, 0.27), accent=(0.78, 0.6, 0.22), glow=(1.0, 0.78, 0.4)),
    'liga':   dict(hull=(0.46, 0.33, 0.27), hull2=(0.24, 0.2, 0.18), accent=(0.82, 0.44, 0.13), glow=(1.0, 0.55, 0.25)),
    'orden':  dict(hull=(0.2, 0.2, 0.28), hull2=(0.12, 0.11, 0.18), accent=(0.54, 0.36, 1.0), glow=(0.72, 0.45, 1.0)),
    'guild':  dict(hull=(0.55, 0.55, 0.56), hull2=(0.25, 0.26, 0.28), accent=(0.9, 0.85, 0.75), glow=(0.5, 0.85, 1.0)),
}

def plated(m, scale=9.0, line=0.35):
    """Обшивка панелями: кирпичная текстура по координатам объекта задаёт швы и разнотон плит."""
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); br = nt.nodes.new('ShaderNodeTexBrick')
    br.inputs['Scale'].default_value = scale; br.inputs['Mortar Size'].default_value = 0.008; br.offset = 0.5
    br.inputs['Brick Width'].default_value = 0.9; br.inputs['Row Height'].default_value = 0.45
    base = b.inputs['Base Color'].default_value[:]
    br.inputs['Color1'].default_value = (base[0] * 1.03, base[1] * 1.03, base[2] * 1.03, 1)
    br.inputs['Color2'].default_value = (base[0] * 0.9, base[1] * 0.9, base[2] * 0.92, 1)
    br.inputs['Mortar'].default_value = (base[0] * line, base[1] * line, base[2] * line, 1)
    nt.links.new(tc.outputs['Object'], br.inputs['Vector']); nt.links.new(br.outputs['Color'], b.inputs['Base Color'])
    return m

def materials(fac='player', hull=None):
    F = FACTION[fac]
    return {
        'hull': plated(mat('hull', hull or F['hull'], 0.55, 0.42), 4.5),
        'hull2': plated(mat('hull2', F['hull2'], 0.6, 0.45), 8),
        'dark': mat('dark', (0.07, 0.075, 0.085), 0.85, 0.32),
        'glass': mat('glass', (0.02, 0.06, 0.1), 1.0, 0.05, (0.05, 0.25, 0.45), 0.8),
        'window': mat('window', (0.05, 0.05, 0.05), 0.2, 0.6, (1.0, 0.85, 0.6), 3.0),
        'glow': mat('glow', F['glow'], 0, 0.3, F['glow'], 9.0),
        'accent': mat('accent', F['accent'], 0.3, 0.4, F['accent'], 2.2),
        'gold': mat('gold', (0.85, 0.62, 0.25), 1.0, 0.25),
        'crystal': mat('crystal', (0.6, 0.4, 1.0), 0.1, 0.1, (0.6, 0.4, 1.0), 4.0),
        'paint': mat('paint', (0.85, 0.4, 0.1), 0.2, 0.5),
    }

def link(ob):
    S['col'].objects.link(ob); return ob

def obj(name, verts, faces, material, smooth=False, angle=40):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.validate(); me.update()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(material); link(ob)
    if smooth:
        for p in me.polygons: p.use_smooth = True
        m = ob.modifiers.new('Сглаживание', 'NODES') if False else None
    return ob

def bevel(ob, w, seg=2, angle=35):
    m = ob.modifiers.new('Фаска', 'BEVEL'); m.width = w; m.segments = seg; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(angle)
    m.harden_normals = False
    return ob

def wn(ob):
    m = ob.modifiers.new('Нормали', 'WEIGHTED_NORMAL'); m.keep_sharp = True
    return ob

def mirror_x(ob):
    m = ob.modifiers.new('Зеркало', 'MIRROR'); m.use_axis[0] = True; m.use_clip = True; m.merge_threshold = 0.001
    return ob

# ---------- профили сечений ----------
def superellipse(n, w, h, e=2.6, z0=0.0, x0=0.0, flat=0.0):
    """Точки сечения: w,h — полуширина/полувысота; e — «квадратность» (2 — эллипс, 4+ — почти прямоугольник);
    flat — доля сплющивания низа (днище плоское)."""
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        c, s = math.cos(a), math.sin(a)
        x = w * math.copysign(abs(c) ** (2 / e), c)
        z = h * math.copysign(abs(s) ** (2 / e), s)
        if z < 0: z *= (1 - flat)
        pts.append((x0 + x, z0 + z))
    return pts

def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)

def loft(name, secs, material, n=20, e=2.6, flat=0.0, steps=4, caps=True, shade=True, crease=True):
    """Корпус по сечениям: secs — [(y, w, h, z0=0, x0=0)], между сечениями — плавная кривая (Catmull-Rom).
    Нос и корма закрываются «ёлочкой» к точке, если ширина там ~0, иначе плоской крышкой."""
    secs = [tuple(list(s) + [0, 0][: 5 - len(s)]) for s in secs]
    # плавная интерполяция параметров сечений
    dense = []
    for i in range(len(secs) - 1):
        p0 = Vector(secs[max(0, i - 1)]); p1 = Vector(secs[i]); p2 = Vector(secs[i + 1]); p3 = Vector(secs[min(len(secs) - 1, i + 2)])
        for k in range(steps):
            v = catmull(p0, p1, p2, p3, k / steps)
            dense.append((v[0], max(0.0005, v[1]), max(0.0005, v[2]), v[3], v[4]))
    dense.append(tuple(secs[-1][:5]))
    verts, faces = [], []
    for (y, w, h, z0, x0) in dense:
        for (x, z) in superellipse(n, w, h, e, z0, x0, flat):
            verts.append((x, y, z))
    rows = len(dense)
    for r in range(rows - 1):
        for i in range(n):
            a = r * n + i; b = r * n + (i + 1) % n; c = (r + 1) * n + (i + 1) % n; d = (r + 1) * n + i
            faces.append((a, b, c, d))
    if caps:
        faces.append(tuple(range(n))[::-1])
        faces.append(tuple(range((rows - 1) * n, rows * n)))
    ob = obj(name, verts, faces, material)
    me = ob.data
    if shade:
        for p in me.polygons: p.use_smooth = True
    # края крышек — фаской, бока — гладкие
    bevel(ob, 0.012, 1, 50)
    return ob

def box(name, sx, sy, sz, loc, material, bev=0.01, rot=(0, 0, 0)):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    v = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz), (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = obj(name, v, f, material); ob.location = loc; ob.rotation_euler = rot
    if bev: bevel(ob, min(bev, sx * 0.3, sy * 0.3, sz * 0.3), 1, 30)
    return ob

def lathe(name, prof, material, verts=16, axis='Y', loc=(0, 0, 0), smooth=True):
    """Тело вращения: prof — [(r, t)] где t — вдоль оси от 0 вперёд."""
    bm = bmesh.new()
    rings = []
    for (r, t) in prof:
        ring = []
        for i in range(verts):
            a = 2 * math.pi * i / verts
            x, z = r * math.cos(a), r * math.sin(a)
            co = (x, t, z) if axis == 'Y' else (x, z, t) if axis == 'Z' else (t, x, z)
            ring.append(bm.verts.new(co))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(verts):
            j = (i + 1) % verts
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    if prof[0][0] > 0.0001: bm.faces.new(rings[0][::-1])
    if prof[-1][0] > 0.0001: bm.faces.new(rings[-1])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(material); link(ob)
    if smooth:
        for p in me.polygons: p.use_smooth = True
    ob.location = loc
    return ob

def cyl(name, r1, r2, length, loc, material, verts=16, axis='Y', smooth=None):
    """Цилиндр/конус от точки loc вдоль оси (+Y по умолчанию)."""
    prof = [(r1, 0), (r2, length)]
    ob = lathe(name, prof, material, verts, axis, loc, smooth if smooth is not None else verts >= 12)
    return ob

def wing(name, root, span, chord_root, chord_tip, sweep, thick, side, material, dihedral=0.0, z_tip=0.0):
    """Крыло: трапеция с толщиной, корень в точке root, размах по ±X."""
    x0, y0, z0 = root
    sd = side
    tip_x = x0 + sd * span; tip_y = y0 - sweep; tip_z = z0 + span * math.tan(dihedral) + z_tip
    P = [(x0, y0 + chord_root / 2, z0), (x0, y0 - chord_root / 2, z0), (tip_x, tip_y - chord_tip / 2, tip_z), (tip_x, tip_y + chord_tip / 2, tip_z)]
    t = thick / 2
    v = [(x, y, z + t) for x, y, z in P] + [(x, y, z - t * 0.6) for x, y, z in P]
    f = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    if sd < 0: f = [tuple(reversed(x)) for x in f]
    ob = obj(name, v, f, material)
    bevel(ob, min(thick * 0.35, 0.02), 2, 30)
    return ob

def fin(name, root, height, chord, sweep, thick, material, tilt=0.0):
    x0, y0, z0 = root
    P = [(x0, y0 + chord / 2, z0), (x0, y0 - chord / 2, z0), (x0 + math.sin(tilt) * height, y0 - chord / 2 - sweep, z0 + height), (x0 + math.sin(tilt) * height, y0 - chord / 2 - sweep + chord * 0.45, z0 + height)]
    t = thick / 2
    v = [(x + t, y, z) for x, y, z in P] + [(x - t, y, z) for x, y, z in P]
    f = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = obj(name, v, f, material)
    bevel(ob, min(thick * 0.35, 0.015), 2, 30)
    return ob

def empty(kind, loc, **extras):
    e = bpy.data.objects.new(kind, None); e.location = loc; e.empty_display_size = 0.05; link(e)
    for k, v in extras.items(): e[k] = v
    return e

def engine(x, y, z, r, M, length=1.0, bell=True):
    """Дюза: кожух с раструбом и светящимся соплом. Сопло смотрит назад (-Y)."""
    L = r * 1.6 * length
    lathe('Кожух_дюзы', [(r * 0.7, y + L * 0.9), (r * 1.08, y + L * 0.55), (r * 1.12, y + L * 0.1), (r * 1.25 if bell else r * 1.05, y - L * 0.05), (r * 1.18 if bell else r, y - L * 0.12)], M['dark'], 16, 'Y', (x, 0, z))
    lathe('Сопло', [(r * 0.98, y - L * 0.06), (r * 0.98, y - L * 0.04)], M['glow'], 16, 'Y', (x, 0, z))
    for i in range(4):  # рёбра охлаждения
        a = i * math.pi / 2 + math.pi / 4
        box('Ребро_дюзы', 0.012 + r * 0.06, L * 0.5, r * 0.12, (x + math.cos(a) * r * 1.12, y + L * 0.35, z + math.sin(a) * r * 1.12), M['hull2'], 0.004, (0, a, 0))
    empty('ENG', (x, y - L * 0.06, z), eng=r)

def canopy(x, y, z, sx, sy, sz, M):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0)
    for v in bm.verts:
        if v.co.z < 0: v.co.z *= 0.2
    me = bpy.data.meshes.new('Кабина'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('Кабина', me); ob.data.materials.append(M['glass']); link(ob)
    for p in me.polygons: p.use_smooth = True
    ob.location = (x, y, z); ob.scale = (sx, sy, sz)
    # рама кабины
    box('Рама_кабины', sx * 0.08, sy * 1.6, sz * 0.25, (x, y, z + sz * 0.75), M['hull2'], 0.004)
    return ob

def windows(x, y, z, length, h, side, M, rows=1):
    for r in range(rows):
        box('Окна', 0.006, length, h, (x * side, y, z - r * h * 2.2), M['window'], 0)

def turret_base(x, y, z, s, M, face=1):
    """Штатная турель модели (видна, пока орудие не установлено) — дочерние детали узла HP, координаты относительно него."""
    hp = empty('HP', (x, y, z), hp=s)
    parts = [cyl('Турель_погон', s * 0.7, s * 0.74, s * 0.16 * face, (0, 0, 0), M['hull2'], 6, 'Z', False),
             box('Турель_башня', s * 0.8, s * 0.9, s * 0.36, (0, -s * 0.05, face * s * 0.3), M['hull2'], s * 0.08)]
    for dx in (-0.16, 0.16):
        parts.append(cyl('Турель_ствол', s * 0.07, s * 0.06, s * 1.2, (dx * s, s * 0.2, face * s * 0.32), M['dark'], 10))
    for p in parts: p.parent = hp
    return hp

def light(x, y, z, color):
    empty('LIGHT', (x, y, z), light=[color[0], color[1], color[2]])

def greebles(target, count, region, M, seed=1, size=0.04):
    """Мелкие детали на поверхности корпуса: луч сверху до обшивки, коробочки и трубки."""
    import random
    rnd = random.Random(seed)
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(target.evaluated_get(dg), dg)
    (x0, x1), (y0, y1) = region
    placed = 0
    for _ in range(count * 4):
        if placed >= count: break
        x, y = rnd.uniform(x0, x1), rnd.uniform(y0, y1)
        top = rnd.random() < 0.75
        hit = bvh.ray_cast(Vector((x, y, 3 if top else -3)), Vector((0, 0, -1 if top else 1)))
        if hit[0] is None: continue
        n = hit[1]
        if (n.z if top else -n.z) < 0.6: continue
        p = target.matrix_world @ hit[0]
        k = rnd.random()
        sx, sy, sz = size * rnd.uniform(0.6, 1.8), size * rnd.uniform(0.8, 2.6), size * rnd.uniform(0.25, 0.7)
        if k < 0.75:
            box('Деталь', sx, sy, sz, (p.x, p.y, p.z + (sz / 2 if top else -sz / 2) * 0.8), M['hull2'] if rnd.random() < 0.6 else M['dark'], min(sx, sz) * 0.2)
        else:
            cyl('Трубка', size * 0.12, size * 0.12, sy * 1.5, (p.x, p.y - sy * 0.7, p.z + (size * 0.12 if top else -size * 0.12)), M['dark'], 8)
        placed += 1
    return placed

def antenna(x, y, z, h, M, tip=None):
    cyl('Антенна', 0.006, 0.003, h, (x, y, z), M['dark'], 6, 'Z')
    if tip is not None: light(x, y, z + h, tip)

def dish(x, y, z, r, M, tilt=0.6):
    d = lathe('Антенна_тарелка', [(0.0, 0), (r * 0.5, r * 0.08), (r, r * 0.28)], M['hull2'], 24, 'Z', (x, y, z + r * 0.12))
    d.rotation_euler = (tilt, 0, 0)
    cyl('Опора_тарелки', r * 0.08, r * 0.08, r * 0.15, (x, y, z), M['dark'], 8, 'Z')
    return d

def ring(name, R, r, loc, material, axis='Y', seg=64, minor=12):
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=False, segments=seg, radius=R)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(material); link(ob)
    m = ob.modifiers.new('Толщина', 'SKIN') if False else None
    # тор через primitive
    bpy.data.objects.remove(ob)
    bm = bmesh.new()
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for j in range(minor):
            b = 2 * math.pi * j / minor
            rr = R + r * math.cos(b)
            bm.verts.new((rr * math.cos(a), r * math.sin(b), rr * math.sin(a)))
    bm.verts.ensure_lookup_table()
    for i in range(seg):
        for j in range(minor):
            a = i * minor + j; b = i * minor + (j + 1) % minor; c = ((i + 1) % seg) * minor + (j + 1) % minor; d = ((i + 1) % seg) * minor + j
            bm.faces.new((bm.verts[a], bm.verts[b], bm.verts[c], bm.verts[d]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(material); link(ob)
    for p in me.polygons: p.use_smooth = True
    ob.location = loc
    if axis == 'Z': ob.rotation_euler = (math.pi / 2, 0, 0)
    if axis == 'X': ob.rotation_euler = (0, 0, math.pi / 2)
    return ob

def seam(secs, M, where='top', k=1.0):
    """Светящаяся полоса вдоль хребта корпуса (по его сечениям)."""
    pts = []
    for s in secs[1:-1]:
        y, w, h = s[0], s[1], s[2]; z0 = s[3] if len(s) > 3 else 0
        pts.append((0, y, z0 + h * (1.01 if where == 'top' else -1.01)))
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        c = (a + b) / 2; d = b - a
        ob = box('Полоса', 0.012 * k, d.length, 0.006, tuple(c), M['accent'], 0)
        ob.rotation_euler = (math.atan2(d.z, d.y), 0, 0)


def surf(x, y, top=True, default=None):
    """Точка на обшивке под (x, y): луч сверху (или снизу) по всем деталям, построенным к этому моменту."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    hit, loc, n, idx, ob, mx = bpy.context.scene.ray_cast(dg, Vector((x, y, 5 if top else -5)), Vector((0, 0, -1 if top else 1)))
    if not hit: return default
    return loc

def mount(x, y, s, M, top=True):
    """Орудийная точка, посаженная на обшивку."""
    p = surf(x, y, top)
    if p is None: return None
    return turret_base(p.x, p.y, p.z - (s * 0.03 if top else -s * 0.03), s, M, 1 if top else -1)

# =====================================================================
# Гранёные формы (v70): корпуса без скругления — плоские панели и рёбра-скулы
# =====================================================================
PROF = {
    # точки сечения в квадрате [-1, 1] (x — ширина, z — высота)
    'oct':   [(1, 0.4), (0.55, 1), (-0.55, 1), (-1, 0.4), (-1, -0.35), (-0.6, -1), (0.6, -1), (1, -0.35)],
    'hex':   [(1, 0), (0.55, 1), (-0.55, 1), (-1, 0), (-0.6, -0.85), (0.6, -0.85)],
    'keel':  [(1, 0.35), (0.65, 1), (-0.65, 1), (-1, 0.35), (-0.45, -0.55), (0, -1), (0.45, -0.55)],
    'diam':  [(1, 0), (0, 1), (-1, 0), (0, -1)],
    'trap':  [(1, -1), (0.62, 1), (-0.62, 1), (-1, -1)],
    'slab':  [(1, 0.55), (0.82, 1), (-0.82, 1), (-1, 0.55), (-1, -0.7), (-0.8, -1), (0.8, -1), (1, -0.7)],
    'tri':   [(1, -1), (0.12, 1), (-0.12, 1), (-1, -1)],
    'arrow': [(1, 0.05), (0.75, 0.6), (-0.75, 0.6), (-1, 0.05), (-0.45, -1), (0.45, -1)],
    'blade': [(1, 0), (0.25, 1), (-0.25, 1), (-1, 0), (-0.25, -1), (0.25, -1)],
}

def _finish(name, bm, material, bev=0.006, angle=28):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(material); link(ob)
    for p in me.polygons: p.use_smooth = False
    if bev: bevel(ob, bev, 1, angle)
    return ob

def hull(name, secs, prof, material, bev=0.006):
    """Гранёный корпус: сечения (y, w, h, z0=0, x0=0, prof=None) соединены прямыми гранями — без сглаживания."""
    bm = bmesh.new(); rings = []
    for s in secs:
        y, w, h = s[0], max(s[1], 0.0008), max(s[2], 0.0008)
        z0 = s[3] if len(s) > 3 else 0; x0 = s[4] if len(s) > 4 else 0
        pr = PROF[s[5] if len(s) > 5 and s[5] else prof]
        rings.append([bm.verts.new((x0 + px * w, y, z0 + pz * h)) for px, pz in pr])
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(rings[0]); bm.faces.new(rings[-1][::-1])
    return _finish(name, bm, material, bev)

def plate(name, outline, z, t, material, bev=0.004, side=1, rot=None, taper=1.0):
    """Плита по контуру сверху: outline — [(x, y)], толщина t вверх от z; side=-1 — зеркально по X.
    taper < 1 — верхняя грань меньше нижней (скос кромок)."""
    pts = [(x * side, y) for x, y in outline]
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, z)) for x, y in pts]
    hi = [bm.verts.new((cx + (x - cx) * taper, cy + (y - cy) * taper, z + t)) for x, y in pts]
    n = len(pts)
    bm.faces.new(lo); bm.faces.new(hi)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    ob = _finish(name, bm, material, bev, 25)
    if rot:
        ob.rotation_euler = rot
    return ob

def vplate(name, outline, x, t, material, bev=0.004):
    """Вертикальная плита (кили, гребни): контур в плоскости Y-Z, толщина t по X вокруг x."""
    bm = bmesh.new()
    a = [bm.verts.new((x - t / 2, y, z)) for y, z in outline]
    b = [bm.verts.new((x + t / 2, y, z)) for y, z in outline]
    n = len(outline)
    bm.faces.new(a); bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    return _finish(name, bm, material, bev, 25)

def facet_canopy(x, y, z, w, l, h, M):
    """Гранёный фонарь кабины: стекло-клин с рамой."""
    hull('Кабина', [(y + l * 0.5, w * 0.05, h * 0.1, z), (y + l * 0.15, w, h, z), (y - l * 0.5, w * 0.85, h * 0.7, z)], 'hex', M['glass'], 0.002)
    plate('Рама_кабины', [(-w * 0.15, y - l * 0.1), (w * 0.15, y - l * 0.1), (w * 0.1, y + l * 0.3), (-w * 0.1, y + l * 0.3)], z + h * 0.92, h * 0.12, M['hull2'], 0.002)

def mir(fn):
    for sd in (1, -1): fn(sd)

# =====================================================================
# Концепт-стиль (v73): разметка, светящиеся решётки, накладные плиты, механика — общий проход для всех кораблей
# =====================================================================
def bm_box(bm, c, d, length, w, h, up=None):
    """Повёрнутый брусок в общий bmesh: центр c, ось d (длина length), ширина w, высота h по up."""
    c = Vector(c); d = Vector(d)
    if d.length < 1e-6: d = Vector((0, 1, 0))
    d.normalize(); up = Vector(up) if up is not None else Vector((0, 0, 1))
    side = d.cross(up)
    if side.length < 1e-4: side = d.cross(Vector((1, 0, 0)))
    side.normalize(); u = side.cross(d).normalized()
    vs = [bm.verts.new(c + d * length * a + side * w * b + u * h * k) for a in (-0.5, 0.5) for b in (-0.5, 0.5) for k in (-0.5, 0.5)]
    for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        bm.faces.new([vs[i] for i in f])

def bm_quad(bm, c, d, length, w, n):
    """Плоская накладка (4 вершины) на обшивке: полосы, решётки, маркировка — без лишних граней."""
    c = Vector(c); n = Vector(n).normalized(); d = Vector(d); d = (d - n * d.dot(n))
    if d.length < 1e-6: d = n.orthogonal()
    d.normalize(); sd = d.cross(n).normalized()
    v = [bm.verts.new(c + d * length * a + sd * w * b) for a, b in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5))]
    f = bm.faces.new(v)
    if f.normal.dot(n) < 0: f.normal_flip()

def bm_obj(name, bm, material, recalc=True):
    if not bm.faces: bm.free(); return None
    if recalc: bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(material); link(ob)
    for p in me.polygons: p.use_smooth = False
    return ob

def style_mats():
    return {'stripe': mat('stripe', (1.0, 0.42, 0.08), 0.2, 0.45, (1.0, 0.38, 0.05), 1.2),
            'vent': mat('vent', (0.05, 0.12, 0.2), 0.3, 0.3, (0.25, 0.65, 1.0), 4.0)}

def hull_bvh(dg):
    """Общее дерево лучей по крупным деталям корпуса (без турелей и мелочи)."""
    verts, polys = [], []
    for o in S['col'].objects:
        if o.type != 'MESH' or o.parent is not None or not o.data.materials: continue
        if o.data.materials[0].name.split('.')[0] not in ('hull', 'hull2'): continue
        if max(o.dimensions) < 0.18: continue
        ev = o.evaluated_get(dg); me = ev.to_mesh(); off = len(verts); mw = o.matrix_world
        verts += [mw @ v.co for v in me.vertices]; polys += [[off + i for i in p.vertices] for p in me.polygons]
        ev.to_mesh_clear()
    if not polys: return None, None
    mn = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
    mx = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
    return BVHTree.FromPolygons(verts, polys), (mn, mx)

def detail_pass(M, seed=1, density=1.0):
    """Детализация в духе концептов: оранжевая разметка вдоль корпуса, синие решётки по бортам,
    накладные бронеплиты, коробки и трубы механики, антенны. Всё сливается в 4 объекта — модель остаётся лёгкой."""
    import random
    rnd = random.Random(seed)
    SM = style_mats(); M.update(SM)
    bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
    bvh, bb = hull_bvh(dg)
    if not bvh: return
    mn, mx = bb; L = mx.y - mn.y; ztop = mx.z + 1
    hps = [o.matrix_world.translation.copy() for o in S['col'].objects if o.type == 'EMPTY' and 'hp' in o.keys()]
    near_hp = lambda p, r=0.1: any((Vector((p.x - h.x, p.y - h.y)).length < r) for h in hps)
    def top(x, y):
        h = bvh.ray_cast(Vector((x, y, ztop)), Vector((0, 0, -1)))
        return h if h[0] is not None and h[1].z > 0.5 else None
    def side_hit(sd, y, z):
        h = bvh.ray_cast(Vector((sd * 3, y, z)), Vector((-sd, 0, 0)))
        return h if h[0] is not None and sd * h[1].x > 0.6 else None
    B = {k: bmesh.new() for k in ('stripe', 'vent', 'hull2', 'dark')}
    # --- 1. разметка: пунктир вдоль корпуса на 2/3 полуширины (и по кромке у широких кораблей)
    ys = [mn.y + L * (0.1 + 0.78 * i / 90) for i in range(91)]
    hw = []
    for y in ys:
        w, x = 0.0, 0.0
        while x < 1.6:
            if top(x, y): w = x
            x += 0.01
        hw.append(w)
    for k in ((0.62,) if max(hw) < 0.25 else (0.42, 0.8)):
        for sd in (1, -1):
            prev = None
            for i, (y, w) in enumerate(zip(ys, hw)):
                h = top(sd * k * w, y) if w > 0.05 else None
                if h and prev and (i % 11) < 8:
                    p1, p2 = prev[0], h[0]
                    if abs(p1.x - p2.x) < 0.03 and abs(p1.z - p2.z) < 0.03 and not near_hp(p2, 0.07):
                        n = (prev[1] + h[1]).normalized()
                        bm_quad(B['stripe'], (p1 + p2) / 2 + n * 0.004, p2 - p1, (p2 - p1).length * 1.03, 0.013, n)
                prev = h
    # --- 2. синие решётки по бортам: группы прорезей на самой широкой высоте борта
    zs = [mn.z + (mx.z - mn.z) * t for t in (0.25, 0.4, 0.55, 0.7)]
    y = mn.y + L * 0.18
    while y < mn.y + L * 0.82:
        if rnd.random() < 0.55:
            best = None
            for z in zs:
                h = side_hit(1, y, z)
                if h and (best is None or h[0].x > best[0].x): best = h
            if best:
                cnt = rnd.randint(3, 6); z0 = best[0].z
                for sd in (1, -1):
                    for j in range(cnt):
                        hh = side_hit(sd, y + j * 0.032, z0)
                        if hh: bm_quad(B['vent'], hh[0] + hh[1] * 0.004, (0, 0, 1), 0.026, 0.018, hh[1])
                y += cnt * 0.032 + 0.05
                continue
        y += 0.06
    # --- 3. накладные плиты, механика, маркировка, антенны сверху
    area = L * 2 * (sum(hw) / len(hw)); N = int(min(70, 18 + 40 * area) * density)
    placed = tries = 0
    while placed < N and tries < N * 8:
        tries += 1
        y = rnd.uniform(mn.y + L * 0.08, mn.y + L * 0.9); i = min(90, max(0, int((y - mn.y - L * 0.1) / (L * 0.78) * 90)))
        w = hw[i]
        if w < 0.04: continue
        x = rnd.uniform(-w * 0.85, w * 0.85); h = top(x, y)
        if not h or h[1].z < 0.75: continue
        p, n = h[0], h[1]
        if near_hp(p): continue
        fwd = Vector((0, 1, 0)) - n * n.y
        k = rnd.random()
        if k < 0.38:
            sx, sy = rnd.uniform(0.05, 0.13), rnd.uniform(0.06, 0.18)
            bm_box(B['hull2'], p + n * 0.005, fwd, sy, sx, 0.01, n)
        elif k < 0.7:
            s = rnd.uniform(0.018, 0.045)
            bm_box(B['dark' if rnd.random() < 0.5 else 'hull2'], p + n * s * 0.35, fwd, s * rnd.uniform(1, 2.2), s * rnd.uniform(0.8, 1.4), s * 0.7, n)
        elif k < 0.84:
            bm_box(B['dark'], p + n * 0.008, fwd, rnd.uniform(0.08, 0.2), 0.012, 0.012, n)
        elif k < 0.95:
            for j in range(rnd.randint(1, 3)):
                bm_quad(B['stripe'], p + n * 0.004 + fwd.normalized() * j * 0.022, fwd, 0.014, 0.03, n)
        else:
            bm_quad(B['vent'], p + n * 0.004, fwd, 0.05, 0.022, n)
        placed += 1
    for j in range(2):
        y = mn.y + L * (0.25 + 0.15 * j); h = top((j - 0.5) * 0.06, y)
        if h and not near_hp(h[0]): bm_box(B['dark'], h[0] + Vector((0, 0, 0.06 + j * 0.03)), (0, 0, 1), 0.12 + j * 0.06, 0.006, 0.006, (0, 1, 0))
    bm_obj('Разметка', B['stripe'], SM['stripe'], False); bm_obj('Решётки', B['vent'], SM['vent'], False)
    bm_obj('Накладные_плиты', B['hull2'], M['hull2']); bm_obj('Механика', B['dark'], M['dark'])

def plumes(color):
    """Факелы дюз только для рендеров (в игру не экспортируются: там свои факелы)."""
    core = mat('plume_core', (0.5, 0.7, 1.0), 0, 0.3, (0.6, 0.85, 1.0), 3.5, 0.6)
    outer = mat('plume', color, 0, 0.3, color, 1.6, 0.18)
    for e in [o for o in S['col'].objects if o.type == 'EMPTY' and 'eng' in o.keys()]:
        r = e['eng']; p = e.matrix_world.translation
        for (rr, ll, m) in ((r * 0.5, r * 3.0, core), (r * 0.92, r * 6.5, outer)):
            lathe('Факел', [(rr, -0.001), (rr * 0.7, -ll * 0.35), (0.002, -ll)], m, 12, 'Y', (p.x, p.y - r * 0.15, p.z), False)
