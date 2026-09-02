import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import api from './api/axios';


// ============================================================
// CarePath AI
// Visit Summary Panel
//
// P0 Step 3B-1
//
// 功能：
// 1. 讀取單筆 Visit Summary
// 2. 顯示主訴與不適程度
// 3. 顯示 Safety Engine 分級
// 4. 顯示 Red Flags
// 5. 顯示病人問診陳述
// 6. 顯示推薦科別
// 7. 顯示 Possible Causes（有資料才顯示）
// 8. 顯示個人健康背景
// 9. 一鍵複製醫療交班摘要
//
// 注意：
// - 不重新進行疾病判斷
// - 不重新執行 Safety Engine
// - 所有醫療內容皆以後端摘要為準
// ============================================================


// ============================================================
// Styles
// ============================================================

const styles = {

  panel: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    boxSizing: 'border-box',
  },


  hero: {
    padding: 22,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    boxShadow:
      '0 10px 30px rgba(15, 23, 42, 0.05)',
  },


  heroTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
    flexWrap: 'wrap',
  },


  heroTitleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },


  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
    fontSize: 22,
    flexShrink: 0,
  },


  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 800,
    color: '#0f172a',
  },


  subtitle: {
    margin: '5px 0 0',
    color: '#64748b',
    fontSize: 12,
    lineHeight: 1.6,
  },


  riskBadge: {
    padding: '7px 12px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },


  complaintBox: {
    marginTop: 18,
    padding: 16,
    borderRadius: 15,
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
  },


  label: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: 700,
  },


  complaintText: {
    marginTop: 6,
    color: '#0f172a',
    fontSize: 16,
    fontWeight: 750,
    lineHeight: 1.65,
  },


  statsGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 12,
  },


  statCard: {
    padding: 16,
    borderRadius: 17,
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
  },


  statValue: {
    marginTop: 7,
    color: '#0f172a',
    fontSize: 18,
    fontWeight: 800,
  },


  section: {
    padding: 20,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
  },


  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },


  sectionTitle: {
    margin: 0,
    color: '#0f172a',
    fontSize: 15,
    fontWeight: 800,
  },


  sectionMeta: {
    color: '#94a3b8',
    fontSize: 10,
  },


  safetyBox: {
    borderRadius: 16,
    padding: 16,
    border: '1px solid',
  },


  safetyTitle: {
    fontSize: 15,
    fontWeight: 800,
  },


  safetyDescription: {
    marginTop: 7,
    fontSize: 12,
    lineHeight: 1.7,
  },


  redFlagList: {
    marginTop: 13,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },


  redFlagCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    border: '1px solid rgba(220, 38, 38, 0.25)',
  },


  redFlagTitle: {
    color: '#991b1b',
    fontSize: 13,
    fontWeight: 800,
  },


  redFlagReason: {
    marginTop: 4,
    color: '#7f1d1d',
    fontSize: 11,
    lineHeight: 1.6,
  },


  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 9,
  },


  listItem: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    padding: '11px 13px',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
  },


  listDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    backgroundColor: '#3b82f6',
    marginTop: 7,
    flexShrink: 0,
  },


  listText: {
    color: '#334155',
    fontSize: 12,
    lineHeight: 1.65,
  },


  causeCard: {
    padding: 13,
    borderRadius: 13,
    backgroundColor: '#f8fafc',
    color: '#334155',
    fontSize: 12,
    lineHeight: 1.6,
  },


  profileGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 10,
  },


  profileCard: {
    padding: 13,
    borderRadius: 13,
    backgroundColor: '#f8fafc',
  },


  profileValue: {
    marginTop: 5,
    color: '#0f172a',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.6,
  },


  handoffBox: {
    padding: 17,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    whiteSpace: 'pre-wrap',
    color: '#334155',
    fontSize: 12,
    lineHeight: 1.8,
  },


  copyButton: {
    border: 'none',
    borderRadius: 10,
    padding: '8px 12px',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 800,
    cursor: 'pointer',
  },


  copySuccessButton: {
    backgroundColor: '#15803d',
  },


  disclaimer: {
    padding: '13px 15px',
    borderRadius: 13,
    backgroundColor: '#f8fafc',
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 1.7,
  },


  emptyBox: {
    padding: 18,
    borderRadius: 15,
    backgroundColor: '#f8fafc',
    color: '#64748b',
    fontSize: 12,
    lineHeight: 1.7,
  },


  loadingBox: {
    minHeight: 220,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },


  errorBox: {
    padding: 20,
    borderRadius: 18,
    backgroundColor: '#fff7ed',
    border: '1px solid #fed7aa',
  },


  retryButton: {
    marginTop: 12,
    border: 'none',
    borderRadius: 10,
    padding: '8px 12px',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 800,
    cursor: 'pointer',
  },
};


// ============================================================
// Risk Presentation
// ============================================================

function getRiskPresentation(
  riskLevel
) {

  switch (riskLevel) {

    case 'emergency':

      return {
        label: '緊急',
        icon: '!',
        color: '#991b1b',
        background: '#fef2f2',
        border: '#fecaca',
        badgeBackground: '#dc2626',
        badgeColor: '#ffffff',
      };


    case 'urgent':

      return {
        label: '建議儘快就醫',
        icon: '!',
        color: '#9a3412',
        background: '#fff7ed',
        border: '#fed7aa',
        badgeBackground: '#f97316',
        badgeColor: '#ffffff',
      };


    case 'standard':

      return {
        label: '一般',
        icon: '✓',
        color: '#166534',
        background: '#f0fdf4',
        border: '#bbf7d0',
        badgeBackground: '#dcfce7',
        badgeColor: '#166534',
      };


    default:

      return {
        label: '安全評估未完成',
        icon: 'i',
        color: '#475569',
        background: '#f8fafc',
        border: '#e2e8f0',
        badgeBackground: '#e2e8f0',
        badgeColor: '#475569',
      };
  }
}


// ============================================================
// Date
// ============================================================

function formatDateTime(
  value
) {

  if (!value) {
    return '未記錄';
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
    return String(
      value
    );
  }


  return date.toLocaleString(
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

      hour:
        '2-digit',

      minute:
        '2-digit',
    }
  );
}


// ============================================================
// Array text
// ============================================================

function formatArrayText(
  values
) {

  if (
    !Array.isArray(
      values
    )
    ||
    values.length === 0
  ) {
    return '未提供';
  }


  return values.join(
    '、'
  );
}


// ============================================================
// Clipboard
// ============================================================

async function copyTextToClipboard(
  text
) {

  if (!text) {
    return false;
  }


  try {

    if (
      navigator.clipboard
      &&
      window.isSecureContext
    ) {

      await navigator.clipboard.writeText(
        text
      );

      return true;
    }


    const textarea =
      document.createElement(
        'textarea'
      );


    textarea.value =
      text;


    textarea.style.position =
      'fixed';


    textarea.style.opacity =
      '0';


    document.body.appendChild(
      textarea
    );


    textarea.focus();
    textarea.select();


    const success =
      document.execCommand(
        'copy'
      );


    document.body.removeChild(
      textarea
    );


    return success;

  } catch (error) {

    console.error(
      '複製就醫摘要失敗：',
      error
    );


    return false;
  }
}


// ============================================================
// Component
// ============================================================

export default function VisitSummaryPanel({

  sessionId,

  refreshKey = 0,

}) {

  // ==========================================================
  // State
  // ==========================================================

  const [
    loading,
    setLoading,
  ] = useState(
    false
  );


  const [
    error,
    setError,
  ] = useState(
    null
  );


  const [
    data,
    setData,
  ] = useState(
    null
  );


  const [
    copied,
    setCopied,
  ] = useState(
    false
  );


  // ==========================================================
  // API
  // ==========================================================

  const loadSummary =
    useCallback(
      async () => {

        if (
          sessionId === null
          ||
          sessionId === undefined
          ||
          sessionId === ''
        ) {

          setData(
            null
          );

          setError(
            null
          );

          setLoading(
            false
          );

          return;
        }


        setLoading(
          true
        );


        setError(
          null
        );


        setCopied(
          false
        );


        try {

          const response =
            await api.get(
              `/api/v1/visit-summary/${sessionId}`
            );


          if (
            response.data?.status
            !==
            'success'
          ) {

            throw new Error(
              '就醫摘要回傳格式異常'
            );
          }


          setData(
            response.data
          );

        } catch (err) {

          console.error(
            'Visit Summary 載入失敗：',
            err
          );


          const statusCode =
            err?.response?.status;


          if (
            statusCode === 401
          ) {

            setError(
              '登入狀態已失效，請重新登入後查看就醫摘要。'
            );

          } else if (
            statusCode === 403
          ) {

            setError(
              err?.response?.data?.detail
              ||
              '目前的訪客身分無法查看此就醫摘要。'
            );

          } else if (
            statusCode === 404
          ) {

            setError(
              '找不到此問診紀錄，或您沒有權限查看。'
            );

          } else {

            setError(
              err?.response?.data?.detail
              ||
              '目前無法取得就醫摘要，請稍後再試。'
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
        sessionId,
      ]
    );


  // ==========================================================
  // Load
  // ==========================================================

  useEffect(
    () => {

      loadSummary();

    },
    [
      loadSummary,
      refreshKey,
    ]
  );


  // ==========================================================
  // Summary
  // ==========================================================

  const summary =
    data?.summary
    ||
    null;


  const safety =
    summary?.safety
    ||
    {};


  const riskPresentation =
    useMemo(
      () =>
        getRiskPresentation(
          safety?.risk_level
        ),
      [
        safety?.risk_level,
      ]
    );


  const patientContext =
    summary?.patient_context
    ||
    {};


  const symptomStatements =
    summary?.symptom_course
      ?.patient_statements
    ||
    [];


  const possibleCauses =
    summary?.possible_causes
    ||
    [];


  const redFlags =
    safety?.red_flags
    ||
    [];


  // ==========================================================
  // Copy
  // ==========================================================

  const handleCopy =
    async () => {

      const success =
        await copyTextToClipboard(
          summary?.handoff_text
        );


      if (!success) {
        return;
      }


      setCopied(
        true
      );


      window.setTimeout(
        () => {

          setCopied(
            false
          );

        },
        1800
      );
    };


  // ==========================================================
  // No Session
  // ==========================================================

  if (
    sessionId === null
    ||
    sessionId === undefined
    ||
    sessionId === ''
  ) {

    return (

      <div
        style={
          styles.emptyBox
        }
      >
        請先選擇一筆已完成的問診，
        即可產生就醫摘要。
      </div>
    );
  }


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

        <div
          style={{
            textAlign:
              'center',
          }}
        >

          <div
            style={{
              fontSize:
                26,
            }}
          >
            📄
          </div>


          <div
            style={{
              marginTop:
                10,

              color:
                '#334155',

              fontSize:
                13,

              fontWeight:
                800,
            }}
          >
            正在整理就醫摘要
          </div>


          <div
            style={{
              marginTop:
                5,

              color:
                '#94a3b8',

              fontSize:
                11,
            }}
          >
            讀取本次問診與安全評估資料
          </div>

        </div>

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

        <div
          style={{
            color:
              '#9a3412',

            fontSize:
              15,

            fontWeight:
              800,
          }}
        >
          就醫摘要暫時無法載入
        </div>


        <div
          style={{
            marginTop:
              7,

            color:
              '#9a3412',

            fontSize:
              12,

            lineHeight:
              1.7,
          }}
        >
          {error}
        </div>


        <button
          type="button"

          onClick={
            loadSummary
          }

          style={
            styles.retryButton
          }
        >
          重新載入
        </button>

      </div>
    );
  }


  // ==========================================================
  // Empty
  // ==========================================================

  if (!summary) {

    return (

      <div
        style={
          styles.emptyBox
        }
      >
        此筆問診目前沒有可顯示的就醫摘要。
      </div>
    );
  }


  // ==========================================================
  // UI
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
              styles.heroTitleWrap
            }
          >

            <div
              style={
                styles.heroIcon
              }
            >
              📄
            </div>


            <div>

              <h2
                style={
                  styles.title
                }
              >
                AI 就醫摘要
              </h2>


              <p
                style={
                  styles.subtitle
                }
              >
                將本次 AI 問診整理成方便向醫療人員說明的重點。
              </p>

            </div>

          </div>


          <div
            style={{
              ...styles.riskBadge,

              background:
                riskPresentation
                  .badgeBackground,

              color:
                riskPresentation
                  .badgeColor,
            }}
          >
            {
              safety?.risk_label
              ||
              riskPresentation.label
            }
          </div>

        </div>


        <div
          style={
            styles.complaintBox
          }
        >

          <div
            style={
              styles.label
            }
          >
            主訴
          </div>


          <div
            style={
              styles.complaintText
            }
          >
            {
              summary.chief_complaint
              ||
              '未記錄'
            }
          </div>

        </div>

      </section>


      {/* =====================================================
          Basic Stats
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
              styles.label
            }
          >
            自評不適程度
          </div>


          <div
            style={
              styles.statValue
            }
          >
            {
              summary.pain_level
              ??
              '—'
            }
            {
              summary.pain_level
              != null
              ? ' / 5'
              : ''
            }
          </div>

        </div>


        <div
          style={
            styles.statCard
          }
        >

          <div
            style={
              styles.label
            }
          >
            建議科別
          </div>


          <div
            style={
              styles.statValue
            }
          >
            {
              summary.recommended_department
              ||
              '未提供'
            }
          </div>

        </div>


        <div
          style={
            styles.statCard
          }
        >

          <div
            style={
              styles.label
            }
          >
            問診時間
          </div>


          <div
            style={{
              ...styles.statValue,
              fontSize:
                13,
            }}
          >
            {
              formatDateTime(
                summary.session_created_at
              )
            }
          </div>

        </div>

      </div>


      {/* =====================================================
          Safety
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

          <h3
            style={
              styles.sectionTitle
            }
          >
            醫療安全風險
          </h3>


          <span
            style={
              styles.sectionMeta
            }
          >
            Safety Engine
          </span>

        </div>


        <div
          style={{
            ...styles.safetyBox,

            color:
              riskPresentation.color,

            background:
              riskPresentation.background,

            borderColor:
              riskPresentation.border,
          }}
        >

          <div
            style={
              styles.safetyTitle
            }
          >
            {riskPresentation.icon}
            {' '}
            {
              safety?.risk_label
              ||
              riskPresentation.label
            }
          </div>


          {
            safety?.safety_action
            &&
            (

              <div
                style={
                  styles.safetyDescription
                }
              >
                {
                  safety.safety_action
                }
              </div>
            )
          }


          {
            redFlags.length > 0
            &&
            (

              <div
                style={
                  styles.redFlagList
                }
              >

                {
                  redFlags.map(
                    (
                      flag,
                      index
                    ) => (

                      <div
                        key={
                          `${flag.code || 'flag'}-${index}`
                        }

                        style={
                          styles.redFlagCard
                        }
                      >

                        <div
                          style={
                            styles.redFlagTitle
                          }
                        >
                          {
                            flag.title
                            ||
                            flag.code
                          }
                        </div>


                        {
                          flag.reason
                          &&
                          (

                            <div
                              style={
                                styles.redFlagReason
                              }
                            >
                              {
                                flag.reason
                              }
                            </div>
                          )
                        }

                      </div>
                    )
                  )
                }

              </div>
            )
          }


          {
            safety?.assessment_available
            === false
            &&
            (

              <div
                style={{
                  marginTop:
                    10,

                  fontSize:
                    11,

                  lineHeight:
                    1.6,
                }}
              >
                此歷史問診當時沒有保存完整的 Safety Engine 評估資料，
                因此不能將其解讀為一般低風險。
              </div>
            )
          }

        </div>

      </section>


      {/* =====================================================
          Symptom Course
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

          <h3
            style={
              styles.sectionTitle
            }
          >
            症狀與問診重點
          </h3>


          <span
            style={
              styles.sectionMeta
            }
          >
            Patient statements only
          </span>

        </div>


        {
          symptomStatements.length === 0
          ? (

            <div
              style={
                styles.emptyBox
              }
            >
              本次沒有其他使用者陳述可整理。
            </div>

          )
          : (

            <div
              style={
                styles.list
              }
            >

              {
                symptomStatements.map(
                  (
                    statement,
                    index
                  ) => (

                    <div
                      key={
                        `${statement}-${index}`
                      }

                      style={
                        styles.listItem
                      }
                    >

                      <div
                        style={
                          styles.listDot
                        }
                      />


                      <div
                        style={
                          styles.listText
                        }
                      >
                        {statement}
                      </div>

                    </div>
                  )
                )
              }

            </div>
          )
        }

      </section>


      {/* =====================================================
          Possible Causes
      ====================================================== */}

      {
        possibleCauses.length > 0
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

              <h3
                style={
                  styles.sectionTitle
                }
              >
                AI 問診曾提出的可能原因
              </h3>


              <span
                style={
                  styles.sectionMeta
                }
              >
                非疾病診斷
              </span>

            </div>


            <div
              style={
                styles.list
              }
            >

              {
                possibleCauses.map(
                  (
                    cause,
                    index
                  ) => (

                    <div
                      key={
                        `${cause}-${index}`
                      }

                      style={
                        styles.causeCard
                      }
                    >
                      {cause}
                    </div>
                  )
                )
              }

            </div>


            {
              summary
                .possible_causes_disclaimer
              &&
              (

                <div
                  style={{
                    marginTop:
                      11,

                    color:
                      '#94a3b8',

                    fontSize:
                      10,

                    lineHeight:
                      1.6,
                  }}
                >
                  {
                    summary
                      .possible_causes_disclaimer
                  }
                </div>
              )
            }

          </section>
        )
      }


      {/* =====================================================
          Patient Context
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

          <h3
            style={
              styles.sectionTitle
            }
          >
            已記錄健康背景
          </h3>


          <span
            style={
              styles.sectionMeta
            }
          >
            Health Profile
          </span>

        </div>


        {
          patientContext.has_profile_data
          ? (

            <div
              style={
                styles.profileGrid
              }
            >

              <div
                style={
                  styles.profileCard
                }
              >

                <div
                  style={
                    styles.label
                  }
                >
                  年齡
                </div>


                <div
                  style={
                    styles.profileValue
                  }
                >
                  {
                    patientContext.age
                    ??
                    '未提供'
                  }
                </div>

              </div>


              <div
                style={
                  styles.profileCard
                }
              >

                <div
                  style={
                    styles.label
                  }
                >
                  生理性別
                </div>


                <div
                  style={
                    styles.profileValue
                  }
                >
                  {
                    patientContext.biological_sex
                    ||
                    '未提供'
                  }
                </div>

              </div>


              <div
                style={
                  styles.profileCard
                }
              >

                <div
                  style={
                    styles.label
                  }
                >
                  過敏史
                </div>


                <div
                  style={
                    styles.profileValue
                  }
                >
                  {
                    formatArrayText(
                      patientContext.allergies
                    )
                  }
                </div>

              </div>


              <div
                style={
                  styles.profileCard
                }
              >

                <div
                  style={
                    styles.label
                  }
                >
                  目前用藥
                </div>


                <div
                  style={
                    styles.profileValue
                  }
                >
                  {
                    formatArrayText(
                      patientContext.medications
                    )
                  }
                </div>

              </div>


              <div
                style={
                  styles.profileCard
                }
              >

                <div
                  style={
                    styles.label
                  }
                >
                  慢性病 / 既往病史
                </div>


                <div
                  style={
                    styles.profileValue
                  }
                >
                  {
                    formatArrayText(
                      patientContext
                        .chronic_conditions
                    )
                  }
                </div>

              </div>

            </div>

          )
          : (

            <div
              style={
                styles.emptyBox
              }
            >
              此會員目前尚未提供可加入摘要的健康背景資料。
            </div>
          )
        }

      </section>


      {/* =====================================================
          Doctor Handoff Text
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

          <div>

            <h3
              style={
                styles.sectionTitle
              }
            >
              給醫療人員看的摘要
            </h3>


            <div
              style={{
                marginTop:
                  4,

                color:
                  '#94a3b8',

                fontSize:
                  10,

                lineHeight:
                  1.5,
              }}
            >
              可在就診時直接出示或複製
            </div>

          </div>


          <button
            type="button"

            onClick={
              handleCopy
            }

            style={{
              ...styles.copyButton,

              ...(copied
                ? styles.copySuccessButton
                : {}),
            }}
          >
            {
              copied
              ? '已複製'
              : '複製摘要'
            }
          </button>

        </div>


        <div
          style={
            styles.handoffBox
          }
        >
          {
            summary.handoff_text
            ||
            '目前沒有可用的交班摘要。'
          }
        </div>

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
          summary.disclaimer
          ||
          (
            '此摘要僅供就醫溝通參考，'
            +
            '不能取代醫師問診、檢查與正式診斷。'
          )
        }
      </div>

    </div>
  );
}