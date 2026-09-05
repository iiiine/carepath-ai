// src/components/NearbyHospitalMap.native.js
// 原生（iOS / Android）版本的附近醫院地圖。
//
// 為什麼要拆成 .native.js / .web.js 兩個檔案：
// react-native-maps 依賴 codegenNativeComponent，react-native-web 沒有這個函式，
// 因此只要在模組層級 import 它，web 版就會在載入階段直接崩潰。
// 用 Platform.OS 判斷擋不住，因為 import 本身就會先執行。
// 交給 Metro 依副檔名解析，才能真正把它排除在 web bundle 之外。

import React from 'react';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';


export default function NearbyHospitalMap({
    style,
    userLocation,
    fallbackLocation,
    hospitals,
}) {
    const lat = Number(userLocation?.latitude ?? fallbackLocation.latitude);
    const lng = Number(userLocation?.longitude ?? fallbackLocation.longitude);

    return (
        <MapView
            // Android 一律走 Google Maps，明講 provider 才會吃 app.config.js 掛的金鑰。
            // 金鑰沒設時地圖是一片灰底，marker 也不會出現，但不影響其他功能。
            provider={PROVIDER_GOOGLE}
            style={style}
            initialRegion={{
                latitude: lat,
                longitude: lng,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
            }}
        >
            <Marker
                coordinate={{ latitude: lat, longitude: lng }}
                title="目前位置"
                pinColor="red"
            />

            {Array.isArray(hospitals) && hospitals.map((hospital, idx) => {
                const hLat = parseFloat(hospital.latitude);
                const hLng = parseFloat(hospital.longitude);

                if (isNaN(hLat) || isNaN(hLng)) return null;

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
