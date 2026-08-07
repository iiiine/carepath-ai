// src/HistorySidebar.jsx
import { useState, useEffect } from 'react';
import api from './api/axios';

function HistorySidebar({ user, onSelectSession, onNewChat }) {
  const [historyList, setHistoryList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // 💡 正在編輯標題的狀態
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');

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
    const handleRefresh = () => fetchHistory();
    window.addEventListener('refresh-history', handleRefresh);
    return () => window.removeEventListener('refresh-history', handleRefresh);
  }, [user]);

  // 刪除單筆紀錄
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

  // ✏️ 開啟編輯模式 (修正：填入 session.title)
  const handleStartEdit = (e, session) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditTitle(session.title || session.symptom_text || '');
  };

  // 💾 儲存新標題 (修正：同步更新 State 中的 item.title)
  const handleSaveTitle = async (e, id) => {
    e.stopPropagation();
    if (!editTitle.trim()) return;

    try {
      await api.patch(`/api/v1/history/${id}`, { title: editTitle.trim() });
      setHistoryList(prev => prev.map(item => 
        item.id === id ? { ...item, title: editTitle.trim() } : item
      ));
      setEditingId(null);
    } catch (err) {
      alert('修改標題失敗');
    }
  };

  // ❌ 取消編輯
  const handleCancelEdit = (e) => {
    e.stopPropagation();
    setEditingId(null);
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
      
      {/* 頂部列 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: isCollapsed ? 'center' : 'space-between',
        marginBottom: '14px',
        paddingBottom: '8px',
        borderBottom: '1px solid #f1f5f9'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? "展開側邊欄" : "收起側邊欄"}
            style={{
              border: 'none', backgroundColor: '#0550a0', color: '#ffffff',
              borderRadius: '8px', cursor: 'pointer', fontSize: '1.2rem',
              width: '36px', height: '36px', display: 'flex', alignItems: 'center',
              justifyContent: 'center', boxShadow: '0 2px 6px rgba(5,80,160,0.3)', flexShrink: 0
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

      {/* 列表區塊 */}
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
                  padding: '10px 12px',
                  borderRadius: '10px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                {/* ✏️ 情況 A：正在編輯標題 */}
                {editingId === session.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
                    <input 
                      type="text" 
                      value={editTitle} 
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle(e, session.id)}
                      autoFocus
                      style={{
                        flex: 1, padding: '4px 6px', fontSize: '0.85rem',
                        borderRadius: '6px', border: '1px solid #0550a0', outline: 'none'
                      }}
                    />
                    <button onClick={(e) => handleSaveTitle(e, session.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.9rem' }} title="確定">✔</button>
                    <button onClick={handleCancelEdit} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.9rem' }} title="取消">✖</button>
                  </div>
                ) : (
                  /* 💬 情況 B：正常顯示標題 (修正：優先讀取 session.title) */
                  <>
                    <div style={{ overflow: 'hidden', flex: 1, paddingRight: '6px' }}>
                      <div style={{ fontWeight: 'bold', color: '#334155', fontSize: '0.88rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {session.title || session.symptom_text || '未命名問診'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                        {session.created_at}
                      </div>
                    </div>

                    {/* 操作按鈕群：編輯 ✏️ & 刪除 ✕ */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button 
                        onClick={(e) => handleStartEdit(e, session)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.82rem', padding: '2px', opacity: 0.7 }}
                        title="重命名"
                      >
                        ✏️
                      </button>
                      <button 
                        onClick={(e) => handleDelete(e, session.id)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444', fontSize: '0.85rem', padding: '2px' }}
                        title="刪除紀錄"
                      >
                        ✕
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}

    </div>
  );
}

export default HistorySidebar;