// src/Baymax.jsx
import baymaxIcon from './assets/baymax.png';

// 杯麵護士全身圖（已去背），用高度控制大小、寬度自動（原圖 197x240）
export function BaymaxAvatar({ size = 56 }) {
  return (
    <img
      src={baymaxIcon}
      alt=""
      style={{ height: size, width: 'auto', flexShrink: 0, display: 'block' }}
    />
  );
}
