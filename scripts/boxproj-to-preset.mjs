// 把 .boxproj 工程文件转为本仓库的内置示例盒：
//   node scripts/boxproj-to-preset.mjs /路径/工程.boxproj
// 图片 dataURL 抽取为 public/preset/layer-<id>.<ext>，工程裁剪后写 src/preset/preset-box.json。
// 用法也写在 package.json：npm run preset:from -- /路径/工程.boxproj
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) { console.error('用法：node scripts/boxproj-to-preset.mjs /路径/工程.boxproj'); process.exit(1); }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const doc = JSON.parse(fs.readFileSync(src, 'utf8'));
if (doc.schema !== 'box3d-project' || doc.version !== 1 || !doc.box || !doc.design || !Array.isArray(doc.design.layers)) {
  console.error('不是有效的 Box3D 工程文件（schema box3d-project v1）。');
  process.exit(1);
}

const presetDir = path.join(root, 'public', 'preset');
fs.rmSync(presetDir, { recursive: true, force: true }); // 清掉上一代示例盒素材
fs.mkdirSync(presetDir, { recursive: true });

const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp' };
let extracted = 0;
for (const layer of doc.design.layers) {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(layer.imgSrc || '');
  if (!m) continue;
  const file = 'layer-' + (layer.id != null ? layer.id : ++extracted) + '.' + EXT[m[1]];
  fs.writeFileSync(path.join(presetDir, file), Buffer.from(m[2], 'base64'));
  layer.imgSrc = '/preset/' + file;
  extracted++;
}

doc.meta = { id: 'preset', name: '内置示例盒', createdAt: doc.meta && doc.meta.createdAt, updatedAt: doc.meta && doc.meta.updatedAt, thumbnail: '' }; // 封面启动后自动重捕，不进仓库
const out = path.join(root, 'src', 'preset', 'preset-box.json');
fs.writeFileSync(out, JSON.stringify(doc, null, 2));
console.log('完成：抽取图片 ' + extracted + ' 张 → public/preset/；工程 → src/preset/preset-box.json（' + Math.round(fs.statSync(out).size / 1024) + ' KB）');
