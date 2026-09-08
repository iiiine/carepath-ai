"""醫院資料與科別 fallback self-check：

    $env:PYTHONPATH="."; & $py test_hospitals.py

會連實際資料庫，不呼叫 Gemini。
"""

from routes.hospitals import haversine_meters, list_hospitals
from routes.diagnose import hospital_covers_department
from hospital_hours import build_opening_hours


# ============================================================
# 1. 距離計算
# ============================================================

# 台南車站 → 衛福部臺南醫院 約 500m 內外（實際約 400 多公尺）
d = haversine_meters(22.997, 120.212, 22.997354, 120.209057)
assert 200 < d < 800, d

# 台北車站 → 台大醫院 約 700m
d = haversine_meters(25.0478, 121.5170, 25.040784, 121.519354)
assert 400 < d < 1200, d


# ============================================================
# 2. 醫院清單
# ============================================================

hospitals = list_hospitals()["hospitals"]

by_prefix = {}
for h in hospitals:
    by_prefix.setdefault(h["hospital_code"][:2], []).append(h)

# 台南 34 家（既有）＋ 五都 253 家
assert len(by_prefix["TN"]) == 34, len(by_prefix["TN"])

five_city = sum(
    len(by_prefix.get(p, []))
    for p in ("TP", "NT", "TY", "TC", "KH")
)
assert five_city == 253, five_city

# 只有 3 家沒有官方座標（全民醫院同名不同區、君銓骨科、杏永醫院皆未收錄）
no_coord = [h for h in hospitals if h["lat"] is None]
assert len(no_coord) == 3, [h["name"] for h in no_coord]


# ============================================================
# 3. 距離排序
# ============================================================

# 帶座標：有 distance_meters 且由近到遠
res = list_hospitals(lat=22.997, lng=120.212)["hospitals"]
dists = [h["distance_meters"] for h in res]
assert dists == sorted(dists) and dists[0] < 1000

# 台北車站附近應該找得到 1 公里內的醫院
res = list_hospitals(lat=25.0478, lng=121.5170)["hospitals"]
assert res[0]["distance_meters"] < 1000, res[0]

# 沒有座標的醫院一律排到最後，不會擠掉真正近的
assert res[-1]["distance_meters"] == 9999999


# ============================================================
# 4. 官方固定看診時段
#
# 來源為健保署開放資料，五都 253 家全部都有；
# 台南既有資料匯入時沒有這個欄位，因此為 None。
# ============================================================

with_hours = [h for h in hospitals if h.get("opening_hours")]
assert len(with_hours) == 253, len(with_hours)

# 台南既有資料沒有官方時段
tn_hours = [
    h for h in hospitals
    if h["hospital_code"].startswith("TN") and h.get("opening_hours")
]
assert tn_hours == [], [h["hospital_code"] for h in tn_hours]

# 原始欄位不可外洩到 API
assert "opening_sessions" not in hospitals[0], hospitals[0].keys()

# 摘要要是可讀的一行字
sample = with_hours[0]["opening_hours"]
assert sample["summary"], sample
assert len(sample["weekly"]) == 7, sample["weekly"]
assert sample["notice"], "必須帶上不代表當日開診的提醒"

# 解析器對壞資料一律回 None，不做半套解析
assert build_opening_hours("不定時") is None
assert build_opening_hours("星期一上午看診、每週三公休") is None
assert build_opening_hours(None) is None


# ============================================================
# 5. 醫院層級科別 fallback
#
# 健保署的診療科別只寫到「內科」，
# 因此心臟內科與腸胃科額外接受「內科」。
# ============================================================

CASES = [
    # (departments, 建議科別, 預期, 說明)
    (["家醫科", "內科"], "家醫科", True, "同名命中"),
    (["家醫科", "內科"], "心臟內科", True, "內科 → 心臟內科"),
    (["家醫科", "內科"], "腸胃科", True, "內科 → 腸胃科"),
    (["家醫科", "內科"], "眼科", False, "沒有的科別不命中"),
    (["內科"], "皮膚科", False, "內科不會泛用到其他科"),
    (["心臟內科"], "心臟內科", True, "真的有次專科時直接命中"),

    # 取不到清單一律回 False，退回「必須有該科醫師」
    ([], "家醫科", False, "空陣列"),
    (None, "家醫科", False, "NULL"),

    # 型別退化防護：字串會讓 in 變成子字串比對
    ("婦產科,神經內科", "內科", False, "字串型別要擋掉"),
]

for departments, dept, expected, note in CASES:
    got = hospital_covers_department(departments, dept)
    assert got is expected, f"{note}: {departments} / {dept} → {got}"


# ============================================================
# 6. 端到端：確認新增的醫院真的進得了推薦
#
# 這是這次改動的重點——
# 改動前台北使用者只會拿到三百公里外的台南醫院。
# ============================================================

def nearest_candidates(lat, lng, suggested_dept, doctor_codes):
    """複製 diagnose.py 的醫院篩選與距離排序邏輯。"""

    picked = []

    for h in list_hospitals(lat=lat, lng=lng)["hospitals"]:

        if h["lat"] is None or h["lng"] is None:
            continue

        has_doctor = h["hospital_code"] in doctor_codes

        if not has_doctor and not hospital_covers_department(
            h.get("departments"),
            suggested_dept,
        ):
            continue

        picked.append(h)

    return picked[:10]


# list_hospitals 目前不回傳 departments，直接查一次資料庫補上
from psycopg2.extras import RealDictCursor  # noqa: E402
from services import get_db_connection      # noqa: E402

conn = get_db_connection()
assert conn, "無法連線至資料庫"

try:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT hospital_code, departments FROM hospitals;")
        dept_map = {
            r["hospital_code"]: r["departments"]
            for r in cur.fetchall()
        }

        cur.execute(
            "SELECT DISTINCT hospital_code FROM doctors WHERE department = %s;",
            ("心臟內科",),
        )
        cardio_codes = {r["hospital_code"] for r in cur.fetchall()}

        cur.execute(
            "SELECT DISTINCT hospital_code FROM doctors WHERE department = %s;",
            ("家醫科",),
        )
        family_codes = {r["hospital_code"] for r in cur.fetchall()}

        # ----------------------------------------------------
        # booking_url 是三態，不可壓成布林：
        #   網址   → 線上掛號按鈕
        #   說明文字 → 院方公告的掛號方式，原文顯示
        #   NULL   → 我們沒有這家醫院的掛號資訊
        #
        # 健保署開放資料沒有掛號網址，
        # 五都目前只有人工查證過的 23 家醫學中心有值。
        # ----------------------------------------------------

        cur.execute(
            """
            SELECT hospital_code, booking_url
            FROM hospitals
            WHERE hospital_code NOT LIKE 'TN%';
            """
        )
        booking = {r["hospital_code"]: r["booking_url"] for r in cur.fetchall()}
finally:
    conn.close()

urls = [v for v in booking.values() if v and v.startswith("http")]
assert len(urls) == 23, len(urls)

# 五都不該出現說明文字型的值，只會是網址或 NULL
notes = [v for v in booking.values() if v and not v.startswith("http")]
assert notes == [], notes

# 23 家醫學中心全部都要有掛號網址
med_centers = [
    code for code in booking
    if code in {
        "TP001", "TP002", "TP003", "TP004", "TP005",
        "TP006", "TP007", "TP008", "TP009", "TP010",
        "NT001", "NT002", "NT003", "NT004", "TY001",
        "TC001", "TC002", "TC003", "TC004",
        "KH001", "KH002", "KH003", "KH004",
    }
]
assert len(med_centers) == 23, len(med_centers)
missing_url = [c for c in med_centers if not booking[c]]
assert missing_url == [], missing_url

# 把 departments 併進 list_hospitals 的結果
_original = list_hospitals


def list_hospitals(lat=None, lng=None):  # noqa: F811
    data = _original(lat=lat, lng=lng)
    for h in data["hospitals"]:
        h["departments"] = dept_map.get(h["hospital_code"])
    return data


# 台北車站 + 心臟內科：五都沒有任何醫院標示心臟內科，
# 全靠官方「內科」的 fallback 才進得來。
taipei = nearest_candidates(25.0478, 121.5170, "心臟內科", cardio_codes)
assert len(taipei) == 10, len(taipei)
assert all(h["distance_meters"] < 10000 for h in taipei), [
    (h["name"], h["distance_meters"]) for h in taipei
]
assert all(h["hospital_code"][:2] in ("TP", "NT") for h in taipei), [
    h["hospital_code"] for h in taipei
]

# 回歸測試：台南使用者的結果仍然是台南醫院，且仍靠醫師資料進榜
tainan = nearest_candidates(22.997, 120.212, "家醫科", family_codes)
assert len(tainan) == 10, len(tainan)
assert all(h["hospital_code"].startswith("TN") for h in tainan), [
    h["hospital_code"] for h in tainan
]
assert all(h["hospital_code"] in family_codes for h in tainan), (
    "台南醫院的 departments 為空，只能靠醫師資料進榜"
)

print(
    "✅ 全部通過："
    f"醫院 {len(hospitals)} 家（台南 34 + 五都 253），"
    f"官方門診時段 {len(with_hours)} 家，"
    f"科別 fallback {len(CASES)} 個案例，"
    f"台北最近 {taipei[0]['name']} {taipei[0]['distance_meters']}m"
)
