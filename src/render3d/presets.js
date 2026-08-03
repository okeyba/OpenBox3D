// 3D 外观预设：纸张与覆膜正交组合；环境能量只属于影棚，不写入材质。
// 影棚预设（STUDIO_PRESETS）从 rig.js 的 SCENE_PRESETS 派生摘要，旧 id 经 scenePreset 映射兼容。
import { SCENE_PRESETS, scenePreset } from './rig.js';

// 纸张扩展字段（均有默认值兜底，旧纸种行为不变）：sheen 0、specularIntensity 1（黑卡 0.72）、metalBase 0（烘焙 metalness 底色，银卡类用）
export const PAPER_PRESETS = [
  { id: 'coated-white', name: '涂布白卡', color: '#f4f1e8', roughness: 0.48, grain: 'fine', grainStrength: 0.45, grainMm: 8, core: '#d8cdb2' },
  { id: 'ivory-uncoated', name: '未涂布象牙卡', color: '#eee5d2', roughness: 0.72, grain: 'open', grainStrength: 0.72, grainMm: 9, core: '#d2c3a6' },
  { id: 'art-paper', name: '铜版 / 粉纸', color: '#f6f3eb', roughness: 0.38, grain: 'fine', grainStrength: 0.28, grainMm: 7, core: '#ded8c9' },
  { id: 'kraft-natural', name: '自然牛皮卡', color: '#b9834c', roughness: 0.9, grain: 'kraft', grainStrength: 0.28, grainMm: 8, core: '#a9703e' },
  { id: 'black-card', name: '黑卡', color: '#24211e', roughness: 0.68, grain: 'fine', grainStrength: 0.12, grainMm: 14, core: '#4a443d', specularIntensity: 0.72 },
  { id: 'white-grayback', name: '灰底白板', color: '#eeeae0', roughness: 0.62, grain: 'open', grainStrength: 0.55, grainMm: 9, core: '#77756f' },
  { id: 'pearlescent-white', name: '珠光白卡', color: '#f2eee6', roughness: 0.42, grain: 'fine', grainStrength: 0.3, grainMm: 7, core: '#ddd5c4', sheen: 0.35 },
  { id: 'metal-silver-card', name: '银卡', color: '#e8e8ea', roughness: 0.32, grain: 'fine', grainStrength: 0.25, grainMm: 7, core: '#c9c9cc', metalBase: 0.9 }
];

// film 扩展字段 specularIntensity（默认 1；哑膜 0.5，压暗镜面反射）
export const FILM_PRESETS = [
  { id: 'none', name: '无膜', clearcoat: 0, clearcoatRoughness: 0.5, roughnessFactor: 1, sheen: 0 },
  { id: 'matte', name: '哑膜', clearcoat: 0.38, clearcoatRoughness: 0.5, roughnessFactor: 0.92, sheen: 0.05, specularIntensity: 0.5 },
  { id: 'gloss', name: '亮膜', clearcoat: 1, clearcoatRoughness: 0.045, roughnessFactor: 0.42, sheen: 0 },
  { id: 'soft', name: '触感膜', clearcoat: 0.18, clearcoatRoughness: 0.72, roughnessFactor: 1.12, sheen: 0.48 }
];

// 影棚摘要（旧 UI/存档字段）：完整参数见 rig.js 的 SCENE_PRESETS（schema v2 灯具数组，按 id 取强度）
export const STUDIO_PRESETS = SCENE_PRESETS.map(r => {
  const I = id => { const l = r.lights.find(x => x.id === id); return l ? l.intensity : 0; };
  return {
    id: r.id, name: r.name, env: r.environment.intensity, exposure: r.tone.exposure,
    key: I('key'), fill: I('fill'), rim: I('rim'), hemi: I('hemi'),
    shadowSoftness: r.shadow.softness, shadowOpacity: r.shadow.opacity
  };
});

// HDRI 环境库（本地 1K，Poly Haven CC0，详见 public/hdri/manifest.json）；kb 为色温/氛围标注，source 供 UI 展示
export const ENVIRONMENT_PRESETS = [
  { id: 'procedural', name: '程序化影棚', url: null, kb: '内置可编辑穹顶', source: '内置' },
  { id: 'room-neutral', name: 'Lab 中性房间', url: null, kb: 'RoomEnvironment 中性柔光', source: '内置' },
  { id: 'studio_small_08', name: '柔光棚 · Studio Small 08', url: '/hdri/studio_small_08_1k.hdr', kb: '~6000K 冷调干净', source: 'Poly Haven' },
  { id: 'studio_small_03', name: '高反差棚 · Studio Small 03', url: '/hdri/studio_small_03_1k.hdr', kb: '~5400K 高反差', source: 'Poly Haven' },
  { id: 'studio_small_09', name: '暖调棚 · Studio Small 09', url: '/hdri/studio_small_09_1k.hdr', kb: '2750K 暖调精品', source: 'Poly Haven' },
  { id: 'white_studio_03', name: '白底电商 · White Studio 03', url: '/hdri/white_studio_03_1k.hdr', kb: '~5300K 白棚', source: 'Poly Haven' },
  { id: 'white_studio_06', name: '明亮白棚 · White Studio 06', url: '/hdri/white_studio_06_1k.hdr', kb: '高调白棚', source: 'Poly Haven' },
  { id: 'cyclorama_hard_light', name: '纯白弧形棚 · Cyclorama', url: '/hdri/cyclorama_hard_light_1k.hdr', kb: '~5400K 硬光', source: 'Poly Haven' },
  { id: 'photo_studio_01', name: '冷调影棚 · Photo Studio 01', url: '/hdri/photo_studio_01_1k.hdr', kb: '~5622K 中反差', source: 'Poly Haven' }
];

export const paperPreset = id => PAPER_PRESETS.find(x => x.id === id) || PAPER_PRESETS[0];
export const filmPreset = id => FILM_PRESETS.find(x => x.id === id) || FILM_PRESETS[0];
export const studioPreset = id => STUDIO_PRESETS.find(x => x.id === id) || STUDIO_PRESETS.find(x => x.id === scenePreset(id).id) || STUDIO_PRESETS[0];
export const environmentPreset = id => ENVIRONMENT_PRESETS.find(x => x.id === id) || ENVIRONMENT_PRESETS[1];

export function legacyAppearance(id) {
  return {
    sbs: ['coated-white', 'none'], black: ['black-card', 'none'], kraft: ['kraft-natural', 'none'],
    matte: ['coated-white', 'matte'], gloss: ['coated-white', 'gloss'], soft: ['coated-white', 'soft']
  }[id] || ['coated-white', 'none'];
}
