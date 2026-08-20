import { useEffect, useState } from 'react'

import api from '../api/axios'
import { t } from '../theme'
import { BaymaxAvatar } from '../Baymax'


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


  // ==========================================
  // 小工具
  // ==========================================
  const fmtDate = (value) => {
    if (!value) {
      return ''
    }

    const text = String(value)

    // 後端給 ISO 字串或 'YYYY-MM-DD HH:MM'，兩種都取前 10 碼就好
    return `${text.slice(5, 7)}/${text.slice(8, 10)}`
  }

  // 把一串數字畫成迷你折線。points 是 SVG polyline 用的座標字串。
  const sparkPoints = (values, width, height) => {
    if (!values || values.length < 2) {
      return null
    }

    const max = Math.max(...values)
    const min = Math.min(...values)
    const span = max - min || 1
    const step = (width - 12) / (values.length - 1)

    return values
      .map((v, i) => {
        const x = 6 + i * step
        const y = height - 6 - ((v - min) / span) * (height - 12)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }

  const trendPain = painTrend.map((d) =>
    Number(d.average_pain_level) || 0
  )

  const trendCount = painTrend.map((d) =>
    Number(d.consultation_count) || 0
  )

  const maxDeptCount = departments.reduce(
    (acc, d) => Math.max(acc, Number(d.consultation_count) || 0),
    0
  ) || 1

  const hasData = Boolean(summary?.latest_department)

  // 載入中的佔位方塊，跟問診頁同一套呼吸動畫
  const Bone = ({ width, height = 14 }) => (
    <div
      style={{
        width,
        height,
        borderRadius: '7px',
        backgroundColor: t.border,
        animation: 'skeleton-pulse 1.5s ease-in-out infinite',
      }}
    />
  )

  return (
    <div style={styles.page}>
      <div style={styles.container}>

        {/* ================================== */}
        {/* 結論卡：先講白話，再給數字 */}
        {/* ================================== */}
        <section style={styles.hero}>
          <BaymaxAvatar size={96} />

          <div style={styles.heroBody}>
            {loading ? (
              <>
                <Bone width="140px" height="12px" />
                <Bone width="420px" height="30px" />
                <Bone width="560px" height="14px" />
              </>
            ) : (
              <>
                <div style={styles.heroEyebrow}>
                  {hasData
                    ? `最近一次問診 · ${fmtDate(summary.latest_consultation_at)}`
                    : '尚無問診紀錄'}
                </div>

                <h1 style={styles.heroTitle}>
                  {hasData ? (
                    <>
                      你最近的狀況偏向
                      <span style={styles.heroMark}>
                        {summary.latest_department}
                      </span>
                    </>
                  ) : (
                    '還沒有任何問診紀錄'
                  )}
                </h1>

                <p style={styles.heroText}>
                  {hasData
                    ? `最近 30 天問診 ${summary.consultation_count_30d} 次，最近一次不適程度 ${summary.latest_pain_level ?? '—'} / 5。症狀若持續超過一週，建議直接就診。`
                    : '描述一次症狀，這裡就會開始累積你的健康紀錄。'}
                </p>
              </>
            )}
          </div>

          <div style={styles.heroActions}>
            <button
              type="button"
              onClick={handleStartConsultation}
              style={styles.primaryButton}
            >
              開始新的 AI 問診
            </button>

            <button
              type="button"
              onClick={handleViewHistory}
              style={styles.secondaryButton}
            >
              查看全部紀錄
            </button>
          </div>
        </section>


        {/* ================================== */}
        {/* 錯誤提示 */}
        {/* ================================== */}
        {error && (
          <div style={styles.errorBox}>
            {error}
          </div>
        )}


        {/* ================================== */}
        {/* 三顆指標，各帶一條迷你趨勢線 */}
        {/* ================================== */}
        <section style={styles.tileRow}>
          <div style={styles.tile}>
            <div style={styles.tileBody}>
              <span style={styles.tileLabel}>最近 30 天問診</span>

              {loading ? (
                <Bone width="60px" height="24px" />
              ) : (
                <span style={styles.tileValue}>
                  {summary?.consultation_count_30d ?? 0}
                  <span style={styles.tileUnit}>次</span>
                </span>
              )}
            </div>

            {sparkPoints(trendCount, 120, 40) && (
              <svg viewBox="0 0 120 40" style={styles.spark}>
                <polyline
                  points={sparkPoints(trendCount, 120, 40)}
                  fill="none"
                  stroke="#c9cdd0"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>

          <div style={styles.tile}>
            <div style={styles.tileBody}>
              <span style={styles.tileLabel}>最近不適程度</span>

              {loading ? (
                <Bone width="60px" height="24px" />
              ) : (
                <span
                  style={{
                    ...styles.tileValue,
                    color:
                      (summary?.latest_pain_level ?? 0) >= 4
                        ? t.danger
                        : t.text,
                  }}
                >
                  {summary?.latest_pain_level ?? '—'}
                  <span style={styles.tileUnit}>/ 5</span>
                </span>
              )}
            </div>

            {sparkPoints(trendPain, 120, 40) && (
              <svg viewBox="0 0 120 40" style={styles.spark}>
                <polyline
                  points={sparkPoints(trendPain, 120, 40)}
                  fill="none"
                  stroke="#c9cdd0"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>

          <div style={styles.tile}>
            <div style={styles.tileBody}>
              <span style={styles.tileLabel}>最常建議科別</span>

              {loading ? (
                <Bone width="90px" height="24px" />
              ) : (
                <span style={styles.tileValue}>
                  {summary?.most_common_department ?? '—'}
                </span>
              )}
            </div>
          </div>
        </section>


        {/* ================================== */}
        {/* 最近問診 + 科別分布 */}
        {/* ================================== */}
        <section style={styles.bottomRow}>

          <div style={styles.panel}>
            <div style={styles.panelHead}>
              <span style={styles.panelTitle}>最近問診</span>

              <button
                type="button"
                onClick={handleViewHistory}
                style={styles.linkButton}
              >
                查看全部
              </button>
            </div>

            {loading ? (
              <div style={styles.boneList}>
                <Bone width="100%" height="46px" />
                <Bone width="100%" height="46px" />
                <Bone width="100%" height="46px" />
              </div>
            ) : recentSessions.length === 0 ? (
              <p style={styles.empty}>還沒有問診紀錄</p>
            ) : (
              <div>
                {recentSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() =>
                      handleSelectRecentSession(session)
                    }
                    style={styles.recentRow}
                  >
                    <span style={styles.recentDate}>
                      {fmtDate(session.created_at)}
                    </span>

                    <span
                      style={{
                        ...styles.recentDot,
                        backgroundColor:
                          (session.pain_level ?? 0) >= 4
                            ? t.danger
                            : '#c9cdd0',
                      }}
                    />

                    <span style={styles.recentBody}>
                      <span style={styles.recentSymptom}>
                        {session.title ||
                          session.symptom ||
                          '未命名問診'}
                      </span>

                      <span style={styles.recentMeta}>
                        <span style={styles.deptChip}>
                          {session.suggested_department || '—'}
                        </span>

                        <span
                          style={{
                            ...styles.painText,
                            color:
                              (session.pain_level ?? 0) >= 4
                                ? t.danger
                                : t.muted,
                          }}
                        >
                          不適 {session.pain_level ?? '—'}
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={styles.panel}>
            <span style={styles.panelTitle}>建議科別分布</span>
            <span style={styles.panelSub}>依歷史問診統計</span>

            {loading ? (
              <div style={styles.boneList}>
                <Bone width="100%" height="26px" />
                <Bone width="100%" height="26px" />
                <Bone width="100%" height="26px" />
              </div>
            ) : departments.length === 0 ? (
              <p style={styles.empty}>還沒有足夠的資料</p>
            ) : (
              <div style={styles.barList}>
                {departments.map((d, index) => (
                  <div
                    key={d.department || index}
                    style={styles.barItem}
                  >
                    <div style={styles.barHead}>
                      <span style={styles.barName}>
                        {d.department}
                      </span>

                      <span style={styles.barCount}>
                        {d.consultation_count} 次
                      </span>
                    </div>

                    <div style={styles.barTrack}>
                      <div
                        style={{
                          ...styles.barFill,
                          width: `${Math.round(
                            (Number(d.consultation_count) /
                              maxDeptCount) *
                              100
                          )}%`,
                          backgroundColor:
                            index === 0 ? t.userBubble : '#c9cdd0',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}




// 全站中性色票，值都從 theme.js 來，這裡不再自己發明顏色
const styles = {
  page: {
    width: '100%',
    boxSizing: 'border-box',
  },

  container: {
    maxWidth: '1700px',
    margin: '0 auto',
    padding: '4px 8px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
    boxSizing: 'border-box',
  },

  // ---------- 結論卡 ----------
  hero: {
    backgroundColor: t.panel,
    border: `1px solid ${t.border}`,
    borderRadius: '14px',
    padding: '26px 30px',
    display: 'flex',
    alignItems: 'center',
    gap: '26px',
    flexWrap: 'wrap',
  },

  heroBody: {
    flexGrow: 1,
    minWidth: '280px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },

  heroEyebrow: {
    fontSize: '0.76rem',
    fontWeight: 700,
    letterSpacing: '0.06em',
    color: t.muted,
  },

  heroTitle: {
    margin: 0,
    fontSize: '1.7rem',
    fontWeight: 700,
    color: t.text,
    letterSpacing: '-0.01em',
    lineHeight: 1.3,
  },

  heroMark: {
    borderBottom: `3px solid ${t.userBubble}`,
    paddingBottom: '1px',
    marginLeft: '2px',
  },

  heroText: {
    margin: 0,
    fontSize: '0.88rem',
    color: t.muted,
    lineHeight: 1.6,
  },

  heroActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flexShrink: 0,
  },

  primaryButton: {
    border: 'none',
    backgroundColor: t.userBubble,
    color: t.page,
    borderRadius: '8px',
    padding: '10px 20px',
    fontSize: '0.84rem',
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },

  secondaryButton: {
    border: `1px solid ${t.border}`,
    backgroundColor: t.panel,
    color: t.text,
    borderRadius: '8px',
    padding: '9px 20px',
    fontSize: '0.84rem',
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },

  errorBox: {
    border: `1px solid ${t.border}`,
    backgroundColor: t.panel,
    color: t.danger,
    borderRadius: '10px',
    padding: '12px 16px',
    fontSize: '0.84rem',
  },

  // ---------- 指標 ----------
  tileRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '12px',
  },

  tile: {
    backgroundColor: t.panel,
    border: `1px solid ${t.border}`,
    borderRadius: '10px',
    padding: '16px 18px',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: '12px',
  },

  tileBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minWidth: 0,
  },

  tileLabel: {
    fontSize: '0.74rem',
    color: t.muted,
  },

  tileValue: {
    fontSize: '1.6rem',
    fontWeight: 700,
    color: t.text,
    lineHeight: 1,
  },

  tileUnit: {
    fontSize: '0.78rem',
    fontWeight: 500,
    color: t.muted,
    marginLeft: '4px',
  },

  spark: {
    width: '120px',
    height: '40px',
    flexShrink: 0,
  },

  // ---------- 下半部 ----------
  bottomRow: {
    display: 'grid',
    gridTemplateColumns: '1.4fr 1fr',
    gap: '12px',
    alignItems: 'start',
  },

  panel: {
    backgroundColor: t.panel,
    border: `1px solid ${t.border}`,
    borderRadius: '10px',
    padding: '18px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },

  panelHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },

  panelTitle: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: t.text,
  },

  panelSub: {
    fontSize: '0.74rem',
    color: t.muted,
    marginBottom: '14px',
  },

  linkButton: {
    border: 'none',
    background: 'none',
    color: t.muted,
    fontSize: '0.76rem',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: 0,
  },

  empty: {
    margin: '10px 0',
    fontSize: '0.84rem',
    color: t.muted,
  },

  boneList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginTop: '6px',
  },

  // ---------- 最近問診 ----------
  recentRow: {
    width: '100%',
    border: 'none',
    borderTop: `1px solid ${t.subtle}`,
    background: 'none',
    fontFamily: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '14px',
    padding: '13px 4px',
  },

  recentDate: {
    fontSize: '0.72rem',
    color: t.muted,
    width: '38px',
    flexShrink: 0,
    paddingTop: '2px',
  },

  recentDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
    marginTop: '6px',
  },

  recentBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    flexGrow: 1,
    minWidth: 0,
  },

  recentSymptom: {
    fontSize: '0.86rem',
    color: t.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  recentMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  deptChip: {
    fontSize: '0.72rem',
    color: t.text,
    backgroundColor: t.subtle,
    borderRadius: '999px',
    padding: '2px 9px',
  },

  painText: {
    fontSize: '0.72rem',
    fontWeight: 600,
  },

  // ---------- 科別分布 ----------
  barList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },

  barItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },

  barHead: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.78rem',
  },

  barName: {
    color: t.text,
  },

  barCount: {
    color: t.muted,
  },

  barTrack: {
    height: '8px',
    borderRadius: '4px',
    backgroundColor: t.subtle,
    overflow: 'hidden',
  },

  barFill: {
    height: '100%',
    borderRadius: '4px',
  },
}


export default DashboardPage