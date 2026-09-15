// Run against a local Vite server. All API/external requests are intercepted.
// NODE_PATH=/tmp/carepath-browser-check/node_modules node frontend/tests/phase-a.browser.cjs
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseURL = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5180';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  });
  try {
    for (const mode of ['saved', 'failed', 'legacy_missing_id', 'guest', 'history']) {
      const context = await browser.newContext();
      await context.addInitScript(() => localStorage.setItem('access_token', 'offline-test-token'));
      const page = await context.newPage();
      const calls = [];
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === new URL(baseURL).origin && !url.pathname.startsWith('/api/')) return route.continue();
        if (!url.pathname.startsWith('/api/')) return route.abort();
        calls.push(url.pathname);
        let data = {};
        const status = 200;
        if (url.pathname === '/api/test') data = { status: 'success', message: 'offline' };
        else if (url.pathname.endsWith('/auth/me')) data = { id: 7, username: '測試會員', is_guest: mode === 'guest' };
        else if (url.pathname.endsWith('/hospitals')) data = { hospitals: [] };
        else if (url.pathname === '/api/v1/history') data = [{
          id: 999, title: '舊紀錄', symptom_text: '鼻塞兩天', original_symptom: '鼻塞兩天',
          suggested_department: '家醫科', pain_level: 3, created_at: '2026-09-15T00:00:00Z', history: [],
        }];
        else if (url.pathname.endsWith('/diagnose')) data = {
          status: 'completed', is_complete: true, symptom: '鼻塞兩天', suggested_department: '家醫科',
          possible_causes: [], nearby_medical_resources: [], message: '測試問診完成',
          session_id: mode === 'saved' ? 42 : null,
          ...(mode === 'legacy_missing_id' ? {} : { save_status: mode === 'guest' ? 'not_applicable' : mode }),
        };
        else if (url.pathname.startsWith('/api/v1/visit-summary/')) {
          data = { status: 'success', session_id: Number(url.pathname.split('/').pop()),
            summary: { chief_complaint: '摘要測試主訴', handoff_text: '離線摘要測試', safety: {}, patient_context: {} } };
        }
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
          headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      });
      await page.goto(baseURL);
      if (mode === 'history') {
        await page.getByRole('button', { name: '舊紀錄', exact: true }).click();
      } else {
        const input = page.getByPlaceholder('傳訊息給 CarePath AI...');
        await input.fill('鼻塞兩天');
        await input.press('Enter');
      }
      const button = page.getByRole('button', { name: mode === 'guest' ? '會員可使用 AI 就醫摘要' : '查看 AI 就醫摘要', exact: true });
      await button.waitFor({ state: 'visible', timeout: 15000 });
      if (mode === 'guest') {
        assert.equal(await button.isDisabled(), true);
      } else {
        if (mode === 'failed') await page.getByText('問診結果已產生，但歷史紀錄未保存成功，暫時無法提供就醫摘要。').waitFor();
        const historyBefore = calls.filter(p => p === '/api/v1/history').length;
        if (mode === 'saved' || mode === 'history') {
          const expected = mode === 'saved' ? 42 : 999;
          await Promise.all([
            page.waitForResponse(r => r.url().includes(`/api/v1/visit-summary/${expected}`)),
            button.click(),
          ]);
          await page.getByText('摘要測試主訴', { exact: true }).waitFor();
        } else {
          await button.click();
          await page.getByText('本次問診尚未取得已保存的紀錄，無法開啟摘要。請從歷史紀錄選擇已保存的問診。').waitFor();
          assert.equal(calls.filter(p => p === '/api/v1/history').length, historyBefore);
          assert.equal(calls.some(p => p.startsWith('/api/v1/visit-summary/')), false);
        }
      }
      assert.equal(calls.includes('/api/v1/visit-summary/999'), mode === 'history');
      console.log(`PASS ${mode}`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
