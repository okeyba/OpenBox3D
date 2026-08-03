import assert from 'node:assert/strict';
import { geomOf } from '../src/dieline/geom.js';
import { heroPanelOf } from '../src/dieline/hero.js';
import { TPLS } from '../src/dieline/templates.js';
import { makePieces } from '../src/render3d/fold.js';

// 结构页是一张生产刀版，3D 会把组合翼片拆开、把卷筒分段，并可省略成品内藏糊口；
// 因此这里核对语义库存，而不是把 2D fill 数量与 3D mesh 数量简单画等号。
const CONTRACTS = {
  rte:     { pieces: 1, main: 6, accessory: 6, glue: 1, panels: 6, asm: [] },
  ste:     { pieces: 1, main: 6, accessory: 6, glue: 1, panels: 6, asm: [] },
  mailer:  { pieces: 1, main: 6, accessory: 5, glue: 0, panels: 6, asm: [] },
  lidbase: { pieces: 2, main: 10, accessory: 8, glue: 0, panels: 10, asm: ['lid'] },
  drawer:  { pieces: 2, main: 9, accessory: 4, glue: 1, panels: 9, asm: ['drawer'] },
  // 卷筒生产刀版含糊口；闭合 3D 壳省略被筒身覆盖的内藏糊口。
  cyl:     { pieces: 1, main: 26, accessory: 0, glue: 0, panels: 3, asm: [] },
  hex:     { pieces: 1, main: 8, accessory: 0, glue: 0, panels: 8, asm: [] }
};

const CASES = [
  { name: '默认竖盒', L: 80, W: 40, H: 120, t: 0.45, glue: 14 },
  { name: '低矮宽盒', L: 120, W: 75, H: 36, t: 0.5, glue: 18 },
  { name: '厚纸小盒', L: 55, W: 32, H: 68, t: 1.5, glue: 10 }
];

const ACCESSORY = new Set(['dust', 'tuck', 'ear']);
const flatten = node => [node, ...(node.kids || []).flatMap(flatten)];
const bboxOf = pts => pts.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const contains = (b, x, y) => x >= b[0] - 1e-6 && x <= b[2] + 1e-6 && y >= b[1] - 1e-6 && y <= b[3] + 1e-6;
const same = v => JSON.parse(JSON.stringify(v ?? null));

const ids = TPLS.map(t => t.id).sort();
assert.deepEqual(Object.keys(CONTRACTS).sort(), ids, 'TPLS 与 3D 同步契约不一致；新增盒型必须登记并完成三视图验收');

for (const c of CASES) {
  for (const tpl of ids) {
    const state = { tpl, L: c.L, W: c.W, H: c.H, bleed: 3, glue: c.glue, ovr: {}, typeOvr: {} };
    const geom = geomOf(state, c.t);
    const pieces = makePieces(tpl, c.L, c.W, c.H, c.t, c.glue);
    const nodes = pieces.flatMap(p => flatten(p.tree));
    const contract = CONTRACTS[tpl];
    const counts = { main: 0, accessory: 0, glue: 0 };

    assert.ok(geom.fills.length && nodes.length, `${tpl}/${c.name} 未生成完整的 2D 或 3D 数据`);
    assert.equal(pieces.length, contract.pieces, `${tpl}/${c.name} 复合件数量漂移`);
    for (const node of nodes) {
      const shape = node.shape || 'rect';
      if (shape === 'glue') counts.glue++;
      else if (ACCESSORY.has(shape)) counts.accessory++;
      else counts.main++;
      assert.ok(Array.isArray(node.uv) && node.uv.length === 4 && node.uv.every(Number.isFinite), `${tpl}/${c.name} 存在无效 UV`);
      assert.ok(node.uv[2] > 0 && node.uv[3] > 0, `${tpl}/${c.name} 存在非正 UV 尺寸`);
    }
    assert.deepEqual(counts, { main: contract.main, accessory: contract.accessory, glue: contract.glue }, `${tpl}/${c.name} 3D 板件库存与契约不一致`);
    assert.deepEqual(pieces.map(p => p.asm?.type).filter(Boolean).sort(), contract.asm, `${tpl}/${c.name} 装配类型漂移`);

    assert.equal(geom.panels.length, contract.panels, `${tpl}/${c.name} 可设计容器数量漂移`);
    assert.equal(new Set(geom.panels.map(p => p.panelId)).size, geom.panels.length, `${tpl}/${c.name} 可设计容器 panelId 必须唯一`);
    for (const panel of geom.panels) {
      assert.ok(panel.panelId, `${tpl}/${c.name} 存在无 panelId 的可设计容器`);
      assert.equal(panel.surface, 'outside', `${tpl}/${c.name}/${panel.panelId} 可设计容器必须是外表面`);
      assert.ok(panel.up, `${tpl}/${c.name}/${panel.panelId} 缺少画面方向`);
      assert.ok(Array.isArray(panel.pts) && panel.pts.length >= 3 && panel.pts.flat().every(Number.isFinite), `${tpl}/${c.name}/${panel.panelId} 边界点无效`);
      const [x0, y0, x1, y1] = bboxOf(panel.pts);
      assert.ok(x1 > x0 && y1 > y0, `${tpl}/${c.name}/${panel.panelId} 容器边界退化`);
    }
    assert.equal(geom.panels.filter(p => p.role === 'hero' && p.surface === 'outside').length, 1, `${tpl}/${c.name} 2D C 位必须且只能有一个`);
    if (tpl === 'cyl') assert.equal(geom.panels.filter(p => p.panelId.startsWith('tube-face-')).length, 0, `${tpl}/${c.name} 圆柱筒身必须合并为一个容器`);
    if (tpl === 'hex') assert.equal(geom.panels.filter(p => p.panelId === 'tube-body' || p.panelId.startsWith('tube-face-')).length, 6, `${tpl}/${c.name} 六边形筒身必须保持六个独立容器`);

    const hero2d = heroPanelOf(geom);
    const heroes3d = nodes.filter(n => n.role === 'hero' && n.surface === 'outside');
    assert.ok(hero2d, `${tpl}/${c.name} 缺少 2D C 位语义`);
    assert.equal(heroes3d.length, 1, `${tpl}/${c.name} 3D C 位必须且只能有一个`);
    const hero3d = heroes3d[0];
    assert.deepEqual(
      { panelId: hero3d.panelId, role: hero3d.role, surface: hero3d.surface, up: hero3d.up, heroRegion: same(hero3d.heroRegion) },
      { panelId: hero2d.panelId, role: hero2d.role, surface: hero2d.surface, up: hero2d.up, heroRegion: same(hero2d.heroRegion) },
      `${tpl}/${c.name} 结构、设计与 3D 的 C 位语义不一致`
    );

    const fillBoxes = geom.fills.map(bboxOf);
    for (const node of nodes) {
      const [x, y, w, h] = node.uv, cx = x + w / 2, cy = y + h / 2;
      assert.ok(fillBoxes.some(b => contains(b, cx, cy)), `${tpl}/${c.name} 的 3D UV 中心未落在任何 2D 板件内：${node.panelId || node.shape || 'rect'}`);
      if (node.edge) assert.ok(['far', 'near', 'xmin', 'xmax'].includes(node.edge), `${tpl}/${c.name} 存在未知折叠边`);
      if (node.attach) assert.ok(['t', 'b', 'l', 'r'].includes(node.attach), `${tpl}/${c.name} 存在未知刀版连接边`);
    }

    if (tpl === 'rte' || tpl === 'ste') {
      const glueNode = nodes.find(n => n.shape === 'glue');
      assert.equal(glueNode.out, c.glue, `${tpl}/${c.name} 的 3D 糊口宽度未跟随结构参数`);
    }
  }
}

assert.throws(() => makePieces('__unknown__', 80, 40, 120, 0.45, 14), /未知盒型/, '未知盒型必须立即失败，禁止静默回退到其它折叠树');
console.log(`结构/设计/3D 同步检查通过：${ids.length} 个盒型 × ${CASES.length} 组尺寸`);
