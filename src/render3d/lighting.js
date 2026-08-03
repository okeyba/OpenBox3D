// 数据驱动摄影棚：背景/环境由 setControls 下发；灯具由 lights spec（v2 数组，见 rig.js）经 setLights 按 id reconcile——
// 新增 id 建灯、消失的 dispose、参数变化就地更新，滑杆拖动不做全量重建；类型或投影角色变化才重建该灯。
// 投影灯（spec 中 shadow:true 的那盏 directional，全数组唯一）独享黄金角多样本软阴影管线 + 加权 ShadowMaterial 承影网；
// 其余 directional 单灯无阴影；point 为 PointLight(decay=2)；hemi 忽略方位/距离。
// 地面布景由 stage.js 独立管理；本模块拥有并释放 background、environment、灯具与阴影承接网。
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { environmentPreset } from './presets.js';
import { canvasGradient, domeEnvironment, normalizeDomeSpec } from './envDome.js';
import { normalizeLights } from './rig.js';
import { asset } from '../asset.js';

// 点光强度标定：three 物理光度学下 PointLight(decay=2) 照度 E≈I/d²；场景单位为 mm（盒高 ~120，灯距 ~400mm），
// 平行光强度 1 约等于照度 1，故点光 UI 强度 1 需 I≈400²≈1.6e5 才同量级——取 2e5，观感与 directional 对齐。
const POINT_SCALE = 200000;
const AREA_PROXY_SCALE = 0.65;

// ShadowMaterial 默认把多灯可见度相乘，会把离散面积光样本合成成过黑的阴影并集。
// 这里只改透明承影网自身的合成：按样本平均可见度；普通 PBR 材质仍走 three.js 逐灯能量累加。
const WEIGHTED_DIRECTIONAL_SHADOW_MASK = /* glsl */`
float getShadowMask() {
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    float visibility = 0.0;
    DirectionalLightShadow directionalLight;
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
      directionalLight = directionalLightShadows[ i ];
      visibility += receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
    }
    #pragma unroll_loop_end
    return visibility / float( NUM_DIR_LIGHT_SHADOWS );
  #else
    return 1.0;
  #endif
}`;

function weightedShadowMaterial(opacity) {
  const mat = new THREE.ShadowMaterial({ opacity });
  mat.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmask_pars_fragment>', WEIGHTED_DIRECTIONAL_SHADOW_MASK); };
  mat.customProgramCacheKey = () => 'box3d-weighted-directional-shadow-v1';
  return mat;
}

function samplePattern(count) {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const r = Math.sqrt((i + 0.5) / count), a = i * goldenAngle + Math.PI / 9;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}

const isColor = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
// 方位/高度 → 光源位置（与 rig.js 同一约定：x=cosE·cosA，y=sinE，z=cosE·sinA）
const spherical = (az, el, dist) => { const a = az * Math.PI / 180, e = el * Math.PI / 180; return [dist * Math.cos(e) * Math.cos(a), dist * Math.sin(e), dist * Math.cos(e) * Math.sin(a)]; };
// 单背景色推导三档径向渐变幕（dome.bg 缺失时用）
const shadeBg = hex => {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255];
  const s = f => '#' + c.map(v => Math.round(Math.min(255, v * f)).toString(16).padStart(2, '0')).join('');
  return [s(1), s(0.9), s(0.78)];
};

export function setupStudio(renderer, scene, shadowSampleCount = 5) {
  const group = new THREE.Group(); group.name = 'Box3DStudio'; scene.add(group);
  let dome = normalizeDomeSpec(null), domeStr = '';
  let backdrop = canvasGradient(dome.bg, true), fallbackTarget = domeEnvironment(renderer, dome);
  const bgColor = new THREE.Color('#e8e4dc');
  let backgroundMode = 'gradient', backgroundBlur = 0.35;
  scene.background = backdrop; scene.environment = fallbackTarget.texture;

  const sampleOffsets = samplePattern(shadowSampleCount);
  const catcherGeo = new THREE.CircleGeometry(2500, 64), catcherMat = weightedShadowMaterial(0.23);
  const catcher = new THREE.Mesh(catcherGeo, catcherMat); catcher.rotation.x = -Math.PI / 2; catcher.receiveShadow = true; group.add(catcher);

  // 动态灯具表：id → { type, role:'shadow'|'plain', lights:THREE.Light[], areaLight, spec }
  const entries = new Map();
  let shadowSoftness = 20;
  let shadowExtent = 220;

  const disposeEntry = e => {
    e.lights.forEach(l => { group.remove(l); l.dispose(); });
    if (e.areaLight) {
      group.remove(e.areaLight.target); group.remove(e.areaLight); e.areaLight.dispose();
    }
  };

  const configureShadowLight = light => {
    light.shadow.camera.left = -shadowExtent; light.shadow.camera.right = shadowExtent;
    light.shadow.camera.top = shadowExtent; light.shadow.camera.bottom = -shadowExtent;
    light.shadow.camera.far = 1600; light.shadow.camera.updateProjectionMatrix();
    light.shadow.bias = -0.00008; light.shadow.normalBias = 0.04; light.shadow.radius = 8;
    light.shadow.needsUpdate = true;
  };

  // 投影灯多样本摆放：base 球坐标 + 正切平面黄金角偏移（偏移半径 = 软源尺度）
  const placeShadowEntry = e => {
    const s = e.spec;
    const base = new THREE.Vector3(...spherical(s.azimuth, s.elevation, s.distance));
    const a = s.azimuth * Math.PI / 180;
    const direction = base.clone().normalize(), tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const bitangent = new THREE.Vector3().crossVectors(direction, tangent).normalize();
    const sourceRadius = shadowSoftness * 1.1;
    e.lights.forEach((light, i) => {
      const off = sampleOffsets[i];
      light.position.copy(base).addScaledVector(tangent, off[0] * sourceRadius).addScaledVector(bitangent, off[1] * sourceRadius);
    });
  };

  const makeEntry = spec => {
    const role = spec.type === 'directional' && spec.shadow ? 'shadow' : 'plain';
    const hasArea = spec.type !== 'hemi' && spec.areaIntensity > 0;
    const e = { type: spec.type, role, hasArea, lights: [], areaLight: null, spec };
    if (role === 'shadow') {
      e.lights = sampleOffsets.map(() => {
        const light = new THREE.DirectionalLight(0xffffff, 0);
        light.castShadow = true; light.shadow.mapSize.set(1024, 1024);
        configureShadowLight(light);
        return light;
      });
    } else if (spec.type === 'point') {
      e.lights = [new THREE.PointLight(0xffffff, 0, 0, 2)]; // decay=2 物理衰减，无阴影
    } else if (spec.type === 'hemi') {
      e.lights = [new THREE.HemisphereLight(0xf2f3f2, 0x68645d, 0)];
    } else {
      e.lights = [new THREE.DirectionalLight(0xffffff, 0)];
    }
    e.lights.forEach(l => group.add(l));
    if (hasArea) {
      e.areaLight = new THREE.DirectionalLight(0xffffff, 0);
      e.areaLight.userData.labLightRole = 'softbox-proxy';
      group.add(e.areaLight.target); group.add(e.areaLight);
    }
    return e;
  };

  const applyAreaLight = (e, spec) => {
    if (!e.areaLight) return;
    const p = new THREE.Vector3(...spherical(spec.azimuth, spec.elevation, spec.distance));
    const targetY = spec.areaTargetY;
    if (spec.type === 'directional') p.y += targetY;
    e.areaLight.color.set(spec.color); e.areaLight.intensity = spec.areaIntensity * AREA_PROXY_SCALE;
    e.areaLight.position.copy(p); e.areaLight.target.position.set(0, targetY, 0);
    e.areaLight.visible = spec.on;
  };

  // 就地更新：颜色/强度/开关/位置，不重建灯对象（shadow entry 只重摆样本）
  const applyEntry = (e, spec) => {
    e.spec = spec;
    if (e.role === 'shadow') {
      e.lights.forEach(l => { l.color.set(spec.color); l.intensity = spec.intensity / shadowSampleCount; l.visible = spec.on; });
      placeShadowEntry(e);
    } else if (spec.type === 'point') {
      const l = e.lights[0];
      l.color.set(spec.color); l.intensity = spec.intensity * POINT_SCALE; l.visible = spec.on;
      l.position.set(...spherical(spec.azimuth, spec.elevation, spec.distance));
    } else if (spec.type === 'hemi') {
      const l = e.lights[0];
      l.color.set(spec.color); l.groundColor.set(spec.groundColor); l.intensity = spec.intensity; l.visible = spec.on;
    } else {
      const l = e.lights[0];
      l.color.set(spec.color); l.intensity = spec.intensity; l.visible = spec.on;
      l.position.set(...spherical(spec.azimuth, spec.elevation, spec.distance));
    }
    applyAreaLight(e, spec);
  };

  // spec（数组或 JSON 字符串）→ normalizeLights 统一 v2（v1 形态自动迁移，shadow 强制唯一）→ 按 id reconcile
  const setLights = spec => {
    let arr = spec;
    if (typeof spec === 'string') { try { arr = JSON.parse(spec); } catch (_) { return; } }
    const list = normalizeLights(arr);
    const seen = new Set();
    for (const s of list) {
      seen.add(s.id);
      const role = s.type === 'directional' && s.shadow ? 'shadow' : 'plain';
      const hasArea = s.type !== 'hemi' && s.areaIntensity > 0;
      let e = entries.get(s.id);
      if (e && (e.type !== s.type || e.role !== role || e.hasArea !== hasArea)) { disposeEntry(e); entries.delete(s.id); e = null; } // 类型、投影角色或伴生柔光面变化时重建
      if (!e) { e = makeEntry(s); entries.set(s.id, e); }
      applyEntry(e, s);
    }
    for (const [id, e] of [...entries]) if (!seen.has(id)) { disposeEntry(e); entries.delete(id); }
  };

  // ---- P3 视口 helper：屏幕恒定大小的灯位图标（Sprite + canvas 纹理，sizeAttenuation:false），
  // 平行光额外一条从灯位指向盒心的细线（不参加拾取）；hemi 无位置不出 helper。
  // 选中态换金色描边纹理，关灯 opacity 0.35。engine 在 setLights 后调 updateHelpers() 同步。 ----
  const helperGroup = new THREE.Group(); helperGroup.name = 'Box3DLightHelpers'; helperGroup.visible = false; group.add(helperGroup);
  const helperEntries = new Map(); // id → { sprite, mat, tex, line, lineGeo, lineMat, color, selected }
  let helpersVisible = false, helperSelectedId = null;
  const helperTarget = new THREE.Vector3(0, 42, 0); // 盒心参考点（engine 按盒高经 setHelperTarget 下发）

  const helperTexture = (type, color, selected) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const cx = cv.getContext('2d');
    cx.beginPath(); cx.arc(32, 32, 21, 0, Math.PI * 2); cx.fillStyle = color; cx.fill();
    cx.lineWidth = 3; cx.strokeStyle = 'rgba(20,16,12,0.55)'; cx.stroke();
    if (type === 'directional') { // 方向刻度：盘内白色箭头（朝盒心方向示意）
      cx.strokeStyle = 'rgba(255,255,255,0.92)'; cx.lineWidth = 4; cx.lineCap = 'round';
      cx.beginPath(); cx.moveTo(32, 22); cx.lineTo(32, 37); cx.stroke();
      cx.beginPath(); cx.moveTo(26, 32); cx.lineTo(32, 39); cx.lineTo(38, 32); cx.stroke();
    }
    if (selected) { cx.beginPath(); cx.arc(32, 32, 27, 0, Math.PI * 2); cx.lineWidth = 5; cx.strokeStyle = '#C9A227'; cx.stroke(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  const disposeHelper = h => {
    helperGroup.remove(h.sprite); if (h.line) helperGroup.remove(h.line);
    h.tex.dispose(); h.mat.dispose();
    if (h.line) { h.lineGeo.dispose(); h.lineMat.dispose(); }
  };
  const updateHelper = (h, e) => {
    const spec = e.spec;
    const p = e.role === 'shadow' ? spherical(spec.azimuth, spec.elevation, spec.distance)
      : [e.lights[0].position.x, e.lights[0].position.y, e.lights[0].position.z];
    h.sprite.position.set(p[0], p[1], p[2]);
    h.mat.opacity = spec.on ? 1 : 0.35;
    const sel = helperSelectedId === spec.id;
    if (h.color !== spec.color || h.selected !== sel) { // 颜色/选中态变化 → 重画纹理
      h.color = spec.color; h.selected = sel;
      const old = h.tex; h.tex = helperTexture(e.type, spec.color, sel); h.mat.map = h.tex; h.mat.needsUpdate = true; old.dispose();
    }
    if (h.line) {
      const arr = h.lineGeo.attributes.position.array;
      arr[0] = p[0]; arr[1] = p[1]; arr[2] = p[2]; arr[3] = helperTarget.x; arr[4] = helperTarget.y; arr[5] = helperTarget.z;
      h.lineGeo.attributes.position.needsUpdate = true;
      h.lineMat.color.set(spec.color); h.lineMat.opacity = spec.on ? 0.45 : 0.15;
    }
  };
  const makeHelper = e => {
    const spec = e.spec, sel = helperSelectedId === spec.id;
    const tex = helperTexture(e.type, spec.color, sel);
    const mat = new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat); sprite.scale.set(0.05, 0.05, 1); sprite.renderOrder = 30; sprite.userData.lightId = spec.id;
    helperGroup.add(sprite);
    const h = { sprite, mat, tex, color: spec.color, selected: sel, line: null, lineGeo: null, lineMat: null };
    if (e.type === 'directional') {
      h.lineGeo = new THREE.BufferGeometry();
      h.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      h.lineMat = new THREE.LineBasicMaterial({ color: spec.color, transparent: true, opacity: 0.45 });
      h.line = new THREE.Line(h.lineGeo, h.lineMat); h.line.renderOrder = 29; h.line.raycast = () => {}; // 细线不参加拾取
      helperGroup.add(h.line);
    }
    updateHelper(h, e);
    return h;
  };
  // 与灯具表对齐：新增建 helper、消失或变 hemi 销毁、参数就地同步
  const updateHelpers = () => {
    for (const [id, e] of entries) {
      if (e.type === 'hemi') continue;
      let h = helperEntries.get(id);
      if (!h) { h = makeHelper(e); helperEntries.set(id, h); } else updateHelper(h, e);
    }
    for (const [id, h] of [...helperEntries]) { const e = entries.get(id); if (!e || e.type === 'hemi') { disposeHelper(h); helperEntries.delete(id); } }
  };

  let alive = true, generation = 0, activeHdriTarget = null, environmentReady = Promise.resolve(true);
  const syncBackground = () => {
    if (!alive) return;
    scene.background = backgroundMode === 'hdri' ? (activeHdriTarget ? activeHdriTarget.texture : fallbackTarget.texture)
      : backgroundMode === 'color' ? bgColor : backdrop;
    scene.backgroundBlurriness = backgroundMode === 'hdri' ? backgroundBlur : 0;
  };
  const useFallback = () => {
    const old = activeHdriTarget; activeHdriTarget = null;
    if (alive) scene.environment = fallbackTarget.texture;
    syncBackground();
    if (old) old.dispose();
  };
  const setEnvironment = sourceId => {
    const source = environmentPreset(sourceId), token = ++generation;
    if (source.id === 'room-neutral') {
      let room = null, pm = null, candidate = null;
      try {
        room = new RoomEnvironment();
        pm = new THREE.PMREMGenerator(renderer);
        candidate = pm.fromScene(room, 0.04);
        const old = activeHdriTarget;
        activeHdriTarget = candidate; candidate = null;
        scene.environment = activeHdriTarget.texture;
        syncBackground();
        if (old) old.dispose();
        environmentReady = Promise.resolve(true);
      } catch (error) {
        useFallback();
        console.warn('RoomEnvironment 加载失败，已回退程序化影棚。', error);
        environmentReady = Promise.resolve(false);
      } finally {
        if (candidate) candidate.dispose();
        if (room) room.dispose();
        if (pm) pm.dispose();
      }
      return environmentReady;
    }
    if (!source.url) {
      useFallback();
      environmentReady = Promise.resolve(true);
      return environmentReady;
    }
    environmentReady = (async () => {
      let raw = null, candidate = null, envPm = null;
      try {
        raw = await new HDRLoader().loadAsync(asset(source.url));
        if (!alive || token !== generation) return false;
        envPm = new THREE.PMREMGenerator(renderer);
        candidate = envPm.fromEquirectangular(raw);
        if (!alive || token !== generation) return false;
        const old = activeHdriTarget;
        activeHdriTarget = candidate; candidate = null;
        scene.environment = activeHdriTarget.texture;
        syncBackground();
        if (old) old.dispose();
        return true;
      } catch (error) {
        if (alive && token === generation) {
          useFallback();
          console.warn('HDRI 加载失败，已回退程序化影棚：' + source.id, error);
        }
        return false;
      } finally {
        if (raw) raw.dispose();
        if (candidate) candidate.dispose();
        if (envPm) envPm.dispose();
      }
    })();
    return environmentReady;
  };
  // 穹顶 spec（JSON 字符串）变化时重建程序化环境与背景幕；字符串相等短路，避免无关控制触发 PMREM
  const rebuildDome = specStr => {
    let parsed = null;
    try { parsed = JSON.parse(specStr); } catch (_) { return; }
    domeStr = specStr; dome = normalizeDomeSpec(parsed);
    const oldBackdrop = backdrop, oldFallback = fallbackTarget;
    backdrop = canvasGradient(dome.bg || shadeBg('#' + bgColor.getHexString()), true);
    fallbackTarget = domeEnvironment(renderer, dome);
    if (scene.environment === oldFallback.texture) scene.environment = fallbackTarget.texture;
    syncBackground();
    oldBackdrop.dispose(); oldFallback.dispose();
  };
  const setControls = controls => {
    const finite = (v, fn) => { const n = +v; if (Number.isFinite(n)) fn(n); };
    finite(controls.environmentIntensity, v => { scene.environmentIntensity = v; });
    finite(controls.environmentRotation, v => { scene.environmentRotation.y = THREE.MathUtils.degToRad(v); scene.backgroundRotation.y = scene.environmentRotation.y; });
    if (controls.backgroundMode === 'gradient' || controls.backgroundMode === 'hdri' || controls.backgroundMode === 'color') backgroundMode = controls.backgroundMode;
    if (isColor(controls.backgroundColor)) bgColor.set(controls.backgroundColor);
    finite(controls.backgroundBlur, v => { backgroundBlur = v; });
    if (typeof controls.domeSpec === 'string' && controls.domeSpec && controls.domeSpec !== domeStr) rebuildDome(controls.domeSpec);
    finite(controls.shadowSoftness, v => { shadowSoftness = v; entries.forEach(e => { if (e.role === 'shadow') placeShadowEntry(e); }); });
    finite(controls.shadowOpacity, v => { catcherMat.opacity = v; catcherMat.needsUpdate = true; });
    syncBackground();
  };
  const api = {
    catcher, shadowSampleCount, setEnvironment, setControls, setLights,
    // P3 helper 层用：灯具访问（Map 副本，值为该灯主对象）与基位置查询（hemi 无位置返回 null）
    lightsById() { return new Map([...entries].map(([id, e]) => [id, e.lights[0]])); },
    lightPositionOf(id) {
      const e = entries.get(id);
      if (!e || e.type === 'hemi') return null;
      const p = e.role === 'shadow' ? new THREE.Vector3(...spherical(e.spec.azimuth, e.spec.elevation, e.spec.distance)) : e.lights[0].position;
      return [p.x, p.y, p.z];
    },
    // P3 helper 编辑 API
    setHelpersVisible(v) { helpersVisible = !!v; helperGroup.visible = helpersVisible; },
    setHelperSelected(id) { const next = id || null; if (helperSelectedId === next) return; helperSelectedId = next; updateHelpers(); },
    setHelperTarget(x, y, z) { helperTarget.set(x, y, z); updateHelpers(); },
    setShadowBounds(l, w, h) {
      shadowExtent = Math.min(600, Math.max(155, Math.max(+l || 0, +w || 0, +h || 0) * 1.3));
      entries.forEach(e => { if (e.role === 'shadow') e.lights.forEach(configureShadowLight); });
    },
    updateHelpers,
    lightAnglesOf(id) { const e = entries.get(id); return e && e.type !== 'hemi' ? { azimuth: e.spec.azimuth, elevation: e.spec.elevation } : null; },
    helperCenter() { return [helperTarget.x, helperTarget.y, helperTarget.z]; },
    // 只测 sprite：屏幕恒定大小 → 拾取半径随深度线性放大（0.5·scale·depth，放宽 1.4 倍），取最近一盏
    pickHelper(raycaster) {
      if (!helpersVisible) return null;
      const c = new THREE.Vector3(); let best = null, bestDist = Infinity;
      const cam = raycaster.camera;
      const orthoRadius = cam && cam.isOrthographicCamera
        ? Math.max(1e-6, (cam.top - cam.bottom) / Math.max(1e-6, cam.zoom)) * 0.025 * 1.4
        : null;
      for (const [id, h] of helperEntries) {
        h.sprite.getWorldPosition(c);
        const dist = raycaster.ray.origin.distanceTo(c);
        const radius = orthoRadius == null ? h.sprite.scale.y * 0.5 * dist * 1.4 : orthoRadius;
        if (raycaster.ray.distanceToPoint(c) <= radius && dist < bestDist) { best = id; bestDist = dist; }
      }
      return best;
    },
    get environmentReady() { return environmentReady; },
    dispose() {
      alive = false; generation++;
      if (scene.background === backdrop || scene.background === bgColor || scene.background === fallbackTarget.texture || scene.background === (activeHdriTarget && activeHdriTarget.texture)) scene.background = null;
      if (scene.environment === fallbackTarget.texture || scene.environment === (activeHdriTarget && activeHdriTarget.texture)) scene.environment = null;
      scene.environmentIntensity = 1; scene.backgroundBlurriness = 0; scene.environmentRotation.set(0, 0, 0); scene.backgroundRotation.set(0, 0, 0);
      scene.remove(group);
      entries.forEach(disposeEntry); entries.clear();
      helperEntries.forEach(disposeHelper); helperEntries.clear();
      catcherGeo.dispose(); catcherMat.dispose();
      if (activeHdriTarget) activeHdriTarget.dispose(); activeHdriTarget = null;
      fallbackTarget.dispose(); backdrop.dispose();
    }
  };
  return api;
}
