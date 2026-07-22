import { useState, useEffect } from 'react';
import { APIProvider, Map, Marker, InfoWindow } from '@vis.gl/react-google-maps';
import api from './api/axios';

// Google Maps API key 放 frontend/.env.local（已被 gitignore，不會進 git）
// 內容：VITE_GOOGLE_MAPS_API_KEY=你的key
const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

const TAINAN_CENTER = { lat: 22.99, lng: 120.21 }; // 定位失敗時的預設中心（台南市區）

const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${m} 公尺`);

function HospitalMap() {
  const [userPos, setUserPos] = useState(null);   // {lat, lng}，拿不到定位就是 null
  const [located, setLocated] = useState(false);  // 定位流程結束（成功或失敗）
  const [hospitals, setHospitals] = useState(null);
  const [selected, setSelected] = useState(null); // 被點選的醫院
  const [error, setError] = useState(false);

  // 1. 先問瀏覽器要使用者位置；被拒絕或逾時就放棄，用預設中心
  useEffect(() => {
    if (!navigator.geolocation) return setLocated(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setUserPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocated(true); },
      () => setLocated(true),
      { timeout: 5000 }
    );
  }, []);

  // 2. 定位結束後向後端要醫院清單（有座標就會照距離排序）
  useEffect(() => {
    if (!located) return;
    const params = userPos ? { lat: userPos.lat, lng: userPos.lng } : {};
    api.get('/api/v1/hospitals', { 
      params,
      headers: {
      'ngrok-skip-browser-warning': 'true' 
      }
    })
      .then((res) => setHospitals(res.data.hospitals))
      .catch(() => setError(true));
  }, [located, userPos]);

  if (!MAPS_KEY) return <p style={{ color: '#d9534f' }}>⚠️ 未設定 Google Maps API key（frontend/.env.local）</p>;
  if (error) return <p style={{ color: '#d9534f' }}>⚠️ 無法載入醫院地圖資料</p>;
  if (!hospitals) return <p style={{ color: '#666' }}>🗺️ 醫院地圖載入中...</p>;

  return (
    <div style={{ marginTop: '15px' }}>
      <h5 style={{ margin: '0 0 8px' }}>🗺️ 臺南市醫院地圖{userPos ? '（依距離排序）' : '（未取得您的位置，顯示全部）'}</h5>
      <APIProvider apiKey={MAPS_KEY}>
        <Map
          style={{ height: '360px', borderRadius: '8px' }}
          defaultCenter={userPos || TAINAN_CENTER}
          defaultZoom={13}
          gestureHandling="cooperative"
        >
          {userPos && (
            <Marker
              position={userPos}
              title="您的位置"
              icon="https://maps.google.com/mapfiles/ms/icons/blue-dot.png"
            />
          )}
          {hospitals.map((h) => (
            <Marker
              key={h.name}
              position={{ lat: h.lat, lng: h.lng }}
              title={h.name}
              onClick={() => setSelected(h)}
            />
          ))}
          {selected && (
            <InfoWindow
              position={{ lat: selected.lat, lng: selected.lng }}
              onCloseClick={() => setSelected(null)}
            >
              <div style={{ color: '#333', lineHeight: 1.6 }}>
                <strong>{selected.name}</strong>
                <br />{selected.address}
                <br />📞 <a href={`tel:${selected.phone}`}>{selected.phone}</a>
                {selected.distance_meters != null && <><br />📏 距離約 {fmtDist(selected.distance_meters)}</>}
                <br />
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`}
                  target="_blank" rel="noreferrer"
                >
                  🧭 導航
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
