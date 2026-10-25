import React, { useEffect, useMemo, useState } from 'react';
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

const STATUS_LABELS = {
  available: '可掛號',
  full: '預約額滿',
  closed: '停診',
  substitute: '代診',
  unknown: '請至院方確認',
};

function isSchedulePast(schedule) {
  if (!schedule?.schedule_date) return false;
  const endTime = schedule.end_time || '23:59:59';
  const endDateTime = new Date(`${schedule.schedule_date}T${endTime}+08:00`);
  return Number.isFinite(endDateTime.getTime()) && endDateTime.getTime() < Date.now();
}

async function openUrl(url) {
  try {
    await Linking.openURL(url);
  } catch (error) {
    console.error('開啟掛號連結失敗：', error);
    Alert.alert('無法開啟', '請確認裝置已設定可開啟此連結的應用程式。');
  }
}

export default function DoctorScheduleInfo({ hospitalCode, doctorName }) {
  const { s } = useElderMode();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(hospitalCode && doctorName));
  const [error, setError] = useState(false);
  const textStyle = { color: t.text, fontSize: s.caption, lineHeight: s.lineBody };
  const mutedStyle = { color: t.muted, fontSize: s.caption, lineHeight: s.lineBody };

  useEffect(() => {
    if (!hospitalCode || !doctorName) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);
    setError(false);

    client.get('/api/v1/doctor-schedules', {
      params: { hospital_code: hospitalCode, doctor_name: doctorName, days: 60 },
    })
      .then(({ data: response }) => {
        if (active) setData(response);
      })
      .catch((requestError) => {
        if (active) {
          console.error('讀取醫師門診失敗：', requestError);
          setError(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [doctorName, hospitalCode]);

  const upcomingSchedules = useMemo(
    () => (data?.schedules || []).filter((schedule) => !isSchedulePast(schedule)).slice(0, 3),
    [data]
  );

  if (loading) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: s.gap }}>
        <ActivityIndicator color={t.userBubble} />
        <Text style={[mutedStyle, { marginLeft: s.gap }]}>正在確認近期門診...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <Text style={[mutedStyle, {
        marginTop: s.gap,
        padding: s.gap,
        borderRadius: s.radius,
        backgroundColor: '#fff7ed',
        color: '#9a3412',
      }]}>
        目前無法取得門診資訊，請以院方官方資訊為準。
      </Text>
    );
  }

  if (!data) return null;

  const bookingUrl = data.hospital?.booking_url;
  const bookingNote = data.hospital?.booking_note;

  return (
    <View style={{
      marginTop: s.gap,
      padding: s.gap,
      borderRadius: s.radius,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.subtle,
    }}>
      <Text style={[textStyle, { fontWeight: '800' }]}>近期門診</Text>

      {upcomingSchedules.length === 0
        ? (
          <Text style={[mutedStyle, { marginTop: s.gap }]}>
            目前尚無可可靠確認的近期日期級門診資料。系統不會自行推測醫師班表，請以院方官方資訊為準。
          </Text>
        )
        : upcomingSchedules.map((schedule, index) => (
          <View key={schedule.id || `${schedule.schedule_date}-${index}`} style={{
            marginTop: s.gap,
            padding: s.gap,
            borderRadius: s.radius,
            backgroundColor: t.panel,
          }}>
            <Text style={[textStyle, { fontWeight: '700' }]}>
              {schedule.schedule_date}
              {schedule.weekday_label ? ` ${schedule.weekday_label}` : ''}
              {schedule.session ? `｜${schedule.session}` : ''}
            </Text>
            {!!schedule.time_text && <Text style={textStyle}>時間：{schedule.time_text}</Text>}
            <Text style={mutedStyle}>
              {schedule.time_precision === 'session_window'
                ? '此時間為院方公布之門診時段，非保證醫師於起始時間準時開始看診。'
                : schedule.time_precision === 'exact'
                  ? '此時間為官方公布之醫師門診時間。'
                  : '院方未公布可可靠確認的明確時間。'}
            </Text>
            {!!schedule.clinic_room && <Text style={textStyle}>診間：{schedule.clinic_room}</Text>}
            <Text style={textStyle}>
              掛號狀態：{schedule.registration_status_label || STATUS_LABELS[schedule.registration_status] || STATUS_LABELS.unknown}
            </Text>
            {!!schedule.substitute_doctor_name && <Text style={textStyle}>代診醫師：{schedule.substitute_doctor_name}</Text>}
            {!!schedule.status_note && <Text style={textStyle}>備註：{schedule.status_note}</Text>}
            {!!schedule.last_verified_at && (
              <Text style={mutedStyle}>
                最後確認：{new Date(schedule.last_verified_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
              </Text>
            )}
            {!!schedule.registration_url && (
              <TouchableOpacity
                onPress={() => openUrl(schedule.registration_url)}
                accessibilityRole="link"
                style={{ minHeight: s.touch, justifyContent: 'center' }}
              >
                <Text style={{ ...textStyle, color: '#2563eb', fontWeight: '700' }}>開啟官方掛號</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

      {bookingUrl
        ? (
          <TouchableOpacity
            onPress={() => openUrl(bookingUrl)}
            accessibilityRole="link"
            style={{ minHeight: s.touch, justifyContent: 'center', marginTop: s.gap }}
          >
            <Text style={{ ...textStyle, color: '#2563eb', fontWeight: '700' }}>查看院方最新門診／掛號</Text>
          </TouchableOpacity>
        )
        : bookingNote
          ? <Text style={[textStyle, { marginTop: s.gap }]}>掛號方式：{bookingNote}</Text>
          : <Text style={[mutedStyle, { marginTop: s.gap }]}>此院目前尚未提供可確認的官方掛號入口。</Text>}

      {!!data.notice && <Text style={[mutedStyle, { marginTop: s.gap }]}>{data.notice}</Text>}
    </View>
  );
}
