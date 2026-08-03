// 程序纸纹：可平铺高度场（正弦叠加天然 tileable）+ Sobel 法线转换
// tileMm = 一个 tile 代表的物理毫米数；画布 128px

function makeTile(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  draw(c.getContext('2d'), 128);
  return c;
}

// 多倍频正弦噪声（可平铺）：h ∈ [-1,1]
function sinNoise(seed, octaves) {
  const comps = [];
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let o = 0; o < octaves; o++) {
    const fx = 1 + Math.floor(rnd() * (2 + o * 2)), fy = 1 + Math.floor(rnd() * (2 + o * 2));
    comps.push({ fx, fy, ph: rnd() * Math.PI * 2, amp: 1 / (o + 1.5) });
  }
  return (x, y) => { // x,y ∈ [0,1)
    let v = 0, a = 0;
    for (const c of comps) { v += c.amp * Math.sin(2 * Math.PI * (c.fx * x + c.fy * y) + c.ph); a += c.amp; }
    return v / a;
  };
}

// 纸纹高度 tile（128 灰度）：细腻纸面起伏；kraft 加水平纤维
export function paperHeightTile(kind) {
  const n1 = sinNoise(kind === 'kraft' ? 7 : kind === 'open' ? 17 : 3, 5);
  const n2 = sinNoise(11, 3);
  return makeTile((g, S) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      let h = n1(u, v) * 0.55 + n2(u * 2 % 1, v * 2 % 1) * 0.2;
      if (kind === 'kraft') {
        // 水平纤维：y 向高频条带 + 沿 x 缓变
        h += Math.sin(2 * Math.PI * (v * 46 + n1(u, v) * 1.5)) * 0.28 + Math.sin(2 * Math.PI * (v * 13 + u * 2)) * 0.12;
      }
      const val = Math.max(0, Math.min(255, 128 + h * (kind === 'kraft' ? 42 : kind === 'open' ? 34 : 22)));
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}

// 高度图 → 切线空间法线图（Sobel）。heightCanvas 灰度；strength 放大梯度
export function normalFromHeight(heightCanvas, strength) {
  const W = heightCanvas.width, H = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d'); const od = g.createImageData(W, H);
  const hv = (x, y) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = (hv(x + 1, y) - hv(x - 1, y)) * strength;
    const gy = (hv(x, y + 1) - hv(x, y - 1)) * strength;
    const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
    const i = (y * W + x) * 4;
    od.data[i] = (-gx * inv * 0.5 + 0.5) * 255;
    od.data[i + 1] = (gy * inv * 0.5 + 0.5) * 255;
    od.data[i + 2] = inv * 255; od.data[i + 3] = 255;
  }
  g.putImageData(od, 0, 0);
  return out;
}

// kraft 纤维正片叠底色 tile（浅棕纤维纹，用于 albedo 叠加）
export function kraftFiberTile() {
  const n = sinNoise(23, 4);
  return makeTile((g, S) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const f = 0.9 + 0.1 * Math.sin(2 * Math.PI * (v * 34 + n(u, v) * 2)) + 0.06 * n(u * 3 % 1, v * 3 % 1);
      const val = Math.max(0, Math.min(255, f * 232));
      const i = (y * S + x) * 4;
      img.data[i] = val; img.data[i + 1] = val * 0.94; img.data[i + 2] = val * 0.85; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}
