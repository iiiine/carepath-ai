import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import api from './api/axios';
import Icon from './Icon';
import {
  mdiAccountCircleOutline,
  mdiAlertCircleOutline,
  mdiTrendingUp,
  mdiChartLine,
  mdiRepeatVariant,
  mdiHospitalBuilding,
  mdiLightbulbOutline,
  mdiPuzzleOutline,
  mdiTimelineClockOutline,
} from '@mdi/js';


// ============================================================
// CarePath AI
// Longitudinal Health Intelligence Panel
//
// Competition Upgrade 02
// Step 2B-1
//
// 功能：
// 1. 呼叫 GET /api/v1/longitudinal
// 2. 顯示 90 天健康趨勢摘要
// 3. 顯示問診頻率
// 4. 顯示同症狀 Pain Trend
// 5. 顯示重複症狀
// 6. 顯示重複推薦科別
// 7. 顯示 Explainable Insights
// 8. 顯示健康時間軸
// 9. 處理資料不足 / Guest / API Error
//
// 注意：
// - 不進行疾病診斷
// - 不取代 Red Flag Safety Engine
// - 不將不同健康問題的 pain level 混在一起比較
// ============================================================


// ============================================================
// 共用樣式
// ============================================================

const styles = {

  panel: {
    width: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },


  hero: {
    borderRadius: 22,
    padding: '22px 24px',
    border: '1px solid rgba(15, 23, 42, 0.08)',
    background:
      'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,248,255,0.98))',
    boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
  },


  heroTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    flexWrap: 'wrap',
  },


  heroTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },


  heroIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(37, 99, 235, 0.10)',
    fontSize: 22,
    flexShrink: 0,
  },


  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: '-0.02em',
  },


  subtitle: {
    margin: '5px 0 0',
    color: '#64748b',
    fontSize: 13,
    lineHeight: 1.6,
  },


  periodBadge: {
    padding: '7px 12px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    background: '#eff6ff',
    color: '#2563eb',
    whiteSpace: 'nowrap',
  },


  overallBox: {
    marginTop: 18,
    padding: '15px 16px',
    borderRadius: 16,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },


  overallIcon: {
    fontSize: 20,
    lineHeight: 1,
    marginTop: 2,
  },


  overallTitle: {
    margin: 0,
    fontSize: 15,
    fontWeight: 800,
  },


  overallDescription: {
    margin: '5px 0 0',
    fontSize: 13,
    lineHeight: 1.65,
  },


  statsGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 12,
  },


  statCard: {
    padding: 17,
    borderRadius: 18,
    background: '#ffffff',
    border: '1px solid rgba(15, 23, 42, 0.08)',
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)',
  },


  statLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: 700,
  },


  statValue: {
    marginTop: 7,
    color: '#0f172a',
    fontSize: 24,
    fontWeight: 850,
  },


  statHint: {
    marginTop: 5,
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 1.5,
  },


  section: {
    borderRadius: 20,
    padding: 20,
    background: '#ffffff',
    border: '1px solid rgba(15, 23, 42, 0.08)',
    boxShadow: '0 8px 26px rgba(15, 23, 42, 0.04)',
  },


  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },


  sectionTitleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
  },


  sectionIcon: {
    fontSize: 19,
  },


  sectionTitle: {
    margin: 0,
    color: '#0f172a',
    fontSize: 16,
    fontWeight: 800,
  },


  sectionMeta: {
    color: '#94a3b8',
    fontSize: 11,
  },


  emptyBox: {
    padding: '18px 16px',
    borderRadius: 15,
    background: '#f8fafc',
    color: '#64748b',
    fontSize: 13,
    lineHeight: 1.7,
  },


  trendCard: {
    padding: 16,
    borderRadius: 16,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
  },


  trendHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },


  trendSymptom: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: 800,
  },


  trendBadge: {
    padding: '5px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
  },


  trendNumbers: {
    marginTop: 14,
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(90px, 1fr))',
    gap: 8,
  },


  trendNumberBox: {
    padding: '10px 12px',
    borderRadius: 12,
    background: '#ffffff',
  },


  trendNumberLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: 700,
  },


  trendNumberValue: {
    marginTop: 3,
    color: '#0f172a',
    fontSize: 16,
    fontWeight: 800,
  },


  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },


  insightCard: {
    borderRadius: 16,
    padding: 15,
    border: '1px solid #e2e8f0',
    background: '#ffffff',
  },


  insightTop: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
  },


  insightDot: {
    width: 9,
    height: 9,
    marginTop: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },


  insightTitle: {
    margin: 0,
    color: '#0f172a',
    fontSize: 14,
    fontWeight: 800,
  },


  insightDescription: {
    margin: '5px 0 0',
    color: '#64748b',
    fontSize: 12,
    lineHeight: 1.65,
  },


  recommendation: {
    marginTop: 10,
    padding: '9px 11px',
    borderRadius: 11,
    background: '#f8fafc',
    color: '#475569',
    fontSize: 11,
    lineHeight: 1.6,
  },


  chipWrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },


  chip: {
    padding: '7px 10px',
    borderRadius: 999,
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    color: '#334155',
    fontSize: 12,
    fontWeight: 700,
  },


  chipCount: {
    marginLeft: 5,
    color: '#2563eb',
  },


  timeline: {
    display: 'flex',
    flexDirection: 'column',
  },


  timelineItem: {
    display: 'grid',
    gridTemplateColumns: '24px 1fr',
    columnGap: 12,
  },


  timelineRail: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },


  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#3b82f6',
    border: '3px solid #dbeafe',
    boxSizing: 'content-box',
    flexShrink: 0,
  },


  timelineLine: {
    width: 2,
    flex: 1,
    minHeight: 52,
    background: '#e2e8f0',
  },


  timelineContent: {
    paddingBottom: 18,
  },


  timelineDate: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: 700,
  },


  timelineSymptom: {
    marginTop: 4,
    color: '#0f172a',
    fontSize: 14,
    fontWeight: 800,
    lineHeight: 1.55,
  },


  timelineMeta: {
    marginTop: 6,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },


  timelineMetaTag: {
    padding: '4px 7px',
    borderRadius: 8,
    background: '#f1f5f9',
    color: '#64748b',
    fontSize: 10,
    fontWeight: 700,
  },


  disclaimer: {
    padding: '13px 15px',
    borderRadius: 14,
    background: '#f8fafc',
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 1.7,
  },


  loadingBox: {
    minHeight: 240,
    borderRadius: 20,
    background: '#ffffff',
    border: '1px solid rgba(15, 23, 42, 0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },


  loadingContent: {
    textAlign: 'center',
    color: '#64748b',
  },


  spinner: {
    width: 34,
    height: 34,
    borderRadius: '50%',
    border: '4px solid #e2e8f0',
    borderTopColor: '#3b82f6',
    margin: '0 auto 12px',
    animation:
      'carepath-longitudinal-spin 0.85s linear infinite',
  },


  errorBox: {
    borderRadius: 20,
    padding: 22,
    background: '#fff7ed',
    border: '1px solid #fed7aa',
  },


  guestBox: {
    borderRadius: 20,
    padding: 22,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
  },


  actionButton: {
    marginTop: 14,
    border: 0,
    borderRadius: 12,
    padding: '9px 14px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
    background: '#2563eb',
    color: '#ffffff',
  },
};


// ============================================================
// Helper
// ============================================================

function formatDate(
  value
) {

  if (!value) {
    return '日期未記錄';
  }


  const date =
    new Date(
      value
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }


  return date.toLocaleDateString(
    'zh-TW',
    {
      timeZone:
        'Asia/Taipei',

      year:
        'numeric',

      month:
        '2-digit',

      day:
        '2-digit',
    }
  );
}


function formatShortDate(
  value
) {

  if (!value) {
    return '—';
  }


  const date =
    new Date(
      value
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }


  return date.toLocaleDateString(
    'zh-TW',
    {
      timeZone:
        'Asia/Taipei',

      month:
        '2-digit',

      day:
        '2-digit',
    }
  );
}


// ============================================================
// Overall Style
// ============================================================

function getOverallPresentation(
  status
) {

  switch (status) {

    case 'watch':

      return {
        icon: '!',
        background:
          '#fff7ed',
        color:
          '#9a3412',
        border:
          '1px solid #fed7aa',
      };


    case 'stable':

      return {
        icon: '✓',
        background:
          '#f0fdf4',
        color:
          '#166534',
        border:
          '1px solid #bbf7d0',
      };


    case 'insufficient_data':

      return {
        icon: 'i',
        background:
          '#f8fafc',
        color:
          '#475569',
        border:
          '1px solid #e2e8f0',
      };


    default:

      return {
        icon: 'i',
        background:
          '#eff6ff',
        color:
          '#1d4ed8',
        border:
          '1px solid #bfdbfe',
      };
  }
}


// ============================================================
// Trend Style
// ============================================================

function getTrendPresentation(
  trend
) {

  switch (trend) {

    case 'increasing':

      return {
        label:
          '上升',
        background:
          '#fff7ed',
        color:
          '#c2410c',
      };


    case 'decreasing':

      return {
        label:
          '下降',
        background:
          '#f0fdf4',
        color:
          '#15803d',
      };


    case 'variable':

      return {
        label:
          '波動',
        background:
          '#fefce8',
        color:
          '#a16207',
      };


    case 'stable':

      return {
        label:
          '穩定',
        background:
          '#eff6ff',
        color:
          '#1d4ed8',
      };


    case 'mixed':

      return {
        label:
          '不同趨勢',
        background:
          '#f8fafc',
        color:
          '#475569',
      };


    default:

      return {
        label:
          '資料不足',
        background:
          '#f8fafc',
        color:
          '#64748b',
      };
  }
}


// ============================================================
// Insight Level
// ============================================================

function getInsightColor(
  level
) {

  if (
    level === 'attention'
  ) {
    return '#f97316';
  }


  return '#3b82f6';
}


// ============================================================
// Main Component
// ============================================================

export default function LongitudinalHealthPanel({

  windowDays = 90,

  refreshKey = 0,

}) {

  // ==========================================================
  // State
  // ==========================================================

  const [
    loading,
    setLoading,
  ] = useState(
    true
  );


  const [
    error,
    setError,
  ] = useState(
    null
  );


  const [
    guestBlocked,
    setGuestBlocked,
  ] = useState(
    false
  );


  const [
    data,
    setData,
  ] = useState(
    null
  );


  // ==========================================================
  // API
  // ==========================================================

  const loadLongitudinalData =
    useCallback(
      async () => {

        setLoading(
          true
        );


        setError(
          null
        );


        setGuestBlocked(
          false
        );


        try {

          const response =
            await api.get(
              '/api/v1/longitudinal',
              {
                params: {
                  window_days:
                    windowDays,
                },
              }
            );


          const payload =
            response.data;


          if (
            payload?.status
            !==
            'success'
          ) {

            throw new Error(
              '縱向健康分析回傳格式異常'
            );
          }


          setData(
            payload
          );

        } catch (err) {

          console.error(
            'Longitudinal Health Intelligence 載入失敗：',
            err
          );


          const statusCode =
            err?.response?.status;


          if (
            statusCode === 403
          ) {

            setGuestBlocked(
              true
            );


            setData(
              null
            );


            return;
          }


          if (
            statusCode === 401
          ) {

            setError(
              '登入狀態已失效，請重新登入後查看健康趨勢。'
            );

          } else {

            setError(
              err?.response?.data?.detail
              ||
              '目前無法取得縱向健康分析資料，請稍後再試。'
            );
          }


          setData(
            null
          );

        } finally {

          setLoading(
            false
          );
        }
      },

      [
        windowDays,
      ]
    );


  // ==========================================================
  // Load
  // ==========================================================

  useEffect(
    () => {

      loadLongitudinalData();

    },
    [
      loadLongitudinalData,
      refreshKey,
    ]
  );


  // ==========================================================
  // Analysis
  // ==========================================================

  const analysis =
    data?.analysis
    ||
    null;


  const overall =
    analysis?.overall
    ||
    null;


  const overallPresentation =
    useMemo(
      () =>
        getOverallPresentation(
          overall?.status
        ),
      [
        overall?.status,
      ]
    );


  const symptomPainTrends =
    analysis?.symptom_pain_trends
    ||
    [];


  const recurringSymptoms =
    analysis?.recurring_symptoms
    ||
    [];


  const departmentPatterns =
    analysis?.department_patterns
    ||
    [];


  const recurringCauses =
    analysis?.recurring_possible_causes
    ||
    [];


  const insights =
    analysis?.insights
    ||
    [];


  const timeline =
    analysis?.timeline
    ||
    [];


  const visitFrequency =
    analysis?.visit_frequency
    ||
    {};


  // ==========================================================
  // Loading
  // ==========================================================

  if (loading) {

    return (

      <div
        style={
          styles.loadingBox
        }
      >

        <style>
          {`
            @keyframes carepath-longitudinal-spin {
              from {
                transform: rotate(0deg);
              }

              to {
                transform: rotate(360deg);
              }
            }
          `}
        </style>


        <div
          style={
            styles.loadingContent
          }
        >

          <div
            style={
              styles.spinner
            }
          />


          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: '#334155',
            }}
          >
            正在分析健康歷史
          </div>


          <div
            style={{
              marginTop: 6,
              fontSize: 12,
            }}
          >
            正在整理歷次問診與症狀變化
          </div>

        </div>

      </div>
    );
  }


  // ==========================================================
  // Guest
  // ==========================================================

  if (guestBlocked) {

    return (

      <div
        style={
          styles.guestBox
        }
      >

        <div>
          <Icon
            path={mdiAccountCircleOutline}
            size="26px"
          />
        </div>


        <h3
          style={{
            margin:
              '10px 0 6px',
            color:
              '#0f172a',
            fontSize:
              17,
          }}
        >
          登入會員即可查看健康趨勢
        </h3>


        <p
          style={{
            margin: 0,
            color:
              '#64748b',
            fontSize:
              13,
            lineHeight:
              1.7,
          }}
        >
          縱向健康分析需要比較多次歷史問診。
          訪客資料不會作為長期會員健康紀錄使用。
        </p>

      </div>
    );
  }


  // ==========================================================
  // Error
  // ==========================================================

  if (error) {

    return (

      <div
        style={
          styles.errorBox
        }
      >

        <div>
          <Icon
            path={mdiAlertCircleOutline}
            size="22px"
          />
        </div>


        <h3
          style={{
            margin:
              '9px 0 5px',
            color:
              '#9a3412',
            fontSize:
              16,
          }}
        >
          健康趨勢暫時無法載入
        </h3>


        <p
          style={{
            margin: 0,
            color:
              '#9a3412',
            fontSize:
              12,
            lineHeight:
              1.65,
          }}
        >
          {error}
        </p>


        <button
          type="button"
          style={
            styles.actionButton
          }
          onClick={
            loadLongitudinalData
          }
        >
          重新載入
        </button>

      </div>
    );
  }


  // ==========================================================
  // No Response
  // ==========================================================

  if (!analysis) {

    return (

      <div
        style={
          styles.emptyBox
        }
      >
        目前沒有可顯示的縱向健康分析資料。
      </div>
    );
  }


  // ==========================================================
  // Render
  // ==========================================================

  return (

    <div
      style={
        styles.panel
      }
    >

      {/* =====================================================
          Hero
      ====================================================== */}

      <section
        style={
          styles.hero
        }
      >

        <div
          style={
            styles.heroTop
          }
        >

          <div
            style={
              styles.heroTitleRow
            }
          >

            <div
              style={
                styles.heroIcon
              }
            >
              <Icon path={mdiTrendingUp} size="1em" />
            </div>


            <div>

              <h2
                style={
                  styles.title
                }
              >
                我的健康趨勢
              </h2>


              <p
                style={
                  styles.subtitle
                }
              >
                比較歷次 AI 問診，
                協助您理解症狀是否反覆或出現變化。
              </p>

            </div>

          </div>


          <div
            style={
              styles.periodBadge
            }
          >
            過去 {analysis.analysis_window_days || windowDays} 天
          </div>

        </div>


        {overall && (

          <div
            style={{
              ...styles.overallBox,

              background:
                overallPresentation.background,

              color:
                overallPresentation.color,

              border:
                overallPresentation.border,
            }}
          >

            <div
              style={
                styles.overallIcon
              }
            >
              {overallPresentation.icon}
            </div>


            <div>

              <p
                style={{
                  ...styles.overallTitle,
                  color:
                    overallPresentation.color,
                }}
              >
                {overall.label}
              </p>


              <p
                style={{
                  ...styles.overallDescription,
                  color:
                    overallPresentation.color,
                }}
              >
                {overall.description}
              </p>

            </div>

          </div>
        )}

      </section>


      {/* =====================================================
          Statistics
      ====================================================== */}

      <div
        style={
          styles.statsGrid
        }
      >

        <div
          style={
            styles.statCard
          }
        >

          <div
            style={
              styles.statLabel
            }
          >
            歷史問診
          </div>


          <div
            style={
              styles.statValue
            }
          >
            {analysis.total_sessions ?? 0}
          </div>


          <div
            style={
              styles.statHint
            }
          >
            系統內累積問診紀錄
          </div>

        </div>


        <div
          style={
            styles.statCard
          }
        >

          <div
            style={
              styles.statLabel
            }
          >
            最近 30 天
          </div>


          <div
            style={
              styles.statValue
            }
          >
            {visitFrequency.last_30_days ?? 0}
          </div>


          <div
            style={
              styles.statHint
            }
          >
            {visitFrequency.pattern_label || '尚無資料'}
          </div>

        </div>


        <div
          style={
            styles.statCard
          }
        >

          <div
            style={
              styles.statLabel
            }
          >
            可比較症狀
          </div>


          <div
            style={
              styles.statValue
            }
          >
            {
              analysis?.pain_trend
                ?.comparable_symptom_count
              ??
              0
            }
          </div>


          <div
            style={
              styles.statHint
            }
          >
            至少出現兩次才建立趨勢
          </div>

        </div>


        <div
          style={
            styles.statCard
          }
        >

          <div
            style={
              styles.statLabel
            }
          >
            分析期間
          </div>


          <div
            style={{
              ...styles.statValue,
              fontSize: 15,
              marginTop: 11,
            }}
          >
            {
              formatShortDate(
                analysis?.date_range?.first
              )
            }
            {' '}
            →
            {' '}
            {
              formatShortDate(
                analysis?.date_range?.latest
              )
            }
          </div>


          <div
            style={
              styles.statHint
            }
          >
            最早至最近歷史紀錄
          </div>

        </div>

      </div>


      {/* =====================================================
          Pain Trend
      ====================================================== */}

      <section
        style={
          styles.section
        }
      >

        <div
          style={
            styles.sectionHeader
          }
        >

          <div
            style={
              styles.sectionTitleWrap
            }
          >

            <span
              style={
                styles.sectionIcon
              }
            >
              <Icon path={mdiChartLine} size="1em" />
            </span>


            <h3
              style={
                styles.sectionTitle
              }
            >
              同症狀不適程度變化
            </h3>

          </div>


          <span
            style={
              styles.sectionMeta
            }
          >
            Same-symptom comparison
          </span>

        </div>


        {symptomPainTrends.length === 0 ? (

          <div
            style={
              styles.emptyBox
            }
          >
            <strong>
              目前沒有足夠的同症狀資料可比較。
            </strong>

            <br />

            系統只會比較相同症狀在不同問診中的不適程度，
            不會把牙痛、頭痛、腹痛等不同健康問題
            混成一條趨勢。
          </div>

        ) : (

          <div
            style={
              styles.list
            }
          >

            {
              symptomPainTrends.map(
                (
                  item,
                  index
                ) => {

                  const presentation =
                    getTrendPresentation(
                      item.trend
                    );


                  return (

                    <div
                      key={
                        `${item.symptom}-${index}`
                      }
                      style={
                        styles.trendCard
                      }
                    >

                      <div
                        style={
                          styles.trendHeader
                        }
                      >

                        <div>

                          <div
                            style={
                              styles.trendSymptom
                            }
                          >
                            {item.symptom}
                          </div>


                          <div
                            style={{
                              marginTop: 4,
                              color: '#64748b',
                              fontSize: 11,
                            }}
                          >
                            共 {item.session_count} 次相關問診
                          </div>

                        </div>


                        <div
                          style={{
                            ...styles.trendBadge,
                            background:
                              presentation.background,
                            color:
                              presentation.color,
                          }}
                        >
                          {presentation.label}
                        </div>

                      </div>


                      <div
                        style={
                          styles.trendNumbers
                        }
                      >

                        <div
                          style={
                            styles.trendNumberBox
                          }
                        >
                          <div
                            style={
                              styles.trendNumberLabel
                            }
                          >
                            最近
                          </div>

                          <div
                            style={
                              styles.trendNumberValue
                            }
                          >
                            {item.latest ?? '—'}
                          </div>
                        </div>


                        <div
                          style={
                            styles.trendNumberBox
                          }
                        >
                          <div
                            style={
                              styles.trendNumberLabel
                            }
                          >
                            平均
                          </div>

                          <div
                            style={
                              styles.trendNumberValue
                            }
                          >
                            {item.average ?? '—'}
                          </div>
                        </div>


                        <div
                          style={
                            styles.trendNumberBox
                          }
                        >
                          <div
                            style={
                              styles.trendNumberLabel
                            }
                          >
                            最高
                          </div>

                          <div
                            style={
                              styles.trendNumberValue
                            }
                          >
                            {item.maximum ?? '—'}
                          </div>
                        </div>


                        <div
                          style={
                            styles.trendNumberBox
                          }
                        >
                          <div
                            style={
                              styles.trendNumberLabel
                            }
                          >
                            最低
                          </div>

                          <div
                            style={
                              styles.trendNumberValue
                            }
                          >
                            {item.minimum ?? '—'}
                          </div>
                        </div>

                      </div>

                    </div>
                  );
                }
              )
            }

          </div>
        )}

      </section>


      {/* =====================================================
          Recurring Symptoms
      ====================================================== */}

      <section
        style={
          styles.section
        }
      >

        <div
          style={
            styles.sectionHeader
          }
        >

          <div
            style={
              styles.sectionTitleWrap
            }
          >

            <span
              style={
                styles.sectionIcon
              }
            >
              <Icon path={mdiRepeatVariant} size="1em" />
            </span>


            <h3
              style={
                styles.sectionTitle
              }
            >
              反覆出現的症狀
            </h3>

          </div>

        </div>


        {recurringSymptoms.length === 0 ? (

          <div
            style={
              styles.emptyBox
            }
          >
            目前沒有同一症狀在兩次以上問診中重複出現。
          </div>

        ) : (

          <div
            style={
              styles.chipWrap
            }
          >

            {
              recurringSymptoms.map(
                (
                  item,
                  index
                ) => (

                  <div
                    key={
                      `${item.symptom}-${index}`
                    }
                    style={
                      styles.chip
                    }
                  >
                    {item.symptom}

                    <span
                      style={
                        styles.chipCount
                      }
                    >
                      × {item.session_count}
                    </span>

                  </div>
                )
              )
            }

          </div>
        )}

      </section>


      {/* =====================================================
          Department Patterns
      ====================================================== */}

      <section
        style={
          styles.section
        }
      >

        <div
          style={
            styles.sectionHeader
          }
        >

          <div
            style={
              styles.sectionTitleWrap
            }
          >

            <span
              style={
                styles.sectionIcon
              }
            >
              <Icon path={mdiHospitalBuilding} size="1em" />
            </span>


            <h3
              style={
                styles.sectionTitle
              }
            >
              歷史科別分流
            </h3>

          </div>

        </div>


        {departmentPatterns.length === 0 ? (

          <div
            style={
              styles.emptyBox
            }
          >
            目前沒有重複推薦兩次以上的科別。
          </div>

        ) : (

          <div
            style={
              styles.chipWrap
            }
          >

            {
              departmentPatterns.map(
                (
                  item,
                  index
                ) => (

                  <div
                    key={
                      `${item.department}-${index}`
                    }
                    style={
                      styles.chip
                    }
                  >
                    {item.department}

                    <span
                      style={
                        styles.chipCount
                      }
                    >
                      × {item.session_count}
                    </span>

                  </div>
                )
              )
            }

          </div>
        )}

      </section>


      {/* =====================================================
          AI Insights
      ====================================================== */}

      <section
        style={
          styles.section
        }
      >

        <div
          style={
            styles.sectionHeader
          }
        >

          <div
            style={
              styles.sectionTitleWrap
            }
          >

            <span
              style={
                styles.sectionIcon
              }
            >
              <Icon path={mdiLightbulbOutline} size="1em" />
            </span>


            <h3
              style={
                styles.sectionTitle
              }
            >
              歷史健康洞察
            </h3>

          </div>


          <span
            style={
              styles.sectionMeta
            }
          >
            Explainable insights
          </span>

        </div>


        {insights.length === 0 ? (

          <div
            style={
              styles.emptyBox
            }
          >
            目前沒有足夠的歷史模式可產生額外健康洞察。
          </div>

        ) : (

          <div
            style={
              styles.list
            }
          >

            {
              insights.map(
                (
                  insight,
                  index
                ) => (

                  <div
                    key={
                      `${insight.code}-${index}`
                    }
                    style={
                      styles.insightCard
                    }
                  >

                    <div
                      style={
                        styles.insightTop
                      }
                    >

                      <div
                        style={{
                          ...styles.insightDot,

                          background:
                            getInsightColor(
                              insight.level
                            ),
                        }}
                      />


                      <div>

                        <h4
                          style={
                            styles.insightTitle
                          }
                        >
                          {insight.title}
                        </h4>


                        <p
                          style={
                            styles.insightDescription
                          }
                        >
                          {insight.description}
                        </p>


                        {
                          insight.recommendation
                          &&
                          (
                            <div
                              style={
                                styles.recommendation
                              }
                            >
                              <strong>
                                建議：
                              </strong>
                              {' '}
                              {
                                insight.recommendation
                              }
                            </div>
                          )
                        }

                      </div>

                    </div>

                  </div>
                )
              )
            }

          </div>
        )}

      </section>


      {/* =====================================================
          Recurring Possible Causes
      ====================================================== */}

      {
        recurringCauses.length > 0
        &&
        (

          <section
            style={
              styles.section
            }
          >

            <div
              style={
                styles.sectionHeader
              }
            >

              <div
                style={
                  styles.sectionTitleWrap
                }
              >

                <span
                  style={
                    styles.sectionIcon
                  }
                >
                  <Icon path={mdiPuzzleOutline} size="1em" />
                </span>


                <h3
                  style={
                    styles.sectionTitle
                  }
                >
                  重複出現的可能原因
                </h3>

              </div>

            </div>


            <div
              style={
                styles.list
              }
            >

              {
                recurringCauses.map(
                  (
                    item,
                    index
                  ) => (

                    <div
                      key={
                        `${item.cause}-${index}`
                      }
                      style={
                        styles.insightCard
                      }
                    >

                      <div
                        style={
                          styles.insightTitle
                        }
                      >
                        {item.cause}
                      </div>


                      <div
                        style={
                          styles.insightDescription
                        }
                      >
                        曾出現在 {item.session_count} 次歷史 AI 問診結果。
                      </div>


                      <div
                        style={{
                          marginTop: 7,
                          color: '#94a3b8',
                          fontSize: 10,
                          lineHeight: 1.5,
                        }}
                      >
                        {
                          item.disclaimer
                          ||
                          '此項不代表疾病確診。'
                        }
                      </div>

                    </div>
                  )
                )
              }

            </div>

          </section>
        )
      }


      {/* =====================================================
          Timeline
      ====================================================== */}

      <section
        style={
          styles.section
        }
      >

        <div
          style={
            styles.sectionHeader
          }
        >

          <div
            style={
              styles.sectionTitleWrap
            }
          >

            <span
              style={
                styles.sectionIcon
              }
            >
              <Icon path={mdiTimelineClockOutline} size="1em" />
            </span>


            <h3
              style={
                styles.sectionTitle
              }
            >
              健康時間軸
            </h3>

          </div>


          <span
            style={
              styles.sectionMeta
            }
          >
            最近 {timeline.length} 筆
          </span>

        </div>


        {timeline.length === 0 ? (

          <div
            style={
              styles.emptyBox
            }
          >
            尚無歷史問診紀錄。
          </div>

        ) : (

          <div
            style={
              styles.timeline
            }
          >

            {
              [...timeline]
                .reverse()
                .map(
                  (
                    item,
                    index,
                    array
                  ) => (

                    <div
                      key={
                        item.session_id
                        ??
                        index
                      }
                      style={
                        styles.timelineItem
                      }
                    >

                      <div
                        style={
                          styles.timelineRail
                        }
                      >

                        <div
                          style={
                            styles.timelineDot
                          }
                        />


                        {
                          index
                          <
                          array.length - 1
                          &&
                          (
                            <div
                              style={
                                styles.timelineLine
                              }
                            />
                          )
                        }

                      </div>


                      <div
                        style={
                          styles.timelineContent
                        }
                      >

                        <div
                          style={
                            styles.timelineDate
                          }
                        >
                          {
                            formatDate(
                              item.created_at
                            )
                          }
                        </div>


                        <div
                          style={
                            styles.timelineSymptom
                          }
                        >
                          {
                            item.symptom_text
                            ||
                            '未記錄症狀描述'
                          }
                        </div>


                        <div
                          style={
                            styles.timelineMeta
                          }
                        >

                          {
                            item.pain_level
                            &&
                            (
                              <span
                                style={
                                  styles.timelineMetaTag
                                }
                              >
                                不適度 {item.pain_level}/5
                              </span>
                            )
                          }


                          {
                            item.suggested_department
                            &&
                            (
                              <span
                                style={
                                  styles.timelineMetaTag
                                }
                              >
                                {item.suggested_department}
                              </span>
                            )
                          }


                          {
                            (
                              item.symptom_concepts
                              ||
                              []
                            )
                              .slice(
                                0,
                                3
                              )
                              .map(
                                (
                                  concept,
                                  conceptIndex
                                ) => (

                                  <span
                                    key={
                                      `${concept}-${conceptIndex}`
                                    }
                                    style={
                                      styles.timelineMetaTag
                                    }
                                  >
                                    {concept}
                                  </span>
                                )
                              )
                          }

                        </div>

                      </div>

                    </div>
                  )
                )
            }

          </div>
        )}

      </section>


      {/* =====================================================
          Disclaimer
      ====================================================== */}

      <div
        style={
          styles.disclaimer
        }
      >
        {
          analysis.disclaimer
          ||
          (
            '此功能僅整理歷史問診變化，'
            +
            '不是疾病診斷或急診分級。'
          )
        }
      </div>

    </div>
  );
}