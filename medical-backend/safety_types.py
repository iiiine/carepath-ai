"""
Safety Layer 三態契約。

這個檔案是批次 C 兩人分工的交界，本身不含任何判斷邏輯、
不碰資料庫、不碰 FastAPI、不呼叫任何模型。

    A（判斷語意）  實作組合子，改寫 safety_engine.py 的 20 條規則
    B（資料流動）  只 import，負責把合併後的 FlagStates 餵進引擎

雙方都不得單方面修改本檔案的簽章與回傳結構。
要改，兩人一起改，並同步更新 SAFETY_ENGINE_VERSION。
"""

from enum import Enum

from typing import (
    Any,
    Dict,
    List,
    Mapping,
    Protocol,
)


# ============================================================
# 版本
#
# 組合子的真值表屬於規則邏輯的一部分，
# 因此不另設版本常數，一律隨 SAFETY_ENGINE_VERSION 走。
# 改動本檔案的語意時記得更新該常數。
# ============================================================


# ============================================================
# 症狀旗標三態
#
# 「沒提到」與「明確否認」必須分開，預設一律 unknown。
# 這三個值會進 jsonb 欄位與 API 回應，因此維持純字串。
# ============================================================

STATE_PRESENT = "present"
STATE_ABSENT = "absent"
STATE_UNKNOWN = "unknown"


VALID_STATES = (
    STATE_PRESENT,
    STATE_ABSENT,
    STATE_UNKNOWN,
)


# 旗標名稱 → 三態值
FlagStates = Mapping[str, str]


def normalize_state(
    value: Any,
) -> str:
    """
    把任意輸入收斂成三態之一。

    這是安全不變量，不是邏輯：
    無法辨識的值一律視為 unknown，**絕不可以退回 absent**。
    「沒有完成評估」不等於「沒有危險」。
    """

    if isinstance(
        value,
        str,
    ):

        normalized = (
            value
            .strip()
            .lower()
        )

        if normalized in VALID_STATES:
            return normalized


    return STATE_UNKNOWN


def normalize_flag_states(
    raw_states: Mapping[str, Any] | None,
) -> Dict[str, str]:
    """把整包旗標收斂成三態。缺值的鍵不補，由 has() 當成 unknown 處理。"""

    if not raw_states:
        return {}


    return {
        str(key): normalize_state(value)
        for key, value in raw_states.items()
    }


# ============================================================
# 規則求值結果
#
# 刻意不用 bool，也不用 Optional[bool]。
#
# 這一層被壓成布林正是批次 C 要修的 bug：
# unknown 被當成 False，導致「沒問過」與「已否認」無法區分，
# 而且方向是往「不升級」倒，與 fail-safe 原則相反。
#
# 因此 __bool__ 直接拋例外 —— 任何 `if result:` 這種寫法
# 都會當場炸掉，而不是安靜地給出錯的答案。
# ============================================================

class Truth(str, Enum):

    TRUE = "T"
    FALSE = "F"
    UNKNOWN = "U"


    def __bool__(self):

        raise TypeError(
            "Truth 不可直接當布林使用。"
            "請明確比對 Truth.TRUE / Truth.FALSE / Truth.UNKNOWN，"
            "或使用 t_and() / t_or() 組合。"
        )


# ============================================================
# 組合子
#
# 以下六個函式由 A 在階段 1 實作，階段 0 只定簽章。
#
# 真值表（實作必須完全符合，A 的 smoke test 要涵蓋全部組合）：
#
#   has(flags, key)
#       present            → TRUE
#       absent             → FALSE
#       unknown / 不存在   → UNKNOWN
#
#   any_of(flags, *keys)
#       任一為 TRUE        → TRUE
#       全部為 FALSE       → FALSE
#       其餘                → UNKNOWN
#
#   all_of(flags, *keys)
#       全部為 TRUE        → TRUE
#       任一為 FALSE       → FALSE
#       其餘                → UNKNOWN
#
#   t_and(*truths)
#       任一為 FALSE       → FALSE      （FALSE 有短路權）
#       全部為 TRUE        → TRUE
#       其餘                → UNKNOWN
#
#   t_or(*truths)
#       任一為 TRUE        → TRUE       （TRUE 有短路權）
#       全部為 FALSE       → FALSE
#       其餘                → UNKNOWN
#
# 關鍵在於 FALSE 的短路權：
# 使用者「明確否認」就是不命中，不會被拖進待確認、不會產生追問。
# 這正是現行布林版本做不到的區分。
#
# 刻意不提供 t_not()：
# 現行 20 條規則沒有任何一條使用否定，
# 而三值邏輯的否定語意（not UNKNOWN 是什麼？）需要另外討論。
# 真的有需要時再一起加，不要單方面補。
# ============================================================

def has(
    flags: FlagStates,
    key: str,
) -> Truth:

    raise NotImplementedError(
        "階段 1 由 A 實作"
    )


def any_of(
    flags: FlagStates,
    *keys: str,
) -> Truth:

    raise NotImplementedError(
        "階段 1 由 A 實作"
    )


def all_of(
    flags: FlagStates,
    *keys: str,
) -> Truth:

    raise NotImplementedError(
        "階段 1 由 A 實作"
    )


def t_and(
    *truths: Truth,
) -> Truth:

    raise NotImplementedError(
        "階段 1 由 A 實作"
    )


def t_or(
    *truths: Truth,
) -> Truth:

    raise NotImplementedError(
        "階段 1 由 A 實作"
    )


# ============================================================
# 引擎回傳結構
#
# 既有欄位一律不動（risk_level、red_flags、should_stop_normal_flow、
# has_red_flags、matched_rule_count、safety_action、engine_version），
# 本批次只新增 indeterminate_rules。
#
# 這樣既有的 build_safety_model() 與三端欄位都不需要改，
# 已上架的 APK 也不受影響 —— 它會忽略不認得的新欄位。
# ============================================================

# 「若 swing_set 裡的 unknown 變成 present，這條規則就會成立」
#
# swing_set 是追問的依據：B 只問這些旗標，不會把所有 unknown 問一遍。
IndeterminateRule = Dict[str, Any]
#   {
#       "code":       str,          # 規則代碼，例：HIGH_RISK_HEAD_INJURY
#       "risk_level": str,          # 該規則的風險層級
#       "swing_set":  List[str],    # 會讓此規則翻成 TRUE 的旗標名稱
#   }


EngineResult = Dict[str, Any]
#   既有欄位 + "indeterminate_rules": List[IndeterminateRule]


class SafetyEngineCallable(Protocol):
    """
    引擎入口的形狀。

    B 在階段 1 用假引擎開發管線時，可以宣告自己的 stub 符合這個 Protocol，
    確保接上 A 的真實作時不會對不起來。

    注意輸入已經是「合併後」的三態旗標：
    引擎不負責跨輪合併、不讀資料庫、不知道 conversation_id 的存在。
    """

    def __call__(
        self,
        flag_states: FlagStates,
    ) -> EngineResult:
        ...


__all__ = [
    "STATE_PRESENT",
    "STATE_ABSENT",
    "STATE_UNKNOWN",
    "VALID_STATES",
    "FlagStates",
    "normalize_state",
    "normalize_flag_states",
    "Truth",
    "has",
    "any_of",
    "all_of",
    "t_and",
    "t_or",
    "IndeterminateRule",
    "EngineResult",
    "SafetyEngineCallable",
]


# ============================================================
# 契約自我檢查
#
# 這裡只驗「契約本身」是否成立，不驗任何規則邏輯。
# 規則的 smoke test 在 safety_engine.py 內。
# ============================================================

if __name__ == "__main__":

    # 三態收斂：無法辨識一律 unknown，不可退回 absent
    assert normalize_state("present") == STATE_PRESENT
    assert normalize_state("ABSENT") == STATE_ABSENT
    assert normalize_state("沒填") == STATE_UNKNOWN
    assert normalize_state(None) == STATE_UNKNOWN
    assert normalize_state(False) == STATE_UNKNOWN
    assert normalize_state(0) == STATE_UNKNOWN

    assert normalize_flag_states(None) == {}
    assert normalize_flag_states(
        {"chest_pain": "present", "fainting": "?"}
    ) == {
        "chest_pain": STATE_PRESENT,
        "fainting": STATE_UNKNOWN,
    }

    # Truth 不可被當成布林使用
    for truth in (
        Truth.TRUE,
        Truth.FALSE,
        Truth.UNKNOWN,
    ):

        try:
            bool(truth)

        except TypeError:
            pass

        else:
            raise AssertionError(
                "Truth.__bool__ 應該拋 TypeError"
            )

    # 可以序列化成 JSON 友善的字串
    assert Truth.UNKNOWN.value == "U"
    assert Truth.TRUE == "T"

    print("✅ safety_types 契約檢查通過")
