// C 位语义入口：仅从模板已生成的实际面板点集派生，不维护另一份毫米坐标表。
const bboxOfPts = pts => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return [x0, y0, x1, y1];
};

export function heroPanelOf(g) {
  const panel = (g.panels || []).find(p => p.role === 'hero' && p.surface === 'outside');
  if (!panel) return null;
  const box = panel.heroBox || bboxOfPts(panel.pts);
  const margin = Math.min(3, (box[2] - box[0]) / 4, (box[3] - box[1]) / 4);
  const safeBox = [box[0] + margin, box[1] + margin, box[2] - margin, box[3] - margin];
  return { ...panel, box, safeBox, cx: (safeBox[0] + safeBox[2]) / 2, cy: (safeBox[1] + safeBox[3]) / 2 };
}

export function containInHero(hero, w, h, margin = 0) {
  const b = hero.safeBox, pw = Math.max(1, b[2] - b[0] - 2 * margin), ph = Math.max(1, b[3] - b[1] - 2 * margin);
  const sc = Math.min(1, pw / Math.max(1e-6, w), ph / Math.max(1e-6, h));
  const nw = Math.round(w * sc * 10) / 10, nh = Math.round(h * sc * 10) / 10;
  return [Math.round(((b[0] + b[2] - nw) / 2) * 10) / 10, Math.round(((b[1] + b[3] - nh) / 2) * 10) / 10, nw, nh];
}

export function placeHeroPresets(layers, hero) {
  if (!hero) return layers;
  const b = hero.safeBox, pw = b[2] - b[0], ph = b[3] - b[1];
  return layers.map(l => {
    const a = l.heroPreset, panelId = l.panelId == null ? hero.panelId : l.panelId;
    if (!a) return panelId === l.panelId ? l : { ...l, panelId };
    if (l.kind === 'text') return { ...l, panelId, x: b[0] + pw * a.cx, y: b[1] + ph * a.cy, size: Math.min(a.size, pw / a.fitChars) };
    return { ...l, panelId, x: b[0] + pw * a.x, y: b[1] + ph * a.y, w: pw * a.w, h: ph * a.h };
  });
}
