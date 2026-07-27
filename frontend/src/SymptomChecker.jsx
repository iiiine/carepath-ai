import { useState, useRef, useEffect } from 'react';
import api from './api/axios';
import HospitalMap from './HospitalMap';

function SymptomChecker({ isConnected, statusText }) {
  const [messages, setMessages] = useState([
    { role: 'model', content: '您好！我是您的 AI 健康助理。請先在右上方選擇您不舒服的程度。\n請問您今天哪裡不舒服呢？可以簡單跟我描述一下症狀。' }
  ]);

  const [inputText, setInputText] = useState('');
  const [painLevel, setPainLevel] = useState(3);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [diagnosisResult, setDiagnosisResult] = useState(null);

  // 全螢幕放大狀態控制 ('map' | 'chat' | 'doctors' | null)
  const [fullscreenSection, setFullscreenSection] = useState(null);

  const messagesEndRef = useRef(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

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

  const toggleFullscreen = (section) => {
    setFullscreenSection(fullscreenSection === section ? null : section);
  };

  const getSectionStyle = (section) => {
    const isFS = fullscreenSection === section;
    if (isFS) {
      return {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        backgroundColor: '#fff',
        padding: '24px',
        boxSizing: 'border-box',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column'
      };
    }
    return {
      backgroundColor: '#fff',
      borderRadius: '12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
      border: '1px solid #e2e8f0',
      overflow: 'hidden',
      minHeight: 0
    };
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr', // 左右寬度 1:1
      gap: '20px',
      maxWidth: '1600px',
      height: 'calc(100vh - 40px)',
      margin: '0 auto'
    }}>
      
      {/* 👈 左半邊欄位 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', minHeight: 0 }}>
        
        {/* 左上（30%）：專案標題與指示燈 */}
        <div style={{ flex: 3, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', padding: '10px 5px', minHeight: 0 }}>
          {/* 🟢/🔴 綠燈指示燈 */}
          <div style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            gap: '8px', 
            backgroundColor: '#ffffff', 
            padding: '5px 12px', 
            borderRadius: '20px', 
            boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
            fontSize: '0.8rem',
            fontWeight: 'bold',
            color: '#555',
            marginBottom: '12px'
          }}>
            <span style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              backgroundColor: isConnected ? '#28a745' : '#dc3545',
              boxShadow: isConnected ? '0 0 6px #28a745' : '0 0 6px #dc3545'
            }} />
            <span>{statusText}</span>
          </div>

          {/* 標題 */}
          <h2 style={{ margin: 0, color: '#0550a0', fontSize: '3.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            🏥 智慧 AI 醫療問診系統
          </h2>
          <p style={{ color: '#666', marginTop: '6px', fontSize: '1.2rem' }}>
            ---------- 即時輔助問診與醫療資源導引
          </p>
        </div>

        {/* 左下（70%）：醫院位置地圖 */}
        <div style={{ ...getSectionStyle('map'), flex: 7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h3 style={{ margin: 0, color: '#333', fontSize: '1rem' }}>🗺️ 附近地圖</h3>
            <button onClick={() => toggleFullscreen('map')} style={{ border: 'none', background: '#f0f0f0', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}>
              {fullscreenSection === 'map' ? '↩️ 退出' : '🔍 全螢幕'}
            </button>
          </div>
          <div style={{ flex: 1, width: '100%', minHeight: 0, position: 'relative' }}>
            <HospitalMap 
              isFullscreen={fullscreenSection === 'map'} 
              hospitalsProp={diagnosisResult ? diagnosisResult.nearby_medical_resources : null}
            />
          </div>
        </div>

      </div>

      {/* 👉 右半邊欄位 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', minHeight: 0 }}>
        
        {/* 右上（50%）：AI 線上問診對話框 */}
        <div style={{ ...getSectionStyle('chat'), flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3 style={{ margin: 0, color: '#0550a0', fontSize: '1rem' }}>💬 AI 線上問診</h3>
            <div>
              {!diagnosisResult && (
                <div style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: '6px', 
                  marginRight: '10px', 
                  backgroundColor: '#f1f5f9', 
                  padding: '3px 10px', 
                  borderRadius: '16px',
                  fontSize: '0.8rem',
                  color: '#475569',
                  fontWeight: 'bold'
                }}>
                  <span>不適度: <strong style={{ color: painLevel >= 4 ? '#dc3545' : '#0056b3' }}>{painLevel} 分</strong></span>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={painLevel}
                    onChange={(e) => setPainLevel(e.target.value)}
                    style={{ 
                      width: '70px', 
                      accentColor: painLevel >= 4 ? '#f34a5b' : painLevel >= 3 ? '#f6cf59' : '#6bf28a', 
                      cursor: 'pointer',
                      verticalAlign: 'middle'
                    }}
                  />
                </div>
              )}
              <button onClick={() => toggleFullscreen('chat')} style={{ border: 'none', background: '#f0f0f0', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}>
                {fullscreenSection === 'chat' ? '↩️退出' : '🔍全螢幕'}
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '8px', marginBottom: '10px' }}>
            {messages.map((msg, index) => (
              <div key={index} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: '10px' }}>
                <div style={{
                  maxWidth: '85%',
                  padding: '8px 12px',
                  borderRadius: msg.role === 'user' ? '14px 14px 0 14px' : '14px 14px 14px 0',
                  backgroundColor: msg.role === 'user' ? '#0550a0' : '#ffffff',
                  color: msg.role === 'user' ? '#ffffff' : '#333333',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  whiteSpace: 'pre-wrap',
                  fontSize: '0.9rem'
                }}>
                  {msg.role === 'model' && <strong style={{ color: '#0550a0', display: 'block', fontSize: '0.75rem', marginBottom: '2px' }}>🤖 AI疾病判斷</strong>}
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && <div style={{ color: '#666', fontSize: '0.8rem' }}>🤖 AI 分析中...</div>}
            <div ref={messagesEndRef} />
          </div>

          {!diagnosisResult ? (
            <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="請描述症狀..."
                disabled={loading}
                style={{ flex: 1, padding: '8px 10px', borderRadius: '6px', border: '1px solid #ccc', outline: 'none', fontSize: '0.85rem' }}
              />
              <button type="submit" disabled={loading || !inputText.trim()} style={{ padding: '0 14px', backgroundColor: '#0550a0', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                發送
              </button>
            </form>
          ) : (
            <button 
              onClick={() => { setDiagnosisResult(null); setMessages([{ role: 'model', content: '您好！我是您的 AI 健康助理。請問您今天哪裡不舒服呢？' }]); setHistory([]); }}
              style={{ width: '100%', padding: '8px', backgroundColor: '#6c757d', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              🔄 重置重新問診
            </button>
          )}
        </div>

        {/* 右下（50%）：推薦診所與門診醫師資訊 */}
        <div style={{ ...getSectionStyle('doctors'), flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3 style={{ margin: 0, color: '#155724', fontSize: '1rem' }}>📋 推薦診所與醫師資訊</h3>
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
                  // 判斷是否為合法的網址 (開頭為 http:// 或 https://)
                  const isUrl = hospital.booking_url && /^https?:\/\//i.test(hospital.booking_url.trim());

                  return (
                    <div key={idx} style={{ backgroundColor: '#fff', padding: '10px', borderRadius: '6px', marginBottom: '8px', border: '1px solid #c3e6cb', fontSize: '0.85rem' }}>
                      
                      {/*醫院名稱與線上掛號按鈕/提示 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: 'bold', color: '#155724', fontSize: '0.95rem' }}>
                          🏥 {hospital.name}
                        </div>

                        {/*條件渲染：合法網址 ➔ 按鈕；一般文字/NULL ➔ 提示黃色標籤 */}
                        {isUrl ? (
                          <a
                            href={hospital.booking_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              backgroundColor: '#28a745',
                              color: '#ffffff',
                              padding: '4px 10px',
                              borderRadius: '4px',
                              textDecoration: 'none',
                              fontSize: '0.8rem',
                              fontWeight: 'bold',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                            }}
                          >
                            🌐 線上掛號
                          </a>
                        ) : (
                          <span style={{ 
                            fontSize: '0.75rem', 
                            color: '#856404', 
                            backgroundColor: '#fff3cd', 
                            padding: '2px 8px', 
                            borderRadius: '4px',
                            border: '1px solid #ffeeba',
                            fontWeight: 'bold'
                          }}>
                            {hospital.booking_url || '僅提供現場掛號'}
                          </span>
                        )}
                      </div>

                      {/* 📍 地址與距離 */}
                      <div style={{ color: '#555', margin: '4px 0', fontSize: '0.8rem' }}>
                        📍 地址：{hospital.address} (約 {hospital.distance_meters}m)
                      </div>

                      {/* 📞 電話 */}
                      <div style={{ color: '#555', marginBottom: '6px', fontSize: '0.8rem' }}>
                        📞 電話：{hospital.phone}
                      </div>
                      
                      {/* 👨‍⚕️ 門診醫師列表 */}
                      <div style={{ marginTop: '6px', borderTop: '1px dashed #d4edda', paddingTop: '6px' }}>
                        <strong>👨‍⚕️ 門診醫師：</strong>
                        {hospital.available_doctors.map((doc, dIdx) => (
                          <div key={dIdx} style={{ backgroundColor: '#f8f9fa', padding: '4px 6px', borderRadius: '4px', marginTop: '4px', fontSize: '0.8rem' }}>
                            <strong>{doc.name}</strong> ({doc.department})
                            <br /><span style={{ color: '#666' }}>專長：{doc.specialty}</span>
                          </div>
                        ))}
                      </div>

                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#888', fontSize: '0.85rem' }}>
                💬 問診完成後，將在此顯示推薦醫師與掛號連結。
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}

export default SymptomChecker;