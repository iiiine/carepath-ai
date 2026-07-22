import { useState, useEffect } from 'react';
import { APIProvider, Map, Marker, InfoWindow } from '@vis.gl/react-google-maps';
import api from './api/axios';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const TAINAN_CENTER = { lat: 22.99, lng: 120.21 };

const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${m} 公尺`);

function HospitalMap({ isFullscreen }) {
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

  if (!MAPS_KEY) return <p style={{ color: '#d9534f' }}>⚠️ 未設定 Google Maps API key</p>;
  if (error) return <p style={{ color: '#d9534f' }}>⚠️ 無法載入醫院地圖資料</p>;
  if (!hospitals) return <p style={{ color: '#666' }}>🗺️ 醫院地圖載入中...</p>;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <APIProvider apiKey={MAPS_KEY}>
        <Map
          style={{ width: '100%', height: isFullscreen ? 'calc(100vh - 100px)' : '100%', minHeight: '380px', borderRadius: '8px' }}
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