// UI 基础件：开关、区块、按钮、输入样式（按原型设计语汇）
import React, { useState } from 'react';

export const C = { ink: '#211d18', brand: '#9a5b1f', gold: '#C9A227', paper: '#f5f1e8', panel: '#faf7f0', bd: '#d8d0c2', bd2: '#e7e0d4', mut: '#8a8071', dim: '#5c554a' };

export const inputSt = { width: '100%', boxSizing: 'border-box', padding: '6px 7px', border: '1px solid #d8d0c2', borderRadius: 5, background: '#fff', fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, color: C.ink };
export const selectSt = { ...inputSt, fontFamily: 'inherit' };
export const btnSt = { padding: '6px 0', borderRadius: 5, border: '1px solid #d8d0c2', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#3d3830', whiteSpace: 'nowrap' };

export function ST({ children, style }) {
  return <div style={{ fontSize: 10.5, letterSpacing: '0.18em', color: C.mut, fontWeight: 700, marginBottom: 9, ...style }}>{children}</div>;
}

export function Block({ children, style }) {
  return <div style={{ padding: 14, borderBottom: '1px solid #e7e0d4', ...style }}>{children}</div>;
}

export function Toggle({ on, onClick }) {
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', width: 30, height: 16, borderRadius: 99, background: on ? C.brand : '#d8d0c2', position: 'relative', transition: 'background .15s', flex: 'none' }}>
      <div style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 12, height: 12, borderRadius: 99, background: '#fff', transition: 'left .15s' }} />
    </div>
  );
}

export function ToggleRow({ label, on, onClick }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
      <span style={{ fontSize: 12.5, color: '#3d3830' }}>{label}</span>
      <Toggle on={on} onClick={onClick} />
    </div>
  );
}

export function NumField({ label, value, onChange, step, style }) {
  return (
    <div style={style}>
      <div style={{ fontSize: 10.5, color: C.mut, marginBottom: 3 }}>{label}</div>
      <input type="number" step={step} value={value} onChange={e => onChange(e)} style={inputSt} />
    </div>
  );
}

export function Note({ children }) {
  return (
    <div style={{ background: '#f0ebe0', border: '1px solid #e2dac9', borderRadius: 6, padding: '10px 12px', fontSize: 11, lineHeight: 1.65, color: '#6d6557' }}>
      {children}
    </div>
  );
}

export function KV({ k, v, mono = true }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0', fontSize: 12 }}>
      <span style={{ color: '#6d6557', whiteSpace: 'nowrap' }}>{k}</span>
      <span style={{ fontFamily: mono ? "'JetBrains Mono',monospace" : 'inherit', color: C.ink, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

// 苏哇猫 logo（金色 + 尾摆动效；bg 为挖眼底色，默认顶栏墨色）
export function LogoCat({ size = 22, color = '#C9A227', bg = '#211d18' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ display: 'block' }}>
      <g fill={color}>
        <path d="M14 28 L10 10 L28 20 Z" />
        <path d="M50 28 L54 10 L36 20 Z" />
        <ellipse cx="32" cy="36" rx="20" ry="17" />
        <path className="logo-tail" d="M47 46 C 56 44 58 34 54 26 C 53 23 49 24 50 28 C 52 35 49 41 45 42 Z" />
      </g>
      <path d="M6 57 Q32 51 58 57" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="25" cy="34" r="4.5" fill={bg} />
      <circle cx="39" cy="34" r="4.5" fill={bg} />
      <circle cx="26.5" cy="35" r="1.8" fill={color} />
      <circle cx="37.5" cy="35" r="1.8" fill={color} />
    </svg>
  );
}

// 数值滑杆行：滑杆 + 可直接输入的数值框（Enter/失焦提交，Esc 还原）
export const monoSt = { fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: '#9a5b1f' };

// 颜色行：标签 + 取色器
export function ColorRow({ label, value, onChange }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 10.5, color: '#8a8071' }}>
    <span>{label}</span><input aria-label={label} type="color" value={value} onChange={e => onChange(e.target.value)} />
  </div>;
}

const clampStep = (v, min, max, step) => Math.min(max, Math.max(min, +(Math.round(v / step) * step).toFixed(6)));

export function Range({ label, value, min, max, step = 0.01, suffix = '', onChange }) {
  const dec = step < 0.1 ? 2 : (step % 1 ? 1 : 0);
  const [draft, setDraft] = useState(null); // 编辑中草稿；null=跟随滑杆值
  const commit = () => {
    if (draft === null) return;
    const n = parseFloat(draft);
    setDraft(null);
    if (!Number.isFinite(n)) return; // 非法输入直接丢弃，不回写
    const v = clampStep(n, min, max, step);
    if (v !== value) onChange(v);
  };
  return <div style={{ marginTop: 8 }}>
    <div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <input aria-label={label} type="range" value={value} min={min} max={max} step={step} onInput={e => onChange(+e.currentTarget.value)} style={{ flex: 1, minWidth: 0, accentColor: '#9a5b1f', margin: 0 }} />
      <input aria-label={label + ' 数值'} inputMode="decimal" value={draft !== null ? draft : Number(value).toFixed(dec)}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }}
        style={{ ...monoSt, width: 46, flex: 'none', padding: '2px 4px', textAlign: 'right', border: '1px solid #d8d0c2', borderRadius: 4, background: '#fff' }} />
      {suffix && <span style={{ ...monoSt, flex: 'none', marginLeft: -3 }}>{suffix}</span>}
    </div>
  </div>;
}

// 从主预览 renderer 抓 JPEG 缩略图（preserveDrawingBuffer 已开；先离屏缩小，控制工程文件体积）
export function captureThumb(engineRef, width = 160) {
  const eng = engineRef && engineRef.current;
  if (!eng || !eng.renderer || !eng.renderer.domElement) return '';
  try {
    const src = eng.renderer.domElement, scale = width / src.width;
    const c = document.createElement('canvas');
    c.width = width; c.height = Math.max(1, Math.round(src.height * scale));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.6);
  } catch (_) { return ''; }
}