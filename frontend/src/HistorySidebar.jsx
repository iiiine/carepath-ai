// src/HistorySidebar.jsx
import { useState, useEffect } from 'react';
import api from './api/axios';
import { t } from './theme';
import Icon from './Icon';
import { mdiMenu, mdiCheck, mdiClose, mdiPencilOutline } from '@mdi/js';

function HistorySidebar({ user, onSelectSession, onNewChat, asPage = false }) {
  const [historyList, setHistoryList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // 整頁形態沒有「讓位給主內容」這件事，所以永遠展開、也不顯示收合鈕
  const collapsed = asPage ? false : isCollapsed;

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
      backgroundColor: t.panel,
      borderRadius: '12px',
      border: `1px solid ${t.border}`,
      padding: collapsed ? '12px 6px' : '16px',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      boxSizing: 'border-box',
      width: asPage ? '100%' : (isCollapsed ? '60px' : '260px'),
      transition: asPage ? 'none' : 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      flexShrink: 0
    }}>
      
      {/* 頂部列 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        marginBottom: '14px',
        paddingBottom: '10px',
        borderBottom: `1px solid ${t.border}`
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!asPage && (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? "展開側邊欄" : "收起側邊欄"}
            style={{
              border: `1px solid ${t.border}`, backgroundColor: t.panel, color: t.text,
              borderRadius: '8px', cursor: 'pointer', fontSize: '1rem',
              width: '32px', height: '32px', display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexShrink: 0
            }}
          >
            <Icon path={mdiMenu} size="1.1rem" />
          </button>
          )}

          {!collapsed && (
            <h3 style={{ margin: 0, color: t.text, fontSize: '0.9rem', whiteSpace: 'nowrap', fontWeight: 600 }}>
              最近問診
            </h3>
          )}
        </div>

        {!collapsed && (
          <button
            onClick={onNewChat}
            style={{
              backgroundColor: t.userBubble, color: '#ffffff', border: 'none',
              borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
              whiteSpace: 'nowrap'
            }}
          >
            新問診
          </button>
        )}
      </div>

      {/* 列表區塊 */}
      {collapsed ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', marginTop: '10px' }}>
          <button
            onClick={onNewChat}
            title="開啟新問診"
            style={{
              border: 'none', backgroundColor: t.userBubble, color: '#ffffff',
              borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer',
              fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            ＋
          </button>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {user?.is_guest ? (
            <div style={{ padding: '12px', backgroundColor: t.subtle, borderRadius: '8px', fontSize: '0.82rem', color: t.muted, lineHeight: '1.6' }}>
              <strong style={{ color: t.text, fontWeight: 600 }}>訪客模式中</strong><br />登入會員後即可自動保存、隨時檢視歷史問診紀錄。
            </div>
          ) : loading ? (
            <div style={{ color: t.muted, fontSize: '0.85rem', textAlign: 'center', padding: '20px 0' }}>載入歷史紀錄中...</div>
          ) : historyList.length === 0 ? (
            <div style={{ color: t.muted, fontSize: '0.85rem', textAlign: 'center', padding: '20px 0' }}>尚無對話紀錄</div>
          ) : (
            historyList.map(session => (
              <div 
                key={session.id}
                onClick={() => onSelectSession(session)}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  backgroundColor: t.panel,
                  border: `1px solid ${t.border}`,
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
                        borderRadius: '6px', border: `1px solid ${t.userBubble}`, outline: 'none'
                      }}
                    />
                    <button onClick={(e) => handleSaveTitle(e, session.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.9rem' }} title="確定"><Icon path={mdiCheck} size="1rem" /></button>
                    <button onClick={handleCancelEdit} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.9rem' }} title="取消"><Icon path={mdiClose} size="1rem" /></button>
                  </div>
                ) : (
                  /* 💬 情況 B：正常顯示標題 (修正：優先讀取 session.title) */
                  <>
                    <div style={{ overflow: 'hidden', flex: 1, paddingRight: '6px' }}>
                      <div style={{ fontWeight: 500, color: t.text, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {session.title || session.symptom_text || '未命名問診'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: t.muted, marginTop: '3px' }}>
                        {session.created_at}
                      </div>
                    </div>

                    {/* 操作按鈕群：重命名與刪除 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button 
                        onClick={(e) => handleStartEdit(e, session)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: t.muted, fontSize: '0.85rem', padding: '2px' }}
                        title="重命名"
                      >
                        <Icon path={mdiPencilOutline} size="1rem" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, session.id)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: t.muted, fontSize: '0.85rem', padding: '2px' }}
                        title="刪除紀錄"
                      >
                        <Icon path={mdiClose} size="1rem" />
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