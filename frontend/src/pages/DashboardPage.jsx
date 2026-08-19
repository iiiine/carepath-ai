import { useEffect, useState } from 'react'

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from 'recharts'

import api from '../api/axios'


const DashboardPage = ({
  onStartConsultation,
  onViewHistory,
  onSelectSession,
}) => {
  // ==========================================
  // Dashboard 資料
  // ==========================================
  const [summary, setSummary] = useState(null)

  const [painTrend, setPainTrend] = useState([])

  const [departments, setDepartments] = useState([])

  const [recentSessions, setRecentSessions] = useState([])


  // ==========================================
  // UI 狀態
  // ==========================================
  const [loading, setLoading] = useState(true)

  const [error, setError] = useState('')


  // ==========================================
  // 讀取 Dashboard 所有資料
  // ==========================================
  useEffect(() => {
    let cancelled = false

    const fetchDashboard = async () => {
      try {
        setLoading(true)
        setError('')

        const results = await Promise.allSettled([
          api.get('/api/v1/dashboard/summary'),

          api.get('/api/v1/dashboard/pain-trend'),

          api.get('/api/v1/dashboard/departments'),

          api.get('/api/v1/dashboard/recent-sessions'),
        ])

        if (cancelled) {
          return
        }


        const [
          summaryResult,
          painResult,
          departmentResult,
          recentResult,
        ] = results


        const failedParts = []


        // ======================================
        // Summary
        // ======================================
        if (summaryResult.status === 'fulfilled') {
          setSummary(
            summaryResult.value.data
          )

          console.log(
            'Dashboard summary:',
            summaryResult.value.data
          )
        } else {
          failedParts.push('健康摘要')

          console.error(
            'Dashboard summary 失敗:',
            summaryResult.reason
          )
        }


        // ======================================
        // Pain Trend
        // ======================================
        if (painResult.status === 'fulfilled') {
          setPainTrend(
            Array.isArray(painResult.value.data)
              ? painResult.value.data
              : []
          )

          console.log(
            'Pain trend:',
            painResult.value.data
          )
        } else {
          failedParts.push('不適程度趨勢')

          console.error(
            'Pain trend 失敗:',
            painResult.reason
          )
        }


        // ======================================
        // Departments
        // ======================================
        if (departmentResult.status === 'fulfilled') {
          setDepartments(
            Array.isArray(departmentResult.value.data)
              ? departmentResult.value.data
              : []
          )

          console.log(
            'Departments:',
            departmentResult.value.data
          )
        } else {
          failedParts.push('科別統計')

          console.error(
            'Departments 失敗:',
            departmentResult.reason
          )
        }


        // ======================================
        // Recent Sessions
        // ======================================
        if (recentResult.status === 'fulfilled') {
          setRecentSessions(
            Array.isArray(recentResult.value.data)
              ? recentResult.value.data
              : []
          )

          console.log(
            'Recent sessions:',
            recentResult.value.data
          )
        } else {
          failedParts.push('最近問診')

          console.error(
            'Recent sessions 失敗:',
            recentResult.reason
          )
        }


        if (failedParts.length > 0) {
          setError(
            `部分資料載入失敗：${failedParts.join('、')}`
          )
        }

      } catch (err) {
        console.error(
          'Dashboard 載入失敗:',
          err
        )

        setError(
          '無法取得健康儀表板資料'
        )
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }


    fetchDashboard()


    return () => {
      cancelled = true
    }
  }, [])


  // ==========================================
  // YYYY-MM-DD → MM/DD
  // ==========================================
  const formatShortDate = (dateString) => {
    if (!dateString) {
      return ''
    }

    const parts =
      String(dateString).split('-')

    if (parts.length === 3) {
      return `${parts[1]}/${parts[2]}`
    }

    return dateString
  }


  // ==========================================
  // 完整日期時間
  // ==========================================
  const formatDateTime = (dateString) => {
    if (!dateString) {
      return ''
    }

    try {
      const date =
        new Date(dateString)

      return date.toLocaleString(
        'zh-TW',
        {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }
      )
    } catch {
      return dateString
    }
  }


  // ==========================================
  // 折線圖資料
  // ==========================================
  const painChartData =
    painTrend.map((item) => ({
      ...item,

      display_date:
        formatShortDate(item.date),
    }))


  // ==========================================
  // 科別統計
  // ==========================================
  const departmentChartData =
    departments.slice(0, 8)


  // ==========================================
  // 開始新的 AI 問診
  // ==========================================
  const handleStartConsultation = () => {
    if (
      typeof onStartConsultation === 'function'
    ) {
      onStartConsultation()
    }
  }


  // ==========================================
  // 查看全部紀錄
  // ==========================================
  const handleViewHistory = () => {
    if (
      typeof onViewHistory === 'function'
    ) {
      onViewHistory()
    }
  }


  // ==========================================
  // 點選 Dashboard 最近問診
  // ==========================================
  const handleSelectRecentSession = (
    session
  ) => {
    if (!session?.id) {
      return
    }

    console.log(
      'Dashboard 點選最近問診:',
      session
    )

    if (
      typeof onSelectSession === 'function'
    ) {
      onSelectSession(session)
    }
  }


  return (
    <div style={styles.page}>
      <div style={styles.container}>

        {/* ================================== */}
        {/* Header */}
        {/* ================================== */}
        <section style={styles.header}>

          <div>
            <p style={styles.eyebrow}>
              健康概覽
            </p>

            <h1 style={styles.title}>
              健康儀表板
            </h1>

            <p style={styles.subtitle}>
              查看 AI 近期問診紀錄與健康趨勢
            </p>
          </div>


          <button
            type="button"
            onClick={handleStartConsultation}
            style={styles.primaryButton}
          >
            ＋ 開始新的 AI 問診
          </button>

        </section>


        {/* ================================== */}
        {/* 錯誤提示 */}
        {/* ================================== */}
        {error && (
          <div style={styles.errorBox}>
            ⚠️ {error}
          </div>
        )}


        {/* ================================== */}
        {/* Summary Cards */}
        {/* ================================== */}
        <section style={styles.summaryGrid}>

          <div style={styles.summaryCard}>
            <span style={styles.cardLabel}>
              最近 30 天問診
            </span>

            <div style={styles.cardValue}>
              {loading
                ? '--'
                : summary?.consultation_count_30d
                  ?? 0}

              <span style={styles.cardUnit}>
                次
              </span>
            </div>

            <span style={styles.cardHint}>
              近期問診次數
            </span>
          </div>


          <div style={styles.summaryCard}>
            <span style={styles.cardLabel}>
              最近不適程度
            </span>

            <div style={styles.cardValue}>
              {loading
                ? '--'
                : summary?.latest_pain_level
                  != null
                  ? summary.latest_pain_level
                  : '--'}

              <span style={styles.cardUnit}>
                / 5
              </span>
            </div>

            <span style={styles.cardHint}>
              最近一次紀錄
            </span>
          </div>


          <div style={styles.summaryCard}>
            <span style={styles.cardLabel}>
              最近建議科別
            </span>

            <div style={styles.departmentValue}>
              {loading
                ? '載入中...'
                : summary?.latest_department
                  || '尚無資料'}
            </div>

            <span style={styles.cardHint}>
              AI 最近建議
            </span>
          </div>


          <div style={styles.summaryCard}>
            <span style={styles.cardLabel}>
              最常建議科別
            </span>

            <div style={styles.departmentValue}>
              {loading
                ? '載入中...'
                : summary?.most_common_department
                  || '尚無資料'}
            </div>

            <span style={styles.cardHint}>
              歷史問診統計
            </span>
          </div>

        </section>


        {/* ================================== */}
        {/* 圖表 */}
        {/* ================================== */}
        <section style={styles.mainGrid}>

          {/* ================================== */}
          {/* 不適程度趨勢 */}
          {/* ================================== */}
          <div style={styles.panel}>

            <div style={styles.panelHeader}>
              <div>
                <h2 style={styles.panelTitle}>
                  不適程度趨勢
                </h2>

                <p style={styles.panelSubtitle}>
                  最近 30 天
                </p>
              </div>
            </div>


            {loading ? (

              <div style={styles.chartEmpty}>
                資料載入中...
              </div>

            ) : painChartData.length === 0 ? (

              <div style={styles.chartEmpty}>

                <div style={styles.emptyBigIcon}>
                  📈
                </div>

                <div style={styles.emptyTitle}>
                  尚無不適程度資料
                </div>

                <div style={styles.emptyText}>
                  完成具有不適程度紀錄的問診後，
                  這裡會顯示健康趨勢
                </div>

              </div>

            ) : (

              <div style={styles.chartContainer}>

                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >
                  <LineChart
                    data={painChartData}
                    margin={{
                      top: 15,
                      right: 25,
                      left: 0,
                      bottom: 5,
                    }}
                  >

                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#e5e7eb"
                    />

                    <XAxis
                      dataKey="display_date"
                      tick={{
                        fontSize: 12,
                        fill: '#64748b',
                      }}
                    />

                    <YAxis
                      domain={[0, 5]}
                      ticks={[
                        0,
                        1,
                        2,
                        3,
                        4,
                        5,
                      ]}
                      allowDecimals={false}
                      tick={{
                        fontSize: 12,
                        fill: '#64748b',
                      }}
                    />

                    <Tooltip
                      formatter={(value) => [
                        `${value} / 5`,
                        '平均不適程度',
                      ]}
                      labelFormatter={(label) =>
                        `日期：${label}`
                      }
                    />

                    <Line
                      type="monotone"
                      dataKey="average_pain_level"
                      name="平均不適程度"
                      stroke="#2563eb"
                      strokeWidth={3}
                      dot={{
                        r: 5,
                        fill: '#2563eb',
                      }}
                      activeDot={{
                        r: 7,
                      }}
                    />

                  </LineChart>
                </ResponsiveContainer>

              </div>

            )}

          </div>


          {/* ================================== */}
          {/* 建議科別分布 */}
          {/* ================================== */}
          <div style={styles.panel}>

            <div style={styles.panelHeader}>
              <div>
                <h2 style={styles.panelTitle}>
                  建議科別分布
                </h2>

                <p style={styles.panelSubtitle}>
                  最近 90 天
                </p>
              </div>
            </div>


            {loading ? (

              <div style={styles.chartEmpty}>
                資料載入中...
              </div>

            ) : departmentChartData.length === 0 ? (

              <div style={styles.chartEmpty}>

                <div style={styles.emptyBigIcon}>
                  📊
                </div>

                <div style={styles.emptyTitle}>
                  尚無科別統計資料
                </div>

                <div style={styles.emptyText}>
                  完成 AI 問診後，
                  這裡會整理最近建議的科別
                </div>

              </div>

            ) : (

              <div style={styles.chartContainer}>

                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >
                  <BarChart
                    data={departmentChartData}
                    layout="vertical"
                    margin={{
                      top: 10,
                      right: 30,
                      left: 10,
                      bottom: 5,
                    }}
                  >

                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#e5e7eb"
                    />

                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{
                        fontSize: 12,
                        fill: '#64748b',
                      }}
                    />

                    <YAxis
                      type="category"
                      dataKey="department"
                      width={95}
                      tick={{
                        fontSize: 12,
                        fill: '#475569',
                      }}
                    />

                    <Tooltip
                      formatter={(value) => [
                        `${value} 次`,
                        '問診次數',
                      ]}
                    />

                    <Bar
                      dataKey="consultation_count"
                      name="問診次數"
                      fill="#2563eb"
                      radius={[0, 8, 8, 0]}
                    />

                  </BarChart>
                </ResponsiveContainer>

              </div>

            )}

          </div>

        </section>


        {/* ================================== */}
        {/* 最近問診 */}
        {/* ================================== */}
        <section style={styles.panel}>

          <div style={styles.panelHeader}>

            <div>
              <h2 style={styles.panelTitle}>
                最近問診
              </h2>

              <p style={styles.panelSubtitle}>
                最近 5 筆 AI 問診紀錄
              </p>
            </div>


            <button
              type="button"
              onClick={handleViewHistory}
              style={styles.secondaryButton}
            >
              查看全部紀錄
            </button>

          </div>


          {loading ? (

            <div style={styles.recentEmpty}>
              問診紀錄載入中...
            </div>

          ) : recentSessions.length === 0 ? (

            <div style={styles.recentEmpty}>

              <div style={styles.emptyBigIcon}>
                🩺
              </div>

              <div style={styles.emptyTitle}>
                尚無問診紀錄
              </div>

              <div style={styles.emptyText}>
                開始第一次 AI 問診後，
                紀錄會顯示在這裡
              </div>

            </div>

          ) : (

            <div style={styles.recentList}>

              {recentSessions.map(
                (session) => (

                  <button
                    key={session.id}
                    type="button"

                    onClick={() =>
                      handleSelectRecentSession(
                        session
                      )
                    }

                    style={styles.sessionCard}
                  >

                    <div style={styles.sessionTop}>

                      <div
                        style={styles.sessionTitle}
                      >
                        {session.title ||
                          '未命名問診'}
                      </div>


                      <div
                        style={styles.sessionDate}
                      >
                        {formatDateTime(
                          session.created_at
                        )}
                      </div>

                    </div>


                    <div style={styles.sessionMeta}>

                      <span
                        style={styles.departmentBadge}
                      >
                        {session.suggested_department
                          || '尚未分類'}
                      </span>


                      <span
                        style={styles.painBadge}
                      >
                        不適程度：
                        {session.pain_level != null
                          ? `${session.pain_level} / 5`
                          : '未紀錄'}
                      </span>

                    </div>


                    {session.symptom && (

                      <div
                        style={styles.sessionSymptom}
                      >
                        {session.symptom}
                      </div>

                    )}


                    <div style={styles.openHint}>
                      點擊查看完整問診 →
                    </div>

                  </button>

                )
              )}

            </div>

          )}

        </section>

      </div>
    </div>
  )
}



const styles = {
  page: {
    width: '100%',
    minHeight: '100vh',
    background: '#f6f8fb',
    padding: '32px',
    boxSizing: 'border-box',
  },

  container: {
    width: '100%',
    maxWidth: '1400px',
    margin: '0 auto',
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '24px',
    marginBottom: '28px',
    flexWrap: 'wrap',
  },

  eyebrow: {
    margin: '0 0 6px 0',
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '1.5px',
    color: '#64748b',
  },

  title: {
    margin: 0,
    fontSize: '32px',
    fontWeight: '800',
    color: '#172033',
  },

  subtitle: {
    margin: '8px 0 0 0',
    fontSize: '15px',
    color: '#64748b',
  },

  primaryButton: {
    border: 'none',
    borderRadius: '12px',
    padding: '13px 20px',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
    background: '#2563eb',
    color: '#ffffff',
    boxShadow:
      '0 6px 16px rgba(37, 99, 235, 0.18)',
  },

  errorBox: {
    padding: '14px 18px',
    marginBottom: '20px',
    borderRadius: '12px',
    border: '1px solid #fecaca',
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: '14px',
    fontWeight: '600',
  },

  summaryGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(210px, 1fr))',
    gap: '18px',
    marginBottom: '22px',
  },

  summaryCard: {
    background: '#ffffff',
    borderRadius: '16px',
    padding: '22px',
    border: '1px solid #e7ebf1',
    boxShadow:
      '0 5px 18px rgba(15, 23, 42, 0.04)',
  },

  cardLabel: {
    display: 'block',
    fontSize: '14px',
    color: '#64748b',
    marginBottom: '12px',
  },

  cardValue: {
    fontSize: '32px',
    fontWeight: '800',
    color: '#172033',
  },

  cardUnit: {
    marginLeft: '5px',
    fontSize: '15px',
    fontWeight: '600',
    color: '#94a3b8',
  },

  departmentValue: {
    minHeight: '38px',
    display: 'flex',
    alignItems: 'center',
    fontSize: '23px',
    fontWeight: '800',
    color: '#172033',
  },

  cardHint: {
    display: 'block',
    marginTop: '9px',
    fontSize: '13px',
    color: '#94a3b8',
  },

  mainGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(360px, 1fr))',
    gap: '22px',
    marginBottom: '22px',
  },

  panel: {
    background: '#ffffff',
    border: '1px solid #e7ebf1',
    borderRadius: '16px',
    padding: '22px',
    boxShadow:
      '0 5px 18px rgba(15, 23, 42, 0.04)',
    marginBottom: '22px',
  },

  panelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '20px',
    flexWrap: 'wrap',
  },

  panelTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '800',
    color: '#172033',
  },

  panelSubtitle: {
    margin: '5px 0 0 0',
    fontSize: '13px',
    color: '#94a3b8',
  },

  chartContainer: {
    width: '100%',
    height: '300px',
    minHeight: '300px',
  },

  chartEmpty: {
    minHeight: '300px',
    borderRadius: '14px',
    background: '#f8fafc',
    border: '1px dashed #d8dee9',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    color: '#94a3b8',
    textAlign: 'center',
    padding: '20px',
    boxSizing: 'border-box',
  },

  emptyBigIcon: {
    fontSize: '32px',
    marginBottom: '4px',
  },

  emptyTitle: {
    color: '#334155',
    fontSize: '15px',
    fontWeight: '700',
  },

  emptyText: {
    color: '#94a3b8',
    fontSize: '13px',
    lineHeight: 1.7,
  },

  secondaryButton: {
    border: '1px solid #dbe2ea',
    borderRadius: '10px',
    padding: '9px 14px',
    background: '#ffffff',
    color: '#475569',
    fontWeight: '700',
    cursor: 'pointer',
  },

  recentList: {
    display: 'grid',
    gap: '12px',
  },

  recentEmpty: {
    padding: '42px 20px',
    background: '#f8fafc',
    borderRadius: '14px',
    textAlign: 'center',
    color: '#94a3b8',
  },

  sessionCard: {
    width: '100%',
    display: 'block',

    padding: '18px',

    borderRadius: '14px',

    border: '1px solid #e2e8f0',

    background: '#ffffff',

    cursor: 'pointer',

    textAlign: 'left',

    fontFamily: 'inherit',

    boxSizing: 'border-box',

    boxShadow:
      '0 2px 8px rgba(15, 23, 42, 0.03)',
  },

  sessionTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
    flexWrap: 'wrap',
  },

  sessionTitle: {
    fontSize: '16px',
    fontWeight: '800',
    color: '#172033',
  },

  sessionDate: {
    fontSize: '12px',
    color: '#94a3b8',
  },

  sessionMeta: {
    marginTop: '12px',
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },

  departmentBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 10px',
    borderRadius: '999px',
    background: '#eff6ff',
    color: '#1d4ed8',
    fontSize: '12px',
    fontWeight: '700',
  },

  painBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 10px',
    borderRadius: '999px',
    background: '#f8fafc',
    color: '#475569',
    fontSize: '12px',
    fontWeight: '700',
  },

  sessionSymptom: {
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid #f1f5f9',
    color: '#64748b',
    fontSize: '13px',
    lineHeight: 1.7,

    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },

  openHint: {
    marginTop: '12px',
    color: '#2563eb',
    fontSize: '12px',
    fontWeight: '700',
  },
}


export default DashboardPage