import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { t } from '../theme';
import { useElderMode } from '../context/ElderModeContext';

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

// AI 安全網的狀態；舊後端沒有這個欄位時整段不顯示
const NET_STATUS = {
  ok: '已執行',
  timeout: '逾時，未採用',
  failed: '執行失敗，未採用',
  disabled: '未啟用',
  not_used: '未使用（安全評估未完成）',
};

const FLAG_GROUPS = [
  { key: 'present_flags', title: '明確存在（present）', color: '#b91c1c' },
  { key: 'absent_flags', title: '明確否認（absent）', color: '#15803d' },
];

const RISK_COLORS = {
  emergency: '#dc2626',
  urgent: '#c2410c',
  standard: '#15803d',
  unknown: t.muted,
};

export default function SafetyAuditPanel({ safety }) {
  const { s } = useElderMode();
  const [expanded, setExpanded] = useState(false);
  const [showUnknown, setShowUnknown] = useState(false);

  if (!safety) return null;

  const textStyle = { color: t.text, fontSize: s.caption, lineHeight: s.lineBody };
  const captionStyle = { color: t.muted, fontSize: s.caption, lineHeight: s.lineBody };
  const flagLabel = (key) => FLAG_LABELS[key] || key;

  return (
    <View style={{
      marginVertical: s.gap,
      padding: s.pad,
      borderRadius: s.radius,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.panel,
    }}>
      <TouchableOpacity
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={{ minHeight: s.touch, justifyContent: 'center' }}
      >
        <Text style={[textStyle, { fontWeight: '700' }]}>
          {expanded ? '收合' : '展開'}安全篩檢稽核紀錄
          {' · '}
          <Text style={{ color: RISK_COLORS[safety.risk_level] || t.muted }}>
            {safety.risk_label || safety.risk_level || '未知'}
          </Text>
        </Text>
      </TouchableOpacity>

      {expanded && (
        <View>
          <Text style={captionStyle}>
            以下是安全篩檢的判斷依據。主體是固定規則，另有 AI 安全網獨立判斷一次、只能把等級往上調。這是風險篩檢，不是疾病診斷。
          </Text>

          <Text style={[textStyle, { marginTop: s.gap, fontWeight: '700' }]}>判斷結果</Text>
          <Text style={textStyle}>
            風險等級：{safety.risk_label || '—'}（{safety.risk_level || '—'}）
          </Text>
          <Text style={textStyle}>
            評估完整度：{safety.assessment_completeness === 'insufficient'
              ? '資訊不足，仍有待確認的警訊'
              : '完整'}
          </Text>
          {safety.technical_failure && (
            <Text style={{ ...textStyle, color: t.danger, fontWeight: '700' }}>
              技術失敗：未完成安全評估，已中止一般問診（不視為低風險）
            </Text>
          )}

          {!!safety.safety_net && (
            <View>
              <Text style={[textStyle, { marginTop: s.gap, fontWeight: '700' }]}>判斷來源</Text>
              <Text style={textStyle}>
                安全規則：{RISK_NAMES[safety.rule_risk_level] || '—'}
              </Text>
              <Text style={textStyle}>
                AI 安全網：{safety.safety_net.status === 'ok'
                  ? RISK_NAMES[safety.safety_net.risk_level] || '—'
                  : NET_STATUS[safety.safety_net.status] || safety.safety_net.status}
                {safety.safety_net.escalated ? '（已提高最終等級）' : ''}
              </Text>
              <Text style={captionStyle}>
                AI 安全網只能把等級往上調，不能往下調；安全網失敗時以安全規則為準。
              </Text>
            </View>
          )}

          <Text style={[textStyle, { marginTop: s.gap, fontWeight: '700' }]}>規則版本</Text>
          <Text style={captionStyle}>
            pipeline {safety.pipeline_version || '—'} ／ engine {safety.engine_version || '—'} ／ extractor {safety.extractor_version || '—'}
            {safety.safety_net?.version ? ` ／ safety net ${safety.safety_net.version}` : ''}
          </Text>

          <Text style={[textStyle, { marginTop: s.gap, fontWeight: '700' }]}>
            命中的安全規則（{safety.red_flags?.length || 0}）
          </Text>
          {safety.red_flags?.length ? safety.red_flags.map((rule, index) => (
            <View key={`${rule.code || 'rule'}-${index}`} style={{
              marginTop: 6,
              padding: s.gap,
              borderLeftWidth: 3,
              borderLeftColor: RISK_COLORS[rule.risk_level] || t.muted,
              borderRadius: 6,
              backgroundColor: t.subtle,
            }}>
              <Text style={[textStyle, { fontWeight: '700' }]}>{rule.title || rule.code}</Text>
              <Text style={captionStyle}>{rule.code || '—'} · {rule.risk_level || '—'}</Text>
              {!!rule.reason && <Text style={textStyle}>{rule.reason}</Text>}
            </View>
          )) : <Text style={captionStyle}>沒有命中任何安全規則</Text>}

          {FLAG_GROUPS.map(({ key, title, color }) => (
            <View key={key} style={{ marginTop: s.gap }}>
              <Text style={[textStyle, { fontWeight: '700' }]}>{title}</Text>
              {safety[key]?.length
                ? <Text style={[textStyle, { color }]}>{safety[key].map(flagLabel).join('、')}</Text>
                : <Text style={captionStyle}>無</Text>}
            </View>
          ))}

          <TouchableOpacity
            onPress={() => setShowUnknown((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showUnknown }}
            style={{ minHeight: s.touch, justifyContent: 'center', marginTop: s.gap }}
          >
            <Text style={[textStyle, { fontWeight: '700' }]}>
              {showUnknown ? '收合' : '查看'}尚未提及（unknown，{safety.unknown_flags?.length || 0} 項）
              {' · 「沒提到」不等於「沒有」'}
            </Text>
          </TouchableOpacity>
          {showUnknown && (
            <Text style={captionStyle}>
              {safety.unknown_flags?.length ? safety.unknown_flags.map(flagLabel).join('、') : '無'}
            </Text>
          )}

          {!!safety.evidence?.length && (
            <View style={{ marginTop: s.gap }}>
              <Text style={[textStyle, { fontWeight: '700' }]}>抽取依據（使用者原話）</Text>
              {safety.evidence.map((item, index) => (
                <Text key={`evidence-${index}`} style={textStyle}>• {item}</Text>
              ))}
            </View>
          )}
          {!!safety.ambiguous_information?.length && (
            <View style={{ marginTop: s.gap }}>
              <Text style={[textStyle, { fontWeight: '700' }]}>描述不明確、需再確認</Text>
              {safety.ambiguous_information.map((item, index) => (
                <Text key={`ambiguous-${index}`} style={textStyle}>• {item}</Text>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
