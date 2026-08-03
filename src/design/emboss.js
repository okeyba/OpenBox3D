// 压纹方向与通道合成：旧图层回退全局方向，重叠处按图层顺序由顶层覆盖。
import { drawLayer } from './layers.js';
import { clipPtsOf } from './containers.js';

const canvasOf = (W, H, fill) => {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  if (fill) { const g = c.getContext('2d'); g.fillStyle = fill; g.fillRect(0, 0, W, H); }
  return c;
};

const paintMasked = (base, mask, color, t) => {
  const g = t.getContext('2d');
  g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, t.width, t.height); g.fillStyle = color; g.fillRect(0, 0, t.width, t.height);
  g.globalCompositeOperation = 'destination-in'; g.drawImage(mask, 0, 0);
  base.getContext('2d').drawImage(t, 0, 0);
};

const hasInk = c => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
};

export const embDirOf = (layer, fallback = 'up') => layer.embDir === 'down' ? 'down' : layer.embDir === 'up' ? 'up' : fallback === 'down' ? 'down' : 'up';

export function composeEmbossChannels({ layers, panels, W, H, S, ox = 0, oy = 0, fallbackDir = 'up', blurPx = 0 }) {
  const signed = canvasOf(W, H, '#808080'), up = canvasOf(W, H, '#000'), down = canvasOf(W, H, '#000'), any = canvasOf(W, H);
  const scratch = canvasOf(W, H);
  let hasUp = false, hasDown = false;
  for (const layer of layers) {
    let mask = canvasOf(W, H), mg = mask.getContext('2d');
    mg.save(); mg.translate(-ox * S, -oy * S); drawLayer(mg, layer, S, '#fff', clipPtsOf(panels, layer)); mg.restore();
    if (blurPx > 0) { const blurred = canvasOf(W, H), bg = blurred.getContext('2d'); bg.filter = 'blur(' + blurPx + 'px)'; bg.drawImage(mask, 0, 0); bg.filter = 'none'; mask = blurred; }
    const dir = embDirOf(layer, fallbackDir);
    paintMasked(up, mask, '#000', scratch); paintMasked(down, mask, '#000', scratch);
    paintMasked(signed, mask, dir === 'up' ? '#fff' : '#000', scratch);
    paintMasked(dir === 'up' ? up : down, mask, '#fff', scratch); paintMasked(any, mask, '#fff', scratch);
    if (dir === 'up') hasUp = true; else hasDown = true;
  }
  hasUp = hasUp && hasInk(up); hasDown = hasDown && hasInk(down);
  return { signed, up, down, any, hasUp, hasDown, hasEmb: hasUp || hasDown };
}
