// 3D 画布组件：React 壳 + BoxEngine 实例（属性驱动）；engineRef 可取出引擎实例（AR 导出用）
import React, { useEffect, useRef } from 'react';
import { BoxEngine } from '../render3d/engine.js';

export function BoxCanvas(props) {
  const ref = useRef(null), engRef = useRef(null);
  useEffect(() => {
    const eng = new BoxEngine(ref.current, props);
    engRef.current = eng;
    if (props.engineRef) props.engineRef.current = eng;
    return () => { engRef.current = null; if (props.engineRef) props.engineRef.current = null; eng.dispose(); };
  }, []);
  useEffect(() => { if (engRef.current) engRef.current.update(props); });
  return <div ref={ref} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />;
}
