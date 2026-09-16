import { useEffect, useState } from 'react';
import api from './api/axios';
import { distanceText, emergencySearchUrl, navigationUrl } from './location';

const DIRECTORY_URL = 'https://dep.mohw.gov.tw/DOMA/cp-2710-7581-106.html';
const SUPPORT_URL = 'https://dep.mohw.gov.tw/DOMHAOH/cp-4906-54077-107.html';
const buttonStyle = { display: 'inline-block', padding: '9px 12px', border: '1px solid #dc2626', borderRadius: 8, color: '#991b1b', background: '#fff', textDecoration: 'none' };

export default function EmergencyResources({ location, city, safety }) {
  const lat = location?.latitude ?? null;
  const lng = location?.longitude ?? null;
  const queryKey = JSON.stringify([lat, lng, city]);
  const [result, setResult] = useState(null);
  const relevant = result?.queryKey === queryKey;
  const needsLocation = lat === null && !city;
  useEffect(() => {
    if (lat === null && !city) return;
    const controller = new AbortController();
    api.get('/api/v1/emergency-resources', {
      params: city ? { city } : { lat, lng }, timeout: 5000, signal: controller.signal,
    }).then(({ data }) => setResult({ queryKey, data }))
      .catch(() => { if (!controller.signal.aborted) setResult({ queryKey, error: true }); });
    return () => controller.abort();
  }, [lat, lng, city, queryKey]);

  const emotionalSupport = safety?.red_flags?.some(flag => /^(SELF_HARM|HARM_TO_OTHERS)/.test(flag.code || ''))
    || safety?.present_flags?.some(flag => /^(self_harm|harm_others|imminent_self_harm|imminent_harm_to_others)/.test(flag));
  const hospitals = relevant ? result?.data?.hospitals || [] : [];
  return <section aria-label="急症求助與院所資源" style={{ marginTop: 14, fontSize: '0.82rem', lineHeight: 1.7 }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <a href="tel:119" style={{ ...buttonStyle, background: '#dc2626', color: '#fff' }}>撥打 119 緊急救護</a>
      <a href={DIRECTORY_URL} target="_blank" rel="noreferrer" style={buttonStyle}>衛福部急救責任醫院名單</a>
      <a href={emergencySearchUrl(location, city)} target="_blank" rel="noreferrer" style={buttonStyle}>
        {city ? `搜尋${city}急診` : location ? '開啟附近急診搜尋' : '開啟急診搜尋（請設定地點）'}
      </a>
    </div>
    {emotionalSupport && <p>
      心理支持：<a href="tel:1925">撥打 1925 安心專線</a>（24 小時免付費）。
      如有立即危險，請先撥 119。<a href={SUPPORT_URL} target="_blank" rel="noreferrer">服務說明</a>
    </p>}
    <p>急需救護請直接撥 119，不必等待院所查詢。搜尋結果與院所距離不代表能立即收治。</p>
    {needsLocation ? <p>未提供定位；可在上方選擇縣市，查看已核對的院所。</p>
      : !relevant ? <p role="status">院所資料載入中；求助電話可立即使用。</p>
      : result.error || result.data?.status === 'unavailable' ? <p>院所資料暫時無法取得，請使用求助電話或官方名單。</p>
      : result.data?.status === 'needs_review' ? <p>院所名單待更新，請查閱官方最新名單。</p>
      : hospitals.length === 0 ? <p>此查詢範圍沒有已核對的院所資料，不代表當地沒有急診；請查閱官方名單。</p>
      : <>
        <p>{city ? `${city}已核對院所` : '30 公里內已核對院所'}（部分名單，非即時收治資訊）</p>
        <ul>{hospitals.map(h => <li key={`${h.name}-${h.address}`}>
          <strong>{h.name}</strong> · {h.address}
          {distanceText(h) && ` · 直線距離約 ${distanceText(h)}`}
          {' '}<a href={navigationUrl(h)} target="_blank" rel="noreferrer">查看院所位置</a>
          {h.phone && <> · <a href={`tel:${h.phone}`}>院所電話</a></>}
        </li>)}</ul>
        <p>核對日期：{result.data.verified_on} · <a href={result.data.source_url} target="_blank" rel="noreferrer">衛福部資料來源</a></p>
      </>}
  </section>;
}
