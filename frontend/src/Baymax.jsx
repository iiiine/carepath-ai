// src/Baymax.jsx
import carepathIcon from './assets/carepath-icon.png';
import carepathWordmark from './assets/carepath-wordmark.png';

// CarePath AI 品牌圖示（已去背，正方形畫布），對話頭像與各處小圖用這顆
export function BaymaxAvatar({ size = 56 }) {
  return (
    <img
      src={carepathIcon}
      alt=""
      style={{ height: size, width: size, flexShrink: 0, display: 'block' }}
    />
  );
}

// 圖示 + 產品名的直式組合，只用在首頁開場這種需要完整品牌露出的地方。
// 用高度控制大小、寬度自動（原圖 798x900）
export function CarePathWordmark({ size = 160 }) {
  return (
    <img
      src={carepathWordmark}
      alt="CarePath AI"
      style={{ height: size, width: 'auto', flexShrink: 0, display: 'block' }}
    />
  );
}
