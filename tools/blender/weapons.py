# Модели орудий ARKTUR для Blender 4.x.
# Запуск (без окна):  blender -b --python tools/blender/weapons.py -- <папка_вывода> [render]
# На выходе для каждого орудия: <id>.blend (можно открыть и править), <id>.glb (для игры), <id>.png (рендер, если указан render)
# и общий showcase.blend со всеми орудиями в ряд.
# Оси: вперёд (ствол) — +Y, вверх — +Z, единица — размер башни. Модели оригинальные.
import bpy, bmesh, math, sys, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'weapons_out')
RENDER = 'render' in argv
os.makedirs(OUT, exist_ok=True)

# ---------- материалы ----------
def mat(name, color, metal=0.8, rough=0.35, emit=None, strength=6.0):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m

def mats(glow):
    return {
        'armor': mat('Броня', (0.36, 0.39, 0.43), 0.65, 0.36),
        'plate': mat('Плиты', (0.22, 0.24, 0.27), 0.7, 0.42),
        'steel': mat('Ствол', (0.06, 0.065, 0.075), 0.9, 0.28),
        'paint': mat('Краска', (0.75, 0.38, 0.08), 0.2, 0.5),
        'glow': mat('Свечение_%02x%02x%02x' % tuple(int(c * 255) for c in glow), glow, 0, 0.3, glow, 8.0),
        'warhead': mat('Боеголовки', (1.0, 0.45, 0.2), 0, 0.3, (1.0, 0.45, 0.2), 5.0),
    }

LV_GLOW = {2: (0.38, 1.0, 0.56), 3: (0.38, 0.69, 1.0), 4: (0.75, 0.44, 1.0), 5: (1.0, 0.75, 0.25)}

# ---------- примитивы ----------
COL = None
def link(ob):
    COL.objects.link(ob); return ob

def bevel(ob, w=0.025, seg=2, limit='ANGLE'):
    m = ob.modifiers.new('Фаска', 'BEVEL'); m.width = w; m.segments = seg; m.limit_method = limit; m.harden_normals = False
    return ob

def mesh_from(name, verts, faces, material):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(material)
    for p in me.polygons: p.use_smooth = False
    return link(ob)

def box(name, sx, sy, sz, loc, material, bev=0.02, rot=(0, 0, 0)):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    v = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz), (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = mesh_from(name, v, f, material); ob.location = loc; ob.rotation_euler = rot
    if bev: bevel(ob, min(bev, sx * 0.3, sy * 0.3, sz * 0.3))
    return ob

def cyl(name, r1, r2, length, loc, material, verts=16, axis='Y', bev=0.0, rot_extra=0.0):
    """Цилиндр/конус вдоль оси; loc — центр основания (начало ствола)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r1, radius2=r2, depth=length)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(material); link(ob)
    smooth = verts >= 12
    for p in me.polygons: p.use_smooth = smooth
    if axis == 'Y':
        ob.rotation_euler = (-math.pi / 2, rot_extra, 0); ob.location = (loc[0], loc[1] + length / 2, loc[2])
    elif axis == 'Z':
        ob.rotation_euler = (0, 0, rot_extra); ob.location = (loc[0], loc[1], loc[2] + length / 2)
    else:
        ob.rotation_euler = (0, math.pi / 2, rot_extra); ob.location = (loc[0] + length / 2, loc[1], loc[2])
    if bev: bevel(ob, bev, 2)
    return ob

def wedge(name, w, h, d, loc, material, front=0.45, back=0.15, bev=0.03):
    """Клин-корпус башни: профиль сбоку (Y-Z) со скошенным лбом, вытянут по X."""
    prof = [(-d / 2, 0), (d / 2, 0), (d / 2, h * 0.38), (d / 2 - d * front, h), (-d / 2 + d * back, h), (-d / 2, h * 0.7)]
    v = [(-w / 2, y, z) for y, z in prof] + [(w / 2, y, z) for y, z in prof]
    n = len(prof)
    f = [tuple(range(n))[::-1], tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    ob = mesh_from(name, v, f, material); ob.location = loc
    return bevel(ob, bev)

def frame(name, outer, inner, depth, loc, material):
    """Квадратная обойма: коробка с вырезом (булево вычитание)."""
    o = box(name, outer, depth, outer, loc, material, bev=0.012)
    cut = box(name + '_вырез', inner, depth * 3, inner, loc, material, bev=0)
    cut.display_type = 'WIRE'; cut.hide_render = True; cut.hide_viewport = True
    m = o.modifiers.new('Вырез', 'BOOLEAN'); m.object = cut; m.operation = 'DIFFERENCE'; m.solver = 'EXACT'
    o.modifiers.move(len(o.modifiers) - 1, 0)
    return o

def array(ob, count, offset):
    m = ob.modifiers.new('Ряд', 'ARRAY'); m.count = count; m.use_relative_offset = False; m.use_constant_offset = True
    m.constant_offset_displace = offset
    ob.modifiers.move(len(ob.modifiers) - 1, 0)
    return ob

# ---------- общие узлы ----------
def mount(M):
    """Погон: шестигранная плита с болтами и поворотный узел."""
    base = cyl('Погон', 0.66, 0.74, 0.12, (0, 0, 0), M['plate'], verts=6, axis='Z', bev=0.02, rot_extra=math.pi / 6)
    ring = cyl('Поворотное_кольцо', 0.5, 0.5, 0.08, (0, 0, 0.12), M['steel'], verts=24, axis='Z')
    for i in range(6):
        a = i * math.pi / 3
        cyl('Болт', 0.035, 0.035, 0.03, (math.cos(a) * 0.58, math.sin(a) * 0.58, 0.12), M['steel'], verts=6, axis='Z')
    box('Узел', 0.46, 0.46, 0.1, (0, 0, 0.25), M['steel'], bev=0.015)

def housing(M, w=0.9, h=0.42, d=1.05, y=-0.05, front=0.45):
    z0 = 0.3
    wedge('Корпус_башни', w, h, d, (0, y, z0), M['armor'], front)
    for sd in (1, -1):
        p = box('Бортовая_броня', 0.05, d * 0.72, h * 0.72, (sd * (w / 2 + 0.03), y - d * 0.05, z0 + h * 0.42), M['plate'], bev=0.012, rot=(0, 0, sd * 0.05))
        box('Полоса', 0.012, d * 0.3, 0.04, (sd * (w / 2 + 0.06), y - d * 0.18, z0 + h * 0.72), M['paint'], bev=0)
    box('Люк', w * 0.46, d * 0.32, 0.05, (0, y - d * 0.22, z0 + h + 0.02), M['plate'], bev=0.01)
    box('Прицел', 0.14, 0.16, 0.1, (w * 0.28, y + d * 0.05, z0 + h + 0.03), M['steel'], bev=0.015)
    return z0 + h * 0.62, w / 2 + 0.07, z0 + h * 0.42  # высота оси стволов, место насечек уровня

def level_marks(lv, mx, mz, y0=-0.35):
    if lv < 2: return
    g = mat('Уровень_%d' % lv, LV_GLOW[lv], 0, 0.3, LV_GLOW[lv], 7.0)
    for i in range(lv - 1):
        for sd in (1, -1): box('Насечка_ур', 0.02, 0.08, 0.04, (sd * mx, y0 + i * 0.12, mz), g, bev=0)

# ---------- орудия ----------
def laser(M, lv, beam=False):
    mount(M); ax, mx, mz = housing(M, 0.88, 0.42, 1.0, -0.08, 0.5)
    box('Маска_ствола', 0.3, 0.42, 0.3, (0, 0.45, ax), M['plate'], bev=0.03)
    L = 1.55 if beam else 1.15
    cyl('Ствол', 0.09, 0.07, L, (0, 0.6, ax), M['steel'], verts=20, bev=0.0)
    fin = box('Радиатор', 0.22, 0.03, 0.22, (0, 0.72, ax), M['plate'], bev=0.006)
    array(fin, 5 if beam else 3, (0, 0.15, 0))
    if beam:
        for sd in (1, -1): cyl('Трубка_охлаждения', 0.022, 0.022, L - 0.35, (sd * 0.1, 0.55, ax - 0.06), M['plate'], verts=10)
    cyl('Фокусирующее_кольцо', 0.13, 0.13, 0.06, (0, 0.6 + L - 0.06, ax), M['plate'], verts=6)
    for i in range(6):
        a = i * math.pi / 3
        box('Фокусёр', 0.025, 0.12, 0.025, (math.cos(a) * 0.12, 0.6 + L + 0.04, ax + math.sin(a) * 0.12), M['steel'], bev=0)
    cyl('Линза', 0.1, 0.1, 0.05, (0, 0.6 + L, ax), M['glow'], verts=6)
    level_marks(lv, mx, mz)

def railgun(M, lv):
    mount(M); ax, mx, mz = housing(M, 0.95, 0.44, 1.1, -0.15, 0.4)
    for sd in (1, -1):
        box('Шина', 0.085, 2.0, 0.22, (sd * 0.13, 0.85, ax + 0.05), M['steel'], bev=0.015)
        box('Изолятор_шины', 0.03, 1.8, 0.1, (sd * 0.075, 0.9, ax + 0.05), M['plate'], bev=0)
    box('Разряд', 0.04, 1.7, 0.06, (0, 0.95, ax + 0.05), M['glow'], bev=0)
    for i in range(4): frame('Обойма_катушки', 0.5, 0.38, 0.1, (0, 0.2 + i * 0.36, ax + 0.05), M['plate'])
    box('Дульный_блок', 0.4, 0.14, 0.32, (0, 1.82, ax + 0.05), M['armor'], bev=0.02)
    cap = cyl('Конденсатор', 0.07, 0.07, 0.3, (-0.3, -0.62, ax - 0.05), M['plate'], verts=12, axis='Z')
    array(cap, 5, (0.15, 0, 0))
    level_marks(lv, mx, mz)

def autocannon(M, lv):
    mount(M); ax, mx, mz = housing(M, 0.9, 0.42, 1.0, -0.1, 0.5)
    box('Кожух', 0.44, 0.34, 0.44, (0, 0.45, ax), M['plate'], bev=0.03)
    for i in range(6):
        a = i * math.pi / 3
        cyl('Ствол', 0.045, 0.045, 1.0, (math.cos(a) * 0.12, 0.6, ax + math.sin(a) * 0.12), M['steel'], verts=10)
    for y in (0.85, 1.35): frame('Хомут', 0.4, 0.3, 0.07, (0, y, ax), M['plate'])
    cyl('Ось_блока', 0.05, 0.05, 1.05, (0, 0.6, ax), M['steel'], verts=10)
    box('Короб_ленты', 0.26, 0.42, 0.34, (0.62, -0.15, 0.48), M['armor'], bev=0.02)
    for i in range(4): box('Звено_ленты', 0.1, 0.07, 0.06, (0.5 - i * 0.03, 0.08 + i * 0.07, 0.62 + i * 0.015), M['steel'], bev=0)
    level_marks(lv, mx, mz)

def plasma(M, lv):
    mount(M); ax, mx, mz = housing(M, 1.0, 0.46, 1.05, -0.12, 0.42)
    b = cyl('Ствол', 0.21, 0.13, 1.05, (0, 0.45, ax), M['steel'], verts=4, rot_extra=math.pi / 4); bevel(b, 0.015)
    for i in range(3): frame('Магнитная_катушка', 0.42 - i * 0.04, 0.3 - i * 0.04, 0.07, (0, 0.6 + i * 0.28, ax), M['plate'])
    box('Дульный_срез', 0.34, 0.1, 0.34, (0, 1.52, ax), M['armor'], bev=0.02)
    ch = bpy.data.objects.new('Камера_плазмы', None)
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.19)
    me = bpy.data.meshes.new('Камера_плазмы'); bm.to_mesh(me); bm.free()
    ch = bpy.data.objects.new('Камера_плазмы', me); ch.data.materials.append(M['glow']); link(ch); ch.location = (0, -0.2, ax + 0.26)
    for dx, dy in ((-0.2, -0.4), (0.2, -0.4), (-0.2, 0.0), (0.2, 0.0)): box('Стойка_клетки', 0.04, 0.04, 0.44, (dx, dy, ax + 0.24), M['plate'], bev=0)
    box('Крышка_клетки', 0.48, 0.48, 0.04, (0, -0.2, ax + 0.47), M['plate'], bev=0.01)
    vent = box('Вентиляция', 0.5, 0.03, 0.02, (0, -0.5, 0.75), M['steel'], bev=0); array(vent, 4, (0, 0.07, 0))
    level_marks(lv, mx, mz)

def ion(M, lv):
    mount(M); ax, mx, mz = housing(M, 0.95, 0.42, 1.0, -0.12, 0.45)
    for sd in (1, -1):
        p = box('Зубец', 0.08, 1.2, 0.13, (sd * 0.19, 0.78, ax + 0.04), M['steel'], bev=0.012, rot=(0, 0, -sd * 0.08))
        ins = cyl('Изолятор', 0.09, 0.09, 0.05, (sd * 0.16, 0.25, ax + 0.04), M['plate'], verts=6)
        array(ins, 4, (0, 0.11, 0))
        tip = bpy.data.meshes.new('Разрядник'); bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.08, radius2=0, depth=0.16); bm.to_mesh(tip); bm.free()
        t = bpy.data.objects.new('Разрядник', tip); t.data.materials.append(M['glow']); link(t); t.location = (sd * 0.28, 1.42, ax + 0.04); t.rotation_euler = (-math.pi / 2, 0, 0)
    box('Дуга', 0.06, 0.6, 0.06, (0, 0.85, ax + 0.04), M['glow'], bev=0)
    cyl('Катушка_накачки', 0.16, 0.16, 0.32, (0, -0.62, ax - 0.02), M['plate'], verts=8)
    level_marks(lv, mx, mz)

def launcher(M, lv):
    mount(M)
    pod = box('Пакет', 1.05, 0.95, 0.62, (0, 0, 0.62), M['armor'], bev=0.035)
    cuts = []
    for i in range(3):
        for j in range(2):
            x, z = (i - 1) * 0.32, 0.48 + j * 0.27
            c = box('Шахта_вырез', 0.24, 0.6, 0.2, (x, 0.42, z), M['steel'], bev=0); c.hide_render = True; c.hide_viewport = True; cuts.append(c)
            box('Боеголовка', 0.14, 0.04, 0.12, (x, 0.16, z), M['warhead'], bev=0) # в глубине шахты
    for c in cuts:
        m = pod.modifiers.new('Шахта', 'BOOLEAN'); m.object = c; m.operation = 'DIFFERENCE'; m.solver = 'EXACT'
        pod.modifiers.move(len(pod.modifiers) - 1, 0)
    wedge('Крышка', 1.12, 0.14, 1.0, (0, 0, 0.93), M['plate'], 0.6, 0.1, 0.02)
    for sd in (1, -1):
        box('Шарнир', 0.08, 0.7, 0.5, (sd * 0.58, -0.05, 0.58), M['plate'], bev=0.015)
        box('Полоса', 0.012, 0.4, 0.05, (sd * 0.535, -0.1, 0.85), M['paint'], bev=0)
    level_marks(lv, 0.63, 0.72)

def miner(M, lv, gas=False):
    """Буровой излучатель: стрела на шарнире, шестигранная головка, кристалл-фокус и три направляющих."""
    mount(M); ax, mx, mz = housing(M, 0.7, 0.34, 0.8, -0.15, 0.5)
    cyl('Шарнир_стрелы', 0.11, 0.11, 0.3, (-0.15, 0.12, ax + 0.02), M['steel'], verts=12, axis='X')
    box('Стрела', 0.16, 0.62, 0.16, (0, 0.42, ax + 0.1), M['plate'], bev=0.02, rot=(0.22, 0, 0))
    head = cyl('Головка', 0.17, 0.15, 0.32, (0, 0.66, ax + 0.18), M['armor'], verts=6, bev=0.01)
    cyl('Кольцо_фокуса', 0.12, 0.12, 0.05, (0, 0.98, ax + 0.18), M['steel'], verts=6)
    cr = bpy.data.meshes.new('Кристалл'); bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.08, radius2=0, depth=0.2); bm.to_mesh(cr); bm.free()
    c = bpy.data.objects.new('Кристалл', cr); c.data.materials.append(M['glow']); link(c); c.location = (0, 1.12, ax + 0.18); c.rotation_euler = (-math.pi / 2, 0, 0)
    for i in range(3):
        a = i * math.pi * 2 / 3 + math.pi / 2
        box('Направляющая', 0.03, 0.3, 0.03, (math.cos(a) * 0.15, 1.12, ax + 0.18 + math.sin(a) * 0.15), M['plate'], bev=0)
    level_marks(lv, mx, mz)

WEAPONS = [
    ('laser_pulse', 'Импульсный лазер', (1.0, 0.38, 0.25), lambda M, lv: laser(M, lv)),
    ('laser_beam', 'Лучевой лазер', (1.0, 0.55, 0.2), lambda M, lv: laser(M, lv, True)),
    ('railgun', 'Рельсотрон', (0.38, 0.75, 1.0), railgun),
    ('autocannon', 'Автопушка', (1.0, 0.82, 0.38), autocannon),
    ('plasma', 'Плазмомёт', (0.38, 1.0, 0.82), plasma),
    ('ion', 'Ионный разрядник', (0.63, 0.5, 1.0), ion),
    ('launcher', 'Ракетная установка', (1.0, 0.45, 0.25), launcher),
    ('miner', 'Буровой лазер', (0.38, 1.0, 0.56), miner),
]

# ---------- сцена, свет, камера ----------
def clean():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def studio(scene, target=(0, 0.55, 0.5), dist=5.4):
    w = bpy.data.worlds.new('Студия'); scene.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.03, 0.035, 0.045, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
    def light(name, kind, loc, energy, size=2.0, color=(1, 1, 1)):
        L = bpy.data.lights.new(name, kind); L.energy = energy; L.color = color
        if kind == 'AREA': L.size = size
        o = bpy.data.objects.new(name, L); o.location = loc; scene.collection.objects.link(o)
        d = Vector(target) - Vector(loc); o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    light('Ключевой', 'AREA', (-3, 3, 4.5), 260, 3)
    light('Заполняющий', 'AREA', (3.5, 1.5, 1.5), 70, 3, (0.7, 0.82, 1.0))
    light('Контровой', 'AREA', (1.5, -4, 3), 320, 2, (1.0, 0.85, 0.7))
    pl = bpy.data.meshes.new('Пол'); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=6); bm.to_mesh(pl); bm.free()
    p = bpy.data.objects.new('Пол', pl); p.data.materials.append(mat('Пол', (0.025, 0.028, 0.034), 0.4, 0.55)); scene.collection.objects.link(p)
    cam = bpy.data.cameras.new('Камера'); cam.lens = 50
    c = bpy.data.objects.new('Камера', cam); scene.collection.objects.link(c); scene.camera = c
    c.location = (target[0] - dist * 0.74, target[1] + dist * 0.6, target[2] + dist * 0.42) # спереди-слева: ствол к зрителю
    c.rotation_euler = (Vector(target) - c.location).to_track_quat('-Z', 'Y').to_euler()
    return c

def setup_render(scene, w=1280, h=860):
    scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = 48; scene.cycles.use_denoising = True
    scene.render.resolution_x = w; scene.render.resolution_y = h; scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'; scene.view_settings.look = 'AgX - Medium High Contrast'

def build(wid, title, glow, fn, lv=3):
    global COL
    clean()
    scene = bpy.context.scene
    COL = bpy.data.collections.new(title); scene.collection.children.link(COL)
    M = mats(glow)
    fn(M, lv)
    return scene

for wid, title, glow, fn in WEAPONS:
    scene = build(wid, title, glow, fn, lv=3)
    # .glb для игры: только орудие (без света, камеры и пола), модификаторы применяются при экспорте
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, wid + '.glb'), export_format='GLB', export_apply=True, use_visible=True, export_lights=False, export_cameras=False)
    studio(scene); setup_render(scene)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, wid + '.blend'))
    if RENDER:
        scene.render.filepath = os.path.join(OUT, wid + '.png'); bpy.ops.render.render(write_still=True)
    print('готово:', wid, title)

# общая витрина: все орудия в ряд, уровни 1–5 по очереди
clean(); scene = bpy.context.scene
for i, (wid, title, glow, fn) in enumerate(WEAPONS):
    COL = bpy.data.collections.new(title); scene.collection.children.link(COL)
    before = set(bpy.data.objects)
    fn(mats(glow), 1 + i % 5)
    for ob in set(bpy.data.objects) - before:
        if ob.parent is None: ob.location.x += (i % 4) * 2.4; ob.location.y -= (i // 4) * 2.8
c = studio(scene, target=(3.6, -1.0, 0.5), dist=9.5); setup_render(scene, 1600, 1000)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'showcase.blend'))
if RENDER:
    scene.render.filepath = os.path.join(OUT, 'showcase.png'); bpy.ops.render.render(write_still=True)
print('витрина готова')
