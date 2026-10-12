import { useEffect, useState } from 'react';
import api from './api/axios';
import { distanceText, emergencySearchUrl, navigationUrl } from './location';

const DIRECTORY_URL = 'https://dep.mohw.gov.tw/DOMA/cp-2710-7581-106.html';
const SUPPORT_URL = 'https://dep.mohw.gov.tw/DOMHAOH/cp-4906-54077-107.html';

// 這個區塊整個長在 role="alert" 裡面，背景是淡紅。
// 色票集中在這裡，不要再散落到各個 style 物件中。
const RED = '#dc2626';
const RED_DARK = '#991b1b';
const RED_TEXT = '#7f1d1d';
const RED_BORDER = '#fecaca';

const styles = {
  section: {
    marginTop: 16,
    fontSize: '0.82rem',
    lineHeight: 1.65,
    // 外層把這個 section 當 flex item 排，寬度要自己撐滿，
    // 否則院所卡片會被擠成一條。
    width: '100%',
  },

  // 分隔標題：一行小標 + 一條延伸到底的細線，
  // 讓「立即行動 / 院所名單」兩塊在視覺上切開。
  legend: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '0 0 8px',
    color: RED_DARK,
    fontSize: '0.74rem',
    fontWeight: 700,
    letterSpacing: '0.02em',
  },

  legendRule: {
    flex: 1,
    height: 1,
    backgroundColor: RED_BORDER,
  },

  // 119 是這個畫面唯一的主要動作，自己佔一列，不跟其他按鈕並排競爭。
  primaryAction: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '12px 16px',
    borderRadius: 10,
    border: `1px solid ${RED}`,
    backgroundColor: RED,
    color: '#fff',
    fontSize: '0.9rem',
    fontWeight: 700,
    textDecoration: 'none',
  },

  secondaryRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },

  secondaryAction: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '9px 12px',
    border: `1px solid ${RED_BORDER}`,
    borderRadius: 8,
    color: RED_DARK,
    backgroundColor: '#fff',
    fontSize: '0.8rem',
    fontWeight: 600,
    textDecoration: 'none',
  },

  // 說明與但書。index.css 的 reset 把 <p> 的 margin 歸零了，
  // 所以每一段都要自己給間距，否則整區會黏成一團。
  note: {
    margin: '10px 0 0',
    color: RED_TEXT,
    fontSize: '0.76rem',
    lineHeight: 1.6,
  },

  // 狀態訊息（載入中 / 取不到 / 無資料）比但書再明顯一點，
  // 因為它回答的是「我現在看到的是什麼」。
  status: {
    margin: '14px 0 0',
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid ${RED_BORDER}`,
    backgroundColor: '#fff',
    color: RED_TEXT,
    fontSize: '0.8rem',
  },

  supportBox: {
    margin: '12px 0 0',
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid ${RED_BORDER}`,
    backgroundColor: '#fff',
    color: RED_TEXT,
    fontSize: '0.8rem',
    lineHeight: 1.65,
  },

  listBlock: {
    marginTop: 16,
  },

  listCaption: {
    margin: '0 0 8px',
    color: RED_TEXT,
    fontSize: '0.76rem',
  },

  // reset 把 ul 的 padding 也歸零了，行為反而剛好 ——
  // 這裡本來就不要項目符號，改用卡片區隔。
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },

  card: {
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid ${RED_BORDER}`,
    backgroundColor: '#fff',
  },

  // 院所名稱與距離同一列，距離靠右 —— 比距離夾在地址後面好掃視。
  //
  // 必須 wrap：手機寬度下塞不進一列時要讓距離整個掉到下一行。
  // 不 wrap 的話名稱會被距離（nowrap）壓成極窄的一欄，
  // 「長庚醫療財團法人林口長庚紀念醫院」會變成一個字一行。
  cardHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '2px 10px',
  },

  // basis 給 12rem：寬螢幕時撐開把距離推到最右，
  // 窄螢幕時 12rem 加上距離放不下，就換行而不是壓縮名稱。
  cardName: {
    flex: '1 1 12rem',
    color: RED_DARK,
    fontSize: '0.84rem',
    fontWeight: 700,
    lineHeight: 1.45,
  },

  // 「直線距離」這四個字不能省：那不是行車距離，也不代表到得了。
  cardDistance: {
    flexShrink: 0,
    color: RED_TEXT,
    fontSize: '0.74rem',
    whiteSpace: 'nowrap',
  },

  cardAddress: {
    marginTop: 3,
    color: RED_TEXT,
    fontSize: '0.78rem',
    lineHeight: 1.55,
  },

  cardActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },

  cardAction: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 10px',
    border: `1px solid ${RED_BORDER}`,
    borderRadius: 999,
    color: RED_DARK,
    backgroundColor: '#fff7f7',
    fontSize: '0.74rem',
    fontWeight: 600,
    textDecoration: 'none',
  },

  source: {
    margin: '10px 0 0',
    color: RED_TEXT,
    fontSize: '0.72rem',
  },
};

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

  const legend = text => <div style={styles.legend}>
    <span>{text}</span>
    <span aria-hidden="true" style={styles.legendRule} />
  </div>;

  return <section aria-label="急症求助與院所資源" style={styles.section}>
    {legend('立即行動')}

    <a href="tel:119" style={styles.primaryAction}>撥打 119 緊急救護</a>

    <div style={styles.secondaryRow}>
      <a href={DIRECTORY_URL} target="_blank" rel="noreferrer" style={styles.secondaryAction}>衛福部急救責任醫院名單</a>
      <a href={emergencySearchUrl(location, city)} target="_blank" rel="noreferrer" style={styles.secondaryAction}>
        {city ? `搜尋${city}急診` : location ? '開啟附近急診搜尋' : '開啟急診搜尋（請設定地點）'}
      </a>
    </div>

    <p style={styles.note}>急需救護請直接撥 119，不必等待院所查詢。搜尋結果與院所距離不代表能立即收治。</p>

    {emotionalSupport && <p style={styles.supportBox}>
      心理支持：<a href="tel:1925">撥打 1925 安心專線</a>（24 小時免付費）。
      如有立即危險，請先撥 119。<a href={SUPPORT_URL} target="_blank" rel="noreferrer">服務說明</a>
    </p>}

    {needsLocation ? <p style={styles.status}>未提供定位；可在上方選擇縣市，查看已核對的院所。</p>
      : !relevant ? <p role="status" style={styles.status}>院所資料載入中；求助電話可立即使用。</p>
      : result.error || result.data?.status === 'unavailable' ? <p style={styles.status}>院所資料暫時無法取得，請使用求助電話或官方名單。</p>
      : result.data?.status === 'needs_review' ? <p style={styles.status}>院所名單待更新，請查閱官方最新名單。</p>
      : hospitals.length === 0 ? <p style={styles.status}>此查詢範圍沒有已核對的院所資料，不代表當地沒有急診；請查閱官方名單。</p>
      : <div style={styles.listBlock}>
        {legend(city ? `${city}已核對院所` : '30 公里內已核對院所')}
        <p style={styles.listCaption}>部分名單，非即時收治資訊</p>
        <ul style={styles.list}>{hospitals.map(h => <li key={`${h.name}-${h.address}`} style={styles.card}>
          <div style={styles.cardHead}>
            <strong style={styles.cardName}>{h.name}</strong>
            {distanceText(h) && <span style={styles.cardDistance}>直線距離約 {distanceText(h)}</span>}
          </div>
          <div style={styles.cardAddress}>{h.address}</div>
          <div style={styles.cardActions}>
            <a href={navigationUrl(h)} target="_blank" rel="noreferrer" style={styles.cardAction}>查看院所位置</a>
            {h.phone && <a href={`tel:${h.phone}`} style={styles.cardAction}>院所電話</a>}
          </div>
        </li>)}</ul>
        <p style={styles.source}>核對日期：{result.data.verified_on} · <a href={result.data.source_url} target="_blank" rel="noreferrer">衛福部資料來源</a></p>
      </div>}
  </section>;
}
