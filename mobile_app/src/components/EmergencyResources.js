import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { t } from '../theme';
import { useElderMode } from '../context/ElderModeContext';
import client from '../api/client';

const DIRECTORY_URL = 'https://dep.mohw.gov.tw/DOMA/cp-2710-7581-106.html';
const SUPPORT_URL = 'https://dep.mohw.gov.tw/DOMHAOH/cp-4906-54077-107.html';

async function openUrl(url) {
  try {
    await Linking.openURL(url);
  } catch (error) {
    console.error('開啟外部連結失敗：', error);
    Alert.alert('無法開啟', '請確認裝置已設定可開啟此連結的應用程式。');
  }
}

export default function EmergencyResources({ location, city, safety, onSelectCity }) {
  const { s } = useElderMode();
  const [result, setResult] = useState(null);
  const lat = city ? null : location?.latitude ?? null;
  const lng = city ? null : location?.longitude ?? null;
  const queryKey = JSON.stringify([lat, lng, city]);
  const relevant = result?.queryKey === queryKey;
  const hasLocation = lat !== null && lng !== null;

  useEffect(() => {
    if (!hasLocation && !city) return undefined;

    let active = true;
    client.get('/api/v1/emergency-resources', {
      params: city ? { city } : { lat, lng },
      timeout: 5000,
    })
      .then(({ data }) => {
        if (active) setResult({ queryKey, data });
      })
      .catch((error) => {
        if (active) {
          console.error('載入急症院所失敗：', error);
          setResult({ queryKey, error: true });
        }
      });

    return () => { active = false; };
  }, [city, hasLocation, lat, lng, queryKey]);

  const hospitals = relevant ? result?.data?.hospitals || [] : [];
  const emotionalSupport = safety?.red_flags?.some((flag) => /^(SELF_HARM|HARM_TO_OTHERS)/.test(flag.code || ''))
    || safety?.present_flags?.some((flag) => /^(self_harm|harm_others|imminent_self_harm|imminent_harm_to_others)/.test(flag));
  const place = city || (hasLocation ? `${lat},${lng}` : '');
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place} 急診`.trim())}`;
  const textStyle = { color: '#7f1d1d', fontSize: s.caption, lineHeight: s.lineBody };
  const actionStyle = {
    minHeight: s.touch,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: s.gap,
    borderRadius: s.radius,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fff7f7',
  };

  return (
    <View accessibilityLabel="急症求助與院所資源" style={{
      marginTop: s.gapLg,
      padding: s.pad,
      borderRadius: s.radius,
      borderWidth: 1,
      borderColor: '#fecaca',
      backgroundColor: '#fff1f2',
    }}>
      <Text style={{ ...textStyle, fontWeight: '800', color: '#991b1b' }}>立即行動</Text>
      <TouchableOpacity
        onPress={() => openUrl('tel:119')}
        accessibilityRole="button"
        style={[actionStyle, { marginTop: s.gap, backgroundColor: '#dc2626', borderColor: '#dc2626' }]}
      >
        <Text style={{ ...textStyle, color: '#ffffff', fontWeight: '800' }}>撥打 119 緊急救護</Text>
      </TouchableOpacity>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: s.gap, marginTop: s.gap }}>
        <TouchableOpacity onPress={() => openUrl(DIRECTORY_URL)} accessibilityRole="link" style={actionStyle}>
          <Text style={textStyle}>衛福部急救責任醫院名單</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => place
            ? openUrl(mapsUrl)
            : Alert.alert('尚未設定地點', '請先選擇縣市或允許定位，再搜尋附近急診。')}
          accessibilityRole="link"
          style={actionStyle}
        >
          <Text style={textStyle}>{city ? `搜尋${city}急診` : '開啟附近急診搜尋'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={[textStyle, { marginTop: s.gap }]}>
        急需救護請直接撥 119，不必等待院所查詢。院所距離為直線距離，搜尋結果不代表能立即收治。
      </Text>

      {emotionalSupport && (
        <View style={{ marginTop: s.gap, padding: s.gap, borderRadius: s.radius, backgroundColor: '#ffffff' }}>
          <Text style={textStyle}>心理支持：可撥打 1925 安心專線（24 小時免付費）。如有立即危險，請先撥 119。</Text>
          <TouchableOpacity onPress={() => openUrl('tel:1925')} accessibilityRole="button" style={[actionStyle, { marginTop: s.gap }]}>
            <Text style={textStyle}>撥打 1925 安心專線</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => openUrl(SUPPORT_URL)} accessibilityRole="link" style={{ minHeight: s.touch, justifyContent: 'center' }}>
            <Text style={[textStyle, { textDecorationLine: 'underline' }]}>查看服務說明</Text>
          </TouchableOpacity>
        </View>
      )}

      {!place
        ? (
          <View style={{ marginTop: s.gap }}>
            <Text style={textStyle}>未提供定位；請先選擇縣市，才能查看已核對的院所。</Text>
            {!!onSelectCity && (
              <TouchableOpacity
                onPress={onSelectCity}
                accessibilityRole="button"
                style={[actionStyle, { marginTop: s.gap }]}
              >
                <Text style={textStyle}>選擇縣市</Text>
              </TouchableOpacity>
            )}
          </View>
        )
        : !relevant
          ? <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: s.gap }}>
            <ActivityIndicator color="#991b1b" />
            <Text style={[textStyle, { marginLeft: s.gap }]}>院所資料載入中；求助電話可立即使用。</Text>
          </View>
          : result.error || result.data?.status === 'unavailable'
            ? <Text style={[textStyle, { marginTop: s.gap }]}>院所資料暫時無法取得，請使用求助電話或官方名單。</Text>
            : result.data?.status === 'needs_review'
              ? <Text style={[textStyle, { marginTop: s.gap }]}>院所名單待更新，請查閱官方最新名單。</Text>
              : hospitals.length === 0
                ? <Text style={[textStyle, { marginTop: s.gap }]}>此查詢範圍沒有已核對的院所資料，不代表當地沒有急診；請查閱官方名單。</Text>
                : (
                  <View style={{ marginTop: s.gapLg }}>
                    <Text style={{ ...textStyle, fontWeight: '800', color: '#991b1b' }}>
                      {city ? `${city}已核對院所` : '30 公里內已核對院所'}（部分名單，非即時收治資訊）
                    </Text>
                    {hospitals.map((hospital, index) => {
                      const distance = hospital.distance_reference === 'provided_coordinates'
                        && Number.isFinite(hospital.distance_meters)
                        ? `直線距離約 ${hospital.distance_meters >= 1000
                          ? `${(hospital.distance_meters / 1000).toFixed(1)} 公里`
                          : `${hospital.distance_meters} 公尺`}`
                        : null;
                      const destination = [hospital.name, hospital.address].filter(Boolean).join(' ');
                      const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;

                      return (
                        <View key={`${hospital.name}-${hospital.address}-${index}`} style={{
                          marginTop: s.gap,
                          padding: s.gap,
                          borderRadius: s.radius,
                          backgroundColor: '#ffffff',
                        }}>
                          <Text style={{ ...textStyle, fontWeight: '800' }}>
                            {hospital.name}{distance ? ` · ${distance}` : ''}
                          </Text>
                          <Text style={textStyle}>{hospital.address}</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: s.gap, marginTop: s.gap }}>
                            <TouchableOpacity onPress={() => openUrl(directionsUrl)} accessibilityRole="link" style={actionStyle}>
                              <Text style={textStyle}>查看院所位置</Text>
                            </TouchableOpacity>
                            {hospital.phone && (
                              <TouchableOpacity onPress={() => openUrl(`tel:${hospital.phone}`)} accessibilityRole="button" style={actionStyle}>
                                <Text style={textStyle}>院所電話</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      );
                    })}
                    <Text style={[textStyle, { marginTop: s.gap }]}>
                      核對日期：{result.data.verified_on || '—'}
                    </Text>
                    {!!result.data.source_url && (
                      <TouchableOpacity onPress={() => openUrl(result.data.source_url)} accessibilityRole="link" style={{ minHeight: s.touch, justifyContent: 'center' }}>
                        <Text style={[textStyle, { textDecorationLine: 'underline' }]}>查看衛福部資料來源</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
    </View>
  );
}
