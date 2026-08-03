// SceneRig schema v2：数据驱动的摄影棚描述——环境（HDRI/程序化穹顶/背景三模式）+ 动态灯具数组 + 阴影 + 色调 + 相机 + 地面
// 渲染内核、实验室、正式 3D 三方共用；rig ↔ store 扁平字段互转（rigToStorePatch / storeToRig），灯具在 store 侧收敛为单一 lightsSpec3d JSON 字符串
// 灯具条目：{id, name, type:'directional'|'point'|'hemi', on, intensity, color, azimuth, elevation, distance, shadow}
//   shadow 仅 directional 且全数组唯一 true（normalizeLights 强制）；hemi 忽略方位/距离；point 用 azimuth/elevation/distance 球坐标定位
// 方位角约定（与 lighting.js 一致）：x = cosE·cosA，y = sinE，z = cosE·sinA（度）
// v1 兼容：normalizeRig / normalizeLights 接受 v1 rig（key/fill/rim/top/hemi 固定槽，强度 0=关）与旧扁平 store 字段，经 migrateLightsV1 统一迁移
import { STAGES, stageId } from './stage.js';
import { DOME_PRESETS, defaultDomeSpec, normalizeDomeSpec } from './envDome.js';

export const RIG_SCHEMA_VERSION = 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isColor = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const num = (v, d) => Number.isFinite(+v) ? +v : d;
const TONE_IDS = ['aces', 'agx', 'neutral', 'linear'];
const BG_MODES = ['gradient', 'hdri', 'color'];
const CAMERA_PROJECTIONS = ['perspective', 'orthographic'];
const STAGE_IDS = STAGES.map(x => x.id);
const LIGHT_TYPES = ['directional', 'point', 'hemi'];
const LIGHT_TYPE_NAMES = { directional: '平行光', point: '点光', hemi: '环境补光' };
const MAX_INTENSITY = { directional: 4, point: 2, hemi: 1 }; // point 为 UI 语义强度，lighting.js 内部再乘 POINT_SCALE

// 内置场景库（数值取自调研：RoomEnvironment 强度配比、产品摄影三点布光、packshot 焦距、金属 F0 色温）
// 顶光 az/el 由旧固定位置 (40,420,40) 换算；key distance 408 沿用旧多样本软阴影基距
export const SCENE_PRESETS = [
  {
    id: 'lab-default', name: '默认场景',
    environment: {
      source: 'procedural', intensity: 0.65, rotation: 0, background: 'color', backgroundColor: '#ffffff', backgroundBlur: 0.18,
      dome: { colors: ['#dce7ec', '#56616a', '#181a1c'], bg: ['#f13a2b', '#d72419', '#8b130e'], softboxes: [
        { w: 90, h: 10, energy: 7.5, tint: '#fff3e7', azimuth: -180, elevation: 22, distance: 52 },
        { w: 46, h: 32, energy: 0.3, tint: '#cdeeff', azimuth: 22, elevation: 25, distance: 48 },
        { w: 56, h: 4, energy: 4.5, tint: '#bfeaff', azimuth: -55, elevation: 28, distance: 42 }
      ] }
    },
    lights: [
      { id: 'key', name: '正面主光', type: 'directional', on: true, intensity: 1.15, color: '#fff1e3', groundColor: '#68645d', azimuth: 51, elevation: 28, distance: 408, shadow: true, areaIntensity: 0, areaWidth: 145, areaHeight: 115, areaTargetY: 42 },
      { id: 'key2', name: '正面主光 副本', type: 'directional', on: true, intensity: 1.35, color: '#fff1e3', groundColor: '#68645d', azimuth: 93, elevation: 5, distance: 408, shadow: false, areaIntensity: 0, areaWidth: 145, areaHeight: 115, areaTargetY: 42 },
      { id: 'fill', name: '右侧弱填充', type: 'directional', on: true, intensity: 0.79, color: '#d7efff', groundColor: '#68645d', azimuth: 95, elevation: 25, distance: 400, shadow: false, areaIntensity: 0, areaWidth: 145, areaHeight: 115, areaTargetY: 42 },
      { id: 'rim', name: '冷色轮廓光', type: 'directional', on: true, intensity: 0.7, color: '#bfeaff', groundColor: '#68645d', azimuth: -55, elevation: 34, distance: 400, shadow: false, areaIntensity: 0, areaWidth: 145, areaHeight: 115, areaTargetY: 42 },
      { id: 'top', name: '顶光', type: 'directional', on: true, intensity: 0.67, color: '#fff8ef', groundColor: '#68645d', azimuth: 45, elevation: 82.3, distance: 400, shadow: false, areaIntensity: 0, areaWidth: 145, areaHeight: 115, areaTargetY: 42 },
      { id: 'hemi', name: '环境补光', type: 'hemi', on: true, intensity: 1, color: '#ffffff', groundColor: '#68645d', azimuth: 0, elevation: 90, distance: 400, shadow: false, areaIntensity: 0, areaWidth: 145, areaHeight: 115, areaTargetY: 42 }
    ],
    shadow: { softness: 22, opacity: 0.28 }, tone: { mapping: 'neutral', exposure: 1.1 }, camera: { projection: 'perspective', fov: 27 }, stage: 'none'
  },
  {
    id: 'packshot-white', name: '电商白棚',
    environment: {
      source: 'white_studio_03', intensity: 0.9, rotation: 0, background: 'hdri', backgroundColor: '#f4f4f2', backgroundBlur: 0.25,
      dome: { colors: ['#e8e8e6', '#a6a5a1', '#54524e'], bg: ['#f4f4f2', '#e3e3e1', '#cdcdcb'], softboxes: [
        { w: 72, h: 64, energy: 2.2, tint: '#fffbf2', azimuth: 40.6, elevation: 68.2, distance: 49.6 },
        { w: 40, h: 28, energy: 1.0, tint: '#fffbf2', azimuth: 143.7, elevation: 20.8, distance: 45.1 },
        { w: 36, h: 18, energy: 0.45, tint: '#fffbf2', azimuth: 19.4, elevation: 22.6, distance: 39.1 },
        { w: 50, h: 3.2, energy: 9, tint: '#fffbf2', azimuth: 162.1, elevation: 27.6, distance: 36.7 }
      ] }
    },
    lights: [
      { id: 'key', name: '主光', type: 'directional', on: true, intensity: 2.0, color: '#fff4e6', azimuth: 35, elevation: 50, distance: 408, shadow: true },
      { id: 'fill', name: '辅光', type: 'directional', on: true, intensity: 0.5, color: '#eef2f8', azimuth: -50, elevation: 30, distance: 400, shadow: false },
      { id: 'rim', name: '轮廓光', type: 'directional', on: true, intensity: 0.4, color: '#ffffff', azimuth: -140, elevation: 55, distance: 400, shadow: false },
      { id: 'top', name: '顶光', type: 'directional', on: true, intensity: 0.8, color: '#ffffff', azimuth: 45, elevation: 82.3, distance: 400, shadow: false },
      { id: 'hemi', name: '环境补光', type: 'hemi', on: true, intensity: 0.1, color: '#f2f3f2', azimuth: 0, elevation: 90, distance: 400, shadow: false }
    ],
    shadow: { softness: 14, opacity: 0.16 }, tone: { mapping: 'neutral', exposure: 1.05 }, camera: { fov: 27 }, stage: 'none'
  },
  {
    id: 'neutral-proof', name: '中性校样',
    environment: { source: 'studio_small_08', intensity: 0.36, rotation: 0, background: 'gradient', backgroundColor: '#e1dfda', backgroundBlur: 0.35, dome: DOME_PRESETS['neutral-proof'] },
    lights: [
      { id: 'key', name: '主光', type: 'directional', on: true, intensity: 1.8, color: '#fff6e9', azimuth: 30, elevation: 54, distance: 408, shadow: true },
      { id: 'fill', name: '辅光', type: 'directional', on: true, intensity: 0.08, color: '#e6edf7', azimuth: 155.2, elevation: 27.6, distance: 400, shadow: false }, // 由旧固定位置 (-260,150,120) 换算
      { id: 'rim', name: '轮廓光', type: 'directional', on: true, intensity: 0.24, color: '#ffffff', azimuth: -77, elevation: 50.2, distance: 400, shadow: false }, // 由旧固定位置 (60,320,-260) 换算
      { id: 'top', name: '顶光', type: 'directional', on: false, intensity: 0, color: '#ffffff', azimuth: 45, elevation: 82.3, distance: 400, shadow: false },
      { id: 'hemi', name: '环境补光', type: 'hemi', on: true, intensity: 0.04, color: '#f2f3f2', azimuth: 0, elevation: 90, distance: 400, shadow: false }
    ],
    shadow: { softness: 20, opacity: 0.23 }, tone: { mapping: 'aces', exposure: 1.0 }, camera: { fov: 35 }, stage: 'none'
  },
  {
    id: 'high-key', name: '明亮展示棚',
    environment: {
      source: 'procedural', intensity: 0.92, rotation: 0, background: 'gradient', backgroundColor: '#fbfbfa', backgroundBlur: 0.18,
      dome: { colors: ['#f4f5f4', '#a8aaa8', '#4b4d4c'], bg: ['#ffffff', '#f7f7f5', '#e7e7e4'], softboxes: [
        { w: 100, h: 75, energy: 2.8, tint: '#fff9f2', azimuth: 78, elevation: 40, distance: 54 },
        { w: 60, h: 45, energy: 1.0, tint: '#edf5ff', azimuth: 22, elevation: 25, distance: 50 },
        { w: 56, h: 5, energy: 6.0, tint: '#eef7ff', azimuth: -55, elevation: 30, distance: 44 },
        { w: 55, h: 22, energy: 2.0, tint: '#ffffff', azimuth: 45, elevation: 76, distance: 52 }
      ] }
    },
    lights: [
      { id: 'key', name: '正面大柔光', type: 'directional', on: true, intensity: 1.85, color: '#fff7ef', azimuth: 78, elevation: 36, distance: 408, shadow: true },
      { id: 'fill', name: '右侧填充', type: 'directional', on: true, intensity: 0.4, color: '#e8f2ff', azimuth: 22, elevation: 28, distance: 400, shadow: false },
      { id: 'rim', name: '轮廓光', type: 'directional', on: true, intensity: 0.28, color: '#eef7ff', azimuth: -55, elevation: 35, distance: 400, shadow: false },
      { id: 'top', name: '顶光', type: 'directional', on: true, intensity: 0.15, color: '#ffffff', azimuth: 45, elevation: 82.3, distance: 400, shadow: false },
      { id: 'hemi', name: '环境补光', type: 'hemi', on: true, intensity: 0.16, color: '#f2f3f2', azimuth: 0, elevation: 90, distance: 400, shadow: false }
    ],
    shadow: { softness: 12, opacity: 0.18 }, tone: { mapping: 'neutral', exposure: 1.08 }, camera: { fov: 30 }, stage: 'none'
  },
  {
    id: 'warm-boutique', name: '暖调精品',
    environment: {
      source: 'studio_small_09', intensity: 0.9, rotation: 0, background: 'gradient', backgroundColor: '#efe7da', backgroundBlur: 0.35,
      dome: { colors: ['#e3d9c8', '#8f8271', '#38322a'], bg: ['#efe7da', '#dcd0be', '#c2b3a0'], softboxes: [
        { w: 72, h: 64, energy: 1.8, tint: '#ffedd8', azimuth: 40.6, elevation: 68.2, distance: 49.6 },
        { w: 40, h: 28, energy: 0.7, tint: '#ffedd8', azimuth: 143.7, elevation: 20.8, distance: 45.1 },
        { w: 36, h: 18, energy: 0.3, tint: '#ffedd8', azimuth: 19.4, elevation: 22.6, distance: 39.1 },
        { w: 50, h: 3.2, energy: 6, tint: '#ffedd8', azimuth: 162.1, elevation: 27.6, distance: 36.7 }
      ] }
    },
    lights: [
      { id: 'key', name: '主光', type: 'directional', on: true, intensity: 2.2, color: '#ffd9a4', azimuth: 40, elevation: 48, distance: 408, shadow: true }, // ≈3200K 暖主光
      { id: 'fill', name: '辅光', type: 'directional', on: true, intensity: 0.3, color: '#cfe0ff', azimuth: -55, elevation: 28, distance: 400, shadow: false }, // 冷辅光对撞
      { id: 'rim', name: '轮廓光', type: 'directional', on: true, intensity: 0.55, color: '#ffe9c9', azimuth: -120, elevation: 50, distance: 400, shadow: false },
      { id: 'top', name: '顶光', type: 'directional', on: true, intensity: 0.5, color: '#ffffff', azimuth: 45, elevation: 82.3, distance: 400, shadow: false },
      { id: 'hemi', name: '环境补光', type: 'hemi', on: true, intensity: 0.06, color: '#f2f3f2', azimuth: 0, elevation: 90, distance: 400, shadow: false }
    ],
    shadow: { softness: 18, opacity: 0.26 }, tone: { mapping: 'agx', exposure: 1.04 }, camera: { fov: 30 }, stage: 'wood_table_001'
  },
  {
    id: 'poster-red', name: '海报红棚',
    environment: {
      source: 'procedural', intensity: 0.65, rotation: 0, background: 'gradient', backgroundColor: '#df291d', backgroundBlur: 0.18,
      dome: { colors: ['#dce7ec', '#56616a', '#181a1c'], bg: ['#f13a2b', '#d72419', '#8b130e'], softboxes: [
        { w: 90, h: 68, energy: 1.8, tint: '#fff3e7', azimuth: 78, elevation: 37, distance: 52 },
        { w: 46, h: 32, energy: 0.3, tint: '#cdeeff', azimuth: 22, elevation: 25, distance: 48 },
        { w: 56, h: 4, energy: 4.5, tint: '#bfeaff', azimuth: -55, elevation: 28, distance: 42 }
      ] }
    },
    lights: [
      { id: 'key', name: '正面主光', type: 'directional', on: true, intensity: 2.15, color: '#fff1e3', azimuth: 78, elevation: 33, distance: 408, shadow: true },
      { id: 'fill', name: '右侧弱填充', type: 'directional', on: true, intensity: 0.27, color: '#d7efff', azimuth: 22, elevation: 26, distance: 400, shadow: false },
      { id: 'rim', name: '冷色轮廓光', type: 'directional', on: true, intensity: 0.3, color: '#bfeaff', azimuth: -55, elevation: 34, distance: 400, shadow: false },
      { id: 'top', name: '顶光', type: 'directional', on: true, intensity: 0.14, color: '#fff8ef', azimuth: 45, elevation: 82.3, distance: 400, shadow: false },
      { id: 'hemi', name: '环境补光', type: 'hemi', on: true, intensity: 0.1, color: '#f2f3f2', azimuth: 0, elevation: 90, distance: 400, shadow: false }
    ],
    shadow: { softness: 9, opacity: 0.28 }, tone: { mapping: 'neutral', exposure: 1.1 }, camera: { projection: 'perspective', fov: 27 }, stage: 'none'
  },
  {
    id: 'dark-craft', name: '深色工艺',
    environment: { source: 'studio_small_08', intensity: 1.1, rotation: 0, background: 'gradient', backgroundColor: '#45433f', backgroundBlur: 0.35, dome: DOME_PRESETS['dark-craft'] },
    lights: [
      { id: 'key', name: '主光', type: 'directional', on: true, intensity: 2.05, color: '#fff6e9', azimuth: 30, elevation: 54, distance: 408, shadow: true },
      { id: 'fill', name: '辅光', type: 'directional', on: true, intensity: 0.55, color: '#e6edf7', azimuth: 155.2, elevation: 27.6, distance: 400, shadow: false },
      { id: 'rim', name: '轮廓光', type: 'directional', on: true, intensity: 0.65, color: '#ffffff', azimuth: -77, elevation: 50.2, distance: 400, shadow: false },
      { id: 'top', name: '顶光', type: 'directional', on: false, intensity: 0, color: '#ffffff', azimuth: 45, elevation: 82.3, distance: 400, shadow: false },
      { id: 'hemi', name: '环境补光', type: 'hemi', on: true, intensity: 0.25, color: '#f2f3f2', azimuth: 0, elevation: 90, distance: 400, shadow: false }
    ],
    shadow: { softness: 17, opacity: 0.28 }, tone: { mapping: 'aces', exposure: 1.14 }, camera: { fov: 35 }, stage: 'none'
  },
  {
    id: 'cool-metal', name: '冷调金属',
    environment: {
      source: 'studio_small_03', intensity: 0.85, rotation: 0, background: 'gradient', backgroundColor: '#e8ebef', backgroundBlur: 0.35,
      dome: { colors: ['#dde2e8', '#878e97', '#33363b'], bg: ['#e8ebef', '#d3d8de', '#b6bcc4'], softboxes: [
        { w: 72, h: 64, energy: 1.9, tint: '#f2f6ff', azimuth: 40.6, elevation: 68.2, distance: 49.6 },
        { w: 40, h: 28, energy: 0.75, tint: '#f2f6ff', azimuth: 143.7, elevation: 20.8, distance: 45.1 },
        { w: 36, h: 18, energy: 0.35, tint: '#f2f6ff', azimuth: 19.4, elevation: 22.6, distance: 39.1 },
        { w: 50, h: 3.2, energy: 7, tint: '#f2f6ff', azimuth: 162.1, elevation: 27.6, distance: 36.7 }
      ] }
    },
    lights: [
      { id: 'key', name: '主光', type: 'directional', on: true, intensity: 2.5, color: '#f4f7ff', azimuth: 25, elevation: 62, distance: 408, shadow: true },
      { id: 'fill', name: '辅光', type: 'directional', on: true, intensity: 0.2, color: '#dfe8f5', azimuth: -55, elevation: 30, distance: 400, shadow: false },
      { id: 'rim', name: '轮廓光', type: 'directional', on: true, intensity: 0.85, color: '#ffffff', azimuth: -140, elevation: 60, distance: 400, shadow: false },
      { id: 'top', name: '顶光', type: 'directional', on: true, intensity: 1.0, color: '#ffffff', azimuth: 45, elevation: 82.3, distance: 400, shadow: false },
      { id: 'hemi', name: '环境补光', type: 'hemi', on: true, intensity: 0.05, color: '#f2f3f2', azimuth: 0, elevation: 90, distance: 400, shadow: false }
    ],
    shadow: { softness: 12, opacity: 0.2 }, tone: { mapping: 'aces', exposure: 1.02 }, camera: { fov: 27 }, stage: 'checkered_pavement_tiles'
  }
];

const LEGACY_SCENE_IDS = { neutral: 'neutral-proof' }; // 旧 studio id 兼容（high-key/dark-craft id 未变）
const DEFAULT_RIG = SCENE_PRESETS.find(x => x.id === 'neutral-proof');

function normalizeLightEntry(raw, i, usedIds) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const type = LIGHT_TYPES.includes(s.type) ? s.type : 'directional';
  let id = typeof s.id === 'string' && s.id.trim() ? s.id.trim().slice(0, 40) : 'light-' + (i + 1);
  while (usedIds.has(id)) id += '_';
  usedIds.add(id);
  return {
    id,
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 24) : LIGHT_TYPE_NAMES[type],
    type,
    on: s.on !== false,
    intensity: clamp(num(s.intensity, type === 'hemi' ? 0.1 : 1), 0, MAX_INTENSITY[type]),
    color: isColor(s.color) ? s.color : (type === 'hemi' ? '#f2f3f2' : '#ffffff'),
    groundColor: isColor(s.groundColor) ? s.groundColor : '#68645d',
    azimuth: clamp(num(s.azimuth, 30), -180, 180),
    elevation: clamp(num(s.elevation, 55), 5, 90),
    distance: clamp(num(s.distance, 400), 50, 2000),
    areaIntensity: type === 'hemi' ? 0 : clamp(num(s.areaIntensity, 0), 0, 10),
    areaWidth: clamp(num(s.areaWidth, 145), 1, 300),
    areaHeight: clamp(num(s.areaHeight, 115), 1, 300),
    areaTargetY: clamp(num(s.areaTargetY, 42), -200, 600),
    shadow: type === 'directional' && s.shadow === true
  };
}

// v2 灯具数组规范化：id 去重、按类型钳制强度、投影（shadow:true）全数组唯一（保留第一盏，其余强制清除）
export function normalizeLights(input) {
  if (!Array.isArray(input)) return migrateLightsV1(input);
  const used = new Set();
  const list = input.map((s, i) => normalizeLightEntry(s, i, used));
  let shadowTaken = false;
  for (const l of list) { if (l.shadow) { if (shadowTaken) l.shadow = false; else shadowTaken = true; } }
  return list;
}

// v1 → v2 灯具迁移：接受 v1 rig（lights 为 key/fill/rim/top/hemi 固定槽对象）或旧扁平 store 字段（keyIntensity3d/keyAngle 等）
// 强度 0 = 关 → on:false；key 挂全数组唯一 shadow:true；缺字段回落默认场景（neutral-proof）同位灯
export function migrateLightsV1(src) {
  const o = src && typeof src === 'object' ? src : {};
  const L = o.lights && typeof o.lights === 'object' && !Array.isArray(o.lights) ? o.lights : {};
  const def = id => DEFAULT_RIG.lights.find(x => x.id === id);
  const read = (slot, fI, fC, fA, fE) => {
    const s = L[slot] || {}, d = def(slot);
    return {
      intensity: num(s.intensity != null ? s.intensity : o[fI], d.intensity),
      color: isColor(s.color) ? s.color : (isColor(o[fC]) ? o[fC] : d.color),
      azimuth: num(s.azimuth != null ? s.azimuth : o[fA], d.azimuth),
      elevation: num(s.elevation != null ? s.elevation : o[fE], d.elevation)
    };
  };
  const dir = (slot, name, shadow, fI, fC, fA, fE) => {
    const v = read(slot, fI, fC, fA, fE), d = def(slot);
    return { id: slot, name, type: 'directional', on: v.intensity > 0, intensity: v.intensity, color: v.color, azimuth: v.azimuth, elevation: v.elevation, distance: d.distance, shadow };
  };
  const hm = read('hemi', 'hemiIntensity3d');
  return normalizeLights([
    dir('key', '主光', true, 'keyIntensity3d', 'keyColor3d', 'keyAngle', 'keyElevation3d'),
    dir('fill', '辅光', false, 'fillIntensity3d', 'fillColor3d', 'fillAngle3d', 'fillElevation3d'),
    dir('rim', '轮廓光', false, 'rimIntensity3d', 'rimColor3d', 'rimAngle3d', 'rimElevation3d'),
    dir('top', '顶光', false, 'topIntensity3d', 'topColor3d'),
    { id: 'hemi', name: '环境补光', type: 'hemi', on: hm.intensity > 0, intensity: hm.intensity, color: def('hemi').color, azimuth: 0, elevation: 90, distance: 400, shadow: false }
  ]);
}

// 宽容合并 + 钳制：缺字段回落默认 rig，不拒绝手工编辑的 JSON；lights 同时接受 v1 固定槽与 v2 数组，输出统一 v2
export function normalizeRig(input) {
  const src = input && typeof input === 'object' ? input : {};
  const env = src.environment || {}, sh = src.shadow || {}, tn = src.tone || {}, cam = src.camera || {};
  return {
    id: typeof src.id === 'string' ? src.id : '', name: typeof src.name === 'string' ? src.name : '自定义场景',
    environment: {
      source: typeof env.source === 'string' && env.source ? env.source : DEFAULT_RIG.environment.source,
      intensity: clamp(num(env.intensity, DEFAULT_RIG.environment.intensity), 0, 2),
      rotation: clamp(num(env.rotation, 0), -180, 180),
      background: BG_MODES.includes(env.background) ? env.background : 'gradient',
      backgroundColor: isColor(env.backgroundColor) ? env.backgroundColor : DEFAULT_RIG.environment.backgroundColor,
      backgroundBlur: clamp(num(env.backgroundBlur, 0.35), 0, 1),
      dome: normalizeDomeSpec(env.dome)
    },
    lights: normalizeLights(src.lights),
    shadow: { softness: clamp(num(sh.softness, 20), 0, 30), opacity: clamp(num(sh.opacity, 0.23), 0, 0.6) },
    tone: { mapping: TONE_IDS.includes(tn.mapping) ? tn.mapping : 'aces', exposure: clamp(num(tn.exposure, 1), 0.6, 1.8) },
    camera: { projection: CAMERA_PROJECTIONS.includes(cam.projection) ? cam.projection : 'perspective', fov: clamp(num(cam.fov, 35), 16, 46) },
    stage: STAGE_IDS.includes(src.stage) ? src.stage : stageId(src.stage)
  };
}

export function scenePreset(id) {
  const raw = SCENE_PRESETS.find(x => x.id === id) || SCENE_PRESETS.find(x => x.id === LEGACY_SCENE_IDS[id]) || DEFAULT_RIG;
  return normalizeRig(raw);
}

// rig → store 扁平字段。灯具收敛为单一 lightsSpec3d JSON 字符串（与 domeSpec3d 同模式）；
// backgroundMode3d 与旧布尔 showEnvironmentBackground 双写：hdri 模式时布尔优先，backgroundMode3d 记录布尔关闭后的回落模式
export function rigToStorePatch(rig) {
  const r = normalizeRig(rig), env = r.environment;
  const patch = {
    environment3d: env.source, envIntensity3d: env.intensity, envRotation3d: env.rotation,
    showEnvironmentBackground: env.background === 'hdri', backgroundMode3d: env.background === 'hdri' ? 'gradient' : env.background,
    backgroundColor3d: env.backgroundColor, backgroundBlur3d: env.backgroundBlur,
    domeSpec3d: JSON.stringify(env.dome),
    lightsSpec3d: JSON.stringify(r.lights),
    shadowSoftness3d: r.shadow.softness, shadowOpacity3d: r.shadow.opacity,
    toneMapping3d: r.tone.mapping, expo3d: r.tone.exposure, cameraProjection3d: r.camera.projection, fov3d: r.camera.fov, stage3d: r.stage
  };
  if (SCENE_PRESETS.some(x => x.id === r.id)) patch.studio3d = r.id;
  return patch;
}

// store 扁平字段 → rig（当前状态快照，供导出/保存）；lightsSpec3d 缺失或损坏时回退旧扁平灯字段迁移（v1 本机预设路径）
export function storeToRig(state) {
  let dome = null;
  try { dome = JSON.parse(state.domeSpec3d); } catch (_) { dome = null; }
  let lights = null;
  try { const parsed = JSON.parse(state.lightsSpec3d); if (Array.isArray(parsed)) lights = parsed; } catch (_) { lights = null; }
  return normalizeRig({
    name: '当前场景',
    environment: {
      source: state.environment3d, intensity: state.envIntensity3d, rotation: state.envRotation3d,
      background: state.showEnvironmentBackground ? 'hdri' : (state.backgroundMode3d === 'color' ? 'color' : 'gradient'),
      backgroundColor: state.backgroundColor3d, backgroundBlur: state.backgroundBlur3d, dome
    },
    lights: lights || migrateLightsV1(state),
    shadow: { softness: state.shadowSoftness3d, opacity: state.shadowOpacity3d },
    tone: { mapping: state.toneMapping3d, exposure: state.expo3d },
    camera: { projection: state.cameraProjection3d, fov: state.fov3d }, stage: state.stage3d
  });
}

export function exportSceneJson(rig) {
  return JSON.stringify({ schema: 'box3d-scene-rig', version: RIG_SCHEMA_VERSION, rig: normalizeRig(rig) }, null, 2);
}

export function importSceneJson(text, baseRig = null) {
  try {
    const doc = JSON.parse(text);
    if (!doc || doc.schema !== 'box3d-scene-rig' || typeof doc.version !== 'number' || doc.version < 1 || doc.version > RIG_SCHEMA_VERSION || !doc.rig) return { ok: false, error: 'JSON schema 或版本不兼容。', rig: null };
    let source = doc.rig;
    if (Array.isArray(doc.scope) && baseRig) {
      const base = normalizeRig(baseRig), scoped = new Set(doc.scope);
      source = { ...base };
      if (scoped.has('environment')) source.environment = { ...base.environment, ...(doc.rig.environment || {}) };
      if (scoped.has('lights') && Array.isArray(doc.rig.lights)) source.lights = doc.rig.lights;
      if (scoped.has('shadow')) source.shadow = { ...base.shadow, ...(doc.rig.shadow || {}) };
      if (scoped.has('tone')) source.tone = { ...base.tone, ...(doc.rig.tone || {}) };
      if (scoped.has('camera')) source.camera = { ...base.camera, ...(doc.rig.camera || {}) };
      if (scoped.has('stage') && typeof doc.rig.stage === 'string') source.stage = doc.rig.stage;
    }
    return {
      ok: true,
      error: '',
      rig: normalizeRig(source),
      compatibility: doc.compatibility || null,
      producer: doc.producer || '',
    }; // v1 文件经 normalizeRig 自动迁移灯具
  } catch (_) { return { ok: false, error: 'JSON 无法解析。', rig: null }; }
}

// 生成可粘贴进 rig.js SCENE_PRESETS 的 JS 字面量文本（编译期固化用）
export function sceneCodeSnippet(rig) {
  return '// 粘贴到 src/render3d/rig.js 的 SCENE_PRESETS 数组\n' + JSON.stringify(normalizeRig(rig), null, 2) + ',';
}
