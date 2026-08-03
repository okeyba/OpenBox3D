// 图片上传：FileReader → dataURL；记录自然尺寸供 DPI 计算；支持替换与新增
import { store } from '../state/store.js';
import { containInHero } from '../dieline/hero.js';
import { bboxOfPts } from './containers.js';
import { randomImageName } from './layers.js';

export const imageFilesOf = files => Array.from(files || []).filter(f => /^image\/(png|jpeg|webp)$/i.test(f.type));

export const readImageFile = file => new Promise((resolve, reject) => {
  const rd = new FileReader();
  rd.onerror = reject;
  rd.onload = () => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => resolve({ imgSrc: rd.result, img, imgW: img.naturalWidth, imgH: img.naturalHeight, pxw: img.naturalWidth });
    img.src = rd.result;
  };
  rd.readAsDataURL(file);
});

export function imageLayerAt(id, asset, panel, point) {
  const rawW = Math.round(asset.imgW / 300 * 25.4 * 10) / 10, rawH = Math.round(asset.imgH / 300 * 25.4 * 10) / 10;
  const b = bboxOfPts(panel.pts), margin = Math.min(3, (b[2] - b[0]) / 4, (b[3] - b[1]) / 4);
  const maxW = b[2] - b[0] - margin * 2, maxH = b[3] - b[1] - margin * 2;
  const scale = Math.min(1, maxW / rawW, maxH / rawH);
  const w = Math.round(rawW * scale * 10) / 10, h = Math.round(rawH * scale * 10) / 10;
  const x = Math.min(b[2] - margin - w, Math.max(b[0] + margin, point[0] - w / 2));
  const y = Math.min(b[3] - margin - h, Math.max(b[1] + margin, point[1] - h / 2));
  const name = randomImageName();
  return { id, kind: 'image', name, content: name, x, y, w, h, panelId: panel.panelId, finish: 'none', visible: true, ...asset };
}

export function uploadImage(addL, replaceId) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp';
  inp.onchange = () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    readImageFile(f).then(asset => {
      if (replaceId != null) {
        store.set(st => ({ layers: st.layers.map(l => l.id === replaceId ? { ...l, ...asset } : l) }));
      } else {
        const w = Math.round(asset.imgW / 300 * 25.4 * 10) / 10, h = Math.round(asset.imgH / 300 * 25.4 * 10) / 10;
        addL((id, hero) => {
          const [x, y, fw, fh] = containInHero(hero, w, h), name = randomImageName();
          return { id, kind: 'image', name, content: name, x, y, w: fw, h: fh, finish: 'none', visible: true, ...asset };
        });
      }
    });
  };
  inp.click();
}
