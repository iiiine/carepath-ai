# eval/eval_safety.py
#
# 安全分級評測：同一批案例，比較三個系統。
#
#   carepath        正式的 Safety Pipeline：抽取三態旗標 → 規則引擎，再加 AI 安全網（只能升級）
#   carepath_rules  同上但關掉安全網，量「只有規則」的表現
#   llm_only        對照組：直接請同一個 Gemini 判斷緊急程度，不經規則引擎
#
# llm_only 呼叫的就是正式的 safety_llm_net.run_safety_net（同一份 prompt），
# 只是 temperature 用模型預設值，模擬一般人直接問 AI 的情況。
#
# 執行（在 backend/ 底下）：
#
#   & $py eval/eval_safety.py --system carepath --repeats 5
#   & $py eval/eval_safety.py --system carepath_rules --repeats 5
#   & $py eval/eval_safety.py --system llm_only --repeats 5
#
# ⚠️ 會實際呼叫 Gemini：案例數 × repeats 次（carepath 每次兩個呼叫）。

import argparse
import contextlib
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional

import eval_common as ec

from services import GEMINI_MODEL_NAME
from safety_pipeline import run_safety_pipeline, SAFETY_PIPELINE_VERSION
from safety_engine import SAFETY_ENGINE_VERSION
from safety_llm_net import run_safety_net, SAFETY_NET_VERSION
from symptom_flag_extractor import SYMPTOM_EXTRACTOR_VERSION


DEFAULT_CASES = ec.EVAL_DIR / "cases" / "safety_cases.csv"

REQUIRED_COLUMNS = (
    "id",
    "text",
    "expected_risk",
)


# ============================================================
# CarePath Safety Pipeline（含／不含 AI 安全網）
# ============================================================

def _predict_pipeline(
    case: Dict[str, str],
    use_safety_net: bool,
) -> Dict[str, Any]:

    started = time.perf_counter()

    result = run_safety_pipeline(
        symptom_text=case["text"],
        history=ec.parse_history(case.get("history", "")),
        use_safety_net=use_safety_net,
    )

    net = result.get("safety_net") or {}

    return {
        "predicted_risk": result["risk_level"],
        "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        "technical_failure": result["technical_failure"],
        "rule_risk": result.get("rule_risk_level") or "",
        "net_status": net.get("status", ""),
        "net_risk": net.get("risk_level", ""),
        "net_escalated": bool(net.get("escalated")),
        "matched_rules": ";".join(
            rule["code"]
            for rule in result.get("red_flags", [])
        ),
        "present_flags": ";".join(result.get("present_flags", [])),
        "indeterminate_rules": ";".join(
            rule["code"]
            for rule in result.get("indeterminate_rules", [])
        ),
        "reason": net.get("reason", ""),
    }


def predict_carepath(
    case: Dict[str, str],
    temperature: Optional[float],
) -> Dict[str, Any]:
    """temperature 對這個系統無效：正式流程的兩個模型呼叫都固定 temperature=0。"""

    return _predict_pipeline(case, use_safety_net=True)


def predict_carepath_rules(
    case: Dict[str, str],
    temperature: Optional[float],
) -> Dict[str, Any]:

    return _predict_pipeline(case, use_safety_net=False)


# ============================================================
# 對照組：直接問 LLM
# ============================================================

def predict_llm_only(
    case: Dict[str, str],
    temperature: Optional[float],
) -> Dict[str, Any]:

    started = time.perf_counter()

    result = run_safety_net(
        case["text"],
        ec.parse_history(case.get("history", "")),
        temperature=temperature,
        max_retries=5,
    )

    return {
        "predicted_risk": result["risk_level"],
        "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        "technical_failure": False,
        "matched_rules": "",
        "present_flags": "",
        "indeterminate_rules": "",
        "reason": result["reason"],
    }


SYSTEMS = {
    "carepath": predict_carepath,
    "carepath_rules": predict_carepath_rules,
    "llm_only": predict_llm_only,
}


# ============================================================
# 執行
# ============================================================

def run_one(
    system: str,
    case: Dict[str, str],
    repeat: int,
    temperature: Optional[float],
) -> Dict[str, Any]:

    try:
        prediction = SYSTEMS[system](case, temperature)

    except Exception as exc:
        # llm_only 失敗時記成 unknown，與 carepath 的 fail-safe 同樣計算，
        # 不可以默默跳過 —— 跳過會讓失敗多的系統看起來比較準。
        prediction = {
            "predicted_risk": "unknown",
            "latency_ms": None,
            "technical_failure": True,
            "matched_rules": "",
            "present_flags": "",
            "indeterminate_rules": "",
            "reason": f"{type(exc).__name__}: {exc}"[:300],
        }

    return {
        "id": case["id"],
        "repeat": repeat,
        "category": case.get("category", ""),
        "expected_risk": case["expected_risk"],
        **prediction,
        "text": case["text"],
    }


# ============================================================
# 指標
# ============================================================

def triage_direction(
    expected: str,
    predicted: str,
) -> str:

    if predicted == "unknown":
        return "unknown"

    diff = ec.RISK_ORDER[predicted] - ec.RISK_ORDER[expected]

    if diff == 0:
        return "correct"

    return "over" if diff > 0 else "under"


def summarize_predictions(
    rows: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """一組「每案一筆」的預測 → 指標。"""

    n = len(rows)
    directions = Counter(
        triage_direction(r["expected_risk"], r["predicted_risk"])
        for r in rows
    )

    emergency_rows = [r for r in rows if r["expected_risk"] == "emergency"]
    urgent_plus_rows = [r for r in rows if r["expected_risk"] in {"urgent", "emergency"}]
    standard_rows = [r for r in rows if r["expected_risk"] == "standard"]

    confusion = {
        expected: {
            predicted: sum(
                1
                for r in rows
                if r["expected_risk"] == expected and r["predicted_risk"] == predicted
            )
            for predicted in (*ec.RISK_LEVELS, "unknown")
        }
        for expected in ec.RISK_LEVELS
    }

    by_category = defaultdict(list)

    for r in rows:
        by_category[r["category"] or "（未分類）"].append(r)

    return {
        "accuracy": ec.rate(directions["correct"], n),

        # 主要安全指標：該叫救護車的有沒有叫
        "emergency_sensitivity": ec.rate(
            sum(1 for r in emergency_rows if r["predicted_risk"] == "emergency"),
            len(emergency_rows),
        ),

        # 寬鬆版：至少提醒要儘快就醫
        "urgent_or_above_sensitivity": ec.rate(
            sum(
                1
                for r in urgent_plus_rows
                if r["predicted_risk"] in {"urgent", "emergency"}
            ),
            len(urgent_plus_rows),
        ),

        "under_triage": ec.rate(directions["under"], n),
        "over_triage": ec.rate(directions["over"], n),

        # 一般案例被誇大成需要儘快或緊急就醫的比例（過度醫療化的代價）
        "standard_over_triage": ec.rate(
            sum(1 for r in standard_rows if r["predicted_risk"] in {"urgent", "emergency"}),
            len(standard_rows),
        ),

        "technical_failure": ec.rate(directions["unknown"], n),
        "confusion": confusion,
        "accuracy_by_category": {
            category: ec.rate(
                sum(
                    1
                    for r in items
                    if r["predicted_risk"] == r["expected_risk"]
                ),
                len(items),
            )
            for category, items in sorted(by_category.items())
        },
    }


def worst_case_rows(
    rows_by_case: Dict[str, List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    """
    每個案例取 repeats 次中「最危險」的一次：

    1. 判太輕（under）最差，取最輕的那次
    2. 否則有技術失敗就取 unknown
    3. 否則取判太重的那次

    用來回答「同一句話問 5 次，只要有一次漏判就算漏判」。
    """

    def badness(r):
        direction = triage_direction(r["expected_risk"], r["predicted_risk"])

        if direction == "under":
            return (3, -ec.RISK_ORDER[r["predicted_risk"]])

        return {
            "unknown": (2, 0),
            "over": (1, 0),
            "correct": (0, 0),
        }[direction]

    return [
        max(items, key=badness)
        for items in rows_by_case.values()
    ]


def flag_recall(
    cases: List[Dict[str, str]],
    first_rows: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """
    expected_present_flags 有填的案例才算：
    該抽到 present 的旗標，抽取器抽到了幾個。
    """

    by_id = {r["id"]: r for r in first_rows}
    hit = total = 0
    missed: Counter = Counter()

    for case in cases:
        expected = ec.split_multi(case.get("expected_present_flags", ""))

        if not expected:
            continue

        got = set(ec.split_multi(by_id[case["id"]]["present_flags"]))

        for flag in expected:
            total += 1

            if flag in got:
                hit += 1
            else:
                missed[flag] += 1

    if not total:
        return None

    return {
        "recall": ec.rate(hit, total),
        "most_missed": missed.most_common(10),
    }


# ============================================================
# 報告用 Markdown
# ============================================================

def render_markdown(
    summary: Dict[str, Any],
) -> str:

    meta = summary["meta"]
    lines = [
        f"# 安全分級評測：{meta['system']}",
        "",
        f"- 執行時間：{meta['run_at']}",
        f"- 案例：{meta['case_count']} 筆（{meta['cases_file']}），每案 {meta['repeats']} 次",
        f"- 模型：{meta['model']}，temperature：{meta['temperature']}",
        f"- 版本：pipeline {meta['pipeline_version']}／engine {meta['engine_version']}／extractor {meta['extractor_version']}",
        "",
    ]

    sections = [("第 1 次執行", summary["first_run"])]

    if summary.get("worst_case"):
        sections.append(("最差情況（每案取 repeats 次中最危險的一次）", summary["worst_case"]))

    for title, s in sections:
        lines += [
            f"## {title}",
            "",
            "| 指標 | 結果 |",
            "|---|---|",
            f"| 完全正確率 | {ec.fmt_rate(s['accuracy'])} |",
            f"| **急症偵測率**（emergency 判為 emergency） | {ec.fmt_rate(s['emergency_sensitivity'])} |",
            f"| 至少提醒儘快就醫（urgent 以上判為 urgent 以上） | {ec.fmt_rate(s['urgent_or_above_sensitivity'])} |",
            f"| 判太輕 | {ec.fmt_rate(s['under_triage'])} |",
            f"| 判太重 | {ec.fmt_rate(s['over_triage'])} |",
            f"| 一般案例被判為需儘快／緊急就醫 | {ec.fmt_rate(s['standard_over_triage'])} |",
            f"| 技術失敗（unknown） | {ec.fmt_rate(s['technical_failure'])} |",
            "",
            "混淆矩陣（列＝正確答案，欄＝系統判斷）：",
            "",
            "| | standard | urgent | emergency | unknown |",
            "|---|---|---|---|---|",
        ]

        for expected, row in s["confusion"].items():
            lines.append(
                f"| {expected} | "
                + " | ".join(str(row[p]) for p in (*ec.RISK_LEVELS, "unknown"))
                + " |"
            )

        lines.append("")

    if summary.get("consistency"):
        lines += [
            "## 重複執行一致性",
            "",
            f"- {summary['meta']['repeats']} 次結果完全相同的案例：{ec.fmt_rate(summary['consistency'])}",
            "",
        ]

    if summary.get("safety_net"):
        net = summary["safety_net"]
        lines += [
            "## AI 安全網（第 1 次執行）",
            "",
            f"- 升級次數：{ec.fmt_rate(net['escalated'])}",
            f"- 升級後等級正確：{net['escalated_correct']}；升級後判太重：{net['escalated_over']}",
            f"- 安全網狀態（全部執行）：{net['status']}",
            "",
        ]

    if summary.get("flag_recall"):
        fr = summary["flag_recall"]
        lines += [
            "## 抽取器旗標召回率",
            "",
            f"- {ec.fmt_rate(fr['recall'])}",
            f"- 最常漏抽：{fr['most_missed']}",
            "",
        ]

    lines += [
        "## 依類別的完全正確率（第 1 次執行）",
        "",
        "| 類別 | 結果 |",
        "|---|---|",
    ]

    for category, r in summary["first_run"]["accuracy_by_category"].items():
        lines.append(f"| {category} | {ec.fmt_rate(r)} |")

    latency = summary["latency"]

    if latency.get("n"):
        lines += [
            "",
            "## 延遲",
            "",
            f"- p50 {latency['p50_ms']} ms／p95 {latency['p95_ms']} ms／最大 {latency['max_ms']} ms（{latency['n']} 次呼叫）",
        ]

    if summary["misses"]:
        lines += [
            "",
            "## 判太輕的案例（第 1 次執行，需逐案檢討）",
            "",
            "| id | 正確 | 系統 | 命中規則 | 描述 |",
            "|---|---|---|---|---|",
        ]

        for r in summary["misses"]:
            lines.append(
                f"| {r['id']} | {r['expected_risk']} | {r['predicted_risk']} "
                f"| {r['matched_rules'] or '—'} | {r['text'][:60]} |"
            )

    return "\n".join(lines) + "\n"


# ============================================================
# Main
# ============================================================

def main():

    parser = argparse.ArgumentParser(description="CarePath 安全分級評測")
    parser.add_argument("--system", choices=sorted(SYSTEMS), required=True)
    parser.add_argument("--cases", default=str(DEFAULT_CASES))
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--limit", type=int, default=0, help="只跑前 N 筆，試跑用")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument(
        "--temperature",
        type=float,
        default=None,
        help="只影響 llm_only；不給就用模型預設值，模擬一般人直接問 AI 的情況",
    )
    parser.add_argument("--resume", help="接續先前中斷的結果資料夾，已完成的不重跑")
    parser.add_argument("--retry-failures", action="store_true", help="接續時把技術失敗的列重跑")
    args = parser.parse_args()

    cases_path = ec.Path(args.cases)
    cases = ec.load_cases(cases_path, REQUIRED_COLUMNS)

    bad = [c["id"] for c in cases if c["expected_risk"] not in ec.RISK_ORDER]

    if bad:
        raise SystemExit(f"❌ expected_risk 只能是 {ec.RISK_LEVELS}，有問題的 id：{bad}")

    if args.limit:
        cases = cases[: args.limit]

    jobs = [
        (case, repeat)
        for repeat in range(1, args.repeats + 1)
        for case in cases
    ]

    run_dir = ec.open_run_dir(f"safety_{args.system}", args.resume)

    wanted = {(case["id"], repeat) for case, repeat in jobs}
    rows: List[Dict[str, Any]] = [
        r
        for r in ec.load_checkpoint(run_dir, args.retry_failures)
        if (r["id"], r["repeat"]) in wanted
    ]
    finished = {(r["id"], r["repeat"]) for r in rows}
    jobs = [(case, repeat) for case, repeat in jobs if (case["id"], repeat) not in finished]

    print(f"🧪 {args.system}：{len(cases)} 案 × {args.repeats} 次，已完成 {len(rows)}，剩 {len(jobs)} 次呼叫")
    print(f"   結果資料夾：{run_dir}（中斷後用 --resume 這個路徑接續）")

    # pipeline 每次都會印效能 log，評測時整段導到 console.log。
    # redirect_stdout 換的是全域 sys.stdout，不可以在各執行緒裡各自包，
    # 所以包在整個 pool 外面，進度訊息直接寫 sys.__stdout__。
    with open(run_dir / "console.log", "a", encoding="utf-8") as console, \
            contextlib.redirect_stdout(console), \
            ThreadPoolExecutor(max_workers=args.workers) as pool:

        futures = [
            pool.submit(run_one, args.system, case, repeat, args.temperature)
            for case, repeat in jobs
        ]

        # 依完成順序收：每筆一完成就落檔，被中止時最多只損失還在跑的幾筆
        for done, future in enumerate(as_completed(futures), start=1):
            row = future.result()
            rows.append(row)
            ec.append_checkpoint(run_dir, row)

            if done % 10 == 0 or done == len(futures):
                print(f"   {done}/{len(futures)}", file=sys.__stdout__, flush=True)

    rows.sort(key=lambda r: (r["repeat"], r["id"]))

    rows_by_case: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    for r in rows:
        rows_by_case[r["id"]].append(r)

    first_rows = [r for r in rows if r["repeat"] == 1]

    summary: Dict[str, Any] = {
        "meta": {
            "system": args.system,
            "run_at": ec.datetime.now().isoformat(timespec="seconds"),
            "cases_file": cases_path.name,
            "case_count": len(cases),
            "repeats": args.repeats,
            "model": GEMINI_MODEL_NAME,
            "temperature": (
                "0（正式流程固定值）"
                if args.system.startswith("carepath")
                else args.temperature if args.temperature is not None else "模型預設"
            ),
            "pipeline_version": SAFETY_PIPELINE_VERSION,
            "engine_version": SAFETY_ENGINE_VERSION,
            "extractor_version": SYMPTOM_EXTRACTOR_VERSION,
            "safety_net_version": SAFETY_NET_VERSION,
        },
        "first_run": summarize_predictions(first_rows),
        "latency": ec.latency_summary(r["latency_ms"] for r in rows),
        "misses": [
            r
            for r in first_rows
            if triage_direction(r["expected_risk"], r["predicted_risk"]) == "under"
        ],
    }

    if args.repeats > 1:
        summary["worst_case"] = summarize_predictions(worst_case_rows(rows_by_case))
        summary["consistency"] = ec.rate(
            sum(
                1
                for items in rows_by_case.values()
                if len({r["predicted_risk"] for r in items}) == 1
            ),
            len(rows_by_case),
        )

    if args.system.startswith("carepath"):
        summary["flag_recall"] = flag_recall(cases, first_rows)
        summary["rule_hits"] = Counter(
            code
            for r in first_rows
            for code in ec.split_multi(r["matched_rules"])
        ).most_common()

    if args.system == "carepath":
        # 安全網的貢獻：升級了幾次、升對幾次、升錯（判太重）幾次、失敗幾次
        escalated = [r for r in first_rows if r["net_escalated"]]

        summary["safety_net"] = {
            "escalated": ec.rate(len(escalated), len(first_rows)),
            "escalated_correct": sum(
                1 for r in escalated if r["predicted_risk"] == r["expected_risk"]
            ),
            "escalated_over": sum(
                1
                for r in escalated
                if triage_direction(r["expected_risk"], r["predicted_risk"]) == "over"
            ),
            "status": dict(Counter(r["net_status"] for r in rows)),
        }

    ec.write_csv(rows, run_dir / "predictions.csv")
    ec.write_json(summary, run_dir / "summary.json")
    (run_dir / "summary.md").write_text(render_markdown(summary), encoding="utf-8")

    s = summary["first_run"]
    print()
    print(f"✅ 完成，結果在 {run_dir}")
    print(f"   急症偵測率   {ec.fmt_rate(s['emergency_sensitivity'])}")
    print(f"   判太輕       {ec.fmt_rate(s['under_triage'])}")
    print(f"   完全正確率   {ec.fmt_rate(s['accuracy'])}")

    if summary.get("consistency"):
        print(f"   重複一致性   {ec.fmt_rate(summary['consistency'])}")


if __name__ == "__main__":
    main()
