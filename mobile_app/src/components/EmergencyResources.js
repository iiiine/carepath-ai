import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Linking, Alert } from 'react-native';
import client from '../api/client';
import { distanceText, navigationUrl, emergencySearchUrl } from '../utils/location';

const DIRECTORY = 'https://dep.mohw.gov.tw/DOMA/cp-2710-7581-106.html';
const open = url => Linking.openURL(url).catch(() => Alert.alert('無法開啟', '請使用電話或瀏覽器手動開啟。'));
function Link({ title, url }) {
  return <TouchableOpacity accessibilityRole="link" accessibilityLabel={title} onPress={() => open(url)} style={{ padding: 12, marginVertical: 4, borderWidth: 1, borderColor: '#991b1b', borderRadius: 8 }}><Text style={{ color: '#991b1b', fontSize: 16 }}>{title}</Text></TouchableOpacity>;
}
export default function EmergencyResources({ location, city, safety }) {
  const lat = location?.latitude ?? null;
  const lng = location?.longitude ?? null;
  const key = JSON.stringify([lat, lng, city]);
  const [result, setResult] = useState(null);
  const needsLocation = lat === null && !city;
  const relevant = result?.key === key;
  useEffect(() => {
    if (lat === null && !city) return;
    const controller = new AbortController();
    client.get('/api/v1/emergency-resources', { params: city ? { city } : { lat, lng }, timeout: 5000, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setResult({ key, data }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, error: true }); });
    return () => controller.abort();
  }, [lat, lng, city, key]);
  const emotional = safety?.red_flags?.some(flag => /^(SELF_HARM|HARM_TO_OTHERS)/.test(flag.code || ''))
    || safety?.present_flags?.some(flag => /^(self_harm|harm_others|imminent_self_harm|imminent_harm_to_others)/.test(flag));
  const hospitals = relevant && Array.isArray(result.data?.hospitals) ? result.data.hospitals : [];
  const message = needsLocation ? '未提供定位，可在地區選擇中指定縣市。'
    : !relevant ? '院所資料載入中；求助電話可立即使用。'
    : result.error || result.data?.status === 'unavailable' ? '院所資料暫時無法取得，請使用求助電話或官方名單。'
    : result.data?.status === 'needs_review' ? '院所名單待更新，請查閱官方最新名單。'
    : !hospitals.length ? '此範圍沒有已核對資料，不代表當地沒有急診。' : null;
  return <View>
    <Link title="撥打 119 緊急救護" url="tel:119" />
    <Link title="衛福部急救責任醫院名單" url={DIRECTORY} />
    <Link title={city ? `搜尋${city}急診` : location ? '開啟附近急診搜尋' : '開啟急診搜尋（請設定地點）'} url={emergencySearchUrl(location, city)} />
    {emotional && <>
      <Link title="撥打 1925 安心專線" url="tel:1925" />
      <Text>心理支持專線，24 小時免付費；如有立即危險請先撥 119。</Text>
      <Link title="安心專線服務說明" url="https://dep.mohw.gov.tw/DOMHAOH/cp-4906-54077-107.html" />
    </>}
    <Text>急需救護請直接撥 119，不必等待院所查詢。距離不代表能立即收治。</Text>
    {message ? <Text accessibilityLiveRegion="polite" style={{ marginVertical: 12 }}>{message}</Text> : <>
      <Text>{city || '30 公里內'}已核對院所（部分名單，非即時收治資訊）</Text>
      {hospitals.map(h => <View key={`${h.name}-${h.address}`} style={{ marginVertical: 8 }}>
        <Text>{h.name} · {h.address}{distanceText(h) ? ` · 直線距離約 ${distanceText(h)}` : ''}</Text>
        <Link title={`查看${h.name}位置`} url={navigationUrl(h)} />
        {h.phone && <Link title={`院所電話 ${h.phone}`} url={`tel:${h.phone}`} />}
      </View>)}
      <Text>核對日期：{result.data.verified_on}</Text>
      <Link title="院所資格資料來源" url="https://dep.mohw.gov.tw/DOMA/fp-979-4112-106.html" />
    </>}
  </View>;
}
