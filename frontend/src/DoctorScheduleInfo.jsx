import { useEffect, useMemo, useState } from "react";
import api from "./api/axios";
import Icon from "./Icon";
import {
  mdiCheckCircle,
  mdiCalendarRemove,
  mdiCloseOctagon,
  mdiAccountSwitch,
  mdiInformationOutline,
  mdiHospitalBuilding,
  mdiPhoneOutline,
  mdiClockOutline,
  mdiAlertCircleOutline,
  mdiCalendarMonthOutline,
  mdiDoorOpen,
  mdiDoctor,
  mdiOpenInNew,
  mdiCheck,
} from "@mdi/js";


const STATUS_CONFIG = {
  available: {
    icon: mdiCheckCircle,
    label: "可掛號",
  },

  full: {
    icon: mdiCalendarRemove,
    label: "預約額滿",
  },

  closed: {
    icon: mdiCloseOctagon,
    label: "停診",
  },

  substitute: {
    icon: mdiAccountSwitch,
    label: "代診",
  },

  unknown: {
    icon: mdiInformationOutline,
    label: "請至院方確認",
  },
};


function isSchedulePast(schedule) {
  if (!schedule?.schedule_date) {
    return false;
  }

  try {
    if (schedule.end_time) {
      const endDateTime = new Date(
        `${schedule.schedule_date}T${schedule.end_time}+08:00`
      );

      return endDateTime.getTime() < Date.now();
    }

    const endOfDay = new Date(
      `${schedule.schedule_date}T23:59:59+08:00`
    );

    return endOfDay.getTime() < Date.now();
  } catch {
    return false;
  }
}


function formatVerifiedAt(value) {
  if (!value) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat(
      "zh-TW",
      {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }
    ).format(
      new Date(value)
    );
  } catch {
    return null;
  }
}


// ============================================================
// 官方掛號資訊
//
// booking_url 有網址
// → 顯示按鈕
//
// booking_note 有文字
// → 顯示現場 / 電話掛號說明
// ============================================================

function BookingInfo({
  bookingUrl,
  bookingNote,
  compact = false,
}) {
  if (bookingUrl) {
    return (
      <a
        href={bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-block",
          marginTop: compact ? 8 : 12,
          padding: compact
            ? "7px 11px"
            : "9px 14px",
          borderRadius: 9,
          background: "#2563eb",
          color: "#ffffff",
          textDecoration: "none",
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        <Icon path={mdiHospitalBuilding} size="1em" /> 查看院方最新門診／掛號
      </a>
    );
  }


  if (bookingNote) {
    return (
      <div
        style={{
          marginTop: compact ? 8 : 12,
          padding: "9px 11px",
          borderRadius: 8,
          background: "#fff7ed",
          border: "1px solid #fed7aa",
          fontSize: 14,
          color: "#9a3412",
          lineHeight: 1.6,
        }}
      >
        <Icon path={mdiPhoneOutline} size="1em" /> 掛號方式：{bookingNote}
      </div>
    );
  }


  return (
    <div
      style={{
        marginTop: 10,
        fontSize: 13,
        color: "#64748b",
      }}
    >
      此院目前尚未提供可確認的官方掛號入口。
    </div>
  );
}


function DoctorScheduleInfo({
  hospitalCode,
  doctorName,
}) {
  const [data, setData] =
    useState(null);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");


  useEffect(() => {
    if (
      !hospitalCode ||
      !doctorName
    ) {
      return;
    }


    let cancelled = false;


    const loadSchedules = async () => {
      try {
        setLoading(true);
        setError("");


        const response =
          await api.get(
            "/api/v1/doctor-schedules",
            {
              params: {
                hospital_code:
                  hospitalCode,

                doctor_name:
                  doctorName,

                days: 60,
              },
            }
          );


        if (!cancelled) {
          setData(
            response.data
          );
        }
      } catch (err) {
        console.error(
          "讀取醫師門診失敗：",
          err
        );


        if (!cancelled) {
          setError(
            "目前無法取得門診資訊"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };


    loadSchedules();


    return () => {
      cancelled = true;
    };
  }, [
    hospitalCode,
    doctorName,
  ]);


  const hospitalBookingUrl =
    data?.hospital?.booking_url ||
    null;


  const hospitalBookingNote =
    data?.hospital?.booking_note ||
    null;


  // =========================================================
  // 過濾已結束門診，只顯示最近 3 筆
  // =========================================================

  const upcomingSchedules =
    useMemo(() => {
      const schedules =
        data?.schedules || [];


      return schedules
        .filter(
          (schedule) =>
            !isSchedulePast(
              schedule
            )
        )
        .slice(
          0,
          3
        );
    }, [data]);


  // =========================================================
  // Loading
  // =========================================================

  if (loading) {
    return (
      <div
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 10,
          background: "#f8fafc",
          fontSize: 14,
        }}
      >
        <Icon path={mdiClockOutline} size="1em" /> 正在確認近期門診...
      </div>
    );
  }


  // =========================================================
  // API Error
  // =========================================================

  if (error) {
    return (
      <div
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 10,
          background: "#fff7ed",
          fontSize: 14,
        }}
      >
        <Icon path={mdiAlertCircleOutline} size="1em" /> {error}
      </div>
    );
  }


  if (!data) {
    return null;
  }


  // =========================================================
  // 沒有可靠近期門診
  // =========================================================

  if (
    upcomingSchedules.length === 0
  ) {
    return (
      <div
        style={{
          marginTop: 12,
          padding: 14,
          borderRadius: 12,
          background: "#f8fafc",
          border:
            "1px solid #e2e8f0",
        }}
      >
        <div
          style={{
            fontWeight: 700,
            marginBottom: 6,
          }}
        >
          <Icon path={mdiCalendarMonthOutline} size="1em" /> 近期門診
        </div>


        <div
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: "#475569",
          }}
        >
          目前尚無可可靠確認的近期日期級門診資料。
        </div>


        <div
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: "#64748b",
            marginTop: 4,
          }}
        >
          為避免提供錯誤門診時間，
          系統不會自行推測醫師班表。
          請以院方官方資訊為準。
        </div>


        <BookingInfo
          bookingUrl={
            hospitalBookingUrl
          }
          bookingNote={
            hospitalBookingNote
          }
        />
      </div>
    );
  }


  // =========================================================
  // 有門診資料
  // =========================================================

  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        borderRadius: 12,
        background: "#f8fafc",
        border:
          "1px solid #e2e8f0",
      }}
    >
      <div
        style={{
          fontWeight: 700,
          marginBottom: 10,
        }}
      >
        <Icon path={mdiCalendarMonthOutline} size="1em" /> 近期門診
      </div>


      <div
        style={{
          display: "grid",
          gap: 10,
        }}
      >
        {upcomingSchedules.map(
          (schedule) => {

            const status =
              STATUS_CONFIG[
                schedule.registration_status
              ] ||
              STATUS_CONFIG.unknown;


            const verifiedAt =
              formatVerifiedAt(
                schedule.last_verified_at
              );


            return (
              <div
                key={schedule.id}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: "#ffffff",
                  border:
                    "1px solid #e2e8f0",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    marginBottom: 5,
                  }}
                >
                  {schedule.schedule_date}

                  {schedule.weekday_label
                    ? ` ${schedule.weekday_label}`
                    : ""}

                  {schedule.session
                    ? `｜${schedule.session}`
                    : ""}
                </div>


                {schedule.time_text && (
                  <div
                    style={{
                      fontSize: 14,
                      marginBottom: 4,
                    }}
                  >
                    <Icon path={mdiClockOutline} size="1em" />{" "}
                    {schedule.time_text}
                  </div>
                )}


                <div
                  style={{
                    fontSize: 13,
                    color: "#64748b",
                    marginBottom: 5,
                    lineHeight: 1.5,
                  }}
                >
                  {schedule.time_precision ===
                  "session_window" ? (
                    <>
                      <Icon path={mdiAlertCircleOutline} size="1em" />{" "}
                      此時間為院方公布之門診時段，非保證醫師於起始時間準時開始看診。
                    </>
                  ) : schedule.time_precision ===
                    "exact" ? (
                    <>
                      <Icon path={mdiCheck} size="1em" />{" "}
                      此時間為官方公布之醫師門診時間。
                    </>
                  ) : (
                    "院方未公布可可靠確認的明確時間。"
                  )}
                </div>


                {schedule.clinic_room && (
                  <div
                    style={{
                      fontSize: 14,
                      marginBottom: 4,
                    }}
                  >
                    <Icon path={mdiDoorOpen} size="1em" />{" "}
                    {schedule.clinic_room}
                  </div>
                )}


                <div
                  style={{
                    fontSize: 14,
                    marginBottom: 4,
                  }}
                >
                  <Icon path={status.icon} size="1em" />{" "}
                  {schedule.registration_status_label ||
                    status.label}
                </div>


                {schedule.substitute_doctor_name && (
                  <div
                    style={{
                      fontSize: 14,
                      marginBottom: 4,
                    }}
                  >
                    <Icon path={mdiDoctor} size="1em" /> 代診醫師：
                    {
                      schedule.substitute_doctor_name
                    }
                  </div>
                )}


                {schedule.status_note && (
                  <div
                    style={{
                      fontSize: 13,
                      marginBottom: 4,
                      color: "#475569",
                    }}
                  >
                    備註：
                    {schedule.status_note}
                  </div>
                )}


                {verifiedAt && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#94a3b8",
                      marginTop: 5,
                    }}
                  >
                    最後確認：
                    {verifiedAt}
                  </div>
                )}


                {schedule.registration_url && (
                  <a
                    href={
                      schedule.registration_url
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display:
                        "inline-block",
                      marginTop: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      textDecoration:
                        "none",
                    }}
                  >
                    <Icon path={mdiOpenInNew} size="1em" /> 官方掛號
                  </a>
                )}
              </div>
            );
          }
        )}
      </div>


      <div
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop:
            "1px solid #e2e8f0",
        }}
      >
        <BookingInfo
          bookingUrl={
            hospitalBookingUrl
          }
          bookingNote={
            hospitalBookingNote
          }
          compact
        />
      </div>


      {data.notice && (
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            lineHeight: 1.6,
            color: "#64748b",
          }}
        >
          {data.notice}
        </div>
      )}
    </div>
  );
}


export default DoctorScheduleInfo;