import { useState, useEffect } from 'react';
import { APIProvider, Map, Marker, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import api from './api/axios';
import { t } from './theme';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const TAINAN_CENTER = { lat: 22.99, lng: 120.21 };

const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${m} 公尺`);

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
      // 支援 lat/lng 或 latitude/longitude
      const lat = h.lat ?? h.latitude;
      const lng = h.lng ?? h.longitude;
      if (lat && lng) {
        bounds.extend({ lat: Number(lat), lng: Number(lng) });
      }
    });

    // 移動視野並加上邊距 (Padding)
    map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
  }, [map, displayHospitals, userPos]);

  return null;
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

  if (!MAPS_KEY) return <p style={{ color: t.danger, fontSize: '0.88rem' }}>未設定 Google Maps API key</p>;
  if (error && !hospitalsProp) return <p style={{ color: t.danger, fontSize: '0.88rem' }}>無法載入醫院地圖資料</p>;
  if (!displayHospitals) return <p style={{ color: t.muted, fontSize: '0.88rem' }}>醫院地圖載入中...</p>;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
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
          style={{ width: '100%', height: isFullscreen ? 'calc(100vh - 100px)' : '100%', minHeight: '380px', borderRadius: '8px' }}
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
            // 💡 兼顧後端兩種欄位格式 lat/lng 或 latitude/longitude
            const lat = Number(h.lat ?? h.latitude);
            const lng = Number(h.lng ?? h.longitude);

            if (!lat || !lng) return null;

            return (
              <Marker
                key={h.hospital_code || h.name || idx}
                position={{ lat, lng }}
                title={h.name}
                onClick={() => setSelected({ ...h, lat, lng })}
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
    </div>
  );
}

export default HospitalMap;