// Lightformer 风格可编辑程序化穹顶：穹顶渐变 3 色 + 柔光箱列表（矩形 w×h / energy HDR 发光强度 / tint / azimuth / elevation，朝向球心）→ PMREM
// 由 lighting.js 旧 proceduralEnvironment/canvasGradient 迁入；DOME_PRESETS 复刻旧 CONFIG 三组（含背景幕 bg），保证旧视觉可复现
import * as THREE from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isColor = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

export function canvasGradient(colors, radial = false) {
  const c = document.createElement('canvas'); c.width = radial ? 1024 : 4; c.height = radial ? 1024 : 128;
  const g = c.getContext('2d');
  const grad = radial ? g.createRadialGradient(512, 390, 90, 512, 500, 880) : g.createLinearGradient(0, 0, 0, 128);
  colors.forEach((color, i) => grad.addColorStop(i / (colors.length - 1), color));
  g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 旧 CONFIG 四个柔光箱的几何（位置已换算为 azimuth/elevation/distance，复现旧高光形状）
const SOFTBOX_GEOMETRY = [
  { w: 72, h: 64, azimuth: 40.6, elevation: 68.2, distance: 49.6 },   // 顶部主光箱
  { w: 40, h: 28, azimuth: 143.7, elevation: 20.8, distance: 45.1 },  // 左侧补光板
  { w: 36, h: 18, azimuth: 19.4, elevation: 22.6, distance: 39.1 },   // 右侧补光板
  { w: 50, h: 3.2, azimuth: 162.1, elevation: 27.6, distance: 36.7 }  // UV 高光窄条
];
const softboxesOf = (energies, tint = '#fffbf2') => SOFTBOX_GEOMETRY.map((g, i) => ({ ...g, energy: energies[i], tint }));

export function defaultDomeSpec() {
  return { colors: ['#d9d6cf', '#89857e', '#373531'], bg: ['#e1dfda', '#cbc9c4', '#b5b3ae'], softboxes: softboxesOf([1.7, 0.65, 0.32, 3.6]) };
}

// 三组旧影棚的穹顶规格：colors = 环境穹顶渐变，bg = 背景径向渐变幕（可选，缺省时 lighting 由背景色推导）
export const DOME_PRESETS = {
  'neutral-proof': defaultDomeSpec(),
  'high-key': { colors: ['#d7d6d2', '#8f8d88', '#44423e'], bg: ['#f4f4f2', '#dcdddc', '#bfc0bf'], softboxes: softboxesOf([2.4, 1.1, 0.48, 10]) },
  'dark-craft': { colors: ['#77736b', '#292724', '#090908'], bg: ['#45433f', '#252421', '#11110f'], softboxes: softboxesOf([1.7, 0.42, 0.25, 8.5]) }
};

// 宽容合并：缺字段回落默认穹顶，数值钳制，最多 16 只柔光箱
export function normalizeDomeSpec(spec) {
  const d = defaultDomeSpec();
  if (!spec || typeof spec !== 'object') return d;
  const src = Array.isArray(spec.softboxes) ? spec.softboxes : d.softboxes;
  return {
    colors: Array.isArray(spec.colors) && spec.colors.length >= 3 ? spec.colors.slice(0, 3).map((c, i) => isColor(c) ? c : d.colors[i]) : d.colors,
    bg: Array.isArray(spec.bg) && spec.bg.length >= 3 ? spec.bg.slice(0, 3).map((c, i) => isColor(c) ? c : d.bg[i]) : null,
    softboxes: src.slice(0, 16).map(raw => {
      const b = raw || {}, n = (v, d) => Number.isFinite(+v) ? +v : d;
      return {
        w: clamp(n(b.w, 40), 1, 200), h: clamp(n(b.h, 30), 1, 200),
        energy: clamp(n(b.energy, 0), 0, 40),
        tint: isColor(b.tint) ? b.tint : '#ffffff',
        azimuth: clamp(n(b.azimuth, 0), -180, 180),
        elevation: clamp(n(b.elevation, 45), -10, 89),
        distance: clamp(n(b.distance, 50), 20, 90)
      };
    })
  };
}

// 穹顶 spec → PMREM 环境贴图（返回 target，调用方负责 dispose）
export function domeEnvironment(renderer, spec) {
  const dome = normalizeDomeSpec(spec);
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();
  const domeTex = canvasGradient(dome.colors);
  const domeGeo = new THREE.SphereGeometry(60, 32, 24), domeMat = new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide });
  es.add(new THREE.Mesh(domeGeo, domeMat));
  for (const b of dome.softboxes) {
    const geo = new THREE.PlaneGeometry(b.w, b.h);
    // tint 的 sRGB 数值直接当线性系数乘 energy（复刻旧 (e, e*0.985, e*0.95) 的 HDR 写法）
    const n = parseInt(b.tint.slice(1), 16);
    const mat = new THREE.MeshBasicMaterial();
    mat.color.setRGB((n >> 16 & 255) / 255 * b.energy, (n >> 8 & 255) / 255 * b.energy, (n & 255) / 255 * b.energy);
    const mesh = new THREE.Mesh(geo, mat);
    const a = b.azimuth * Math.PI / 180, e = b.elevation * Math.PI / 180;
    mesh.position.set(b.distance * Math.cos(e) * Math.cos(a), b.distance * Math.sin(e), b.distance * Math.cos(e) * Math.sin(a));
    mesh.lookAt(0, 0, 0); es.add(mesh);
  }
  const target = pm.fromScene(es);
  es.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  domeTex.dispose(); pm.dispose();
  return target;
}
