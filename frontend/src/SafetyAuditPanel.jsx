// src/SafetyAuditPanel.jsx
//
// 安全篩檢稽核紀錄：把 /diagnose 回傳的 safety 物件裡
// 「判斷依據」攤開來看 —— 命中哪條規則、哪一版規則、每個症狀旗標的三態。
//
// 只讀、不重算：這裡顯示的就是後端當下據以判斷的內容（存進 safety_snapshot 的同一份）。
// 給醫護人員、評審、開發者核對用，預設收合，一般使用者不需要打開。

import { t } from './theme';


// 旗標名稱 → 中文。對應 backend/symptom_flag_extractor.py 的 SymptomFlagsSchema；
// 後端新增旗標而這裡沒補時，直接顯示英文鍵名，不會壞。
const FLAG_LABELS = {
  facial_droop: '臉部歪斜',
  one_sided_weakness: '單側無力',
  new_speech_difficulty: '突發說話困難',
  recent_resolved_neurologic_deficit: '曾出現神經症狀但已恢復',
  unresponsive: '叫不醒',
  severe_altered_consciousness: '嚴重意識改變',
  seizure_over_5_minutes: '抽搐超過 5 分鐘',
  repeated_seizures_without_recovery: '反覆抽搐未清醒',
  stiff_neck: '頸部僵硬',
  chest_pain: '胸痛',
  shortness_of_breath: '呼吸困難',
  severe_shortness_of_breath: '嚴重呼吸困難',
  unable_to_speak_full_sentences: '喘到無法說完整句子',
  cyanosis: '嘴唇或皮膚發紫',
  fainting: '昏倒',
  cold_sweat: '冒冷汗',
  throat_swelling: '喉嚨腫脹',
  tongue_swelling: '舌頭腫脹',
  severe_allergic_reaction: '嚴重過敏反應',
  severe_bleeding: '大量出血',
  uncontrolled_bleeding: '出血止不住',
  vomiting_blood: '吐血',
  bloody_stool: '血便',
  black_stool: '黑便',
  head_injury: '頭部撞傷',
  loss_of_consciousness: '失去意識',
  taking_anticoagulants: '服用抗凝血劑',
  pregnant: '懷孕',
  heavy_vaginal_bleeding: '陰道大量出血',
  vaginal_bleeding: '陰道出血',
  severe_abdominal_pain: '劇烈腹痛',
  self_harm_thoughts: '自傷念頭',
  harm_others_thoughts: '傷人念頭',
  self_harm_intent_or_plan: '自傷計畫',
  harm_others_intent_or_plan: '傷人計畫',
  imminent_self_harm: '即將自傷',
  imminent_harm_to_others: '即將傷人',
  fever: '發燒',
  persistent_vomiting: '持續嘔吐',
  sudden_vision_loss: '突然視力喪失',
  thunderclap_headache: '突發劇烈頭痛',
  acute_severe_imbalance: '突發嚴重平衡障礙',
  eye_chemical_injury: '化學物質入眼',
  toxic_ingestion: '誤食有毒物質',
  young_infant_fever: '未滿三個月嬰兒發燒',
  tearing_chest_or_back_pain: '撕裂樣胸背痛',
  bleeding_with_shock_signs: '大量出血合併頭暈虛弱',
  near_syncope: '差點昏倒',
  coughing_blood: '咳血',
  dehydration_signs: '脫水警訊',
};


const RISK_NAMES = {
  emergency: '緊急',
  urgent: '儘快就醫',
  standard: '一般',
};


// AI 安全網的狀態。沒有這個欄位的舊後端回應不顯示這一段。
const NET_STATUS = {
  ok: '已執行',
  timeout: '逾時，未採用',
  failed: '執行失敗，未採用',
  disabled: '未啟用',
  not_used: '未使用（安全評估未完成）',
};

const flagLabel = (key) => FLAG_LABELS[key] || key;


const RISK_COLORS = {
  emergency: t.danger,
  urgent: '#c2410c',
  standard: t.ok,
  unknown: t.muted,
};


const sectionTitle = {
  margin: '14px 0 6px',
  fontSize: '0.78rem',
  fontWeight: 700,
  color: t.muted,
};

const chip = (color, background) => ({
  display: 'inline-block',
  margin: '0 6px 6px 0',
  padding: '2px 10px',
  borderRadius: '999px',
  fontSize: '0.8rem',
  color,
  backgroundColor: background,
  border: `1px solid ${color}33`,
});


const FlagChips = ({ flags, color, background, empty }) => (
  flags?.length
    ? (
      <div>
        {flags.map((flag) => (
          <span key={flag} style={chip(color, background)} title={flag}>
            {flagLabel(flag)}
          </span>
        ))}
      </div>
    )
    : <div style={{ fontSize: '0.82rem', color: t.muted }}>{empty}</div>
);


const SafetyAuditPanel = ({ safety }) => {

  if (!safety) {
    return null;
  }

  const riskColor = RISK_COLORS[safety.risk_level] || t.muted;
  const rules = safety.red_flags || [];

  return (
    <details
      style={{
        margin: '12px 0 4px',
        border: `1px solid ${t.border}`,
        borderRadius: '12px',
        backgroundColor: t.panel,
        fontSize: '0.85rem',
        color: t.text,

        // 版本號、規則代碼是不斷行的長字串，手機寬度會把面板撐出畫面
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      <summary
        style={{
          padding: '10px 14px',
          cursor: 'pointer',
          color: t.muted,
          fontWeight: 600,
        }}
      >
        安全篩檢稽核紀錄
        <span style={{ marginLeft: '8px', color: riskColor }}>
          {safety.risk_label}
        </span>
      </summary>

      <div style={{ padding: '0 14px 14px' }}>

        <div style={{ fontSize: '0.78rem', color: t.muted, lineHeight: 1.6 }}>
          以下是安全篩檢的判斷依據。主體是固定規則，同樣的症狀旗標一定得到同樣的結果；
          另有 AI 安全網獨立判斷一次，只能把等級往上調。這是風險篩檢，不是診斷。
        </div>

        {/* 結論與版本 */}
        <div style={sectionTitle}>判斷結果</div>
        <div style={{ lineHeight: 1.8 }}>
          風險等級：
          <strong style={{ color: riskColor }}>
            {safety.risk_label}（{safety.risk_level}）
          </strong>
          <br />
          評估完整度：
          {safety.assessment_completeness === 'insufficient'
            ? '資訊不足，仍有待確認的警訊'
            : '完整'}
          {safety.technical_failure && (
            <>
              <br />
              <span style={{ color: t.danger }}>
                技術失敗：未完成安全評估，已中止一般問診（不視為低風險）
              </span>
            </>
          )}
        </div>

        {safety.safety_net && (
          <>
            <div style={sectionTitle}>判斷來源</div>
            <div style={{ lineHeight: 1.8 }}>
              安全規則：{RISK_NAMES[safety.rule_risk_level] || '—'}
              <br />
              AI 安全網：
              {safety.safety_net.status === 'ok'
                ? RISK_NAMES[safety.safety_net.risk_level] || '—'
                : NET_STATUS[safety.safety_net.status] || safety.safety_net.status}
              {safety.safety_net.escalated && (
                <span style={{ color: riskColor }}>（已提高最終等級）</span>
              )}
              <div style={{ fontSize: '0.78rem', color: t.muted }}>
                AI 安全網只能把等級往上調，不能往下調；安全網失敗時以安全規則為準。
              </div>
            </div>
          </>
        )}

        <div style={sectionTitle}>規則版本</div>
        <div style={{ fontFamily: 'Consolas, monospace', fontSize: '0.78rem', color: t.muted, lineHeight: 1.7 }}>
          pipeline {safety.pipeline_version || '—'}
          {' ／ '}engine {safety.engine_version || '—'}
          {' ／ '}extractor {safety.extractor_version || '—'}
          {safety.safety_net?.version && <>{' ／ '}safety net {safety.safety_net.version}</>}
        </div>

        {/* 命中規則 */}
        <div style={sectionTitle}>命中的安全規則（{rules.length}）</div>
        {rules.length
          ? rules.map((rule) => (
            <div
              key={rule.code}
              style={{
                marginBottom: '6px',
                padding: '8px 10px',
                borderLeft: `3px solid ${RISK_COLORS[rule.risk_level] || t.muted}`,
                backgroundColor: t.subtle,
                borderRadius: '6px',
              }}
            >
              <div style={{ fontWeight: 600 }}>{rule.title}</div>
              <div style={{ fontSize: '0.78rem', color: t.muted }}>
                <code>{rule.code}</code> · {rule.risk_level}
              </div>
              <div style={{ marginTop: '2px' }}>{rule.reason}</div>
            </div>
          ))
          : <div style={{ fontSize: '0.82rem', color: t.muted }}>沒有命中任何安全規則</div>}

        {/* 三態旗標 */}
        <div style={sectionTitle}>明確存在（present）</div>
        <FlagChips
          flags={safety.present_flags}
          color={t.danger}
          background="#fef2f2"
          empty="無"
        />

        <div style={sectionTitle}>明確否認（absent）</div>
        <FlagChips
          flags={safety.absent_flags}
          color={t.ok}
          background="#f0fdf4"
          empty="無"
        />

        <details style={{ marginTop: '10px' }}>
          <summary style={{ ...sectionTitle, margin: 0, cursor: 'pointer' }}>
            尚未提及（unknown，{safety.unknown_flags?.length || 0} 項）——
            「沒提到」不等於「沒有」
          </summary>
          <div style={{ marginTop: '6px' }}>
            <FlagChips
              flags={safety.unknown_flags}
              color={t.muted}
              background={t.subtle}
              empty="無"
            />
          </div>
        </details>

        {/* 抽取依據 */}
        {safety.evidence?.length > 0 && (
          <>
            <div style={sectionTitle}>抽取依據（使用者原話）</div>
            <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.7 }}>
              {safety.evidence.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </>
        )}

        {safety.ambiguous_information?.length > 0 && (
          <>
            <div style={sectionTitle}>描述不明確、需再確認</div>
            <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.7 }}>
              {safety.ambiguous_information.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
};

export default SafetyAuditPanel;
