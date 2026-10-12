// Run against an Expo web export. All API calls are mocked; native hardware is not tested.
const assert = require('node:assert/strict');
const {chromium}=require('playwright');
const base=process.env.MOBILE_TEST_URL||'http://127.0.0.1:5181';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try {for(const mode of ['denied','granted','city','failed','missing_id','guest','emergency_failure','emergency_empty','emergency_expired','emergency_available','history','emergency_switch']) {
  const context=await browser.newContext({viewport:{width:430,height:932}});
  await context.addInitScript(mode=>{
   localStorage.setItem('access_token','offline-test');
   Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:mode==='granted'?'granted':'denied'})}});
   Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:ok=>ok({coords:{latitude:25.03,longitude:121.56},timestamp:Date.now()})}});
  },mode);
  const page=await context.newPage(); page.setDefaultTimeout(12000); let body; const calls=[]; let release;
  const pending=new Promise(r=>release=r);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin===base) return route.continue();
   if(!url.pathname.startsWith('/api/')) return route.abort();
   calls.push(url.pathname);
   let data={},status=200;
   if(url.pathname.endsWith('/auth/me')) data={id:7,username:'測試',is_guest:mode==='guest'};
   else if(url.pathname.endsWith('/longitudinal')) data={status:'success',analysis:{recurring_symptoms:[]}};
   else if(url.pathname.endsWith('/dashboard/recent-sessions')) data=[{id:999,title:'舊問診',suggested_department:'家醫科'}];
   else if(url.pathname.endsWith('/history')) data=[{id:999,original_symptom:'舊問診',suggested_department:'家醫科',history:[],nearby_medical_resources:[]}];
   else if(url.pathname.endsWith('/diagnose')) {
    body=route.request().postDataJSON();
    data=mode.startsWith('emergency')?{status:'safety_alert',is_complete:true,message:'測試警示',safety:{risk_level:'emergency',red_flags:[{code:'SELF_HARM',title:'測試'}]}}:
     {status:'completed',is_complete:true,message:'測試完成',suggested_department:'家醫科',symptom:'測試主訴',session_id:['failed','missing_id','guest'].includes(mode)?null:42,
      save_status:mode==='failed'?'failed':mode==='guest'?'not_applicable':'saved',nearby_medical_resources:[{name:'無座標院所',address:'臺北市測試路',latitude:null,longitude:null,distance_meters:9999999,available_doctors:[]}]};
   } else if(url.pathname.startsWith('/api/v1/visit-summary/')) data={status:'success',summary:{chief_complaint:url.pathname.endsWith('/999')?'歷史摘要999':'正確摘要42',safety:{},patient_context:{}}};
   else if(url.pathname.endsWith('/emergency-resources')) {
    if (mode==='emergency_switch' && url.searchParams.get('city')==='臺南市') {
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'available',hospitals:[{name:'新地區院所',address:'臺南市測試路'}]}),headers:{'Access-Control-Allow-Origin':'*'}});
    }
    assert.equal(url.searchParams.get('city'),'臺北市'); await pending;
    status=mode==='emergency_failure'?404:200;
    data={status:mode==='emergency_expired'?'needs_review':mode==='emergency_available'?'available':'no_verified_match',verified_on:'2026-09-16',hospitals:mode==='emergency_available'?[{name:'核對院所',address:'臺北市測試路',phone:'02-00000000'}]:[]};
   }
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data),headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}});
  });
  await page.goto(base);

  const input=page.getByPlaceholder('傳訊息給 CarePath AI...'); await input.waitFor();
  if(mode==='history') {
   await page.getByRole('button',{name:'開啟選單'}).click();
   await page.getByText('歷史問診紀錄',{exact:true}).click();
   await page.getByRole('button',{name:'家醫科，舊問診'}).click();
   await page.getByText('開啟本次 AI 就醫摘要',{exact:true}).click();
   await page.getByText('歷史摘要999',{exact:true}).waitFor();
   await page.getByText('關閉',{exact:true}).click();
   await page.getByText('歷史摘要999',{exact:true}).waitFor({state:'hidden'});
   await page.getByText('新問診',{exact:true}).click();
   await input.waitFor();
  }
  if(mode==='city'||mode.startsWith('emergency')) {
   await page.getByRole('button',{name:'選擇問診地區'}).click();
   await page.getByRole('button',{name:'臺北市',exact:true}).click();
   await page.getByRole('button',{name:'取消',exact:true}).waitFor({state:'hidden'});
  }
  await input.fill('測試主訴'); await page.getByRole('button',{name:'送出訊息'}).click();

  if(mode.startsWith('emergency')) {
   await page.getByRole('link',{name:'撥打 119 緊急救護'}).waitFor();
   await page.getByRole('link',{name:'撥打 1925 安心專線'}).waitFor();
   await page.getByText('院所資料載入中；求助電話可立即使用。',{exact:true}).waitFor();
   if(mode==='emergency_switch') {
    await page.getByRole('button',{name:'選擇問診地區'}).click();
    await page.getByRole('button',{name:'臺南市',exact:true}).click();
    await page.getByRole('button',{name:'取消',exact:true}).waitFor({state:'hidden'});
    await page.getByText('新地區院所 · 臺南市測試路',{exact:true}).waitFor();
    release();
    assert.equal(await page.getByText('核對院所 · 臺北市測試路',{exact:true}).count(),0);
   } else {
   release();
   await page.getByText(mode==='emergency_failure'?'院所資料暫時無法取得，請使用求助電話或官方名單。':mode==='emergency_expired'?'院所名單待更新，請查閱官方最新名單。':mode==='emergency_available'?'核對院所 · 臺北市測試路':'此範圍沒有已核對資料，不代表當地沒有急診。',{exact:true}).waitFor();
   }
  } else if(mode==='failed'||mode==='missing_id') {
   await page.getByText(mode==='failed'?'問診結果已產生，但紀錄保存失敗，暫時無法提供就醫摘要。':'本次問診未取得已保存的紀錄，無法開啟摘要。',{exact:true}).waitFor();
   assert(!calls.some(p=>p.includes('/visit-summary/')));
  } else {
   await page.getByText(mode==='guest'?'查看訪客本機摘要（未保存）':'開啟本次 AI 就醫摘要',{exact:true}).click();
   if(mode==='guest') {await page.getByText('本機摘要未取得完整安全評估，不能據此判定風險。',{exact:true}).waitFor(); assert(!calls.some(p=>p.includes('/visit-summary/')));}
   else { await page.getByText('正確摘要42',{exact:true}).waitFor(); assert(calls.includes('/api/v1/visit-summary/42')); }
   release();
  }
  assert.equal(body.user_latitude,mode==='granted'?25.03:null);
  assert.equal(body.user_longitude,mode==='granted'?121.56:null);
  assert.equal(body.user_city,mode==='city'||mode.startsWith('emergency')?'臺北市':null);
  assert.deepEqual(errors,[]);
  console.log(`PASS ${mode}`); await context.close();
 }} finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
