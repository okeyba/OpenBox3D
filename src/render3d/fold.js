// 折叠树：面板几何（矩形板=BoxGeometry 高细分，异形板=ExtrudeGeometry）+ 展开图图集 UV 重映射
// 每面板标注 uvRect（2D 刀版坐标 mm）+ attach（2D 中与母板的相邻边），
// buildNode 累计 rotZ（0/90/180/270），按规则自动求 flip——主体板零手工方向标定
import * as THREE from 'three';
import { discBbox } from '../dieline/templates.js';

const deg = d => d * Math.PI / 180;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 归一化：(up,vp) = f(un,vn, rotZ)
function normUV(un, vn, rotZ) {
  if (rotZ === 0) return [un, vn];
  if (rotZ === 90) return [1 - vn, un];
  if (rotZ === 180) return [1 - un, 1 - vn];
  return [vn, 1 - un]; // 270
}
// 累计 rotZ 下面板的"向外生长方向"（归一系中）：far 保持，near +180，xmin +90，xmax +270
// 注意：pg 系 +y = 2D 系 -y（2D 顶插舌在母板上方，3D far 翼在母板 +y 侧），故 v 映射为 (1-vp)
const OUT = { 0: '+v', 90: '-u', 180: '-v', 270: '+u' };
function flipOf(rotZ, attach) {
  if (!attach) return '';
  const d = OUT[rotZ];
  let f = '';
  if ((d === '+v' && attach === 'b') || (d === '-v' && attach === 't')) f += 'v';
  if ((d === '+u' && attach === 'l') || (d === '-u' && attach === 'r')) f += 'u';
  return f;
}
const ROTADD = { far: 0, near: 180, xmin: 90, xmax: 270 };
const rectPt = (uvRect, up, vp) => [uvRect[0] + up * uvRect[2], uvRect[1] + (1 - vp) * uvRect[3]];

// 背面图集会在合盖时绕 X 翻到外侧，需额外翻 v 抵消背面观察产生的上下镜像。
// 面板顶面 UV 重写：顶点(局部 x,y) → 归一(rotZ) → flip → uvRect → 图集 UV；内面 → 纸色角点
function retopUV(geo, lx, ly, rotZ, flip, uvRect, sbb, innerUV, faceZ, atlasFace) {
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const sw = sbb[2] - sbb[0], sh = sbb[3] - sbb[1];
  const map = i => {
    let [up, vp] = normUV(pos.getX(i) / lx, pos.getY(i) / ly, rotZ);
    if (flip.includes('u')) up = 1 - up;
    if (flip.includes('v')) vp = 1 - vp;
    if (atlasFace === 'back') vp = 1 - vp;
    const [x2, y2] = rectPt(uvRect, up, vp);
    uv.setXY(i, (x2 - sbb[0]) / sw, 1 - (y2 - sbb[1]) / sh);
  };
  if (geo.groups && geo.groups.length) {
    // ExtrudeGeometry：group0 = 顶/底面（z=faceZ 为外面），group1 = 侧面（不动）
    const g0 = geo.groups[0];
    for (let i = g0.start; i < g0.start + g0.count; i++) {
      const targetZ = atlasFace === 'back' ? 0 : faceZ;
      if (Math.abs(pos.getZ(i) - targetZ) < 1e-6) map(i);
      else uv.setXY(i, innerUV[0], innerUV[1]);
    }
  }
  uv.needsUpdate = true;
}

// BoxGeometry（矩形板）：pz 面 = 外面（重映射 + 可高细分承载压纹置换），nz/侧面 = 纸色/纸芯
function boxUV(geo, lx, ly, t, rotZ, flip, uvRect, sbb, innerUV, atlasFace) {
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const sw = sbb[2] - sbb[0], sh = sbb[3] - sbb[1];
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const targetZ = atlasFace === 'back' ? 0 : t;
    if (Math.abs(z - targetZ) < 1e-6) {
      let [up, vp] = normUV(pos.getX(i) / lx, pos.getY(i) / ly, rotZ);
      if (flip.includes('u')) up = 1 - up;
      if (flip.includes('v')) vp = 1 - vp;
      if (atlasFace === 'back') vp = 1 - vp;
      const [x2, y2] = rectPt(uvRect, up, vp);
      uv.setXY(i, (x2 - sbb[0]) / sw, 1 - (y2 - sbb[1]) / sh);
    } else uv.setXY(i, innerUV[0], innerUV[1]);
  }
  uv.needsUpdate = true;
  // 材质组：px,nx,py,ny 侧面=1(core)；pz,nz=0(face)
  geo.groups.forEach((g, gi) => { g.materialIndex = gi >= 4 ? 0 : 1; });
}

function shapeOf(T, kind, len, out, n) {
  const S = new T.Shape();
  const q = (cx, cy, x, y) => S.quadraticCurveTo(cx, cy, x, y);
  if (kind === 'disc') {
    // 正 N 边形盖：附著边 (0,0)-(len,0)，凸弧 +y
    const N = n || 24, e = 2 * Math.PI / N;
    const a = len / (2 * Math.tan(Math.PI / N)), Rp = len / (2 * Math.sin(Math.PI / N));
    const cx = len / 2, cy = a, base = Math.atan2(-a, -len / 2);
    S.moveTo(0, 0); S.lineTo(len, 0);
    for (let k = 2; k < N; k++) S.lineTo(cx + Rp * Math.cos(base + k * e), cy + Rp * Math.sin(base + k * e));
    S.closePath();
  } else if (kind === 'dust') {
    const i = Math.min(6, len * 0.12), d5 = Math.min(5, out * 0.3);
    S.moveTo(i * 0.25, 0); S.lineTo(i * 0.6, out - d5); S.lineTo(i * 1.5, out);
    S.lineTo(len - i * 1.5, out); S.lineTo(len - i * 0.6, d5); S.lineTo(len - i * 0.25, 0);
  } else if (kind === 'tuck') {
    const sh = Math.min(5, len * 0.12), rr = Math.min(3.5, out * 0.4);
    S.moveTo(1, 0); S.lineTo(sh, 2); S.lineTo(sh, out - rr); q(sh, out, sh + rr, out);
    S.lineTo(len - sh - rr, out); q(len - sh, out, len - sh, out - rr); S.lineTo(len - sh, 2); S.lineTo(len - 1, 0);
  } else if (kind === 'glue') {
    S.moveTo(0, 0); S.lineTo(len, 0); S.lineTo(len - 5, out); S.lineTo(5, out);
  } else if (kind === 'ear') {
    const rr = Math.min(6, out * 0.4);
    S.moveTo(0.5, 0); S.lineTo(len - 0.5, 0); S.lineTo(len - 0.5, out - rr);
    q(len - 0.5, out, len - 0.5 - rr, out); S.lineTo(2, out); S.lineTo(0.5, out - 2);
  } else if (kind === 'lid') {
    S.moveTo(0, 0); S.lineTo(len, 0); S.lineTo(len - 1, out); S.lineTo(1, out);
  } else {
    S.moveTo(0, 0); S.lineTo(len, 0); S.lineTo(len, out); S.lineTo(0, out);
  }
  return S;
}

export class Folder {
  constructor(T, sbb, innerUV) {
    this.T = T; this.sbb = sbb; this.innerUV = innerUV || [0.0002, 0.9998];
    this.hasEmb = false; // 由 engine 在 build 前设置：压纹面板高细分
  }
  edgeFrame(lx, ly, edge) {
    if (edge === 'far') return { px: 0, py: ly, rz: 0, len: lx };
    if (edge === 'near') return { px: lx, py: 0, rz: Math.PI, len: lx };
    if (edge === 'xmax') return { px: lx, py: ly, rz: -Math.PI / 2, len: ly };
    return { px: 0, py: 0, rz: Math.PI / 2, len: ly }; // xmin
  }
  panelMesh(kind, len, out, rotZ, flip, uvRect, spec) {
    const T = this.T, t = this._t;
    let geo;
    if (kind === 'rect') {
      // 压纹时高细分（顶面承载置换）；段数随面板尺寸
      const seg = this.hasEmb ? Math.max(40, Math.min(240, Math.round(len * 2.2))) : 1;
      const segY = this.hasEmb ? Math.max(40, Math.min(240, Math.round(out * 2.2))) : 1;
      geo = new T.BoxGeometry(len, out, t, seg, segY, 1);
      geo.translate(len / 2, out / 2, t / 2);
      boxUV(geo, len, out, t, rotZ, flip, uvRect, this.sbb, this.innerUV, spec && spec.atlasFace);
    } else {
      geo = new T.ExtrudeGeometry(shapeOf(T, kind, len, out, this._shapeN), { depth: t, bevelEnabled: false, curveSegments: 6 });
      retopUV(geo, len, out, rotZ, flip, uvRect, this.sbb, this.innerUV, t, spec && spec.atlasFace);
    }
    const m = new T.Mesh(geo, [this.faceMat, this.coreMat]);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  buildNode(parentGroup, parentDims, spec, depth, pc, rotZ) {
    const T = this.T;
    if (depth === 0) {
      const rz = spec.uvRot || 0;
      const rootMesh = this.panelMesh('rect', spec.lx, spec.ly, rz, flipOf(rz, spec.attach), spec.uv, spec);
      rootMesh.userData.panel = { panelId: spec.panelId, role: spec.role, surface: spec.surface, up: spec.up, heroRegion: spec.heroRegion };
      parentGroup.add(rootMesh);
      for (const kid of (spec.kids || [])) this.buildNode(parentGroup, spec, kid, 1, pc, rz);
      return;
    }
    const f = this.edgeFrame(parentDims.lx, parentDims.ly, spec.edge);
    const rz = (rotZ + ROTADD[spec.edge]) % 360;
    const g = new T.Group(); g.position.set(f.px, f.py, 0); g.rotation.z = f.rz;
    const fg = new T.Group(); g.add(fg);
    this._shapeN = spec.n || null;
    const mesh = this.panelMesh(spec.shape || 'rect', f.len, spec.out, rz, flipOf(rz, spec.attach), spec.uv, spec);
    mesh.userData.panel = { panelId: spec.panelId, role: spec.role, surface: spec.surface, up: spec.up, heroRegion: spec.heroRegion };
    this._shapeN = null;
    // 纸层堆叠：副翼类面板沿法向内缩，消除合盖后的共面 z-fighting
    const zoff = { glue: -1.05, dust: -0.62, ear: -0.62, tuck: -0.55 }[spec.shape] || 0;
    if (zoff) mesh.position.z = zoff * this._t;
    fg.add(mesh);
    parentGroup.add(g);
    this.nodes.push({ fg, depth, angle: deg(spec.angle == null ? 90 : spec.angle), sign: pc.sign });
    const dims = { lx: f.len, ly: spec.out };
    for (const kid of (spec.kids || [])) this.buildNode(fg, dims, kid, depth + 1, pc, rz);
  }

  build(pieces, t, faceMat, coreMat) {
    const T = this.T;
    this._t = t; this.faceMat = faceMat; this.coreMat = coreMat;
    this.nodes = [];
    const root = new T.Group();
    for (const pc of pieces) {
      const pg = new T.Group();
      pg.rotation.x = -Math.PI / 2;           // 展开图 XY → 地面，+z → 世界上方
      pg.position.set(0, 0.5, 0);
      pc.pg = pg;
      const pv = new T.Group();
      pv.position.set(pc.off[0], 0, pc.off[1]);
      pv.add(pg); pc.pivot = pv;
      this.buildNode(pg, null, pc.tree, 0, pc, 0);
      root.add(pv);
    }
    this.maxDepth = Math.max(1, ...this.nodes.map(n => n.depth));
    return root;
  }

  applyFold(pieces, fold) {
    const k = clamp(fold / 100, 0, 1);
    const hasAsm = (pieces || []).some(pc => pc.asm);
    const ss = v => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };
    const kF = hasAsm ? clamp(k / 0.68, 0, 1) : k;
    const kA = hasAsm ? clamp((k - 0.7) / 0.3, 0, 1) : 0;
    const ke = ss(kF);
    const D = this.maxDepth || 1;
    for (const n of this.nodes) {
      const kd = clamp(kF * D - (D - n.depth), 0, 1);
      const e = kd * kd * (3 - 2 * kd);
      n.fg.rotation.x = n.sign * e * n.angle;
    }
    for (const pc of (pieces || [])) {
      pc.pg.position.y = 0.5 + (pc.sign < 0 ? ke * pc.lift : 0);
      const pv = pc.pivot; if (!pv) continue;
      pv.position.set(pc.off[0], 0, pc.off[1]); pv.rotation.set(0, 0, 0);
      if (pc.stand) {
        const kS2 = ss(clamp((k - 0.85) / 0.15, 0, 1));
        pv.rotation.x = Math.PI / 2 * kS2;
      }
      if (!pc.asm || kA <= 0) continue;
      const { L, W, H, t } = this._dims;
      // 双件套合：盖/套筒与盒体共面处留 0.35mm 装配间隙
      if (pc.asm.type === 'lid') {
        const hh = pc.asm.hh, L2 = pc.asm.lx, W2 = pc.asm.ly;
        const kH = ss(kA / 0.6), kV = ss((kA - 0.6) / 0.4);
        const tx = -(L2 - L) / 2, tz = -W - (W2 - W) / 2;
        const hover = H + hh + 16;
        pv.rotation.x = Math.PI * kH;                     // 翻面：盖口朝下
        pv.position.x = pc.off[0] + (tx - pc.off[0]) * kH;
        pv.position.z = tz * kH;
        pv.position.y = hover * kH - (hover - (H + t + 0.95)) * kV;
      } else if (pc.asm.type === 'drawer') {
        const kS = ss(kA);
        const target = pc.asm.d - L * 0.15;               // 末态留 15% 抽出
        pv.position.x = pc.off[0] + (target - pc.off[0]) * kS;
        pv.position.y = (t + 0.55) * kS;
        pv.position.z = -(t + 0.35) * kS;
      }
    }
  }
}

// —— 盒型折叠树（与 2D gen* 共用尺寸公式；uv = 2D 刀版坐标矩形，attach = 2D 中挂于母板哪侧） ——
export function makePieces(tpl, L, W, H, t, glue) {
  const dh = Math.min(W * 0.75, 32), tk = Math.min(16, W * 0.55);
  if (tpl === 'rte' || tpl === 'ste') {
    const bh = H + t, lidH = W + t;
    const xs1 = W + t, xs2 = W + t + L + t, xs3 = xs2 + W + t;
    const kids = [
      {
        edge: 'xmin', out: W, uv: [0, 0, W + t, bh], attach: 'l', kids: [
          { edge: 'xmax', out: dh, shape: 'dust', uv: [0, bh, W + t, dh], attach: 'b' },
          { edge: 'xmin', out: dh, shape: 'dust', uv: [0, -dh, W + t, dh], attach: 't' },
          { edge: 'far', out: glue, shape: 'glue', uv: [-glue, 0, glue, bh], attach: 'l' }]
      },
      {
        edge: 'xmax', out: W, uv: [xs2, 0, W + t, bh], attach: 'r', kids: [
          { edge: 'xmin', out: dh, shape: 'dust', uv: [xs2, bh, W + t, dh], attach: 'b' },
          { edge: 'xmax', out: dh, shape: 'dust', uv: [xs2, -dh, W + t, dh], attach: 't' },
          {
            edge: 'far', out: L, uv: [xs3, 0, L + 2 * t, bh], attach: 'r', kids: [
              ...(tpl === 'rte' ? [{
                edge: 'xmax', out: W, shape: 'lid', uv: [xs3, bh, L + 2 * t, lidH], attach: 'b', kids: [
                  { edge: 'far', out: tk, shape: 'tuck', angle: 100, uv: [xs3, bh + lidH, L + 2 * t, tk], attach: 'b' }]
              }] : [])
            ]
          }]
      },
      {
        edge: 'far', out: W, shape: 'lid', uv: [xs1, -lidH, L + t, lidH], attach: 't', kids: [
          { edge: 'far', out: tk, shape: 'tuck', angle: 100, uv: [xs1, -lidH - tk, L + t, tk], attach: 't' }]
      }
    ];
    if (tpl === 'ste') kids.push({
      edge: 'near', out: W, shape: 'lid', uv: [xs1, bh, L + t, lidH], attach: 'b', kids: [
        { edge: 'far', out: tk, shape: 'tuck', angle: 100, uv: [xs1, bh + lidH, L + t, tk], attach: 'b' }]
    });
    return [{ tree: { lx: L, ly: H, uv: [xs1, 0, L + t, bh], panelId: 'front', role: 'hero', surface: 'outside', up: 'top', kids }, sign: -1, lift: W, off: [0, 0], stand: true }];
  }
  if (tpl === 'mailer') {
    const tk2 = Math.min(H * 0.7, 28), dw = Math.min(H * 0.8, 26);
    const Lc = L + 2 * t, Wl = W + 3 * t, Hb = H + t, Wb = W + t, Hf = H, Sw = H + t;
    const y1 = Wl, y2 = y1 + Hb, y3 = y2 + Wb;
    const eh = Math.min(Hf - 1, Sw * 0.95);
    const tree = {
      lx: L, ly: W, uv: [0, y2, Lc, Wb], kids: [
        {
          edge: 'far', out: H, uv: [0, y1, Lc, Hb], attach: 't', kids: [{
            edge: 'far', out: W, uv: [0, 0, Lc, Wl], panelId: 'mailer-lid', role: 'hero', surface: 'outside', up: 'top', atlasFace: 'back', attach: 't', kids: [
              { edge: 'far', out: tk2, shape: 'tuck', angle: 100, uv: [0, -tk2, Lc, tk2], attach: 't' },
              { edge: 'xmin', out: dw, shape: 'dust', uv: [-dw, 0, dw, y1], attach: 'l' },
              { edge: 'xmax', out: dw, shape: 'dust', uv: [Lc, 0, dw, y1], attach: 'r' }]
          }]
        },
        { edge: 'near', out: H, uv: [0, y3, Lc, Hf], attach: 'b' },
        {
          edge: 'xmin', out: H, uv: [-Sw, y2, Sw, Wb], attach: 'l', kids: [
            { edge: 'xmin', out: Math.min(H * 0.9, L * 0.45), shape: 'ear', uv: [-Sw, y3, Sw, eh], attach: 'b' }]
        },
        {
          edge: 'xmax', out: H, uv: [Lc, y2, Sw, Wb], attach: 'r', kids: [
            { edge: 'xmax', out: Math.min(H * 0.9, L * 0.45), shape: 'ear', uv: [Lc, y3, Sw, eh], attach: 'b' }]
        }
      ]
    };
    return [{ tree, sign: 1, lift: 0, off: [0, 0] }];
  }
  const tray = (Lt, Wt, hh, ox) => {
    const eo = Math.min(hh, Wt * 0.85);
    const cx1 = ox + hh, cx2 = cx1 + Lt, cy2 = hh + Wt;
    return {
      lx: Lt, ly: Wt, uv: [cx1, hh, Lt, Wt], kids: [
        {
          edge: 'far', out: hh, uv: [cx1, cy2, Lt, hh], attach: 'b', kids: [
            { edge: 'xmin', out: eo, shape: 'ear', uv: [ox, cy2, hh, hh], attach: 'l' },
            { edge: 'xmax', out: eo, shape: 'ear', uv: [cx2, cy2, hh, hh], attach: 'r' }]
        },
        {
          edge: 'near', out: hh, uv: [cx1, 0, Lt, hh], attach: 't', kids: [
            { edge: 'xmin', out: eo, shape: 'ear', uv: [ox, 0, hh, hh], attach: 'l' },
            { edge: 'xmax', out: eo, shape: 'ear', uv: [cx2, 0, hh, hh], attach: 'r' }]
        },
        { edge: 'xmin', out: hh, uv: [ox, hh, hh, Wt], attach: 'l' },
        { edge: 'xmax', out: hh, uv: [cx2, hh, hh, Wt], attach: 'r' }
      ]
    };
  };
  if (tpl === 'lidbase') {
    const hh2 = Math.max(14, H * 0.45);
    const L2 = L + 2 * t + 1, W2 = W + 2 * t + 1, D = L + 2 * H + 45;
    const ox2 = 2 * H + L + 28;
    return [
      { tree: tray(L, W, H, 0), sign: 1, lift: 0, off: [0, 0] },
      { tree: { ...tray(L2, W2, hh2, ox2), panelId: 'lid-top', role: 'hero', surface: 'outside', up: 'top', atlasFace: 'back' }, sign: 1, lift: 0, off: [D, 0], asm: { type: 'lid', hh: hh2, lx: L2, ly: W2 } }
    ];
  }
  // 卷筒盒（圆柱 24 棱 / 六边形 6 棱）：p0 根段 → xmax 出 p1 → far 逐段卷合；正 N 边形顶/底盖
  if (tpl === 'cyl' || tpl === 'hex') {
    const N = tpl === 'cyl' ? 24 : 6;
    const wSeg = tpl === 'cyl' ? Math.PI * L / 24 : W;
    const bh = H + t;
    const { a, Rp, h } = discBbox(N, wSeg);
    let chain = null;
    for (let i = N - 1; i >= 1; i--) {
      chain = { edge: i === 1 ? 'xmax' : 'far', out: wSeg, angle: 360 / N, uv: [i * wSeg, 0, wSeg, bh], attach: 'r', kids: chain ? [chain] : [] };
    }
    const kids = [
      chain,
      { edge: 'far', out: h, shape: 'disc', n: N, uv: [wSeg / 2 - Rp, -(a + Rp), 2 * Rp, a + Rp], attach: 't' },
      { edge: 'near', out: h, shape: 'disc', n: N, uv: [wSeg / 2 - Rp, bh, 2 * Rp, a + Rp], attach: 'b' }
    ].filter(Boolean);
    return [{ tree: { lx: wSeg, ly: bh, uv: [0, 0, wSeg, bh], panelId: 'tube-body', role: 'hero', surface: 'outside', up: 'top', heroRegion: N === 24 ? [9 / 24, 0, 6 / 24, 1] : [3 / 6, 0, 1 / 6, 1], kids }, sign: -1, lift: Rp, off: [0, 0], stand: true }];
  }
  if (tpl !== 'drawer') throw new Error(`未知盒型：${tpl}；请先补齐结构与 3D 同步契约`);
  // drawer：内盒托盘 + 套筒（root uvRot=90：3D lx 沿 2D band 纵向）
  const D2 = L + 2 * H + 45;
  const oxS = 2 * H + L + 28;
  const sxs1 = oxS + H + 2 * t, sxs2 = sxs1 + W + 3 * t, sxs3 = sxs2 + H + 3 * t;
  const band = L + 2;
  const sleeve = {
    lx: L, ly: W + 2 * t, uvRot: 90, uv: [sxs1, 0, W + 3 * t, band], panelId: 'sleeve-top', role: 'hero', surface: 'outside', up: 'left', kids: [{
      edge: 'far', out: H + 2 * t, uv: [oxS, 0, H + 2 * t, band], attach: 'l', kids: [{
        edge: 'far', out: W + 3 * t, uv: [sxs3, 0, W + 4 * t, band], attach: 'l', kids: [{
          edge: 'far', out: H + 3 * t, uv: [sxs2, 0, H + 3 * t, band], attach: 'l', kids: [
            { edge: 'far', out: 12, shape: 'glue', uv: [oxS - 12, 0, 12, band], attach: 'l' }]
        }]
      }]
    }]
  };
  return [
    { tree: tray(L, W, H, 0), sign: 1, lift: 0, off: [0, 0], asm: { type: 'drawer', d: D2 } },
    { tree: sleeve, sign: -1, lift: H, off: [D2, 0] }
  ];
}
