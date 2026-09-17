-- ============================================================
-- consultation_safety_state
--
-- 批次 C：跨輪安全狀態。
--
-- 現行 safety_pipeline 每輪從頭重算風險，伺服器端沒有任何狀態
-- 記著「第 2 輪已經成立過 emergency」；而判斷依據的 history 來自
-- payload.history，是用戶端送什麼就信什麼。
--
-- 這張表就是那個缺少的伺服器端狀態。
--
-- 專案沒有 migration 工具，schema 變更靠手動同步。
-- 本檔為單一事實來源，可重複執行（全部 IF NOT EXISTS）。
--
-- 套用：
--   cd medical-backend
--   & $py schema/apply_schema.py schema/consultation_safety_state.sql
-- ============================================================


CREATE TABLE IF NOT EXISTS consultation_safety_state (

    -- 會送到用戶端再送回來，因此用 uuid 而非序號：
    -- 序號等於讓人可以枚舉別人的對話。
    -- 專案既有的 guest_sessions 也是 gen_random_uuid()。
    id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 只掛正式會員。訪客不做伺服器端跨輪狀態，維持現況每輪重算，
    -- 追問的「已問過」改從用戶端 history 推導 —— 不退步，但也不升級。
    -- 型別對齊 users.id（bigint），不沿用 chat_sessions.user_id 的 integer。
    user_id             bigint       NOT NULL
                                     REFERENCES users(id) ON DELETE CASCADE,

    -- 合併後的三態旗標：{"chest_pain": "present", "fainting": "unknown", ...}
    -- 合併規則見 safety_pipeline，重點是 present 具黏性：
    -- 後續輪次抽不到不會退回 unknown。
    flag_states         jsonb        NOT NULL DEFAULT '{}'::jsonb,

    -- 本對話中已經成立過的規則代碼。
    --
    -- 目前是純稽核欄位，沒有任何程式讀它做判斷。
    -- 跨輪保護實際生效的機制是 flag_states 的 present 黏性：
    -- 旗標不退回 unknown，規則自然會再次命中。
    --
    -- 不要誤以為這裡還有一層 enforcement 接著 ——
    -- 黏性若被改壞，這個欄位不會救你。
    established_rules   jsonb        NOT NULL DEFAULT '[]'::jsonb,

    -- 已經追問過的旗標，避免同一項重複問。
    -- 問過一次仍是 unknown 就不再問，改標記評估未完成。
    asked_flags         jsonb        NOT NULL DEFAULT '[]'::jsonb,

    -- 症狀曾經出現、後來使用者表示已緩解。
    -- 不直接覆蓋成 absent：剛才單側無力現在恢復仍屬高風險（疑似 TIA）。
    resolved_recently   jsonb        NOT NULL DEFAULT '[]'::jsonb,

    -- 產生本狀態的引擎版本。版本不同代表旗標語意可能已改變，
    -- 讀取端應視為不可沿用並重新評估（保守方向）。
    engine_version      text,
    extractor_version   text,

    turn_count          smallint     NOT NULL DEFAULT 0,

    created_at          timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 一次問診對話是短生命週期的東西，不是歷史紀錄。
    -- 過期後回來繼續問會被當成新對話重新評估 ——
    -- 方向保守（重算而非沿用舊狀態），代價是可能重複追問。
    expires_at          timestamptz  NOT NULL
                                     DEFAULT CURRENT_TIMESTAMP + INTERVAL '24 hours'
);


-- 清理過期狀態用。查詢一律以 id（PK）為入口，因此不另建 user_id 索引。
CREATE INDEX IF NOT EXISTS consultation_safety_state_expires_at_idx
    ON consultation_safety_state (expires_at);


COMMENT ON TABLE consultation_safety_state IS
    '批次 C 跨輪安全狀態。僅正式會員；短生命週期，非歷史紀錄。';

COMMENT ON COLUMN consultation_safety_state.flag_states IS
    '合併後的三態旗標，present 具黏性';

COMMENT ON COLUMN consultation_safety_state.resolved_recently IS
    '曾出現後緩解的症狀；不等於 absent，風險未解除';
