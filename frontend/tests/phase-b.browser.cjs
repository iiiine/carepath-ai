// Offline browser acceptance: no real database, AI or map requests.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseURL = process.env.FRONTEND_TEST_URL || 'http://127.0.0.1:5180';
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE}: {})});
  try {
    for (const mode of ['denied','timeout','unsupported','granted','city','emergency','emergency_failure']) {
      const context = await browser.newContext();
      await context.addInitScript(mode => {
        localStorage.setItem('access_token','offline-test-token');
        Object.defineProperty(navigator,'geolocation',{configurable:true,value: mode === 'unsupported' ? undefined : {
          getCurrentPosition(ok,fail) { if(mode === 'granted') ok({coords:{latitude:25.03,longitude:121.56}}); else fail({code:mode === 'timeout'?3:1}); }
        }});
      },mode);
      const page = await context.newPage();
      let body; let release;
      const pending = new Promise(resolve => { release=resolve; });
      await page.route('**/*',async route => {
        const url = new URL(route.request().url());
        if(url.origin === new URL(baseURL).origin && !url.pathname.startsWith('/api/')) return route.continue();
        if(!url.pathname.startsWith('/api/')) return route.abort();
        let data={}; let status=200;
        if(url.pathname.endsWith('/auth/me')) data={id:7,username:'測試',is_guest:false};
        else if(url.pathname.endsWith('/history')) data=[];
        else if(url.pathname.endsWith('/hospitals')) data={hospitals:[]};
        else if(url.pathname.endsWith('/diagnose')) {
          body=route.request().postDataJSON();
          data=mode.startsWith('emergency') ? {status:'safety_alert',is_complete:true,message:'安全警示測試',safety:{risk_level:'emergency',red_flags:[{code:'SELF_HARM',message:'測試'}]},nearby_medical_resources:[]} :
            {status:'completed',is_complete:true,message:'測試完成',suggested_department:'家醫科',nearby_medical_resources:[],session_id:42,save_status:'saved'};
        } else if(url.pathname.endsWith('/emergency-resources')) {
          assert.equal(url.searchParams.get('city'),'臺北市');
          await pending;
          status=mode === 'emergency_failure'?503:200;
          data={status:'no_verified_match',hospitals:[]};
        }
        await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data),headers:{'Access-Control-Allow-Origin':'*'}});
      });
      await page.goto(baseURL);
      if(mode === 'city' || mode.startsWith('emergency')) await page.getByLabel('選擇縣市').selectOption('臺北市');
      const input=page.getByPlaceholder('傳訊息給 CarePath AI...');
      await input.fill('測試症狀'); await input.press('Enter');
      if(mode.startsWith('emergency')) {
        await page.getByRole('link',{name:'撥打 119 緊急救護'}).waitFor();
        await page.getByRole('link',{name:'撥打 1925 安心專線'}).waitFor();
        await page.getByText('院所資料載入中；求助電話可立即使用。').waitFor();
        release();
        await page.getByText(mode === 'emergency_failure'?'院所資料暫時無法取得，請使用求助電話或官方名單。':'此查詢範圍沒有已核對的院所資料，不代表當地沒有急診；請查閱官方名單。').waitFor();
        assert.equal(await page.getByRole('link',{name:'撥打 119 緊急救護'}).getAttribute('href'),'tel:119');
      } else {
        await page.getByRole('button',{name:'查看 AI 就醫摘要',exact:true}).waitFor(); release();
      }
      assert.equal(body.user_latitude,mode === 'granted'?25.03:null);
      assert.equal(body.user_longitude,mode === 'granted'?121.56:null);
      assert.equal(body.user_city,mode === 'city'||mode.startsWith('emergency')?'臺北市':null);
      console.log(`PASS ${mode}`); await context.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
