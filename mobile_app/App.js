// App.js
import React, { useContext } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, AuthContext } from './src/context/AuthContext';
import { ElderModeProvider } from './src/context/ElderModeContext';
import ConsultScreen from './src/screens/ConsultScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import LoginScreen from './src/screens/LoginScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import HistoryListScreen from './src/screens/HistoryListScreen';
import StartupScreen from './src/screens/StartupScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ 
      headerShown: false,
      // 🌟 徹底隱藏底部導航，全權交給我們手刻的側邊欄控制
      tabBarStyle: { display: 'none' } 
    }}>
      <Tab.Screen name="Consult" component={ConsultScreen} />
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="HistoryList" component={HistoryListScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Login" component={LoginScreen} options={{ presentation: 'modal' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// 訪客登入完成前先擋住整個介面。冷啟動時後端要數十秒才醒，
// 這段期間放行會讓使用者在還沒拿到 token 時就送出請求，後端回 401。
function AuthGate({ children }) {
  const { loading } = useContext(AuthContext);
  return loading ? <StartupScreen /> : children;
}


export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ElderModeProvider>
          <AuthGate>
            <RootNavigator />
          </AuthGate>
        </ElderModeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}