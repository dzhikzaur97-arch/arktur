// Файлы three.js, которые нужны игре (с зависимостями эффектов) — общий список для сборок сайта, порталов и ПК.
'use strict';
module.exports = ['build/three.module.js', 'LICENSE',
  ...['EffectComposer', 'MaskPass', 'Pass', 'ShaderPass', 'RenderPass', 'OutputPass', 'SMAAPass', 'UnrealBloomPass', 'AfterimagePass'].map(f => `examples/jsm/postprocessing/${f}.js`),
  ...['AfterimageShader', 'CopyShader', 'LuminosityHighPassShader', 'OutputShader', 'SMAAShader', 'FXAAShader'].map(f => `examples/jsm/shaders/${f}.js`),
  'examples/jsm/geometries/RoundedBoxGeometry.js', 'examples/jsm/utils/BufferGeometryUtils.js', 'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/libs/fflate.module.js'];
