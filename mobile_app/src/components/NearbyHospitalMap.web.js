// src/components/NearbyHospitalMap.web.js
// Web（瀏覽器預覽）版本的附近醫院地圖替代畫面。
//
// react-native-maps 沒有 web 實作，這個檔案讓 web bundle 完全不會載入它。
// 醫院清單在地圖下方本來就以卡片完整列出（含名稱、地址、導航連結），
// 因此 web 版只顯示提示，不會遺漏任何就醫資訊。

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { t } from '../theme';


export default function NearbyHospitalMap({ style, hospitals }) {
    const count = Array.isArray(hospitals) ? hospitals.length : 0;

    return (
        <View style={[style, styles.placeholder]}>
            <Text style={styles.title}>
                🗺️ 地圖僅在手機版顯示
            </Text>

            <Text style={styles.hint}>
                {count > 0
                    ? `已為你找到 ${count} 間附近醫院，詳細資訊請見下方清單`
                    : '附近醫院資訊請見下方清單'}
            </Text>
        </View>
    );
}


const styles = StyleSheet.create({
    placeholder: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: t.subtle,
        paddingHorizontal: 20,
    },
    title: {
        fontSize: 15,
        fontWeight: '900',
        color: t.text,
        marginBottom: 6,
    },
    hint: {
        fontSize: 13,
        color: t.muted,
        textAlign: 'center',
        lineHeight: 19,
    },
});
