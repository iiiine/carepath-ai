// src/HistorySidebar.jsx
import { useState, useEffect } from 'react';
import api from './api/axios';

function HistorySidebar({ user, onSelectSession, onNewChat }) {
  const [historyList, setHistoryList] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // 💡 由元件自己管理縮放狀態（預設 false 展開）
  const [isCollapsed, setIsCollapsed] = useState(false);

  // 抓取歷史紀錄 (僅會員發送 API)
  const fetchHistory = async () => {
    if (user?.is_guest) return;
    setLoading(true);
    try {
      const res = await api.get('/api/v1/history');
      setHistoryList(res.data);
    } catch (err) {
      console.error('抓取歷史對話失敗:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [user]);

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('確定要刪除這筆問診紀錄嗎？')) return;
    try {
      await api.delete(`/api/v1/history/${id}`);
      setHistoryList(prev => prev.filter(item => item.id !== id));
    } catch (err) {
      alert('刪除失敗');
    }
  };

  return (
    <div style={{
      backgroundColor: '#ffffff',
      borderRadius: '16px',
      border: '1px solid #cbd5e1',
      padding: isCollapsed ? '12px 6px' : '16px',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      boxSizing: 'border-box',
      boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
      width: isCollapsed ? '60px' : '260px',
      transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      flexShrink: 0
    }}>
      
      {/* 🔝 頂部列：無論是訪客還是會員，永遠顯示 ☰ 漢堡按鈕 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: isCollapsed ? 'center' : 'space-between',
        marginBottom: '14px',
        paddingBottom: '8px',
        borderBottom: '1px solid #f1f5f9'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* 💡 醒目的深藍色 ☰ 按鈕 */}
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? "展開側邊欄" : "收起側邊欄"}
            style={{
              border: 'none',
              backgroundColor: '#0550a0',
              color: '#ffffff',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '1.2rem',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 6px rgba(5,80,160,0.3)',
              flexShrink: 0
            }}
          >
            ☰
          </button>

          {!isCollapsed && (
            <h3 style={{ margin: 0, color: '#0550a0', fontSize: '0.95rem', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
              📜 歷史紀錄
            </h3>
          )}
        </div>

        {!isCollapsed && (
          <button 
            onClick={onNewChat}
            style={{
              backgroundColor: '#e2e8f0', color: '#0550a0', border: 'none',
              borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold',
              whiteSpace: 'nowrap'
            }}
          >
            ➕ 新問診
          </button>
        )}
      </div>

      {/* 底部內容：縮起時顯示圖示 / 展開時顯示完整列表 */}
      {isCollapsed ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', marginTop: '10px' }}>
          <button 
            onClick={onNewChat}
            title="開啟新問診"
            style={{
              border: 'none', backgroundColor: '#e2e8f0', color: '#0550a0',
              borderRadius: '50%', width: '36px', height: '36px', cursor: 'pointer',
              fontSize: '1rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            ➕
          </button>
          <div title="歷史紀錄" style={{ fontSize: '1.2rem', opacity: 0.6 }}>📜</div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {user?.is_guest ? (
            <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.82rem', color: '#64748b', lineHeight: '1.5' }}>
              🔒 <strong>訪客模式中</strong><br />登入會員後即可自動保存隨時檢視歷史問診紀錄。
            </div>
          ) : loading ? (
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center', padding: '20px 0' }}>載入歷史紀錄中...</div>
          ) : historyList.length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center', padding: '20px 0' }}>尚無對話紀錄</div>
          ) : (
            historyList.map(session => (
              <div 
                key={session.id}
                onClick={() => onSelectSession(session)}
                style={{
                  padding: '12px',
                  borderRadius: '10px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start'
                }}
              >
                <div style={{ overflow: 'hidden', flex: 1, paddingRight: '8px' }}>
                  <div style={{ fontWeight: 'bold', color: '#334155', fontSize: '0.88rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {session.symptom_text}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#0550a0', marginTop: '4px', fontWeight: 600 }}>
                    🏥 {session.suggested_department || '家醫科'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '4px' }}>
                    {session.created_at}
                  </div>
                </div>
                <button 
                  onClick={(e) => handleDelete(e, session.id)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444', fontSize: '0.9rem', padding: '0 4px' }}
                  title="刪除紀錄"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      )}

    </div>
  );
}

export default HistorySidebar;