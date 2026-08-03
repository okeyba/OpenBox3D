import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { store } from './state/store.js';
import { loadPresetBox } from './preset/presetBox.js';

// 先注入预设示例盒再挂载，避免空白盒闪屏；素材加载失败也保证应用可开。
// ?heroTest/?embTest/?surfaceTest 调试场景自带测试图层，跳过预设注入。
const debugScene = ['heroTest', 'embTest', 'surfaceTest'].some(k => new URLSearchParams(location.search).has(k));
loadPresetBox().catch(() => null).then(preset => {
  if (preset && !debugScene) store.reset(preset);
  createRoot(document.getElementById('root')).render(<App />);
});
