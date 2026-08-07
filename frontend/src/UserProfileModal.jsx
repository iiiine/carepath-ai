// src/UserProfileModal.jsx
import { useState, useEffect } from 'react';
import api from './api/axios';

function UserProfileModal({ isOpen, onClose, user }) {
  const [formData, setFormData] = useState({
    height_cm: '',
    weight_kg: '',
    birth_date: '',
    gender: '男',
    past_medical_history: '',
    allergy_history: '',
    current_medications: ''
  });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 打開 Modal 時抓取現有健康資料
  useEffect(() => {
    if (isOpen && user && !user.is_guest) {
      fetchProfile();
    }
  }, [isOpen, user]);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/profile');
      if (res.data && Object.keys(res.data).length > 0) {
        setFormData({
          height_cm: res.data.height_cm || '',
          weight_kg: res.data.weight_kg || '',
          birth_date: res.data.birth_date || '',
          gender: res.data.gender || '男',
          past_medical_history: res.data.past_medical_history || '',
          allergy_history: res.data.allergy_history || '',
          current_medications: res.data.current_medications || ''
        });
      }
    } catch (err) {
      console.error('抓取健康資料失敗:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    // 💡 方案 B：自動格式化生日字串，連續打入 8 位數字 (如 20060219) 自動轉成 2006-02-19
    if (name === 'birth_date') {
      const rawDigits = value.replace(/\D/g, ''); // 只留下數字
      if (rawDigits.length === 8) {
        const formattedDate = `${rawDigits.slice(0, 4)}-${rawDigits.slice(4, 6)}-${rawDigits.slice(6, 8)}`;
        setFormData(prev => ({ ...prev, birth_date: formattedDate }));
        return;
      }
    }

    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    
    // 💡 整理格式，避免空字串讓後端資料庫寫入失敗
    const payload = {
      height_cm: formData.height_cm ? parseFloat(formData.height_cm) : null,
      weight_kg: formData.weight_kg ? parseFloat(formData.weight_kg) : null,
      // 將 YYYY/MM/DD 或空字串統一轉為 YYYY-MM-DD 或 null
      birth_date: formData.birth_date ? formData.birth_date.replaceAll('/', '-') : null,
      gender: formData.gender || '男',
      past_medical_history: formData.past_medical_history || '',
      allergy_history: formData.allergy_history || '',
      current_medications: formData.current_medications || ''
    };

    try {
      await api.post('/api/v1/profile', payload);
      alert('✅ 個人健康基本資料已成功儲存！');
      onClose();
    } catch (err) {
      console.error('儲存失敗細節:', err.response?.data || err);
      alert(`⚠️ 儲存失敗：${err.response?.data?.detail || '請檢查輸入欄位'}`);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#ffffff', borderRadius: '16px', padding: '24px',
        width: '90%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', border: '1px solid #cbd5e1'
      }}>
        
        {/* Modal 頂部列 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
          <h3 style={{ margin: 0, color: '#0550a0', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            📋 個人健康基本資料
          </h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: '1.2rem', cursor: 'pointer', color: '#64748b' }}>✕</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>載入資料中...</div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            
            {/* 身高 & 體重 */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: '#334155', marginBottom: '4px' }}>身高 (cm)</label>
                <input 
                  type="number" step="0.1" name="height_cm" placeholder="如: 175"
                  value={formData.height_cm} onChange={handleChange}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: '#334155', marginBottom: '4px' }}>體重 (kg)</label>
                <input 
                  type="number" step="0.1" name="weight_kg" placeholder="如: 68"
                  value={formData.weight_kg} onChange={handleChange}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            {/* 生日 & 性別 */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: '#334155', marginBottom: '4px' }}>出生日期</label>
                {/* 💡 使用 type="date" 並搭配智慧連續輸入轉號 */}
                <input 
                  type="date" 
                  name="birth_date"
                  value={formData.birth_date} 
                  onChange={handleChange}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: '#334155', marginBottom: '4px' }}>生理性別</label>
                <select 
                  name="gender" value={formData.gender} onChange={handleChange}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', backgroundColor: '#fff' }}
                >
                  <option value="男">男</option>
                  <option value="女">女</option>
                  <option value="其他">其他</option>
                </select>
              </div>
            </div>

            {/* 過去病史 */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: '#334155', marginBottom: '4px' }}>既往病史</label>
              <textarea 
                name="past_medical_history" rows="2" placeholder="如：高血壓、氣喘、胃食道逆流...（無則留空）"
                value={formData.past_medical_history} onChange={handleChange}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', resize: 'vertical' }}
              />
            </div>

            {/* 過敏史 */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: '#334155', marginBottom: '4px' }}>藥物或食物過敏史</label>
              <textarea 
                name="allergy_history" rows="2" placeholder="如：對盤尼西林過敏、花生過敏...（無則留空）"
                value={formData.allergy_history} onChange={handleChange}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', resize: 'vertical' }}
              />
            </div>

            {/* 長期用藥 */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: '#334155', marginBottom: '4px' }}>目前長期服用藥物</label>
              <textarea 
                name="current_medications" rows="2" placeholder="如：降血壓藥、慢性病藥物...（無則留空）"
                value={formData.current_medications} onChange={handleChange}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', resize: 'vertical' }}
              />
            </div>

            {/* 提示訊息 */}
            <div style={{ fontSize: '0.78rem', color: '#64748b', backgroundColor: '#f1f5f9', padding: '8px 12px', borderRadius: '6px' }}>
              💡 填寫資料後，AI助手在進行問診評估時會自動參考您的健康背景資訊。
            </div>

            {/* 按鈕組 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button 
                type="button" onClick={onClose}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#fff', cursor: 'pointer', color: '#475569' }}
              >
                取消
              </button>
              <button 
                type="submit" disabled={saving}
                style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', backgroundColor: '#0550a0', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {saving ? '儲存中...' : '儲存健康資料'}
              </button>
            </div>

          </form>
        )}
      </div>
    </div>
  );
}

export default UserProfileModal;