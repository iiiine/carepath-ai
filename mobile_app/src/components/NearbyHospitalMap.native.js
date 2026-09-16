// src/components/NearbyHospitalMap.native.js
// 原生（iOS / Android）版本的附近醫院地圖。
//
// 為什麼要拆成 .native.js / .web.js 兩個檔案：
// react-native-maps 依賴 codegenNativeComponent，react-native-web 沒有這個函式，
// 因此只要在模組層級 import 它，web 版就會在載入階段直接崩潰。
// 用 Platform.OS 判斷擋不住，因為 import 本身就會先執行。
// 交給 Metro 依副檔名解析，才能真正把它排除在 web bundle 之外。

import React from 'react';
import { Platform, View, Text } from 'react-native';
import { coordinatesOf } from '../utils/location';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';


export default function NearbyHospitalMap({
    style,
    userLocation,
    hospitals,
}) {
    const user = coordinatesOf(userLocation);
    const first = (hospitals || []).map(coordinatesOf).find(Boolean);
    const center = user || first;
    if (!center) return <View style={style}><Text>未提供可顯示的座標，請使用下方院所地址導覽。</Text></View>;
    const lat = center.lat;
    const lng = center.lng;

    return (
        <MapView
            key={`${lat},${lng}`}
            // 只有 Android 指定 Google Maps，這樣才吃得到 app.config.js 掛的金鑰。
            // iOS 不能跟著設：PROVIDER_GOOGLE 會改要 Google Maps iOS SDK 的金鑰，
            // 留 undefined 走系統內建的 Apple Maps，不必額外申請。
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            style={style}
            initialRegion={{
                latitude: lat,
                longitude: lng,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
            }}
        >
            {user && <Marker
                coordinate={{ latitude: user.lat, longitude: user.lng }}
                title="問診當時位置"
                pinColor="red"
            />}

            {Array.isArray(hospitals) && hospitals.map((hospital, idx) => {
                const point = coordinatesOf(hospital);
                if (!point) return null;
                const { lat: hLat, lng: hLng } = point;

                return (
                    <Marker
                        key={idx}
                        coordinate={{ latitude: hLat, longitude: hLng }}
                        title={hospital.name}
                        description={hospital.address}
                        pinColor="blue"
                    />
                );
            })}
        </MapView>
    );
}
