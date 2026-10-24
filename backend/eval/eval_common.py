# eval/eval_common.py
#
# 評測腳本共用工具：讀案例、算信賴區間、輸出結果。
#
# 評測腳本只量測，不修改任何正式流程，也不寫資料庫。

import csv
import json
import math
import statistics
import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, Iterable, List, Optional, Sequence


EVAL_DIR = Path(__file__).resolve().parent
BACKEND_DIR = EVAL_DIR.parent

# 讓 eval/ 底下的腳本能 import 後端根目錄的模組
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Git Bash 的主控台是 cp950，印 emoji 會直接 UnicodeEncodeError 中止評測
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")


# ============================================================
# 風險等級
#
# unknown 不在序位裡：它代表「沒完成評估」，
# 不是比 standard 更低或比 emergency 更高的等級，統計時另外計。
# ============================================================

RISK_LEVELS = (
    "standard",
    "urgent",
    "emergency",
)

RISK_ORDER = {
    level: index
    for index, level in enumerate(RISK_LEVELS)
}


# ============================================================
# 讀案例
# ============================================================

def load_cases(
    path: Path,
    required_columns: Sequence[str],
) -> List[Dict[str, str]]:
    """
    讀 UTF-8 CSV（Excel 存的 UTF-8 BOM 也可以）。

    缺必要欄位、id 重複、必要欄位空白都直接中止 ——
    案例集有問題時跑出來的數字沒有意義，不如早點炸。
    """

    with open(
        path,
        encoding="utf-8-sig",
        newline="",
    ) as f:
        reader = csv.DictReader(f)
        columns = reader.fieldnames or []

        missing = [
            column
            for column in required_columns
            if column not in columns
        ]

        if missing:
            raise SystemExit(
                f"❌ {path.name} 缺少欄位：{missing}"
            )

        cases = [
            {
                key: (value or "").strip()
                for key, value in row.items()
                if key
            }
            for row in reader
        ]

    seen = set()

    for line_no, case in enumerate(cases, start=2):

        for column in required_columns:
            if not case.get(column):
                raise SystemExit(
                    f"❌ {path.name} 第 {line_no} 行的 {column} 是空的"
                )

        if case["id"] in seen:
            raise SystemExit(
                f"❌ {path.name} 的 id 重複：{case['id']}"
            )

        seen.add(case["id"])

    return cases


def split_multi(
    value: str,
) -> List[str]:
    """把 `a;b；c` 拆成清單，全形分號也接受。"""

    return [
        part.strip()
        for part in value.replace("；", ";").split(";")
        if part.strip()
    ]


def parse_history(
    value: str,
) -> List[SimpleNamespace]:
    """
    history 欄位：多則先前的使用者訊息用 `||` 隔開。

    只模擬使用者先前說過的話，不模擬 AI 回覆 ——
    案例集的重點是「使用者說了什麼」，AI 中間問了什麼不影響安全判斷的輸入。
    """

    return [
        SimpleNamespace(
            role="user",
            content=part.strip(),
        )
        for part in (value or "").split("||")
        if part.strip()
    ]


# ============================================================
# 統計
# ============================================================

def wilson_interval(
    successes: int,
    total: int,
    z: float = 1.96,
) -> Optional[tuple]:
    """
    比例的 95% Wilson 信賴區間。

    案例數只有一兩百筆，用常態近似在比例接近 100% 時會失真
    （例如 50/50 會算出 [100%, 100%]），Wilson 區間不會。
    """

    if total == 0:
        return None

    p = successes / total
    denom = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denom
    half = (
        z
        * math.sqrt(
            p * (1 - p) / total
            + z * z / (4 * total * total)
        )
        / denom
    )

    return (
        max(0.0, center - half),
        min(1.0, center + half),
    )


def rate(
    successes: int,
    total: int,
) -> Dict[str, Any]:
    """比例＋信賴區間，輸出成 JSON 友善的格式。"""

    interval = wilson_interval(successes, total)

    return {
        "k": successes,
        "n": total,
        "rate": (
            round(successes / total, 4)
            if total
            else None
        ),
        "ci95": (
            [round(interval[0], 4), round(interval[1], 4)]
            if interval
            else None
        ),
    }


def fmt_rate(
    r: Dict[str, Any],
) -> str:
    """報告用：`92.0%（46/50，95% CI 81.2–96.9%）`"""

    if not r["n"]:
        return "—（無案例）"

    low, high = r["ci95"]

    return (
        f"{r['rate'] * 100:.1f}%"
        f"（{r['k']}/{r['n']}，"
        f"95% CI {low * 100:.1f}–{high * 100:.1f}%）"
    )


def latency_summary(
    values_ms: Iterable[float],
) -> Dict[str, Any]:

    values = sorted(
        v
        for v in values_ms
        if v is not None
    )

    if not values:
        return {"n": 0}

    def pct(q):
        # 最近秩法，小樣本也不會內插出不存在的值
        index = max(
            0,
            math.ceil(q * len(values)) - 1,
        )
        return round(values[index], 1)

    return {
        "n": len(values),
        "p50_ms": pct(0.50),
        "p95_ms": pct(0.95),
        "mean_ms": round(statistics.mean(values), 1),
        "max_ms": round(values[-1], 1),
    }


# ============================================================
# 輸出
# ============================================================

def make_run_dir(
    name: str,
) -> Path:
    """每次執行一個資料夾：eval/results/20261025-142233_safety_carepath/"""

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = EVAL_DIR / "results" / f"{stamp}_{name}"
    run_dir.mkdir(parents=True, exist_ok=True)

    return run_dir


def write_csv(
    rows: List[Dict[str, Any]],
    path: Path,
) -> None:
    """utf-8-sig：讓 Excel 直接打開不會亂碼，Robin、Jason 要看。"""

    if not rows:
        return

    columns: List[str] = []

    for row in rows:
        for key in row:
            if key not in columns:
                columns.append(key)

    with open(
        path,
        "w",
        encoding="utf-8-sig",
        newline="",
    ) as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def write_json(
    data: Any,
    path: Path,
) -> None:

    path.write_text(
        json.dumps(
            data,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
