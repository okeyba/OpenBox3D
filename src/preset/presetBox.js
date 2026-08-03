// 预设示例盒：首次启动与顶栏「重置示例盒」时载入，让新用户开箱即有一只完成度较高的盒子。
//
// —— 如何替换为你自己的预设盒 ——
// 1. 在工作台里设计好盒子，顶栏「导出工程」保存 .boxproj 文件；
// 2. 仓库根目录运行：npm run preset:from -- /路径/你的工程.boxproj
//    （图层图片会抽取到 public/preset/，工程裁剪后写入 src/preset/preset-box.json）；
// 3. 重新 npm run dev / npm run build 即生效。
//
// preset-box.json 就是标准 .boxproj（box3d-project v1），加载逻辑与「导入工程」一致。
import { projectStateOf } from '../projects/projects.js';
import presetDoc from './preset-box.json';

let cache = null;

// 返回可直接传给 store.reset 的 patch；结果缓存，供「重置示例盒」重复使用。
export async function loadPresetBox() {
  if (cache) return cache;
  const qp = new URLSearchParams(location.search); // 调试深链优先：?view=/?fold= 不被预设覆盖
  const patch = await projectStateOf(presetDoc, 'three'); // 首屏即 3D 视图
  cache = {
    ...patch,
    view: qp.get('view') || 'three',
    fold: qp.has('fold') ? +qp.get('fold') : 100 // 闭合态成品盒
  };
  return cache;
}
