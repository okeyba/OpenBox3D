// 图集烘焙管线（核心）：整版一张图集，烘焙 albedo/normal/roughness/metalness/clearcoat/displacement 六通道
// 坐标系 = 2D 刀版展开图（mm），外扩 bleed 作为出血区；UV = 展开图坐标归一化（v 翻转）
import { drawLayer } from '../design/layers.js';
import { composeEmbossChannels } from '../design/emboss.js';
import { clipPtsOf } from '../design/containers.js';
import { paperHeightTile, normalFromHeight, kraftFiberTile } from './paper.js';
import { paperPreset, filmPreset } from './presets.js';

const mk = (W, H) => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };

// 以 mask  canvas（白=作用区）把 overlay canvas 画到 base 上
function maskDraw(base, overlay, mask) {
  const t = mk(base.width, base.height);
  const tg = t.getContext('2d');
  tg.drawImage(overlay, 0, 0);
  tg.globalCompositeOperation = 'destination-in';
  tg.drawImage(mask, 0, 0);
  base.getContext('2d').drawImage(t, 0, 0);
}

// 平铺绘制 tile（tileMm 物理尺寸）
function tileDraw(ctx, tile, S, tileMm, W, H, op) {
  const px = tileMm * S;
  ctx.save();
  if (op) ctx.globalCompositeOperation = op;
  for (let y = 0; y < H; y += px) for (let x = 0; x < W; x += px) ctx.drawImage(tile, x, y, px, px);
  ctx.restore();
}

// 低频值噪声（镭射膜厚扰动）：两级随机网格双线性放大后按权重平均，值域约 [0.25, 1]
function lowFreqNoise(W, H) {
  const grid = n => {
    const c = mk(n, n), g = c.getContext('2d'), d = g.createImageData(n, n);
    for (let i = 0; i < d.data.length; i += 4) { const v = 64 + Math.floor(Math.random() * 192); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0);
    return c;
  };
  const out = mk(W, H), g = out.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.globalAlpha = 0.62; g.drawImage(grid(6), 0, 0, W, H);
  g.globalAlpha = 0.38; g.drawImage(grid(17), 0, 0, W, H);
  return out;
}

// 覆膜切换只重绘两张轻量标量图，不重跑图层、纸纹和法线烘焙。
export function paintFilmChannels(baked, filmId, controls = {}) {
  if (!baked || !baked.ccC || !baked.ccRC) return;
  const film = filmPreset(filmId), cg = baked.ccC.getContext('2d'), crg = baked.ccRC.getContext('2d');
  const clamp01 = v => Math.min(1, Math.max(0, v));
  const clearcoat = Number.isFinite(+controls.filmClearcoat) ? clamp01(+controls.filmClearcoat) : film.clearcoat;
  const clearcoatRoughness = Number.isFinite(+controls.filmClearcoatRoughness) ? clamp01(+controls.filmClearcoatRoughness) : film.clearcoatRoughness;
  const uvClearcoat = Number.isFinite(+controls.uvClearcoat) ? clamp01(+controls.uvClearcoat) : 1;
  const uvRoughness = Number.isFinite(+controls.uvRoughness) ? clamp01(+controls.uvRoughness) : 0.05;
  const cv = Math.round(clearcoat * 255), crv = Math.round(clearcoatRoughness * 255);
  cg.globalCompositeOperation = 'source-over'; cg.globalAlpha = 1; cg.fillStyle = 'rgb(' + cv + ',' + cv + ',' + cv + ')'; cg.fillRect(0, 0, baked.ccC.width, baked.ccC.height);
  crg.globalCompositeOperation = 'source-over'; crg.globalAlpha = 1; crg.fillStyle = 'rgb(' + crv + ',' + crv + ',' + crv + ')'; crg.fillRect(0, 0, baked.ccRC.width, baked.ccRC.height);
  if (baked.hasSuv && baked.maskUv) {
    const uvHi = mk(baked.ccC.width, baked.ccC.height), ug = uvHi.getContext('2d'), uvv = Math.round(uvClearcoat * 255); ug.fillStyle = 'rgb(' + uvv + ',' + uvv + ',' + uvv + ')'; ug.fillRect(0, 0, uvHi.width, uvHi.height); maskDraw(baked.ccC, uvHi, baked.maskUv);
    const uvLo = mk(baked.ccC.width, baked.ccC.height), ul = uvLo.getContext('2d'), urv = Math.round(uvRoughness * 255); ul.fillStyle = 'rgb(' + urv + ',' + urv + ',' + urv + ')'; ul.fillRect(0, 0, uvLo.width, uvLo.height); maskDraw(baked.ccRC, uvLo, baked.maskUv);
  }
}

// 仅重绘箔区粗糙度（金/银两 mask 统一），不重复图层、纸纹与法线烘焙。
export function paintFoilRoughness(baked, value) {
  if (!baked || !baked.hasFoil || !baked.roughC) return;
  const roughness = Math.min(1, Math.max(0, Number.isFinite(+value) ? +value : 0.22));
  const foilR = mk(baked.roughC.width, baked.roughC.height), fg = foilR.getContext('2d'), rv = Math.round(roughness * 255);
  fg.fillStyle = 'rgb(' + rv + ',' + rv + ',' + rv + ')'; fg.fillRect(0, 0, foilR.width, foilR.height);
  if (baked.maskFoil) maskDraw(baked.roughC, foilR, baked.maskFoil);
  if (baked.maskSilver) maskDraw(baked.roughC, foilR, baked.maskSilver);
}

export function bakeAtlas(o) {
  const { layers, panels, sbb, bleed, paperId, filmId, embDepth, embDir, embBoost } = o;
  const paper = paperPreset(paperId);
  const foilEnabled = o.foilOn !== false && o.foilOn !== '0', suvEnabled = o.suvOn !== false && o.suvOn !== '0', glossEnabled = o.glossOn !== false && o.glossOn !== '0', holoEnabled = o.holoOn !== false && o.holoOn !== '0';
  const grainStrength = Math.max(0, Math.min(1.5, o.grainStrength == null ? paper.grainStrength : o.grainStrength));
  const grainScale = Math.max(3, Math.min(20, o.grainScale || paper.grainMm));
  const pad = Math.max(2, bleed || 0);
  const Wmm = (sbb[2] - sbb[0]) + 2 * pad, Hmm = (sbb[3] - sbb[1]) + 2 * pad;
  const S = Math.min(8, 4096 / Math.max(Wmm, Hmm));
  const W = Math.round(Wmm * S), H = Math.round(Hmm * S);
  const ox = sbb[0] - pad, oy = sbb[1] - pad;
  const X = v => (v - ox) * S, Y = v => (v - oy) * S;
  const vis = layers.filter(l => l.visible);

  // —— albedo：纸基色 →（kraft 纤维正片叠底）→ 图层 ——
  const colorC = mk(W, H), cc0 = colorC.getContext('2d');
  cc0.fillStyle = paper.color; cc0.fillRect(0, 0, W, H);
  if (paper.grain === 'kraft') { cc0.save(); cc0.globalAlpha = Math.min(0.3, grainStrength * 0.28); tileDraw(cc0, kraftFiberTile(), S, grainScale, W, H, 'multiply'); cc0.restore(); }
  cc0.save(); cc0.translate(-ox * S, -oy * S);
  for (const l of vis) drawLayer(cc0, l, S, undefined, clipPtsOf(panels, l));
  cc0.restore();

  // —— 工艺 mask：金箔 / 银箔分通道（albedo 分别染 foilColor / silverColor，不再统一染金） ——
  const foilC = mk(W, H), silverC = mk(W, H), uvC = mk(W, H), glossC = mk(W, H), holoC = mk(W, H);
  const fc = foilC.getContext('2d'), sc = silverC.getContext('2d'), uc = uvC.getContext('2d'), gc = glossC.getContext('2d'), hc = holoC.getContext('2d');
  fc.save(); fc.translate(-ox * S, -oy * S);
  sc.save(); sc.translate(-ox * S, -oy * S);
  uc.save(); uc.translate(-ox * S, -oy * S);
  gc.save(); gc.translate(-ox * S, -oy * S);
  hc.save(); hc.translate(-ox * S, -oy * S);
  let hasFoil = false, hasSilver = false, hasSuv = false, hasGloss = false, hasHolo = false;
  for (const l of vis) {
    if (l.finish === 'foil' && foilEnabled) { drawLayer(fc, l, S, '#fff', clipPtsOf(panels, l)); hasFoil = true; }
    else if (l.finish === 'silver' && foilEnabled) { drawLayer(sc, l, S, '#fff', clipPtsOf(panels, l)); hasSilver = true; }
    else if (l.finish === 'uv' && suvEnabled) { drawLayer(uc, l, S, '#fff', clipPtsOf(panels, l)); hasSuv = true; }
    else if (l.finish === 'gloss' && glossEnabled) { drawLayer(gc, l, S, '#fff', clipPtsOf(panels, l)); hasGloss = true; }
    else if (l.finish === 'holo' && holoEnabled) { drawLayer(hc, l, S, '#fff', clipPtsOf(panels, l)); hasHolo = true; }
  }
  fc.restore(); sc.restore(); uc.restore(); gc.restore(); hc.restore();
  const anyFoil = hasFoil || hasSilver;
  const foilColor = typeof o.foilColor === 'string' ? o.foilColor : '#ffdb91', silverColor = typeof o.silverColor === 'string' ? o.silverColor : '#faf7f2';
  if (hasFoil) {
    const foilTone = mk(W, H), ft = foilTone.getContext('2d');
    ft.fillStyle = foilColor; ft.fillRect(0, 0, W, H);
    maskDraw(colorC, foilTone, foilC);
  }
  if (hasSilver) {
    const silverTone = mk(W, H), st = silverTone.getContext('2d');
    st.fillStyle = silverColor; st.fillRect(0, 0, W, H);
    maskDraw(colorC, silverTone, silverC);
  }
  // 镭射区染银白基色（幻彩由 iridescence 随角度产生，albedo 只需浅底）
  if (hasHolo) {
    const holoTone = mk(W, H), ht = holoTone.getContext('2d');
    ht.fillStyle = '#edf1f6'; ht.fillRect(0, 0, W, H);
    maskDraw(colorC, holoTone, holoC);
  }

  // —— metalness：纸张 metalBase 打底（银卡类全幅金属），金/银箔区并集为白 ——
  const metalBase = Math.max(0, Math.min(1, paper.metalBase || 0));
  const metalC = mk(W, H), mc = metalC.getContext('2d');
  const mv = Math.round(metalBase * 255);
  mc.fillStyle = 'rgb(' + mv + ',' + mv + ',' + mv + ')'; mc.fillRect(0, 0, W, H);
  if (anyFoil) {
    const full = mk(W, H), fg0 = full.getContext('2d');
    fg0.fillStyle = '#fff'; fg0.fillRect(0, 0, W, H);
    if (hasFoil) maskDraw(metalC, full, foilC);
    if (hasSilver) maskDraw(metalC, full, silverC);
  }
  if (hasHolo) { // 镭射区并入金属通道：iridescenceMap（=metal 通道）自动覆盖镭射区；0.85 留少量漫反射防死黑
    const fullH2 = mk(W, H), fh2 = fullH2.getContext('2d');
    fh2.fillStyle = 'rgb(216,216,216)'; fh2.fillRect(0, 0, W, H);
    maskDraw(metalC, fullH2, holoC);
  }

  // —— 压纹高度：中灰为零，白凸黑凹；顶层覆盖重叠区 ——
  const embSharpness = Math.max(0, Math.min(1, Number.isFinite(+o.embSharpness) ? +o.embSharpness : 0.85));
  const emb = composeEmbossChannels({ layers: vis.filter(l => l.finish === 'emboss'), panels, W, H, S, ox, oy, fallbackDir: embDir, blurPx: (1 - embSharpness) * Math.max(2, S * 0.4) });
  const dispC = emb.signed, embBlur = emb.any, hasEmb = emb.hasEmb;

  // —— 高度场：纸纹（overlay 微幅）+ 压纹 ——
  const paperH = mk(W, H), ph = paperH.getContext('2d');
  ph.fillStyle = '#808080'; ph.fillRect(0, 0, W, H);
  ph.save(); ph.globalAlpha = Math.min(1, grainStrength); tileDraw(ph, paperHeightTile(paper.grain), S, grainScale, W, H, 'overlay'); ph.restore();
  const fullH = mk(W, H), fh = fullH.getContext('2d');
  fh.drawImage(paperH, 0, 0);
  if (hasEmb) {
    fh.save();
    fh.globalCompositeOperation = 'overlay'; fh.globalAlpha = 0.9; fh.drawImage(dispC, 0, 0);
    fh.restore();
  }
  const boost = embBoost ? 3 : 1;
  const paperNormalStrength = 0.45 + grainStrength * 1.2;
  const normalPaper = normalFromHeight(paperH, paperNormalStrength);
  const normalFull = normalFromHeight(fullH, paperNormalStrength + (hasEmb ? embDepth * 9 * boost : 0));

  // —— roughness：基材基础值；压纹压光区降低；箔区（金/银统一）foilRoughness ——
  const roughC = mk(W, H), rc = roughC.getContext('2d');
  const rv = 255;
  rc.fillStyle = 'rgb(' + rv + ',' + rv + ',' + rv + ')'; rc.fillRect(0, 0, W, H);
  if (hasEmb) {
    const smooth = mk(W, H), sg = smooth.getContext('2d');
    const sv = 190;
    sg.fillStyle = 'rgb(' + sv + ',' + sv + ',' + sv + ')'; sg.fillRect(0, 0, W, H);
    maskDraw(roughC, smooth, embBlur);
  }
  if (hasGloss) {
    const glossR = mk(W, H), gg = glossR.getContext('2d');
    const gv = Math.round(Math.min(0.5, Math.max(0.02, Number.isFinite(+o.glossRoughness) ? +o.glossRoughness : 0.08)) * 255);
    gg.fillStyle = 'rgb(' + gv + ',' + gv + ',' + gv + ')'; gg.fillRect(0, 0, W, H);
    maskDraw(roughC, glossR, glossC);
  }
  if (anyFoil) {
    const foilR = mk(W, H), fg = foilR.getContext('2d');
    const fv = Math.round(Math.min(1, Math.max(0, Number.isFinite(+o.foilRoughness) ? +o.foilRoughness : 0.22)) * 255);
    fg.fillStyle = 'rgb(' + fv + ',' + fv + ',' + fv + ')'; fg.fillRect(0, 0, W, H);
    if (hasFoil) maskDraw(roughC, foilR, foilC);
    if (hasSilver) maskDraw(roughC, foilR, silverC);
  }
  if (hasHolo) { // 镭射区低粗糙（幻彩箔近镜面）
    const holoR = mk(W, H), hg = holoR.getContext('2d');
    hg.fillStyle = 'rgb(38,38,38)'; hg.fillRect(0, 0, W, H); // 0.15
    maskDraw(roughC, holoR, holoC);
  }

  // —— 镭射膜厚扰动图：白底（=厚度图 Range 上限，与无厚度图行为一致），holo 区叠低频值噪声产生块状多彩 ——
  const holoThickC = hasHolo ? mk(W, H) : null;
  if (hasHolo) {
    const tg = holoThickC.getContext('2d');
    tg.fillStyle = '#fff'; tg.fillRect(0, 0, W, H);
    maskDraw(holoThickC, lowFreqNoise(W, H), holoC);
  }

  // —— clearcoat：覆膜基础值（map 驱动）+ 局部 UV 区 ——
  const ccC = mk(W, H), ccRC = mk(W, H);
  paintFilmChannels({ ccC, ccRC, maskUv: uvC, hasSuv }, filmId, o);

  // —— UV 棋盘（20mm/格，检查贴图密度与拉伸） ——
  const checkerC = mk(W, H), ch = checkerC.getContext('2d');
  ch.fillStyle = '#efeadd'; ch.fillRect(0, 0, W, H);
  ch.fillStyle = '#cfc8b8';
  const step = 20 * S;
  for (let y = 0, r = 0; y < H; y += step, r++) for (let x = (r % 2) * step; x < W; x += 2 * step) ch.fillRect(x, y, step, step);
  ch.strokeStyle = '#c9542e'; ch.lineWidth = Math.max(2, S * 0.5); ch.strokeRect(0, 0, W, H);

  return {
    colorC, normalPaper, normalFull, roughC, metalC, ccC, ccRC, dispC, checkerC,
    maskFoil: foilC, maskSilver: silverC, maskUv: uvC, maskGloss: glossC, maskHolo: holoC, holoThickC, maskEmbUp: emb.up, maskEmbDown: emb.down,
    hasFoil: anyFoil, hasSilver, hasSuv, hasGloss, hasEmb, hasHolo, hasEmbUp: emb.hasUp, hasEmbDown: emb.hasDown, S, W, H,
    // UV 必须按实际烘焙画布（含出血外扩与像素取整）归一化；若仍使用原始 sbb，
    // 3D 面板边缘会采到出血画布里的纸基色，表现为单侧或三侧漏白/漏黑。
    atlasSbb: [ox, oy, ox + W / S, oy + H / S],
    innerUV: [0.5 / W, 1 - 0.5 / H]   // 图集角点（出血区外）= 干净纸色，供面板内壁
  };
}
