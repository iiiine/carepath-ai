import { useEffect, useState } from 'react';
import { coordinatesOf } from './location';

export function useLocationSelection() {
  const [position, setPosition] = useState(null);
  const [city, setCity] = useState('');
  const [status, setStatus] = useState(() => navigator.geolocation ? 'loading' : 'unsupported');
  useEffect(() => {
    if (!navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      result => {
        if (cancelled) return;
        const coordinates = coordinatesOf(result.coords);
        setPosition(coordinates ? { latitude: coordinates.lat, longitude: coordinates.lng } : null);
        setStatus(coordinates ? 'success' : 'unavailable');
      },
      error => {
        if (cancelled) return;
        setPosition(null);
        setStatus(error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 },
    );
    return () => { cancelled = true; };
  }, []);
  return { location: city ? null : position, city, setCity, status: city ? 'manual' : status };
}
