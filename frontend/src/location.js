export const CITIES = ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣'];

export function coordinatesOf(h) {
  const lat = h?.lat ?? h?.latitude;
  const lng = h?.lng ?? h?.longitude;
  if (lat == null || lng == null || lat === '' || lng === '') return null;
  const position = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(position.lat) && Number.isFinite(position.lng)
    && Math.abs(position.lat) <= 90 && Math.abs(position.lng) <= 180 ? position : null;
}

export function distanceText(h) {
  const m = h?.distance_meters;
  if (h?.distance_reference !== 'provided_coordinates' || typeof m !== 'number' || !Number.isFinite(m) || m < 0) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${m} 公尺`;
}

export function navigationUrl(h) {
  // Hospital address/name also works when coordinates are unavailable.
  const destination = [h.name, h.address].filter(Boolean).join(' ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

export function emergencySearchUrl(location, city) {
  const position = coordinatesOf(location);
  const place = city || (position ? `${position.lat},${position.lng}` : '');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place} 急診`.trim())}`;
}
