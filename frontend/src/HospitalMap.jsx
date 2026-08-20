import { useState, useEffect } from 'react';
import { APIProvider, Map, Marker, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import api from './api/axios';
import { t } from './theme';
import { BaymaxAvatar } from './Baymax';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const TAINAN_CENTER = { lat: 22.99, lng: 120.21 };

const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${m} 公尺`);

// 後端有時給 lat/lng、有時給 latitude/longitude，統一在這裡轉
const coordOf = (h) => ({ lat: Number(h.lat ?? h.latitude), lng: Number(h.lng ?? h.longitude) });

// 建立組件負責「自動縮放地圖視野 (fitBounds)」
function MapController({ displayHospitals, userPos }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !displayHospitals || displayHospitals.length === 0) return;

    // 建立包含所有地標與使用者位置的 Bounds 邊界
    const bounds = new window.google.maps.LatLngBounds();

    if (userPos) {
      bounds.extend(userPos);
    }

    displayHospitals.forEach((h) => {
      const { lat, lng } = coordOf(h);
      if (lat && lng) {
        bounds.extend({ lat, lng });
      }
    });

    // 移動視野並加上邊距 (Padding)
    map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
  }, [map, displayHospitals, userPos]);

  return null;
}

// 排名圓點圖示，號碼直接畫進 SVG。
// 不用 google.maps.SymbolPath：第一次 render 時 Maps 程式庫可能還沒載完，
// 讀 SymbolPath 會拿到 undefined 讓整頁掛掉（實際踩過）。data URI 沒有這個時序問題。
function rankIcon(n, isTop) {
  const size = isTop ? 30 : 26;
  const fill = isTop ? t.userBubble : '#a1a1aa';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 28 28">`
    + `<circle cx="14" cy="14" r="12" fill="${fill}" stroke="#ffffff" stroke-width="2"/>`
    + `<text x="14" y="18.5" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#ffffff">${n}</text>`
    + `</svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

// 接受傳入 hospitalsProp (問診後傳進來的 5 間醫院)
function HospitalMap({ isFullscreen, hospitalsProp = null }) {
  const [userPos, setUserPos] = useState(null);
  const [located, setLocated] = useState(false);
  const [hospitals, setHospitals] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) return setLocated(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setUserPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocated(true); },
      () => setLocated(true),
      { timeout: 5000 }
    );
  }, []);

  // 只有在【沒有傳入特定醫院清單】時，才去撈取全臺南的醫院
  useEffect(() => {
    if (!located) return;
    // 已經有問診結果就不抓全量。注意要用 null 判斷：問診完但查無醫院時是空陣列 []，
    // 這種情況該顯示「查無」，不是退回顯示全部醫院。
    if (hospitalsProp) return;

    const params = userPos ? { lat: userPos.lat, lng: userPos.lng } : {};
    api.get('/api/v1/hospitals', { 
      params,
      headers: {
        'ngrok-skip-browser-warning': 'true' 
      }
    })
      .then((res) => setHospitals(res.data.hospitals))
      .catch(() => setError(true));
  }, [located, userPos, hospitalsProp]);

  // 決定目前要在地圖顯示的醫院：有問診結果就用 hospitalsProp（即使是空的），否則用全量 hospitals
  const displayHospitals = hospitalsProp ?? hospitals;
  const isEmptyResult = hospitalsProp?.length === 0;

  // 排名／推薦只在「問診結果」才成立。瀏覽全臺南醫院時沒有科別匹配可言，
  // 這時退回原本的普通紅色 pin，不要假裝有推薦順序。
  const isRanked = Boolean(hospitalsProp?.length);
  const top = isRanked ? displayHospitals[0] : null;
  const rest = isRanked ? displayHospitals.slice(1) : [];

  if (!MAPS_KEY) return <p style={{ color: t.danger, fontSize: '0.88rem' }}>未設定 Google Maps API key</p>;
  if (error && !hospitalsProp) return <p style={{ color: t.danger, fontSize: '0.88rem' }}>無法載入醫院地圖資料</p>;
  if (!displayHospitals) return <p style={{ color: t.muted, fontSize: '0.88rem' }}>醫院地圖載入中...</p>;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* 首選卡：杯麵直接推第一名，省掉使用者自己比對五間 */}
      {top && (
        <div style={{
          display: 'flex', gap: '10px', alignItems: 'flex-start', flexShrink: 0,
          border: `1px solid ${t.text}`, borderRadius: '10px', padding: '12px', backgroundColor: t.page,
        }}>
          <BaymaxAvatar size={34} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexGrow: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em',
                color: t.page, backgroundColor: t.userBubble, borderRadius: '4px', padding: '2px 7px',
              }}>最推薦</span>
              <span style={{ fontSize: '0.7rem', color: t.muted }}>專長最符合 · 距離最近</span>
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: t.text, lineHeight: 1.35 }}>{top.name}</div>
            <div style={{ fontSize: '0.75rem', color: t.muted }}>
              {top.address}
              {top.distance_meters != null && ` · ${fmtDist(top.distance_meters)}`}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${coordOf(top).lat},${coordOf(top).lng}`}
                target="_blank" rel="noreferrer"
                style={{
                  textDecoration: 'none', fontSize: '0.76rem', fontWeight: 600,
                  color: t.page, backgroundColor: t.userBubble, borderRadius: '6px', padding: '7px 16px',
                }}
              >
                導航前往
              </a>
              {top.phone && (
                <a
                  href={`tel:${top.phone}`}
                  style={{
                    textDecoration: 'none', fontSize: '0.76rem', color: t.text,
                    border: `1px solid ${t.border}`, backgroundColor: t.panel,
                    borderRadius: '6px', padding: '6px 16px',
                  }}
                >
                  撥打電話
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ flexGrow: 1, minHeight: 0, position: 'relative' }}>
        {/* 問診完但查無合作院所：地圖留著讓使用者看得到自己的位置，只在上面疊一條說明 */}
        {isEmptyResult && (
          <div style={{
            position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 10, backgroundColor: t.panel, color: t.text,
            border: `1px solid ${t.border}`, borderRadius: '8px',
            padding: '8px 14px', fontSize: '0.82rem', fontWeight: 500,
            boxShadow: '0 2px 8px rgba(0,0,0,0.10)', whiteSpace: 'nowrap',
          }}>
            附近查無合作院所，建議直接前往鄰近醫院就診
          </div>
        )}

        <APIProvider apiKey={MAPS_KEY}>
          <Map
            style={{ width: '100%', height: isFullscreen ? 'calc(100vh - 100px)' : '100%', minHeight: '340px', borderRadius: '8px' }}
            defaultCenter={userPos || TAINAN_CENTER}
            defaultZoom={13}
            gestureHandling="cooperative"
          >
            {/* 自動聚焦控制器 */}
            <MapController displayHospitals={displayHospitals} userPos={userPos} />

            {userPos && (
              <Marker
                position={userPos}
                title="您的位置"
                icon="https://maps.google.com/mapfiles/ms/icons/blue-dot.png"
              />
            )}

            {displayHospitals.map((h, idx) => {
              const { lat, lng } = coordOf(h);
              if (!lat || !lng) return null;

              return (
                <Marker
                  key={h.hospital_code || h.name || idx}
                  position={{ lat, lng }}
                  title={isRanked ? `${idx + 1}. ${h.name}` : h.name}
                  onClick={() => setSelected({ ...h, lat, lng })}
                  zIndex={isRanked && idx === 0 ? 10 : 1}
                  icon={isRanked ? rankIcon(idx + 1, idx === 0) : undefined}
                />
              );
            })}

            {selected && (
              <InfoWindow
                position={{ lat: selected.lat, lng: selected.lng }}
                onCloseClick={() => setSelected(null)}
              >
                <div style={{ color: t.text, lineHeight: 1.7, fontSize: '0.85rem' }}>
                  <strong>{selected.name}</strong>
                  <br />{selected.address}
                  <br /><a href={`tel:${selected.phone}`} style={{ color: t.text }}>{selected.phone}</a>
                  {selected.distance_meters != null && <><br />距離約 {fmtDist(selected.distance_meters)}</>}
                  <br />
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`}
                    target="_blank" rel="noreferrer"
                  >
                    導航至此
                  </a>
                </div>
              </InfoWindow>
            )}
          </Map>
        </APIProvider>

        {/* 第 2~5 名縮成一排小格，點了就在地圖上開該院所的資訊視窗 */}
        {rest.length > 0 && (
          <div style={{
            position: 'absolute', left: '10px', right: '10px', bottom: '10px',
            zIndex: 5, display: 'flex', gap: '6px',
          }}>
            {rest.map((h, i) => {
              const { lat, lng } = coordOf(h);
              return (
                <button
                  key={h.hospital_code || h.name || i}
                  type="button"
                  onClick={() => lat && lng && setSelected({ ...h, lat, lng })}
                  style={{
                    flexGrow: 1, flexBasis: 0, minWidth: 0, cursor: 'pointer', fontFamily: 'inherit',
                    backgroundColor: 'rgba(255,255,255,0.94)', border: `1px solid ${t.border}`,
                    borderRadius: '8px', padding: '6px 4px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                  }}
                >
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#a1a1aa' }}>{i + 2}</span>
                  <span style={{
                    fontSize: '0.66rem', color: t.text, maxWidth: '100%',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{h.name}</span>
                  <span style={{ fontSize: '0.62rem', color: t.muted }}>
                    {h.distance_meters != null ? fmtDist(h.distance_meters) : ''}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default HospitalMap;
