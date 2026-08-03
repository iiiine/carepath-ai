// src/SymptomChecker.jsx
import { useState, useRef, useEffect } from 'react';
import api from './api/axios';
import HospitalMap from './HospitalMap';
import HistorySidebar from './HistorySidebar';
import UserProfileModal from './UserProfileModal'; // 👈 1. 匯入 Modal

function SymptomChecker({ user, isConnected, statusText }) {
  const [messages, setMessages] = useState([
    { role: 'model', content: '您好！我是您的 AI 健康助理。請先在右上角選擇不舒服的程度，並跟我描述您的症狀。' }
  ]);

  const [inputText, setInputText] = useState('');
  const [painLevel, setPainLevel] = useState(3);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [diagnosisResult, setDiagnosisResult] = useState(null);

  // 🎯 介面模式: 'chat-only' | 'split-screen'
  const [viewMode, setViewMode] = useState('chat-only');
  
  // 💡 側邊欄展開/收納狀態 (預設展開)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // 💡 3秒倒數燈號計時器狀態 (0, 1, 2, 3)
  const [countdownStep, setCountdownStep] = useState(0); 
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [fullscreenSection, setFullscreenSection] = useState(null);

  // 💡 個人健康資料 Modal 開關狀態
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const messagesEndRef = useRef(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // 開啟個人健康資料 Modal 判斷
  const handleOpenProfile = () => {
    if (user?.is_guest) {
      alert('🔒 訪客模式無法儲存健康資料，請先註冊/登入會員！');
      return;
    }
    setIsProfileOpen(true);
  };

  // 發送問診訊息
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || loading) return;

    const userText = inputText;
    setInputText('');

    const newMessages = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const response = await api.post('/api/v1/diagnose', {
        pain_level: Number(painLevel),
        symptom_text: userText,
        user_latitude: 23.0,
        user_longitude: 120.2,
        history: history
      });

      const data = response.data;

      if (!data.is_complete) {
        setMessages([...newMessages, { role: 'model', content: data.message }]);
        setHistory(data.history || []);
      } else {
        setMessages([...newMessages, { role: 'model', content: data.message }]);
        setDiagnosisResult(data);

        // 廣播「歷史紀錄已更新」事件
        window.dispatchEvent(new Event('refresh-history'));

        // 🟢 觸發「三個燈 3 秒倒數彈窗」
        setShowCompleteModal(true);
        setCountdownStep(1); // 亮第 1 個燈 (第 1 秒)

        setTimeout(() => setCountdownStep(2), 1000); // 亮第 2 個燈 (第 2 秒)
        setTimeout(() => setCountdownStep(3), 2000); // 亮第 3 個燈 (第 3 秒)

        setTimeout(() => {
          setShowCompleteModal(false);
          setCountdownStep(0);
          setViewMode('split-screen'); // 跳轉至 1:1 畫面
        }, 3000);
      }
    } catch (error) {
      console.error('問診請求失敗:', error);
      setMessages([
        ...newMessages,
        { role: 'model', content: '⚠️ 抱歉，目前系統連線有些問題，請確認後端服務是否正常啟動。' }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSession = (session) => {
    const savedHistory = Array.isArray(session.history)
      ? session.history
      : [];

    const savedCauses = Array.isArray(session.possible_causes)
      ? session.possible_causes
      : [];

    const savedResources = Array.isArray(
      session.nearby_medical_resources
    )
      ? session.nearby_medical_resources
      : [];

    setMessages(savedHistory);
    setHistory(savedHistory);
    setPainLevel(session.pain_level ?? 3);

    setDiagnosisResult({
      status: 'completed',
      is_complete: true,
      symptom:
        session.original_symptom ||
        session.symptom_text ||
        '',
      suggested_department:
        session.suggested_department || '家醫科',
      possible_causes: savedCauses,
      nearby_medical_resources: savedResources,
      message: ''
    });

    setViewMode('split-screen');
  };

  const handleNewChat = () => {
    setDiagnosisResult(null);
    setMessages([{ role: 'model', content: '您好！我是您的 AI 健康助理。請問您今天哪裡不舒服呢？' }]);
    setHistory([]);
    setViewMode('chat-only');
  };

  const toggleFullscreen = (section) => {
    setFullscreenSection(fullscreenSection === section ? null : section);
  };

  const getSectionStyle = (section) => {
    if (fullscreenSection === section) {
      return {
        position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999,
        backgroundColor: '#fff', padding: '24px', boxSizing: 'border-box', overflowY: 'auto', display: 'flex', flexDirection: 'column'
      };
    }
    return {
      backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.06)', padding: '16px',
      display: 'flex', flexDirection: 'column', boxSizing: 'border-box', border: '1px solid #e2e8f0', overflow: 'hidden', minHeight: 0
    };
  };

  return (
    <div style={{
      display: 'flex',
      gap: '16px',
      maxWidth: '1700px',
      height: 'calc(100vh - 85px)',
      margin: '0 auto',
      width: '100%',
      position: 'relative'
    }}>
      
      <div style={{ 
        width: isSidebarCollapsed ? '60px' : '260px', 
        transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)', 
        flexShrink: 0, 
        height: '100%' 
      }}>
        <HistorySidebar 
          user={user} 
          onSelectSession={handleSelectSession} 
          onNewChat={handleNewChat}
        />
      </div>

      {/* 👉 主畫面區域 */}
      <div style={{ flex: 1, height: '100%', minWidth: 0, position: 'relative' }}>
        
        {viewMode === 'chat-only' ? (
          /* 🎯 模式 A：剛登入時「AI 對話框置中」 */
          <div style={{
            maxWidth: '850px',
            height: '100%',
            margin: '0 auto',
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
            border: '1px solid #cbd5e1',
            padding: '24px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h2 style={{ margin: 0, color: '#0550a0', fontSize: '1.6rem' }}>💬 AI 線上問診助理</h2>
                <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.9rem' }}>請詳細描述症狀，AI 將為您即時分析並推薦醫療資源</p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* 📋 個人健康資料按鈕 */}
                <button
                  onClick={handleOpenProfile}
                  style={{
                    backgroundColor: user?.is_guest ? '#f1f5f9' : '#e0f2fe',
                    color: user?.is_guest ? '#64748b' : '#0369a1',
                    border: '1px solid #bae6fd',
                    borderRadius: '16px',
                    padding: '6px 12px',
                    fontSize: '0.82rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  📋 個人健康資料
                </button>

                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', backgroundColor: '#f1f5f9', padding: '6px 14px', borderRadius: '20px', fontSize: '0.85rem', color: '#475569', fontWeight: 'bold' }}>
                  <span>不適度: <strong style={{ color: painLevel >= 4 ? '#dc3545' : '#0056b3' }}>{painLevel} 分</strong></span>
                  <input
                    type="range" min="1" max="5" step="1" value={painLevel}
                    onChange={(e) => setPainLevel(e.target.value)}
                    style={{ width: '80px', accentColor: painLevel >= 4 ? '#f34a5b' : painLevel >= 3 ? '#f6cf59' : '#6bf28a', cursor: 'pointer' }}
                  />
                </div>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '12px', marginBottom: '16px' }}>
              {messages.map((msg, index) => (
                <div key={index} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: '12px' }}>
                  <div style={{
                    maxWidth: '80%', padding: '10px 16px',
                    borderRadius: msg.role === 'user' ? '16px 16px 0 16px' : '16px 16px 16px 0',
                    backgroundColor: msg.role === 'user' ? '#0550a0' : '#ffffff',
                    color: msg.role === 'user' ? '#ffffff' : '#333333',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                    whiteSpace: 'pre-wrap', fontSize: '0.95rem'
                  }}>
                    {msg.role === 'model' && <strong style={{ color: '#0550a0', display: 'block', fontSize: '0.8rem', marginBottom: '4px' }}>🤖 AI 疾病判斷</strong>}
                    {msg.content}
                  </div>
                </div>
              ))}
              {loading && <div style={{ color: '#64748b', fontSize: '0.85rem' }}>🤖 AI 分析症狀中...</div>}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text" value={inputText} onChange={(e) => setInputText(e.target.value)}
                placeholder="請描述您不舒服的地方（例如：頭痛、發燒...）" disabled={loading}
                style={{ flex: 1, padding: '12px 16px', borderRadius: '10px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '0.95rem' }}
              />
              <button type="submit" disabled={loading || !inputText.trim()} style={{ padding: '0 24px', backgroundColor: '#0550a0', color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.95rem' }}>
                發送
              </button>
            </form>
          </div>
        ) : (
          /* 🗺️ 模式 B：左右 1:1 完整版面 */
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', height: '100%' }}>
            
            {/* 左邊：地圖 */}
            <div style={{ ...getSectionStyle('map'), height: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{ margin: 0, color: '#333', fontSize: '1rem' }}>🗺️ 附近醫療院所地圖</h3>
                <button onClick={() => toggleFullscreen('map')} style={{ border: 'none', background: '#f0f0f0', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}>
                  {fullscreenSection === 'map' ? '↩️ 退出' : '🔍 全螢幕'}
                </button>
              </div>
              <div style={{ flex: 1, width: '100%', minHeight: 0, position: 'relative' }}>
                <HospitalMap isFullscreen={fullscreenSection === 'map'} hospitalsProp={diagnosisResult ? diagnosisResult.nearby_medical_resources : null} />
              </div>
            </div>

            {/* 右邊：對話歷史 + 醫師推薦 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', minHeight: 0 }}>
              
              <div style={{ ...getSectionStyle('chat'), flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h3 style={{ margin: 0, color: '#0550a0', fontSize: '0.95rem' }}>💬 問診對話歷程</h3>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={handleOpenProfile}
                      style={{
                        backgroundColor: user?.is_guest ? '#f1f5f9' : '#e0f2fe',
                        color: user?.is_guest ? '#64748b' : '#0369a1',
                        border: '1px solid #bae6fd',
                        borderRadius: '12px',
                        padding: '3px 8px',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      📋 個人資料
                    </button>
                    <button onClick={() => toggleFullscreen('chat')} style={{ border: 'none', background: '#f0f0f0', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                      {fullscreenSection === 'chat' ? '↩️退出' : '🔍全螢幕'}
                    </button>
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '8px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
                  {messages.map((msg, index) => (
                    <div key={index} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: '8px' }}>
                      <div style={{
                        maxWidth: '85%', padding: '6px 10px', borderRadius: '10px',
                        backgroundColor: msg.role === 'user' ? '#0550a0' : '#ffffff',
                        color: msg.role === 'user' ? '#ffffff' : '#333333', fontSize: '0.85rem'
                      }}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              <div style={{ ...getSectionStyle('doctors'), flex: 1.2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h3 style={{ margin: 0, color: '#155724', fontSize: '0.95rem' }}>📋 推薦診所與門診醫師資訊</h3>
                  <button onClick={() => toggleFullscreen('doctors')} style={{ border: 'none', background: '#f0f0f0', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}>
                    {fullscreenSection === 'doctors' ? '↩️退出' : '🔍全螢幕'}
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                  {diagnosisResult ? (
                    <div>
                      <div style={{ padding: '8px 10px', backgroundColor: '#e6f4ea', borderRadius: '6px', marginBottom: '8px', fontSize: '0.85rem' }}>
                        <p style={{ margin: 0 }}><strong>推薦科別：</strong> <span style={{ backgroundColor: '#28a745', color: '#fff', padding: '1px 6px', borderRadius: '4px' }}>{diagnosisResult.suggested_department}</span></p>
                        <p style={{ margin: '4px 0 0' }}><strong>可能原因：</strong> {diagnosisResult.possible_causes.join('、')}</p>
                      </div>

                      {diagnosisResult.nearby_medical_resources.map((hospital, idx) => {
                        const isUrl = hospital.booking_url && /^https?:\/\//i.test(hospital.booking_url.trim());
                        return (
                          <div key={idx} style={{ backgroundColor: '#fff', padding: '10px', borderRadius: '6px', marginBottom: '8px', border: '1px solid #c3e6cb', fontSize: '0.82rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ fontWeight: 'bold', color: '#155724' }}>🏥 {hospital.name}</div>
                              {isUrl ? (
                                <a href={hospital.booking_url} target="_blank" rel="noopener noreferrer" style={{ backgroundColor: '#28a745', color: '#ffffff', padding: '3px 8px', borderRadius: '4px', textDecoration: 'none', fontWeight: 'bold', fontSize: '0.75rem' }}>🌐 線上掛號</a>
                              ) : (
                                <span style={{ fontSize: '0.72rem', color: '#856404', backgroundColor: '#fff3cd', padding: '2px 6px', borderRadius: '4px' }}>{hospital.booking_url || '現場掛號'}</span>
                              )}
                            </div>
                            <div style={{ color: '#555', margin: '4px 0' }}>📍 {hospital.address} (約 {hospital.distance_meters}m)</div>
                            <div style={{ color: '#555' }}>
                              📞{' '}
                              {hospital.phone ? (
                                <a href={`tel:${hospital.phone}`} style={{ color: '#0550a0', textDecoration: 'none' }}>
                                  {hospital.phone}
                                </a>
                              ) : (
                                '院方未提供'
                              )}
                            </div>

                            <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #e2e8f0' }}>
                              <div style={{ color: '#0550a0', fontWeight: 'bold', marginBottom: '6px' }}>👨‍⚕️ 推薦醫師</div>
                              {Array.isArray(hospital.available_doctors) && hospital.available_doctors.length > 0 ? (
                                hospital.available_doctors.map((doctor, doctorIndex) => (
                                  <div key={`${hospital.hospital_code}-${doctor.name}-${doctorIndex}`} style={{ padding: '8px 10px', marginBottom: '6px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                                    <div style={{ color: '#334155', fontWeight: 'bold' }}>👨‍⚕️ {doctor.name}</div>
                                    <div style={{ color: '#0550a0', marginTop: '3px' }}>科別：{doctor.department || '院方未提供'}</div>
                                    <div style={{ color: '#64748b', marginTop: '3px', lineHeight: 1.5 }}>專長：{doctor.specialty || '院方未提供'}</div>
                                  </div>
                                ))
                              ) : (
                                <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>目前沒有符合科別的醫師資料</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', color: '#888', paddingTop: '30px', fontSize: '0.85rem' }}>問診完成後在此顯示推薦醫師資訊。</div>
                  )}
                </div>
              </div>

            </div>

          </div>
        )}

        {/* 🟢 三燈倒數彈窗 (3秒) */}
        {showCompleteModal && (
          <div style={{
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', justifyContent: 'center', alignItems: 'center',
            zIndex: 99999
          }}>
            <div style={{
              backgroundColor: '#ffffff', padding: '32px 48px', borderRadius: '20px',
              boxShadow: '0 12px 40px rgba(0,0,0,0.25)', textAlign: 'center',
              border: '2px solid #28a745', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px'
            }}>
              <h2 style={{ color: '#28a745', margin: 0, fontSize: '1.6rem' }}>🎉 問診已完成！</h2>
              <p style={{ color: '#475569', margin: 0, fontSize: '1rem' }}>
                即將為您跳轉至地圖與相關資訊...
              </p>

              <div style={{ display: 'flex', gap: '14px', marginTop: '8px' }}>
                {[1, 2, 3].map((step) => {
                  const isActive = countdownStep >= step;
                  return (
                    <div
                      key={step}
                      style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        backgroundColor: isActive ? '#28a745' : '#e2e8f0',
                        boxShadow: isActive ? '0 0 10px #28a745' : 'none',
                        transition: 'all 0.4s ease'
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 📋 渲染個人健康資料彈窗 Modal */}
        <UserProfileModal 
          isOpen={isProfileOpen} 
          onClose={() => setIsProfileOpen(false)} 
          user={user} 
        />

      </div>

    </div>
  );
}

export default SymptomChecker;