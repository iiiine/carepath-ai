// src/theme.js
export const t = {
  page: '#F4F6F8',       // 頁面背景 (極淺灰)
  panel: '#FFFFFF',      // 卡片/輸入框背景 (純白)
  border: '#E2E8F0',     // 邊框線條 (淺灰)
  text: '#1E293B',       // 主要文字 (深灰偏黑)
  muted: '#64748B',      // 次要文字 (中灰)
  subtle: '#F1F5F9',     // Tag/徽章底色 (淡灰)
  userBubble: '#1A1A1A', // 🌟 核心主色：使用者氣泡與主要按鈕改為純黑/深黑色
  danger: '#EF4444',     // 警告色 (保留紅色用於疼痛指數警告)
};


// ============================================================
// 尺寸級距（字級／行高／間距／外觀／觸控）
// ============================================================
//
// 高齡友善模式不再由各處寫 `elderMode && { fontSize: 18 }` 個別處理，
// 而是整組替換成 elder。畫面只讀語意名稱（s.body、s.pad），不寫死數字。
//
// 這樣做的理由：
// 1. 原本 64 處條件式散在單一檔案內，且 inline 物件與具名樣式兩種寫法混用，
//    很難確認每一個文字都真的放大了——對主打高齡友善的醫療 app 是功能性缺陷。
// 2. 新畫面只要讀 s，就自動支援高齡模式，不會漏。
//
// elder 的數值沿用原本 *Elder 樣式已在用的實際值（內文 18、輸入 20、
// 標題 30、行高 28、框線 2），不是另外發明一套，避免視覺跑掉。
//
// ponytail: 維持常數物件的寫法，不做 theme provider。
//   只有 elderMode 這個「會變動且需跨畫面共享」的開關才用 context。
// ============================================================

export const scale = {
  normal: {
    // ---- 字級 ----
    micro: 11,      // 密集資料的欄位標籤（統計卡、時間軸）——僅用於此
    caption: 12,    // 徽章、次要標註
    body: 14,       // 內文
    input: 16,      // 輸入框
    subtitle: 18,
    title: 22,
    hero: 26,

    // ---- 行高 ----
    lineBody: 21,
    lineSubtitle: 26,
    lineTitle: 30,

    // ---- 間距 ----
    gap: 8,
    gapLg: 12,
    pad: 16,
    padLg: 20,

    // ---- 外觀 ----
    radius: 12,
    radiusLg: 20,
    border: 1,

    // ---- 觸控目標（WCAG 2.5.5 建議至少 44）----
    touch: 44,

    // ---- 對比 ----
    // 高齡模式不只放大，也刻意加深文字與框線。
    // 原本這是散在各處的硬編碼色碼，收進級距後才會一致。
    textStrong: t.text,
    borderStrong: t.border,
    pageBg: t.page,
  },

  elder: {
    micro: 14,
    caption: 15,
    body: 18,
    input: 20,
    subtitle: 22,
    title: 30,
    hero: 34,

    lineBody: 28,
    lineSubtitle: 32,
    lineTitle: 38,

    gap: 12,
    gapLg: 18,
    pad: 22,
    padLg: 26,

    radius: 16,
    radiusLg: 28,
    border: 2,

    touch: 56,

    textStrong: '#0F172A',   // 比 t.text 更深，提高長者的閱讀對比
    borderStrong: '#CBD5E1', // 比 t.border 更深，讓區塊邊界更明確
    pageBg: '#F8FAFC',
  },
};
