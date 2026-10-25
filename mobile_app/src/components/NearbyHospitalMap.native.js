// src/components/NearbyHospitalMap.native.js
// 原生（iOS / Android）版本的附近醫院地圖。
//
// 為什麼要拆成 .native.js / .web.js 兩個檔案：
// react-native-maps 依賴 codegenNativeComponent，react-native-web 沒有這個函式，
// 因此只要在模組層級 import 它，web 版就會在載入階段直接崩潰。
// 用 Platform.OS 判斷擋不住，因為 import 本身就會先執行。
// 交給 Metro 依副檔名解析，才能真正把它排除在 web bundle 之外。

import React from 'react';
import { Platform } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

function coordinate(value, limit) {
    if (value == null || value === '') return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const number = Number(value);
    return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

export default function NearbyHospitalMap({
    style,
    userLocation,
    hospitals,
}) {
    const firstHospital = Array.isArray(hospitals)
        ? hospitals.find((hospital) => coordinate(hospital.latitude, 90) !== null && coordinate(hospital.longitude, 180) !== null)
        : null;
    const userLat = coordinate(userLocation?.latitude, 90);
    const userLng = coordinate(userLocation?.longitude, 180);
    const hasUserLocation = userLat !== null && userLng !== null;
    const lat = hasUserLocation ? userLat : (coordinate(firstHospital?.latitude, 90) ?? 23.6978);
    const lng = hasUserLocation ? userLng : (coordinate(firstHospital?.longitude, 180) ?? 120.9605);

    return (
        <MapView
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
            {hasUserLocation && (
                <Marker
                    coordinate={{ latitude: userLat, longitude: userLng }}
                    title="目前位置"
                    pinColor="red"
                />
            )}

            {Array.isArray(hospitals) && hospitals.map((hospital, idx) => {
                const hLat = coordinate(hospital.latitude, 90);
                const hLng = coordinate(hospital.longitude, 180);

                if (hLat === null || hLng === null) return null;

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
