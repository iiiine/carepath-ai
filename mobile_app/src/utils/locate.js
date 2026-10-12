import { coordinatesOf } from './location.js';

// Permission prompts can stay open; the caller is free to continue without location.
export async function locate(Location, timeoutMs = 8000) {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') return { position: null, status: 'denied' };
  let timer;
  try {
    const result = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    const p = coordinatesOf(result.coords);
    return p ? { position: { latitude: p.lat, longitude: p.lng }, status: 'success' }
      : { position: null, status: 'unavailable' };
  } catch (error) {
    return { position: null, status: error.message === 'timeout' ? 'timeout' : 'unavailable' };
  } finally { clearTimeout(timer); }
}
