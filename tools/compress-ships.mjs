// Сжатие моделей кораблей из Blender для игры: сварка вершин, квантование (KHR_mesh_quantization) и meshopt (EXT_meshopt_compression).
// node tools/compress-ships.mjs <папка_с_glb_из_blender> [public/models/ships]
import fs from 'fs';
import path from 'path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, quantize, meshopt, dedup, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const [src, out = 'public/models/ships'] = process.argv.slice(2);
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
fs.mkdirSync(out, { recursive: true });
let total = 0;
for (const f of fs.readdirSync(src).filter(f => f.endsWith('.glb')).sort()) {
  const doc = await io.read(path.join(src, f));
  await doc.transform(dedup(), weld(), prune({ keepLeaves: true, keepExtras: true }), quantize({ quantizePosition: 14, quantizeNormal: 10 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const buf = await io.writeBinary(doc);
  fs.writeFileSync(path.join(out, f), buf); total += buf.length;
  console.log(f.padEnd(18), (fs.statSync(path.join(src, f)).size / 1024).toFixed(0).padStart(5), '→', (buf.length / 1024).toFixed(0).padStart(4), 'КБ');
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(fs.readdirSync(out).filter(f => f.endsWith('.glb')).map(f => f.slice(0, -4)).sort()));
console.log('всего:', (total / 1024).toFixed(0), 'КБ');
