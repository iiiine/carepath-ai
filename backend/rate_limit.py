"""
行程內速率限制。

用途是擋住「匿名端點被反覆呼叫」這類成本與資料汙染問題 ——
/guest-login 每呼叫一次就往 users 塞一列，而每個 guest 都能打 /diagnose
直接消耗 Gemini 額度。

刻意不引入 slowapi 之類的相依：

  - Render 免費方案就是單一實例，行程內計數已經是準確的。
  - 多開實例之後這層會變成「每個實例各算各的」，
    真正要跨實例限流得把計數移到 Redis 或資料庫。
    這個限制寫在這裡，不要讓它變成靜默的假保護。

純標準函式庫、無外部相依，因此可以不碰網路直接測。
"""

import os
import threading
import time

from collections import deque
from typing import Deque, Dict, Optional, Tuple


# ============================================================
# 版本
#
# 限流參數屬於對外行為的一部分，調整時一併遞增，
# 事後看 log 才知道當時跑的是哪一組設定。
# ============================================================

RATE_LIMIT_VERSION = "2026.09.1"


class RateLimiter:
    """
    滑動視窗計數器。

    每個 key（通常是來源 IP）記住視窗內的請求時間戳，
    超過上限就拒絕，並回報還要等多久才會放行。
    """

    def __init__(
        self,
        max_requests: int,
        window_seconds: float,
    ) -> None:

        if max_requests < 1:
            raise ValueError(
                "max_requests 必須至少為 1"
            )

        if window_seconds <= 0:
            raise ValueError(
                "window_seconds 必須為正數"
            )

        self.max_requests = max_requests
        self.window_seconds = window_seconds

        self._hits: Dict[str, Deque[float]] = {}

        # key 數量超過這個值才做清理。每次請求都掃一遍是浪費，
        # 而在到達門檻之前那點記憶體無關緊要。
        self._sweep_threshold = 1024

        # 端點是同步 def（見 CLAUDE.md：不可改 async），
        # FastAPI 會丟到 threadpool，因此這裡會被多執行緒同時進入。
        self._lock = threading.Lock()


    def check(
        self,
        key: str,
        now: Optional[float] = None,
    ) -> Tuple[bool, float]:
        """
        回傳 (是否放行, 建議的 Retry-After 秒數)。

        放行時第二個值是 0.0。只有放行才會記錄這次請求 ——
        被擋掉的請求若也計入，持續重試會讓封鎖無限延長。
        """

        moment = (
            time.monotonic()
            if now is None
            else now
        )

        cutoff = moment - self.window_seconds


        with self._lock:

            bucket = self._hits.setdefault(
                key,
                deque(),
            )


            # 丟掉視窗外的紀錄
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()


            if len(bucket) >= self.max_requests:

                # 最舊的那一筆離開視窗時就會空出名額
                retry_after = (
                    bucket[0]
                    + self.window_seconds
                    - moment
                )

                return False, max(
                    retry_after,
                    0.0,
                )


            bucket.append(
                moment
            )

            self._sweep(
                cutoff
            )

            return True, 0.0


    def _sweep(
        self,
        cutoff: float,
    ) -> None:
        """
        清掉視窗內已無紀錄的 key。

        不清的話每個出現過的來源都會永久留下一個空 deque，
        長時間執行等於把記憶體開放給任何人灌。

        呼叫端必須已持有 self._lock。
        """

        if len(self._hits) < self._sweep_threshold:
            return


        stale = [
            key
            for key, hits in self._hits.items()
            if not hits or hits[-1] <= cutoff
        ]


        for key in stale:
            self._hits.pop(
                key,
                None,
            )


    def reset(self) -> None:
        """清空所有計數。測試用。"""

        with self._lock:
            self._hits.clear()


def client_key(request) -> str:
    """
    取出用來計數的來源識別。

    Render 在應用程式前面有反向代理，request.client.host 會是代理的位址，
    所有人都會被算成同一個 key。因此優先看 X-Forwarded-For 的最左側。

    ⚠️ X-Forwarded-For 是可偽造的標頭，只有在「確實有可信代理會覆寫它」的
       部署環境下才有意義。直接把應用程式曝露在公網時，這層限流可以被繞過。
       這是部署形態的限制，不是這段程式能解決的問題。
    """

    forwarded = (
        request.headers.get(
            "x-forwarded-for"
        )
        or ""
    ).strip()


    if forwarded:
        return forwarded.split(",")[0].strip()


    client = getattr(
        request,
        "client",
        None,
    )


    return getattr(
        client,
        "host",
        None,
    ) or "unknown"


def _positive_int_env(
    name: str,
    default: int,
) -> int:
    """讀取正整數環境變數；格式錯或非正數時退回預設值並說明。"""

    raw = os.getenv(
        name,
        "",
    ).strip()


    if not raw:
        return default


    try:
        value = int(raw)

    except ValueError:
        print(
            f"⚠️ [RateLimit] {name}={raw!r} 不是整數，改用預設值 {default}"
        )
        return default


    if value < 1:
        print(
            f"⚠️ [RateLimit] {name}={value} 不是正數，改用預設值 {default}"
        )
        return default


    return value


# ============================================================
# 訪客登入限流
#
# 預設每個來源每小時 20 次。一般使用者整段流程只會呼叫一次
# （前端在沒有 token 時靜默取得訪客身分），20 次留給重整、
# 換分頁與同一個 NAT 後面的多名使用者。
#
# 決賽現場評審可能全部在同一個出口 IP 後面，所以不宜訂得更緊；
# 真的不夠時用 GUEST_LOGIN_RATE_LIMIT 調大，不必改程式。
# ============================================================

GUEST_LOGIN_MAX_REQUESTS = _positive_int_env(
    "GUEST_LOGIN_RATE_LIMIT",
    20,
)

GUEST_LOGIN_WINDOW_SECONDS = _positive_int_env(
    "GUEST_LOGIN_RATE_WINDOW_SECONDS",
    3600,
)


guest_login_limiter = RateLimiter(
    max_requests=GUEST_LOGIN_MAX_REQUESTS,
    window_seconds=GUEST_LOGIN_WINDOW_SECONDS,
)
