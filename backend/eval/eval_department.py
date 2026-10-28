# eval/eval_department.py
#
# 科別建議評測：同一批案例，比較三個系統。
#
#   carepath  正式流程：Safety Pipeline → RAG → 一般問診 prompt → 白名單
#   no_rag    同上，但 RAG 換成「暫無相關衛教知識」，量 RAG 的貢獻
#   keyword   關鍵字對應，代表「沒有 AI」的最簡單做法
#
# prompt 與正式問診共用 consultation_prompt.build_consultation_prompt，
# 白名單共用 routes.diagnose.get_departments —— 量到的就是線上系統。
#
# 與線上流程的差異（刻意簡化，報告裡要寫）：
#   - 一律當訪客，不帶個人健康檔案
#   - 安全評估只跑第一輪；追問的回答是案例集寫好的固定文字，
#     不含新的警訊，每輪重跑只會多花呼叫次數
#
# 執行（在 backend/ 底下）：
#
#   & $py eval/eval_department.py --system carepath
#
# ⚠️ carepath / no_rag 會實際呼叫 Gemini（每案 2～4 次）。

import argparse
import contextlib
import io
import json
import re
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from types import SimpleNamespace
from typing import Any, Dict, List

import eval_common as ec

from services import call_gemini_with_retry, get_rag_context, GEMINI_MODEL_NAME
from safety_pipeline import run_safety_pipeline
from consultation_prompt import build_consultation_prompt
from routes.diagnose import get_departments


DEFAULT_CASES = ec.EVAL_DIR / "cases" / "department_cases.csv"

REQUIRED_COLUMNS = (
    "id",
    "text",
    "expected_departments",
)

# 與 routes/diagnose.py 相同
GUEST_PROFILE_TEXT = "無提供 (訪客或尚未填寫)"
NO_RAG_TEXT = "暫無相關衛教知識"
FALLBACK_DEPARTMENT = "家醫科"

DEFAULT_FOLLOWUP_ANSWER = "沒有其他補充了，請依目前的資訊建議科別。"

# 與 models.py DiagnoseRequest.pain_level 相同：1～5，預設 3
VALID_PAIN_LEVELS = {"1", "2", "3", "4", "5"}
DEFAULT_PAIN_LEVEL = 3


# ============================================================
# 關鍵字對照組
#
# ponytail: 刻意寫得很陽春 —— 它代表的是「沒有 AI 的做法」，
# 調得太聰明反而失去對照的意義。
# ============================================================

KEYWORD_TABLE = {
    "婦產科": ("月經", "經痛", "懷孕", "陰道", "白帶", "分泌物", "子宮", "更年期"),
    "心臟內科": ("心悸", "心跳", "胸悶", "血壓", "胸痛"),
    "牙科": ("牙", "智齒", "蛀"),
    "皮膚科": ("皮膚", "疹", "癢", "痘", "脫皮", "頭皮屑"),
    "眼科": ("眼", "視力", "看不清", "飛蚊"),
    "神經外科": ("椎間盤", "坐骨", "脊椎", "手麻", "腳麻"),
    "精神科": ("失眠", "焦慮", "憂鬱", "情緒", "恐慌", "壓力"),
    "腸胃科": ("胃", "肚子", "腹", "拉肚子", "腹瀉", "便秘", "嘔吐", "噁心", "大便"),
}


def predict_keyword(
    case: Dict[str, str],
    departments: tuple,
) -> Dict[str, Any]:

    text = " ".join(
        [msg.content for msg in ec.parse_history(case.get("history", ""))]
        + [case["text"]]
    )

    scores = {
        department: sum(1 for word in words if word in text)
        for department, words in KEYWORD_TABLE.items()
        if department in departments
    }

    best = max(scores.values(), default=0)

    department = (
        next(d for d, score in scores.items() if score == best)
        if best
        else FALLBACK_DEPARTMENT
    )

    return {
        "raw_department": department,
        "turns": 0,
        "stopped_by_safety": False,
        "safety_risk": "",
        "completed": True,
        "causes": "",
        "follow_up_questions": "",
    }


# ============================================================
# AI 系統（carepath / no_rag）
# ============================================================

def predict_ai(
    case: Dict[str, str],
    departments: tuple,
    use_rag: bool,
    max_turns: int,
) -> Dict[str, Any]:

    history = ec.parse_history(case.get("history", ""))
    symptom_text = case["text"]

    # Safety Layer 永遠先跑，與正式流程相同；
    # emergency / unknown 在線上會中止一般問診，這裡也就不給科別。
    safety_result = run_safety_pipeline(
        symptom_text=symptom_text,
        history=history,
    )

    if safety_result.get("should_stop_normal_flow"):
        return {
            "raw_department": "",
            "turns": 0,
            "stopped_by_safety": True,
            "safety_risk": safety_result["risk_level"],
            "completed": False,
            "causes": "",
            "follow_up_questions": "",
        }

    followup_answer = case.get("followup_answer") or DEFAULT_FOLLOWUP_ANSWER
    questions: List[str] = []

    for turn in range(1, max_turns + 1):

        full_context_text = (
            " ".join(msg.content for msg in history)
            + f" {symptom_text}"
        )

        rag_knowledge = (
            get_rag_context(full_context_text)
            if use_rag
            else NO_RAG_TEXT
        )

        prompt = build_consultation_prompt(
            rag_knowledge=rag_knowledge,
            profile_info_text=GUEST_PROFILE_TEXT,
            safety_result=safety_result,
            pain_level=case.get("pain_level") or DEFAULT_PAIN_LEVEL,
            departments=departments,
            history=history,
            symptom_text=symptom_text,
        )

        response = call_gemini_with_retry(prompt)

        # 與 routes/diagnose.py 相同的防禦性解析
        ai_result = json.loads(
            re.sub(r"```(?:json)?", "", response.text).strip()
        )

        if ai_result.get("is_complete", False):
            return {
                "raw_department": ai_result.get("department", FALLBACK_DEPARTMENT),
                "turns": turn,
                "stopped_by_safety": False,
                "safety_risk": safety_result["risk_level"],
                "completed": True,
                "causes": ";".join(ai_result.get("causes", [])),
                "follow_up_questions": " || ".join(questions),
            }

        question = ai_result.get("follow_up_question", "")
        questions.append(question)

        history = history + [
            SimpleNamespace(role="user", content=symptom_text),
            SimpleNamespace(role="model", content=question),
        ]
        symptom_text = followup_answer

    return {
        "raw_department": "",
        "turns": max_turns,
        "stopped_by_safety": False,
        "safety_risk": safety_result["risk_level"],
        "completed": False,
        "causes": "",
        "follow_up_questions": " || ".join(questions),
    }


# ============================================================
# 執行
# ============================================================

def run_one(
    system: str,
    case: Dict[str, str],
    departments: tuple,
    max_turns: int,
) -> Dict[str, Any]:

    started = time.perf_counter()

    try:
        if system == "keyword":
            prediction = predict_keyword(case, departments)
        else:
            prediction = predict_ai(case, departments, system == "carepath", max_turns)
        error = ""

    except Exception as exc:
        prediction = {
            "raw_department": "",
            "turns": 0,
            "stopped_by_safety": False,
            "safety_risk": "",
            "completed": False,
            "causes": "",
            "follow_up_questions": "",
        }
        error = f"{type(exc).__name__}: {exc}"[:300]

    raw = prediction["raw_department"]
    in_whitelist = (not raw) or raw in departments

    # 白名單防護：與 routes/diagnose.py Step 8 相同
    final = (
        raw
        if raw in departments
        else FALLBACK_DEPARTMENT
        if raw
        else ""
    )

    expected = ec.split_multi(case["expected_departments"])

    return {
        "id": case["id"],
        "category": case.get("category", ""),
        "expected_departments": ";".join(expected),
        "final_department": final,
        "correct": bool(final) and final in expected,
        "raw_department": raw,
        "in_whitelist": in_whitelist,
        **{k: v for k, v in prediction.items() if k != "raw_department"},
        "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        "error": error,
        "text": case["text"],
    }


def summarize(
    rows: List[Dict[str, Any]],
) -> Dict[str, Any]:

    n = len(rows)
    evaluable = [r for r in rows if not r["stopped_by_safety"]]
    ai_rows = [r for r in evaluable if r["raw_department"]]

    by_expected = defaultdict(list)

    for r in evaluable:
        by_expected[r["expected_departments"].split(";")[0]].append(r)

    return {
        # 分母排除被安全層中止的案例：那些案例線上本來就不會給科別
        "accuracy": ec.rate(sum(1 for r in evaluable if r["correct"]), len(evaluable)),
        "stopped_by_safety": ec.rate(n - len(evaluable), n),
        "incomplete_after_max_turns": ec.rate(
            sum(1 for r in evaluable if not r["completed"] and not r["error"]),
            len(evaluable),
        ),
        "errors": ec.rate(sum(1 for r in rows if r["error"]), n),
        "whitelist_violation": ec.rate(
            sum(1 for r in ai_rows if not r["in_whitelist"]),
            len(ai_rows),
        ),
        "asked_follow_up": ec.rate(
            sum(1 for r in evaluable if r["turns"] > 1 or (not r["completed"] and r["turns"])),
            len(evaluable),
        ),
        "fallback_family_medicine": ec.rate(
            sum(1 for r in ai_rows if r["final_department"] == FALLBACK_DEPARTMENT),
            len(ai_rows),
        ),
        "accuracy_by_expected_department": {
            department: ec.rate(sum(1 for r in items if r["correct"]), len(items))
            for department, items in sorted(by_expected.items())
        },
        "latency": ec.latency_summary(r["latency_ms"] for r in evaluable),
    }


def render_markdown(
    summary: Dict[str, Any],
    rows: List[Dict[str, Any]],
) -> str:

    meta = summary["meta"]
    s = summary["result"]

    lines = [
        f"# 科別建議評測：{meta['system']}",
        "",
        f"- 執行時間：{meta['run_at']}",
        f"- 案例：{meta['case_count']} 筆（{meta['cases_file']}），最多 {meta['max_turns']} 輪",
        f"- 模型：{meta['model']}",
        f"- 科別白名單（{len(meta['departments'])} 科）：{'、'.join(meta['departments'])}",
        "",
        "| 指標 | 結果 |",
        "|---|---|",
        f"| **科別命中率**（排除被安全層中止的案例） | {ec.fmt_rate(s['accuracy'])} |",
        f"| 被安全層中止（線上不會給科別） | {ec.fmt_rate(s['stopped_by_safety'])} |",
        f"| 有追問 | {ec.fmt_rate(s['asked_follow_up'])} |",
        f"| 追問到上限仍未完成 | {ec.fmt_rate(s['incomplete_after_max_turns'])} |",
        f"| 模型給出白名單外科別 | {ec.fmt_rate(s['whitelist_violation'])} |",
        f"| 最終建議為家醫科 | {ec.fmt_rate(s['fallback_family_medicine'])} |",
        f"| 執行錯誤 | {ec.fmt_rate(s['errors'])} |",
        "",
        "## 依正確科別",
        "",
        "| 正確科別 | 命中率 |",
        "|---|---|",
    ]

    for department, r in s["accuracy_by_expected_department"].items():
        lines.append(f"| {department} | {ec.fmt_rate(r)} |")

    latency = s["latency"]

    if latency.get("n"):
        lines += [
            "",
            f"每案總耗時（含追問）：p50 {latency['p50_ms']} ms／p95 {latency['p95_ms']} ms",
        ]

    if meta.get("rag_warmup_ms"):
        lines.append(
            f"（開始前已先暖機 RAG，冷啟動耗時 {meta['rag_warmup_ms'] / 1000:.1f} 秒，不計入上列數字）"
        )

    wrong = [r for r in rows if not r["stopped_by_safety"] and not r["correct"]]

    if wrong:
        lines += [
            "",
            "## 未命中的案例",
            "",
            "| id | 正確 | 系統 | 模型原始輸出 | 描述 |",
            "|---|---|---|---|---|",
        ]

        for r in wrong:
            lines.append(
                f"| {r['id']} | {r['expected_departments']} | {r['final_department'] or '（未完成）'} "
                f"| {r['raw_department'] or r['error'][:40] or '—'} | {r['text'][:50]} |"
            )

    return "\n".join(lines) + "\n"


# ============================================================
# Main
# ============================================================

def main():

    parser = argparse.ArgumentParser(description="CarePath 科別建議評測")
    parser.add_argument("--system", choices=("carepath", "no_rag", "keyword"), required=True)
    parser.add_argument("--cases", default=str(DEFAULT_CASES))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--max-turns", type=int, default=3)
    parser.add_argument("--resume", help="接續先前中斷的結果資料夾，已完成的不重跑")
    parser.add_argument("--retry-failures", action="store_true", help="接續時把執行錯誤的案例重跑")
    args = parser.parse_args()

    cases_path = ec.Path(args.cases)
    cases = ec.load_cases(cases_path, REQUIRED_COLUMNS)

    with contextlib.redirect_stdout(io.StringIO()):
        departments = get_departments()

    # 正確答案必須是系統「有可能」給出的科別，否則那題永遠不可能答對
    invalid = {
        case["id"]: [d for d in ec.split_multi(case["expected_departments"]) if d not in departments]
        for case in cases
    }
    invalid = {k: v for k, v in invalid.items() if v}

    if invalid:
        raise SystemExit(
            f"❌ expected_departments 有不在白名單的科別：{invalid}\n"
            f"   目前白名單：{departments}"
        )

    # 正式 API 只接受 1～5（models.py DiagnoseRequest），範圍外的值線上根本送不進來
    bad_pain = [
        case["id"]
        for case in cases
        if case.get("pain_level") and case["pain_level"] not in VALID_PAIN_LEVELS
    ]

    if bad_pain:
        raise SystemExit(
            f"❌ pain_level 只能是 1～5 的整數（與正式 API 相同），有問題的 id：{bad_pain}"
        )

    if args.limit:
        cases = cases[: args.limit]

    # RAG 第一次查詢要初始化向量庫連線。多個執行緒同時做第一次查詢時，
    # 實測每條執行緒的第一筆都卡到 90 秒以上；單獨暖機一次只要幾秒。
    # 先暖機，不然延遲數字會被初始化灌爆；暖機耗時另外記錄，不藏起來。
    warmup_ms = None

    if args.system == "carepath":
        started = time.perf_counter()

        with contextlib.redirect_stdout(io.StringIO()):
            get_rag_context("頭痛")

        warmup_ms = round((time.perf_counter() - started) * 1000, 1)
        print(f"🔥 RAG 暖機 {warmup_ms / 1000:.1f} 秒")

    run_dir = ec.open_run_dir(f"department_{args.system}", args.resume)

    wanted = {case["id"] for case in cases}
    rows: List[Dict[str, Any]] = [
        r
        for r in ec.load_checkpoint(run_dir, args.retry_failures)
        if r["id"] in wanted
    ]
    finished = {r["id"] for r in rows}
    pending = [case for case in cases if case["id"] not in finished]

    print(f"🧪 {args.system}：{len(cases)} 案，已完成 {len(rows)}，剩 {len(pending)} 案")
    print(f"   結果資料夾：{run_dir}（中斷後用 --resume 這個路徑接續）")

    # 理由同 eval_safety.py：redirect_stdout 是全域的，只能包在 pool 外面；
    # 每案完成就落檔，被中止時已完成的不會白費
    with open(run_dir / "console.log", "a", encoding="utf-8") as console, \
            contextlib.redirect_stdout(console), \
            ThreadPoolExecutor(max_workers=args.workers) as pool:

        futures = [
            pool.submit(run_one, args.system, case, departments, args.max_turns)
            for case in pending
        ]

        for done, future in enumerate(as_completed(futures), start=1):
            row = future.result()
            rows.append(row)
            ec.append_checkpoint(run_dir, row)

            if done % 10 == 0 or done == len(futures):
                print(f"   {done}/{len(futures)}", file=sys.__stdout__, flush=True)

    rows.sort(key=lambda r: r["id"])

    summary = {
        "meta": {
            "system": args.system,
            "run_at": ec.datetime.now().isoformat(timespec="seconds"),
            "cases_file": cases_path.name,
            "case_count": len(cases),
            "max_turns": args.max_turns,
            "model": GEMINI_MODEL_NAME if args.system != "keyword" else "（無）",
            "departments": list(departments),
            "rag_warmup_ms": warmup_ms,
        },
        "result": summarize(rows),
    }

    ec.write_csv(rows, run_dir / "predictions.csv")
    ec.write_json(summary, run_dir / "summary.json")
    (run_dir / "summary.md").write_text(render_markdown(summary, rows), encoding="utf-8")

    s = summary["result"]
    print()
    print(f"✅ 完成，結果在 {run_dir}")
    print(f"   科別命中率       {ec.fmt_rate(s['accuracy'])}")
    print(f"   白名單外科別     {ec.fmt_rate(s['whitelist_violation'])}")
    print(f"   被安全層中止     {ec.fmt_rate(s['stopped_by_safety'])}")


if __name__ == "__main__":
    main()
