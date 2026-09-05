// src/Icon.jsx

// ==========================================
// Material Design Icons 的極簡渲染元件
//
// 圖示路徑來自 @mdi/js（純 ESM 常數，零相依、可 tree-shake），
// 與行動端 @react-native-vector-icons/material-design-icons
// 是同一套圖示、同一組名稱，兩端外觀因此一致。
//
// 不裝 @mdi/react 的理由：該套件是 CJS 打包，且仍在函式元件上
// 使用 React 19 已移除的 defaultProps。這裡需要的其實只是
// 「把 path 畫成 svg」，二十行就夠。
//
// ponytail: 不做 icon registry、不做 size 級距。
//   前端本來就沒有框架，維持一個單純元件即可。
// ==========================================

// 預設 1em：跟著父層字級走，放進文字行內不會忽大忽小。
const Icon = ({
  path,
  size = '1em',
  color = 'currentColor',
  title,
  style,
}) => (

  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}

    // 有 title 的當成圖片讀出來，
    // 純裝飾（與相鄰文字重複）的則對輔助技術隱藏。
    role={title ? 'img' : undefined}
    aria-label={title || undefined}
    aria-hidden={title ? undefined : 'true'}
    focusable="false"

    style={{
      flexShrink: 0,
      verticalAlign: 'text-bottom',
      ...style,
    }}
  >
    <path d={path} fill={color} />
  </svg>
);

export default Icon;
