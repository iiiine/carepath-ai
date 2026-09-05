// src/pages/DashboardPage.jsx

import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import api from '../api/axios'
import { t } from '../theme'
import { BaymaxAvatar } from '../Baymax'
import LongitudinalHealthPanel from '../LongitudinalHealthPanel'


const DashboardPage = ({
  onStartConsultation,
  onViewHistory,
  onSelectSession,
}) => {

  // ==========================================
  // Dashboard 基本資料
  //
  // 唯一資料來源：
  // GET /api/v1/history
  //
  // 避免 Dashboard 再依賴四支額外 API，
  // 降低「部分資料載入失敗 / 顯示 0」問題。
  // ==========================================

  const [
    sessions,
    setSessions,
  ] = useState([])


  // ==========================================
  // UI 狀態
  // ==========================================

  const [
    loading,
    setLoading,
  ] = useState(true)


  const [
    error,
    setError,
  ] = useState('')


  // ==========================================
  // Longitudinal refresh key
  //
  // 新問診完成後刷新同症狀分析。
  // ==========================================

  const [
    longitudinalRefreshKey,
    setLongitudinalRefreshKey,
  ] = useState(0)


  // ==========================================
  // 載入 Dashboard
  // ==========================================

  useEffect(() => {

    let cancelled = false


    const fetchDashboard =
      async () => {

        try {

          setLoading(
            true
          )


          setError(
            ''
          )


          const response =
            await api.get(
              '/api/v1/history'
            )


          if (cancelled) {
            return
          }


          const rows =
            Array.isArray(
              response.data
            )
              ? response.data
              : []


          setSessions(
            rows
          )


          console.log(
            'Dashboard history source:',
            rows
          )

        } catch (err) {

          if (cancelled) {
            return
          }


          console.error(
            'Dashboard 歷史資料載入失敗:',
            err
          )


          setSessions(
            []
          )


          setError(
            err?.response?.data?.detail
            ||
            '目前無法載入健康 Dashboard，請稍後再試。'
          )

        } finally {

          if (!cancelled) {

            setLoading(
              false
            )
          }
        }
      }


    fetchDashboard()


    // SymptomChecker 完成問診後會送出 refresh-history。
    const handleRefresh =
      () => {

        fetchDashboard()


        setLongitudinalRefreshKey(
          (
            current
          ) =>
            current + 1
        )
      }


    window.addEventListener(
      'refresh-history',
      handleRefresh
    )


    return () => {

      cancelled =
        true


      window.removeEventListener(
        'refresh-history',
        handleRefresh
      )
    }

  }, [])


  // ==========================================
  // 日期工具
  // ==========================================

  const parseDate =
    (
      value
    ) => {

      if (!value) {
        return null
      }


      const date =
        new Date(
          value
        )


      if (
        Number.isNaN(
          date.getTime()
        )
      ) {

        return null
      }


      return date
    }


  const fmtDate =
    (
      value
    ) => {

      const date =
        parseDate(
          value
        )


      if (!date) {
        return ''
      }


      return date.toLocaleDateString(
        'zh-TW',
        {
          month:
            '2-digit',

          day:
            '2-digit',
        }
      )
    }


  // ==========================================
  // 排序歷史紀錄
  // ==========================================

  const sortedSessions =
    useMemo(
      () => {

        return [
          ...sessions
        ].sort(
          (
            a,
            b
          ) => {

            const timeA =
              parseDate(
                a?.created_at
              )?.getTime()
              ??
              0


            const timeB =
              parseDate(
                b?.created_at
              )?.getTime()
              ??
              0


            if (
              timeA !==
              timeB
            ) {

              return (
                timeB -
                timeA
              )
            }


            return (
              (
                Number(
                  b?.id
                )
                ||
                0
              )
              -
              (
                Number(
                  a?.id
                )
                ||
                0
              )
            )
          }
        )

      },
      [
        sessions,
      ]
    )


  // ==========================================
  // 最近 30 天問診
  // ==========================================

  const recent30Sessions =
    useMemo(
      () => {

        const now =
          new Date()


        const cutoff =
          new Date(
            now.getTime()
            -
            30
            *
            24
            *
            60
            *
            60
            *
            1000
          )


        return sortedSessions.filter(
          (
            session
          ) => {

            const date =
              parseDate(
                session?.created_at
              )


            return (
              date
              &&
              date >= cutoff
            )
          }
        )

      },
      [
        sortedSessions,
      ]
    )


  // ==========================================
  // 最新問診
  // ==========================================

  const latestSession =
    sortedSessions[
      0
    ]
    ||
    null


  // ==========================================
  // 建議科別統計
  // ==========================================

  const departmentStats =
    useMemo(
      () => {

        const counter =
          new Map()


        for (
          const session
          of
          sortedSessions
        ) {

          const department =
            String(
              session?.suggested_department
              ||
              ''
            ).trim()


          if (!department) {
            continue
          }


          counter.set(
            department,
            (
              counter.get(
                department
              )
              ||
              0
            )
            +
            1
          )
        }


        return Array
          .from(
            counter.entries()
          )
          .map(
            (
              [
                department,
                consultation_count,
              ]
            ) => ({
              department,
              consultation_count,
            })
          )
          .sort(
            (
              a,
              b
            ) =>
              b.consultation_count
              -
              a.consultation_count
          )

      },
      [
        sortedSessions,
      ]
    )


  const mostCommonDepartment =
    departmentStats[
      0
    ]?.department
    ||
    null


  // ==========================================
  // 最近 5 筆問診
  // ==========================================

  const recentSessions =
    sortedSessions.slice(
      0,
      5
    )


  // ==========================================
  // 近 14 天問診次數趨勢
  //
  // 注意：
  // 這裡只表示「問診頻率」，
  // 不把不同症狀的不適程度混成同一條線。
  // ==========================================

  const consultationTrend =
    useMemo(
      () => {

        const now =
          new Date()


        const result =
          []


        for (
          let offset = 13;
          offset >= 0;
          offset -= 1
        ) {

          const day =
            new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate()
              -
              offset
            )


          const nextDay =
            new Date(
              day.getFullYear(),
              day.getMonth(),
              day.getDate()
              +
              1
            )


          const count =
            sortedSessions.filter(
              (
                session
              ) => {

                const date =
                  parseDate(
                    session?.created_at
                  )


                return (
                  date
                  &&
                  date >= day
                  &&
                  date < nextDay
                )
              }
            ).length


          result.push({
            date:
              day,

            count,
          })
        }


        return result

      },
      [
        sortedSessions,
      ]
    )


  const trendCount =
    consultationTrend.map(
      (
        item
      ) =>
        item.count
    )


  // ==========================================
  // SVG spark line
  // ==========================================

  const sparkPoints =
    (
      values,
      width,
      height
    ) => {

      if (
        !values
        ||
        values.length < 2
      ) {

        return null
      }


      const max =
        Math.max(
          ...values
        )


      const min =
        Math.min(
          ...values
        )


      const span =
        max -
        min
        ||
        1


      const step =
        (
          width -
          12
        )
        /
        (
          values.length -
          1
        )


      return values
        .map(
          (
            value,
            index
          ) => {

            const x =
              6
              +
              index
              *
              step


            const y =
              height
              -
              6
              -
              (
                (
                  value -
                  min
                )
                /
                span
              )
              *
              (
                height -
                12
              )


            return (
              `${x.toFixed(1)},${y.toFixed(1)}`
            )
          }
        )
        .join(
          ' '
        )
    }


  const maxDeptCount =
    departmentStats.reduce(
      (
        max,
        item
      ) =>
        Math.max(
          max,
          Number(
            item.consultation_count
          )
          ||
          0
        ),
      0
    )
    ||
    1


  const hasData =
    sortedSessions.length
    >
    0


  // ==========================================
  // Navigation
  // ==========================================

  const handleStartConsultation =
    () => {

      if (
        typeof onStartConsultation
        ===
        'function'
      ) {

        onStartConsultation()
      }
    }


  const handleViewHistory =
    () => {

      if (
        typeof onViewHistory
        ===
        'function'
      ) {

        onViewHistory()
      }
    }


  const handleSelectRecentSession =
    (
      session
    ) => {

      if (
        !session?.id
      ) {

        return
      }


      if (
        typeof onSelectSession
        ===
        'function'
      ) {

        onSelectSession(
          session
        )
      }
    }


  // ==========================================
  // Skeleton
  // ==========================================

  const Bone = ({
    width,
    height = 14,
  }) => (

    <div
      style={{
        width,
        height,

        borderRadius:
          '7px',

        backgroundColor:
          t.border,

        animation:
          'skeleton-pulse 1.5s ease-in-out infinite',
      }}
    />

  )


  // ==========================================
  // UI
  // ==========================================

  return (

    <div
      style={
        styles.page
      }
    >

      <div
        style={
          styles.container
        }
      >

        {/* ================================== */}
        {/* Hero */}
        {/* ================================== */}

        <section
          style={
            styles.hero
          }
        >

          <BaymaxAvatar
            size={
              96
            }
          />


          <div
            style={
              styles.heroBody
            }
          >

            {loading ? (

              <>

                <Bone
                  width="140px"
                  height="12px"
                />

                <Bone
                  width="420px"
                  height="30px"
                />

                <Bone
                  width="560px"
                  height="14px"
                />

              </>

            ) : (

              <>

                <div
                  style={
                    styles.heroEyebrow
                  }
                >

                  {
                    hasData
                      ? `最近一次問診 · ${fmtDate(
                          latestSession
                            ?.created_at
                        )}`
                      : '尚無問診紀錄'
                  }

                </div>


                <h1
                  style={
                    styles.heroTitle
                  }
                >

                  {hasData ? (

                    <>

                      最近一次建議科別為

                      <span
                        style={
                          styles.heroMark
                        }
                      >
                        {
                          latestSession
                            ?.suggested_department
                          ||
                          '未指定'
                        }
                      </span>

                    </>

                  ) : (

                    '還沒有任何問診紀錄'

                  )}

                </h1>


                <p
                  style={
                    styles.heroText
                  }
                >

                  {
                    hasData
                      ? (
                          `最近 30 天共有 ${recent30Sessions.length} 次問診；`
                          +
                          `最近一次不適程度為 ${latestSession?.pain_level ?? '—'} / 5。`
                        )
                      : '完成一次 AI 問診後，這裡會開始整理你的健康紀錄。'
                  }

                </p>

              </>

            )}

          </div>


          <div
            style={
              styles.heroActions
            }
          >

            <button
              type="button"

              onClick={
                handleStartConsultation
              }

              style={
                styles.primaryButton
              }
            >
              開始新的 AI 問診
            </button>


            <button
              type="button"

              onClick={
                handleViewHistory
              }

              style={
                styles.secondaryButton
              }
            >
              查看全部紀錄
            </button>

          </div>

        </section>


        {/* ================================== */}
        {/* Error */}
        {/* ================================== */}

        {error && (

          <div
            style={
              styles.errorBox
            }
          >

            <strong>
              Dashboard 資料載入失敗
            </strong>


            <div
              style={{
                marginTop:
                  '4px',
              }}
            >
              {error}
            </div>

          </div>

        )}


        {/* ================================== */}
        {/* 三顆主要指標 */}
        {/* ================================== */}

        <section
          style={
            styles.tileRow
          }
        >

          {/* 最近 30 天問診 */}

          <div
            style={
              styles.tile
            }
          >

            <div
              style={
                styles.tileBody
              }
            >

              <span
                style={
                  styles.tileLabel
                }
              >
                最近 30 天問診
              </span>


              {loading ? (

                <Bone
                  width="60px"
                  height="24px"
                />

              ) : (

                <span
                  style={
                    styles.tileValue
                  }
                >

                  {
                    recent30Sessions
                      .length
                  }

                  <span
                    style={
                      styles.tileUnit
                    }
                  >
                    次
                  </span>

                </span>

              )}

            </div>


            {
              sparkPoints(
                trendCount,
                120,
                40
              )
              &&
              (
                <svg
                  viewBox="0 0 120 40"

                  style={
                    styles.spark
                  }
                >

                  <polyline
                    points={
                      sparkPoints(
                        trendCount,
                        120,
                        40
                      )
                    }

                    fill="none"

                    stroke="#c9cdd0"

                    strokeWidth="2"

                    strokeLinecap="round"

                    strokeLinejoin="round"
                  />

                </svg>
              )
            }

          </div>


          {/* 最近一次不適程度 */}

          <div
            style={
              styles.tile
            }
          >

            <div
              style={
                styles.tileBody
              }
            >

              <span
                style={
                  styles.tileLabel
                }
              >
                最近一次不適程度
              </span>


              {loading ? (

                <Bone
                  width="60px"
                  height="24px"
                />

              ) : (

                <span
                  style={{
                    ...styles.tileValue,

                    color:
                      (
                        latestSession
                          ?.pain_level
                        ??
                        0
                      )
                      >=
                      4
                        ? t.danger
                        : t.text,
                  }}
                >

                  {
                    latestSession
                      ?.pain_level
                    ??
                    '—'
                  }

                  <span
                    style={
                      styles.tileUnit
                    }
                  >
                    / 5
                  </span>

                </span>

              )}


              <span
                style={
                  styles.tileHint
                }
              >
                單筆問診值，不跨不同症狀直接比較
              </span>

            </div>

          </div>


          {/* 最常建議科別 */}

          <div
            style={
              styles.tile
            }
          >

            <div
              style={
                styles.tileBody
              }
            >

              <span
                style={
                  styles.tileLabel
                }
              >
                最常建議科別
              </span>


              {loading ? (

                <Bone
                  width="90px"
                  height="24px"
                />

              ) : (

                <span
                  style={
                    styles.tileValue
                  }
                >
                  {
                    mostCommonDepartment
                    ??
                    '—'
                  }
                </span>

              )}

            </div>

          </div>

        </section>


        {/* ================================== */}
        {/* 近 14 天問診頻率 */}
        {/* ================================== */}

        <section
          style={
            styles.trendPanel
          }
        >

          <div
            style={
              styles.panelHead
            }
          >

            <div>

              <div
                style={
                  styles.panelTitle
                }
              >
                近 14 天問診頻率
              </div>


              <div
                style={
                  styles.panelSubCompact
                }
              >
                這條線只表示問診次數，不代表病情嚴重程度。
              </div>

            </div>

          </div>


          <div
            style={
              styles.trendChart
            }
          >

            {
              consultationTrend.map(
                (
                  item,
                  index
                ) => {

                  const maxCount =
                    Math.max(
                      ...trendCount,
                      1
                    )


                  const heightPercent =
                    (
                      item.count
                      /
                      maxCount
                    )
                    *
                    100


                  return (

                    <div
                      key={
                        index
                      }

                      style={
                        styles.trendColumn
                      }
                    >

                      <div
                        style={
                          styles.trendBarArea
                        }
                      >

                        <div
                          title={
                            `${fmtDate(item.date)}：${item.count} 次問診`
                          }

                          style={{
                            ...styles.trendBar,

                            height:
                              item.count > 0
                                ? `${Math.max(
                                    heightPercent,
                                    12
                                  )}%`
                                : '3px',

                            opacity:
                              item.count > 0
                                ? 1
                                : 0.28,
                          }}
                        />

                      </div>


                      {
                        (
                          index === 0
                          ||
                          index === 6
                          ||
                          index === 13
                        )
                        &&
                        (
                          <span
                            style={
                              styles.trendDate
                            }
                          >
                            {
                              fmtDate(
                                item.date
                              )
                            }
                          </span>
                        )
                      }

                    </div>

                  )
                }
              )
            }

          </div>

        </section>


        {/* ================================== */}
        {/* 同症狀歷史分析

            直接使用已完成的 Longitudinal Health Intelligence。
            症狀概念正規化、同症狀判斷、pain trend
            都由既有後端邏輯處理，不在 Dashboard 重複實作。 */}
        {/* ================================== */}

        <section
          style={
            styles.longitudinalPanel
          }
        >

          <div
            style={
              styles.longitudinalHeader
            }
          >

            <div>

              <div
                style={
                  styles.longitudinalTitle
                }
              >
                同症狀歷史分析
              </div>


              <div
                style={
                  styles.longitudinalSubtitle
                }
              >
                只比較相同症狀的歷史紀錄，不把頭痛、腹痛等不同症狀的不適程度混在一起。
              </div>

            </div>


            <span
              style={
                styles.longitudinalBadge
              }
            >
              近 90 天
            </span>

          </div>


          <div
            style={
              styles.longitudinalContent
            }
          >

            <LongitudinalHealthPanel
              windowDays={
                90
              }

              refreshKey={
                longitudinalRefreshKey
              }
            />

          </div>

        </section>


        {/* ================================== */}
        {/* 最近問診 + 科別分布 */}
        {/* ================================== */}

        <section
          style={
            styles.bottomRow
          }
        >

          {/* 最近問診 */}

          <div
            style={
              styles.panel
            }
          >

            <div
              style={
                styles.panelHead
              }
            >

              <span
                style={
                  styles.panelTitle
                }
              >
                最近問診
              </span>


              <button
                type="button"

                onClick={
                  handleViewHistory
                }

                style={
                  styles.linkButton
                }
              >
                查看全部
              </button>

            </div>


            {loading ? (

              <div
                style={
                  styles.boneList
                }
              >

                <Bone
                  width="100%"
                  height="46px"
                />

                <Bone
                  width="100%"
                  height="46px"
                />

                <Bone
                  width="100%"
                  height="46px"
                />

              </div>

            ) : recentSessions.length === 0 ? (

              <p
                style={
                  styles.empty
                }
              >
                還沒有問診紀錄
              </p>

            ) : (

              <div>

                {
                  recentSessions.map(
                    (
                      session
                    ) => (

                      <button
                        key={
                          session.id
                        }

                        type="button"

                        onClick={() =>
                          handleSelectRecentSession(
                            session
                          )
                        }

                        style={
                          styles.recentRow
                        }
                      >

                        <span
                          style={
                            styles.recentDate
                          }
                        >
                          {
                            fmtDate(
                              session.created_at
                            )
                          }
                        </span>


                        <span
                          style={{
                            ...styles.recentDot,

                            backgroundColor:
                              (
                                session
                                  .pain_level
                                ??
                                0
                              )
                              >=
                              4
                                ? t.danger
                                : '#c9cdd0',
                          }}
                        />


                        <span
                          style={
                            styles.recentBody
                          }
                        >

                          <span
                            style={
                              styles.recentSymptom
                            }
                          >
                            {
                              session.title
                              ||
                              session.original_symptom
                              ||
                              session.symptom_text
                              ||
                              session.symptom
                              ||
                              '未命名問診'
                            }
                          </span>


                          <span
                            style={
                              styles.recentMeta
                            }
                          >

                            <span
                              style={
                                styles.deptChip
                              }
                            >
                              {
                                session
                                  .suggested_department
                                ||
                                '—'
                              }
                            </span>


                            <span
                              style={{
                                ...styles.painText,

                                color:
                                  (
                                    session
                                      .pain_level
                                    ??
                                    0
                                  )
                                  >=
                                  4
                                    ? t.danger
                                    : t.muted,
                              }}
                            >
                              不適 {
                                session
                                  .pain_level
                                ??
                                '—'
                              }
                            </span>

                          </span>

                        </span>

                      </button>

                    )
                  )
                }

              </div>

            )}

          </div>


          {/* 科別分布 */}

          <div
            style={
              styles.panel
            }
          >

            <span
              style={
                styles.panelTitle
              }
            >
              建議科別分布
            </span>


            <span
              style={
                styles.panelSub
              }
            >
              依歷史 AI 問診建議科別統計
            </span>


            {loading ? (

              <div
                style={
                  styles.boneList
                }
              >

                <Bone
                  width="100%"
                  height="26px"
                />

                <Bone
                  width="100%"
                  height="26px"
                />

                <Bone
                  width="100%"
                  height="26px"
                />

              </div>

            ) : departmentStats.length === 0 ? (

              <p
                style={
                  styles.empty
                }
              >
                還沒有足夠的資料
              </p>

            ) : (

              <div
                style={
                  styles.barList
                }
              >

                {
                  departmentStats
                    .slice(
                      0,
                      8
                    )
                    .map(
                      (
                        item,
                        index
                      ) => (

                        <div
                          key={
                            item.department
                            ||
                            index
                          }

                          style={
                            styles.barItem
                          }
                        >

                          <div
                            style={
                              styles.barHead
                            }
                          >

                            <span
                              style={
                                styles.barName
                              }
                            >
                              {
                                item.department
                              }
                            </span>


                            <span
                              style={
                                styles.barCount
                              }
                            >
                              {
                                item
                                  .consultation_count
                              } 次
                            </span>

                          </div>


                          <div
                            style={
                              styles.barTrack
                            }
                          >

                            <div
                              style={{
                                ...styles.barFill,

                                width:
                                  `${Math.round(
                                    (
                                      Number(
                                        item
                                          .consultation_count
                                      )
                                      /
                                      maxDeptCount
                                    )
                                    *
                                    100
                                  )}%`,

                                backgroundColor:
                                  index === 0
                                    ? t.userBubble
                                    : '#c9cdd0',
                              }}
                            />

                          </div>

                        </div>

                      )
                    )
                }

              </div>

            )}

          </div>

        </section>

      </div>

    </div>
  )
}


// ==========================================
// Styles
// ==========================================

const styles = {

  page: {
    width:
      '100%',

    boxSizing:
      'border-box',
  },


  container: {
    maxWidth:
      '1700px',

    margin:
      '0 auto',

    padding:
      '4px 8px 28px',

    display:
      'flex',

    flexDirection:
      'column',

    gap:
      '18px',

    boxSizing:
      'border-box',
  },


  hero: {
    backgroundColor:
      t.panel,

    border:
      `1px solid ${t.border}`,

    borderRadius:
      '14px',

    padding:
      '26px 30px',

    display:
      'flex',

    alignItems:
      'center',

    gap:
      '26px',

    flexWrap:
      'wrap',
  },


  heroBody: {
    flexGrow:
      1,

    minWidth:
      '280px',

    display:
      'flex',

    flexDirection:
      'column',

    gap:
      '8px',
  },


  heroEyebrow: {
    fontSize:
      '0.76rem',

    fontWeight:
      700,

    letterSpacing:
      '0.06em',

    color:
      t.muted,
  },


  heroTitle: {
    margin:
      0,

    fontSize:
      '1.7rem',

    fontWeight:
      700,

    color:
      t.text,

    letterSpacing:
      '-0.01em',

    lineHeight:
      1.3,
  },


  heroMark: {
    borderBottom:
      `3px solid ${t.userBubble}`,

    paddingBottom:
      '1px',

    marginLeft:
      '6px',
  },


  heroText: {
    margin:
      0,

    fontSize:
      '0.88rem',

    color:
      t.muted,

    lineHeight:
      1.6,
  },


  heroActions: {
    display:
      'flex',

    flexDirection:
      'column',

    gap:
      '8px',

    flexShrink:
      0,
  },


  primaryButton: {
    border:
      'none',

    backgroundColor:
      t.userBubble,

    color:
      t.page,

    borderRadius:
      '8px',

    padding:
      '10px 20px',

    fontSize:
      '0.84rem',

    fontWeight:
      600,

    fontFamily:
      'inherit',

    cursor:
      'pointer',

    whiteSpace:
      'nowrap',
  },


  secondaryButton: {
    border:
      `1px solid ${t.border}`,

    backgroundColor:
      t.panel,

    color:
      t.text,

    borderRadius:
      '8px',

    padding:
      '9px 20px',

    fontSize:
      '0.84rem',

    fontFamily:
      'inherit',

    cursor:
      'pointer',

    whiteSpace:
      'nowrap',
  },


  errorBox: {
    border:
      `1px solid ${t.border}`,

    backgroundColor:
      t.panel,

    color:
      t.danger,

    borderRadius:
      '10px',

    padding:
      '12px 16px',

    fontSize:
      '0.84rem',

    lineHeight:
      1.5,
  },


  tileRow: {
    display:
      'grid',

    gridTemplateColumns:
      'repeat(3, minmax(0, 1fr))',

    gap:
      '12px',
  },


  tile: {
    backgroundColor:
      t.panel,

    border:
      `1px solid ${t.border}`,

    borderRadius:
      '10px',

    padding:
      '16px 18px',

    display:
      'flex',

    alignItems:
      'flex-end',

    justifyContent:
      'space-between',

    gap:
      '12px',
  },


  tileBody: {
    display:
      'flex',

    flexDirection:
      'column',

    gap:
      '6px',

    minWidth:
      0,
  },


  tileLabel: {
    fontSize:
      '0.74rem',

    color:
      t.muted,
  },


  tileValue: {
    fontSize:
      '1.6rem',

    fontWeight:
      700,

    color:
      t.text,

    lineHeight:
      1,
  },


  tileUnit: {
    fontSize:
      '0.78rem',

    fontWeight:
      500,

    color:
      t.muted,

    marginLeft:
      '4px',
  },


  tileHint: {
    fontSize:
      '0.7rem',

    color:
      t.muted,

    lineHeight:
      1.4,
  },


  spark: {
    width:
      '120px',

    height:
      '40px',

    flexShrink:
      0,
  },


  trendPanel: {
    backgroundColor:
      t.panel,

    border:
      `1px solid ${t.border}`,

    borderRadius:
      '10px',

    padding:
      '18px 20px',
  },


  panelSubCompact: {
    marginTop:
      '4px',

    fontSize:
      '0.74rem',

    color:
      t.muted,
  },


  trendChart: {
    height:
      '150px',

    display:
      'grid',

    gridTemplateColumns:
      'repeat(14, minmax(0, 1fr))',

    alignItems:
      'end',

    gap:
      '6px',

    marginTop:
      '16px',

    paddingTop:
      '8px',

    borderTop:
      `1px solid ${t.subtle}`,
  },


  trendColumn: {
    height:
      '120px',

    display:
      'flex',

    flexDirection:
      'column',

    alignItems:
      'center',

    justifyContent:
      'flex-end',

    minWidth:
      0,
  },


  trendBarArea: {
    flex:
      1,

    width:
      '100%',

    display:
      'flex',

    alignItems:
      'flex-end',

    justifyContent:
      'center',
  },


  trendBar: {
    width:
      '58%',

    minHeight:
      '3px',

    maxWidth:
      '22px',

    borderRadius:
      '5px 5px 2px 2px',

    backgroundColor:
      t.userBubble,

    transition:
      'height 0.2s ease',
  },


  trendDate: {
    marginTop:
      '7px',

    fontSize:
      '0.66rem',

    color:
      t.muted,

    whiteSpace:
      'nowrap',
  },


  longitudinalPanel: {
    backgroundColor:
      t.panel,

    border:
      `1px solid ${t.border}`,

    borderRadius:
      '12px',

    overflow:
      'hidden',
  },


  longitudinalHeader: {
    display:
      'flex',

    justifyContent:
      'space-between',

    alignItems:
      'flex-start',

    gap:
      '16px',

    padding:
      '18px 20px',

    borderBottom:
      `1px solid ${t.border}`,
  },


  longitudinalTitle: {
    fontSize:
      '1rem',

    fontWeight:
      700,

    color:
      t.text,
  },


  longitudinalSubtitle: {
    marginTop:
      '5px',

    maxWidth:
      '760px',

    fontSize:
      '0.78rem',

    color:
      t.muted,

    lineHeight:
      1.6,
  },


  longitudinalBadge: {
    flexShrink:
      0,

    padding:
      '4px 10px',

    borderRadius:
      '999px',

    backgroundColor:
      t.subtle,

    color:
      t.muted,

    fontSize:
      '0.72rem',

    fontWeight:
      600,
  },


  longitudinalContent: {
    padding:
      '18px',

    boxSizing:
      'border-box',
  },


  bottomRow: {
    display:
      'grid',

    gridTemplateColumns:
      '1.4fr 1fr',

    gap:
      '12px',

    alignItems:
      'start',
  },


  panel: {
    backgroundColor:
      t.panel,

    border:
      `1px solid ${t.border}`,

    borderRadius:
      '10px',

    padding:
      '18px 20px',

    display:
      'flex',

    flexDirection:
      'column',

    gap:
      '4px',
  },


  panelHead: {
    display:
      'flex',

    alignItems:
      'center',

    justifyContent:
      'space-between',

    marginBottom:
      '8px',
  },


  panelTitle: {
    fontSize:
      '0.9rem',

    fontWeight:
      600,

    color:
      t.text,
  },


  panelSub: {
    fontSize:
      '0.74rem',

    color:
      t.muted,

    marginBottom:
      '14px',
  },


  linkButton: {
    border:
      'none',

    background:
      'none',

    color:
      t.muted,

    fontSize:
      '0.76rem',

    fontFamily:
      'inherit',

    cursor:
      'pointer',

    padding:
      0,
  },


  empty: {
    margin:
      '10px 0',

    fontSize:
      '0.84rem',

    color:
      t.muted,
  },


  boneList: {
    display:
      'flex',

    flexDirection:
      'column',

    gap:
      '10px',

    marginTop:
      '6px',
  },


  recentRow: {
    width:
      '100%',

    border:
      'none',

    borderTop:
      `1px solid ${t.subtle}`,

    background:
      'none',

    fontFamily:
      'inherit',

    textAlign:
      'left',

    cursor:
      'pointer',

    display:
      'flex',

    alignItems:
      'flex-start',

    gap:
      '14px',

    padding:
      '13px 4px',
  },


  recentDate: {
    fontSize:
      '0.72rem',

    color:
      t.muted,

    width:
      '42px',

    flexShrink:
      0,

    paddingTop:
      '2px',
  },


  recentDot: {
    width:
      '8px',

    height:
      '8px',

    borderRadius:
      '50%',

    flexShrink:
      0,

    marginTop:
      '6px',
  },


  recentBody: {
    display:
      'flex',

    flexDirection:
      'column',

    gap:
      '5px',

    flexGrow:
      1,

    minWidth:
      0,
  },


  recentSymptom: {
    fontSize:
      '0.86rem',

    color:
      t.text,

    overflow:
      'hidden',

    textOverflow:
      'ellipsis',

    whiteSpace:
      'nowrap',
  },


  recentMeta: {
    display:
      'flex',

    alignItems:
      'center',

    gap:
      '8px',

    flexWrap:
      'wrap',
  },


  deptChip: {
    fontSize:
      '0.72rem',

    color:
      t.text,

    backgroundColor:
      t.subtle,

    borderRadius:
      '999px',

    padding:
      '2px 9px',
  },


  painText: {
    fontSize:
      '0.72rem',

    fontWeight:
      600,
  },


  barList: {
    display:
      'flex',

    flexDirection:
      'column',

    gap:
      '14px',
  },


  barItem: {
    display:
      'flex',

    flexDirection:
      'column',

    gap:
      '6px',
  },


  barHead: {
    display:
      'flex',

    justifyContent:
      'space-between',

    fontSize:
      '0.78rem',
  },


  barName: {
    color:
      t.text,
  },


  barCount: {
    color:
      t.muted,
  },


  barTrack: {
    height:
      '8px',

    borderRadius:
      '4px',

    backgroundColor:
      t.subtle,

    overflow:
      'hidden',
  },


  barFill: {
    height:
      '100%',

    borderRadius:
      '4px',
  },
}


export default DashboardPage