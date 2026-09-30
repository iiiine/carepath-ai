// Offline browser acceptance: no real database, AI or map requests.
//
// 驗「最近問診 → 健康 Dashboard」等待期間的提示橫幅。
//
// 這個功能整個是時間行為，靠讀程式碼看不出對不對：
//   - 太早出現 → 資料一下就回來時閃一下，比沒有更像故障
//   - 不會消失 → 載入完還留著
//   - 冷啟動說明太早出現 → 正常的一兩秒也在講「伺服器休眠」
// 所以三種情況都用實際的延遲跑一遍。
//
// 時間點與 DashboardPage.jsx 的 HINT_DELAY_MS / HINT_SLOW_MS 對應，
// 那兩個常數改了這裡要跟著改。
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseURL = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5180';

const HINT_TEXT = '正在載入你的健康紀錄…';
const COLD_START_TEXT = '伺服器閒置一段時間後，第一次開啟需要較久';

// DashboardPage 的 HINT_DELAY_MS = 600、HINT_SLOW_MS = 8000
const CASES = [
  // 立刻回來：橫幅完全不該出現
  { mode: 'fast', delayMs: 0, expectHint: false, expectColdStart: false },
  // 比 600ms 慢但遠早於 8s：只出現基本文案
  { mode: 'slow', delayMs: 2500, expectHint: true, expectColdStart: false },
  // 超過 8s：補上冷啟動說明
  { mode: 'cold', delayMs: 10000, expectHint: true, expectColdStart: true },
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  });

  try {
    for (const { mode, delayMs, expectHint, expectColdStart } of CASES) {
      const context = await browser.newContext();

      await context.addInitScript(() => {
        localStorage.setItem('access_token', 'offline-test-token');
      });

      const page = await context.newPage();

      await page.route('**/*', async route => {
        const url = new URL(route.request().url());

        if (url.origin === new URL(baseURL).origin && !url.pathname.startsWith('/api/')) return route.continue();
        if (!url.pathname.startsWith('/api/')) return route.abort();

        let data = {};

        if (url.pathname.endsWith('/auth/me')) data = { id: 7, username: '測試', is_guest: false };
        else if (url.pathname.endsWith('/history')) {
          // 這就是 Dashboard 在等的那一支
          if (delayMs) await sleep(delayMs);
          data = [];
        }
        else if (url.pathname.endsWith('/hospitals')) data = { hospitals: [] };
        else if (url.pathname.includes('/longitudinal')) data = { status: 'insufficient_data' };

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(data),
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      });

      await page.goto(baseURL);

      // 先進「最近問診」再切 Dashboard —— 這是使用者實際的動線，
      // 也是回報問題時走的那一條。
      await page.getByRole('button', { name: '最近問診' }).click();
      await page.getByRole('button', { name: '健康 Dashboard' }).click();

      const hint = page.getByText(HINT_TEXT);
      const coldStart = page.getByText(COLD_START_TEXT);

      if (expectHint) {
        await hint.waitFor({ timeout: 5000 });

        if (expectColdStart) {
          // 8 秒後才該出現，所以這裡要等
          await coldStart.waitFor({ timeout: 12000 });
        } else {
          // 基本文案在，但不可以已經在講冷啟動
          assert.equal(await coldStart.count(), 0, `${mode}：冷啟動說明出現得太早`);
        }
      } else {
        // 資料立刻回來時整段都不該閃過。延遲門檻是 600ms，
        // 這裡多等一點確保不是只是還沒來得及出現。
        await sleep(1200);
        assert.equal(await hint.count(), 0, `${mode}：資料立刻回來時不應該出現載入提示`);
      }

      // 不論哪一種，載入結束後橫幅都要消失。
      // 用「開始新的 AI 問診」當作 Dashboard 已經渲染完的訊號。
      await page.getByRole('button', { name: '開始新的 AI 問診' }).waitFor({ timeout: 15000 });
      await hint.waitFor({ state: 'detached', timeout: 5000 });

      assert.equal(await coldStart.count(), 0, `${mode}：載入結束後冷啟動說明仍留著`);

      console.log(`PASS ${mode}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
