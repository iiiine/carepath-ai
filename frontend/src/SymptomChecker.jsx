import { useState, useRef, useEffect } from 'react';
import api from './api/axios'; // 引入前面封裝好的 axios (baseURL 預設連 127.0.0.1:8000)
import HospitalMap from './HospitalMap'; // Peter 的醫院地圖

function SymptomChecker() {
  // 1. 對話訊息列表 (初始化放一則 AI 的問候語)
  const [messages, setMessages] = useState([
    { role: 'model', content: '您好！我是您的 AI 健康助理。請問您今天哪裡不舒服呢？可以簡單跟我描述一下症狀。' }
  ]);

  // 2. 表單狀態
  const [inputText, setInputText] = useState('');
  const [painLevel, setPainLevel] = useState(3); // 預設不舒服程度 3 分 (1-5分)
  const [loading, setLoading] = useState(false);
  
  // 3. 後端歷史紀錄 (格式配合後端的 ChatMessage: [{role: "user"|"model", content: ""}])
  const [history, setHistory] = useState([]);
  
  // 4. 診斷完成後的醫療資源結果
  const [diagnosisResult, setDiagnosisResult] = useState(null);

  // 用於自動滾動到對話最底部
  const messagesEndRef = useRef(null);
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // 發送對話訊息給 FastAPI
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || loading) return;

    const userText = inputText;
    setInputText(''); // 清空輸入框

    // 畫面立即顯示使用者的對話
    const newMessages = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);
    setLoading(true);

    try {
      // 🎯 呼叫後端的 /api/v1/diagnose API
      const response = await api.post('/api/v1/diagnose', {
        pain_level: Number(painLevel),
        symptom_text: userText,
        user_latitude: 23.0,
        user_longitude: 120.2,
        history: history // 傳送過去的對話歷史
      });

      const data = response.data;

      if (!data.is_complete) {
        // 🔄 情境 A：資訊不足，AI 繼續追問
        setMessages([...newMessages, { role: 'model', content: data.message }]);
        // 更新 history 供下一輪對話使用
        setHistory(data.history || []);
      } else {
        // ✅ 情境 B：診斷完成，顯示 AI 的結論與推薦資源
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

  return (
    <div style={{ maxWidth: '700px', margin: '20px auto', fontFamily: 'Arial, sans-serif' }}>
      {/* 頂部標題與不舒服程度選擇器 */}
      <div style={{ backgroundColor: '#0056b3', color: '#fff', padding: '15px 20px', borderRadius: '12px 12px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>🩺 智慧 AI 線上問診室</h3>
        
        {/* 1-5分 不舒服程度調整 */}
        {!diagnosisResult && (
          <div style={{ fontSize: '0.85rem', backgroundColor: 'rgba(255,255,255,0.2)', padding: '5px 10px', borderRadius: '20px' }}>
            不適程度: 
            <select 
              value={painLevel} 
              onChange={(e) => setPainLevel(e.target.value)}
              style={{ marginLeft: '5px', borderRadius: '4px', border: 'none', padding: '2px 5px' }}
            >
              <option value={1}>1分 (輕微)</option>
              <option value={2}>2分 (輕度)</option>
              <option value={3}>3分 (中度)</option>
              <option value={4}>4分 (明顯不適)</option>
              <option value={5}>5分 (劇痛/緊急)</option>
            </select>
          </div>
        )}
      </div>

      {/* 💬 對話聊天區域 */}
      <div style={{ backgroundColor: '#f8f9fa', height: '420px', overflowY: 'auto', padding: '20px', borderLeft: '1px solid #ddd', borderRight: '1px solid #ddd' }}>
        {messages.map((msg, index) => (
          <div 
            key={index} 
            style={{ 
              display: 'flex', 
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: '15px' 
            }}
          >
            <div style={{ 
              maxWidth: '75%', 
              padding: '12px 16px', 
              borderRadius: msg.role === 'user' ? '18px 18px 0px 18px' : '18px 18px 18px 0px',
              backgroundColor: msg.role === 'user' ? '#0056b3' : '#ffffff',
              color: msg.role === 'user' ? '#ffffff' : '#333333',
              boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
              lineHeight: '1.5',
              whiteSpace: 'pre-wrap'
            }}>
              {msg.role === 'model' && <strong style={{ color: '#0056b3', display: 'block', marginBottom: '4px', fontSize: '0.85rem' }}>🤖 AI 醫師</strong>}
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '15px' }}>
            <div style={{ backgroundColor: '#e9ecef', padding: '10px 15px', borderRadius: '18px', color: '#666', fontSize: '0.9rem' }}>
              🤖 AI 正在分析您的描述中...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 🏥 診斷完成卡片 (當 is_complete = True 時顯示) */}
      {diagnosisResult && (
        <div style={{ padding: '20px', backgroundColor: '#e6f4ea', borderLeft: '1px solid #ddd', borderRight: '1px solid #ddd', borderBottom: '1px solid #ddd' }}>
          <h4 style={{ color: '#1e7e34', marginTop: 0 }}>📋 最終評估報告與建議資源</h4>
          <p><strong>推薦科別：</strong> <span style={{ backgroundColor: '#28a745', color: '#fff', padding: '3px 8px', borderRadius: '4px' }}>{diagnosisResult.suggested_department}</span></p>
          <p><strong>可能原因：</strong> {diagnosisResult.possible_causes.join('、')}</p>
          
          <h5 style={{ marginBottom: '10px', marginTop: '15px' }}>📍 推薦附近醫療院所：</h5>
          {diagnosisResult.nearby_medical_resources.map((hospital, idx) => (
            <div key={idx} style={{ backgroundColor: '#fff', padding: '12px', borderRadius: '8px', marginBottom: '10px', border: '1px solid #c3e6cb' }}>
              <div style={{ fontWeight: 'bold', color: '#155724' }}>🏥 {hospital.name}</div>
              <div style={{ fontSize: '0.85rem', color: '#555', margin: '4px 0' }}>地址：{hospital.address} (距離約 {hospital.distance_meters}m)</div>
              
              <div style={{ marginTop: '8px', fontSize: '0.85rem' }}>
                <strong>👨‍⚕️ 門診醫師資訊：</strong>
                {hospital.available_doctors.map((doc, dIdx) => (
                  <div key={dIdx} style={{ backgroundColor: '#f8f9fa', padding: '6px 8px', borderRadius: '4px', marginTop: '4px' }}>
                    <strong>{doc.name} 醫師</strong> ({doc.department}) - 專長：{doc.specialty}
                    <br />
                    <span style={{ color: '#d9534f' }}>🗓️ 排班時間：{doc.schedule}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <HospitalMap />
        </div>
      )}

      {/* ✍️ 底部文字輸入框 (問診尚未完成時可繼續輸入) */}
      {!diagnosisResult ? (
        <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '8px', padding: '12px', backgroundColor: '#ffffff', border: '1px solid #ddd', borderRadius: '0 0 12px 12px' }}>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="請詳細輸入您的不適情況（例如：從昨天開始腹痛，伴隨噁心感...）"
            disabled={loading}
            style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #ccc', outline: 'none', fontSize: '0.95rem' }}
          />
          <button 
            type="submit" 
            disabled={loading || !inputText.trim()}
            style={{ padding: '0 20px', backgroundColor: '#0056b3', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            發送
          </button>
        </form>
      ) : (
        <div style={{ padding: '15px', backgroundColor: '#fff', textAlign: 'center', border: '1px solid #ddd', borderRadius: '0 0 12px 12px' }}>
          <button 
            onClick={() => { setDiagnosisResult(null); setMessages([{ role: 'model', content: '您好！我是您的 AI 健康助理。請問您今天哪裡不舒服呢？' }]); setHistory([]); }}
            style={{ padding: '8px 16px', backgroundColor: '#6c757d', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            🔄 開始新的問診
          </button>
        </div>
      )}
    </div>
  );
}

export default SymptomChecker;