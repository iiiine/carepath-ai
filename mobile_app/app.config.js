// mobile_app/app.config.js
//
// 從 app.json 換成 app.config.js 的原因：
// Google Maps 的 Android 金鑰不能進版控，而靜態 JSON 讀不到環境變數。
//
// 金鑰來源：本機看 .env（Expo CLI 會自動載入），EAS Build 雲端看 EAS 環境變數。
// ⚠️ 在 EAS 上要設成 plaintext 或 sensitive，不能設成 secret ——
//    secret 型別在解析 app config 的階段讀不到，plugin 會拿到 undefined。

const googleMapsApiKey =
  process.env.GOOGLE_MAPS_ANDROID_API_KEY;


module.exports = {
  expo: {
    name: 'CarePath AI',
    slug: 'carepath-ai',
    // 帳號有個人與團隊兩個，明寫 owner 才不用每次 eas 指令都帶 --account
    owner: 'iiiine',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,

    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },

    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.carepathai.app',
    },

    android: {
      package: 'com.carepathai.app',
      versionCode: 2,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      edgeToEdgeEnabled: true,
    },

    web: {
      favicon: './assets/favicon.png',
    },

    // eas init 建立的專案識別。動態 config 沒辦法讓 CLI 自動寫入，只能手動補。
    extra: {
      eas: {
        projectId: 'b00168ee-fa2a-4b64-840d-2918ca1d9766',
      },
    },

    plugins: [
      'expo-secure-store',
      '@react-native-vector-icons/material-design-icons',
      'expo-font',

      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'CarePath AI 需要您的位置，才能推薦附近的醫院與診所。',
        },
      ],

      // 沒有金鑰時整個不掛 plugin：帶空字串進去會產生一筆空的 meta-data，
      // 反而比沒設定更難查。缺金鑰的行為是地圖空白，其餘功能不受影響。
      ...(googleMapsApiKey
        ? [
            [
              'react-native-maps',
              { androidGoogleMapsApiKey: googleMapsApiKey },
            ],
          ]
        : []),
    ],
  },
};
