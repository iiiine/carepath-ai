// src/screens/StartupScreen.js
//
// 開 App 後、訪客登入完成前的過場畫面。
//
// 為什麼需要它：RootNavigator 原本不看 AuthContext 的 loading，一啟動就直接
// 渲染 ConsultScreen。後端在免費方案上冷啟動要數十秒，這段期間畫面看起來
// 已經可以用了，使用者若先送出訊息，請求會在還沒拿到 token 的情況下送出，
// 後端回 401，看起來就像 App 壞掉。先擋住整個介面比較誠實。

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Animated } from 'react-native';

import { t } from '../theme';
import { useElderMode } from '../context/ElderModeContext';

// 等多久才顯示喚醒說明。後端是暖的時候訪客登入約 1 秒內完成，
// 立刻顯示「約需一分鐘」反而會嚇到人，所以等超過這個秒數才補上。
// 與 ConsultScreen 的 WAKE_HINT_DELAY 同樣用意，兩處各自宣告不共用常數。
const WAKE_HINT_DELAY = 6000;


// 三顆跳動的點。動畫參數刻意抄 ConsultScreen 的 TypingIndicator，
// 讓「系統正在忙」在兩個畫面看起來是同一件事。
//
// ponytail: 不把 TypingIndicator 抽成共用元件。它綁在 ConsultScreen 的
//   makeStyles(s) 上，抽出來要一併動到那支檔案的樣式結構，為了三顆點不划算。
function LoadingDots({ size }) {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.stagger(150, [dot1, dot2, dot3].map((dot) =>
        Animated.sequence([
          Animated.timing(dot, { toValue: 1, duration: 250, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 250, useNativeDriver: true }),
        ])
      ))
    ).start();
  }, []);

  const dotStyle = (dot) => ({
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: '#94A3B8',
    transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }],
    opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
  });

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Animated.View style={dotStyle(dot1)} />
      <Animated.View style={dotStyle(dot2)} />
      <Animated.View style={dotStyle(dot3)} />
    </View>
  );
}


export default function StartupScreen() {
  const { s } = useElderMode();
  const [showWakeHint, setShowWakeHint] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowWakeHint(true), WAKE_HINT_DELAY);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.page,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: s.padLg,
      }}
    >
      <Image
        source={require('../../assets/carepath-wordmark.png')}
        style={{ width: s.touch * 2.3, height: s.touch * 2.6 }}
        resizeMode="contain"
      />

      <View style={{ marginTop: s.padLg }}>
        {/* 高齡模式下點點也跟著放大，跟其他元素一致 */}
        <LoadingDots size={s.body >= 18 ? 12 : 8} />
      </View>

      {showWakeHint && (
        <Text
          style={{
            marginTop: s.padLg,
            fontSize: s.body,
            lineHeight: s.lineBody,
            color: t.muted,
            textAlign: 'center',
          }}
        >
          伺服器喚醒中，首次連線約需一分鐘，請稍候…
        </Text>
      )}
    </View>
  );
}
