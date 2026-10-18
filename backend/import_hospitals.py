# import_hospitals.py

"""
五都醫院資料匯入腳本。

資料來源全部為政府開放資料，不含任何推測或自行編造的欄位：

    健保署「健保特約醫事機構」
        醫學中心 / 區域醫院 / 地區醫院 三個資料集
        → 名稱、電話、地址、診療科別、固定看診時段、醫事機構代碼

    內政部國土測繪中心「查詢醫療設施」
        marktype 9930101（醫院，不含診所）
        → 官方經緯度

刻意不收錄「診所」：健保署的診所資料集完全不讀取。

執行方式：

    $env:PYTHONPATH="."; & $py import_hospitals.py --build
        重新產生 data/hospitals_5city.json，不碰資料庫

    $env:PYTHONPATH="."; & $py import_hospitals.py --sweep
        重新掃描 NLSC 取得座標點位（約 8 分鐘），更新座標快取

    $env:PYTHONPATH="."; & $py import_hospitals.py --write
        將 data/hospitals_5city.json 寫入 hospitals 資料表
"""

import argparse
import csv
import io
import json
import math
import os
import re
import ssl
import sys
import threading
import time
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path


# ============================================================
# 版本常數
#
# 匯入邏輯（科別擷取、正規化、編碼規則）若有變動，
# 必須同步更新這個版本號，
# 否則事後無法回推當時是用哪一版規則產生的資料。
# ============================================================

IMPORT_VERSION = "hospital_import_v1"


# ============================================================
# 政府 API 的 SSL context
#
# 健保署與國土測繪中心的憑證都缺 Subject Key Identifier，
# Python 的 ssl 會直接拒絕（curl 與瀏覽器則可通）。
#
# 這支腳本只做公開唯讀資料的一次性抓取，
# 不傳送任何憑證或個資，因此關閉驗證。
# 一般後端程式碼請勿沿用這個做法。
# ============================================================

GOV_SSL_CONTEXT = (
    ssl._create_unverified_context()
)


# ============================================================
# 路徑
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

DATA_DIR = BASE_DIR / "data"

POINTS_PATH = DATA_DIR / "nlsc_hospital_points.json"

OUTPUT_PATH = DATA_DIR / "hospitals_5city.json"


# ============================================================
# 健保署開放資料集
#
# 只取三個「醫院」資料集，
# 診所資料集（A21030000I-D21004-*）刻意不列入。
# ============================================================

NHI_DATASETS = [
    (
        "醫學中心",
        "A21030000I-D21001-003",
    ),
    (
        "區域醫院",
        "A21030000I-D21002-005",
    ),
    (
        "地區醫院",
        "A21030000I-D21003-003",
    ),
]

NHI_ENDPOINT = (
    "https://info.nhi.gov.tw"
    "/api/iode0000s01/Dataset?rId="
)

LEVEL_RANK = {
    "醫學中心": 0,
    "區域醫院": 1,
    "地區醫院": 2,
}


# ============================================================
# 收錄縣市與代碼前綴
#
# 沿用既有台南資料的 TN001 寫法。
# ============================================================

CITY_PREFIX = {
    "臺北市": "TP",
    "新北市": "NT",
    "桃園市": "TY",
    "臺中市": "TC",
    "高雄市": "KH",
}


# ============================================================
# 收錄科別
#
# 只取系統現有的 9 種科別，
# 官方診療科別中其餘科別一律不收。
#
# 口腔相關科別統一歸「牙科」，
# 腸胃相關科別統一歸「腸胃科」。
# ============================================================

TARGET_DEPARTMENTS = (
    "家醫科",
    "婦產科",
    "心臟內科",
    "腸胃科",
    "牙科",
    "神經外科",
    "精神科",
    "眼科",
    "皮膚科",
)


# ============================================================
# 額外保留的官方原文科別
#
# 健保署的「診療科別」只寫到「內科」，
# 沒有心臟內科、腸胃科這種次專科，
# 因此五都 253 家醫院沒有任何一家標示這兩科。
#
# 這裡把官方原文的「內科」一併存進 departments，
# 讓 diagnose.py 在找不到心臟內科／腸胃科醫師時
# 有官方依據可以退回比對。
#
# 注意：
# 存進資料庫的一律是官方原文，
# 不把「內科」展開成「心臟內科」或「腸胃科」——
# 那是我們的判斷而非官方資訊，
# 展開後就再也分不出哪些是官方資料、哪些是推論。
# 「內科可以處理心臟／腸胃問題」這個判斷
# 放在 diagnose.py 的比對規則裡，可稽核、可調整。
# ============================================================

OFFICIAL_EXTRA_DEPARTMENTS = (
    "內科",
)

# departments 欄位的輸出順序
STORED_DEPARTMENTS = (
    TARGET_DEPARTMENTS
    + OFFICIAL_EXTRA_DEPARTMENTS
)

# 官方科別名稱 → 系統科別
DEPARTMENT_ALIASES = {
    # --- 口腔相關一律歸牙科 ---
    "牙科": "牙科",
    "家庭牙醫科": "牙科",
    "口腔顎面外科": "牙科",
    "口腔病理科": "牙科",
    "牙周病科": "牙科",
    "牙髓病科": "牙科",
    "牙體復形科": "牙科",
    "兒童牙科": "牙科",
    "齒顎矯正科": "牙科",
    "贋復補綴牙科": "牙科",
    "特殊需求者口腔醫學科": "牙科",

    # --- 腸胃相關一律歸腸胃科 ---
    "腸胃科": "腸胃科",
    "胃腸科": "腸胃科",
    "消化內科": "腸胃科",
    "肝膽腸胃科": "腸胃科",
    "胃腸肝膽科": "腸胃科",

    # --- 官方原文保留 ---
    "內科": "內科",

    # --- 其餘直接對應 ---
    "心臟內科": "心臟內科",
    "心臟血管內科": "心臟內科",
    "家醫科": "家醫科",
    "家庭醫學科": "家醫科",
    "婦產科": "婦產科",
    "神經外科": "神經外科",
    "精神科": "精神科",
    "眼科": "眼科",
    "皮膚科": "皮膚科",
}


# ============================================================
# 全形轉半形與欄位正規化
# ============================================================

def to_halfwidth(
    text: str
) -> str:
    """
    全形英數字轉半形，
    讓地址與既有台南資料寫法一致。
    """

    if not text:
        return ""

    return unicodedata.normalize(
        "NFKC",
        text,
    )


def normalize_phone(
    raw: str
) -> str:
    """
    健保署電話格式為 (02)23123456，
    既有資料為 06-2200055，
    這裡統一成後者。

    無法辨識的格式原樣保留，不猜。
    """

    value = to_halfwidth(
        raw
    ).strip()

    if not value:
        return ""

    matched = re.match(
        r"^\((\d{2,4})\)(.+)$",
        value,
    )

    if matched:
        return (
            f"{matched.group(1)}"
            f"-"
            f"{matched.group(2).strip()}"
        )

    return value


def match_key(
    text: str
) -> str:
    """
    名稱比對用的正規化鍵值。
    """

    value = to_halfwidth(
        text
    ).replace(
        "臺",
        "台",
    )

    return re.sub(
        r"[\s,、，．.\-－─()（）]",
        "",
        value,
    )


# ============================================================
# 科別擷取
# ============================================================

def extract_departments(
    raw: str
) -> list:
    """
    從官方「診療科別」擷取系統收錄的 9 種科別，
    外加官方原文的「內科」。

    注意：
    這裡只做「有沒有這一科」的擷取，
    不做任何科別推論。

    官方只寫「內科」時就存「內科」，
    不會展開成心臟內科或腸胃科。
    """

    if not raw:
        return []

    found = []

    for item in raw.split(","):

        name = item.strip()

        if not name:
            continue

        mapped = DEPARTMENT_ALIASES.get(
            name
        )

        if (
            mapped
            and mapped not in found
        ):
            found.append(
                mapped
            )

    # 依 STORED_DEPARTMENTS 的順序輸出，讓結果穩定可比對
    return [
        dept
        for dept in STORED_DEPARTMENTS
        if dept in found
    ]


# ============================================================
# 健保署 CSV 下載
# ============================================================

def download_nhi_csv(
    resource_id: str,
    retries: int = 3,
) -> list:
    """
    下載單一健保署資料集。

    帶遞增退避重試；
    最終仍失敗則丟出例外，
    不回傳半套資料。
    """

    url = (
        NHI_ENDPOINT
        + resource_id
    )

    last_error = None

    for attempt in range(retries):

        try:

            with urllib.request.urlopen(
                url,
                timeout=60,
                context=GOV_SSL_CONTEXT,
            ) as response:

                raw = response.read()

            text = raw.decode(
                "utf-8-sig"
            )

            return list(
                csv.DictReader(
                    io.StringIO(
                        text
                    )
                )
            )

        except Exception as error:

            last_error = error

            print(
                f"⚠️ 下載 {resource_id} 失敗"
                f"（第 {attempt + 1} 次）："
                f"{error}"
            )

            time.sleep(
                2 * (attempt + 1)
            )

    raise RuntimeError(
        f"❌ 無法下載健保署資料集 "
        f"{resource_id}：{last_error}"
    )


# ============================================================
# NLSC 座標掃描
# ============================================================

NLSC_ENDPOINT = (
    "https://api.nlsc.gov.tw"
    "/other/MarkBufferAnlys/med"
)

# marktype 9930101 = 醫院（不含診所）
NLSC_HOSPITAL_TYPE = "9930101"

# 單次查詢半徑（公尺）。
# 實測最密集處回傳 112 筆，離 230 筆上限有餘裕。
NLSC_RADIUS = 3000

# 格點間距（公里）。
# 需 <= 半徑 * sqrt(2) 才能完全覆蓋，取 4.0 留安全邊界。
NLSC_STEP_KM = 4.0

# 五都外接矩形（含緩衝）
NLSC_BOXES = [
    (
        "北北桃",
        120.94,
        122.03,
        24.57,
        25.32,
    ),
    (
        "臺中",
        120.41,
        121.48,
        23.97,
        24.47,
    ),
    (
        "高雄",
        120.08,
        121.08,
        22.43,
        23.51,
    ),
]


def build_grid(
    lon_min: float,
    lon_max: float,
    lat_min: float,
    lat_max: float,
) -> list:
    """
    產生等距格點。
    """

    points = []

    delta_lat = (
        NLSC_STEP_KM
        / 110.574
    )

    latitude = lat_min

    while latitude <= lat_max:

        delta_lon = (
            NLSC_STEP_KM
            / (
                111.320
                * math.cos(
                    math.radians(
                        latitude
                    )
                )
            )
        )

        longitude = lon_min

        while longitude <= lon_max:

            points.append(
                (
                    round(longitude, 6),
                    round(latitude, 6),
                )
            )

            longitude += delta_lon

        latitude += delta_lat

    return points


def sweep_nlsc_points() -> list:
    """
    掃描五都範圍，蒐集所有醫院點位。

    單一格點查詢失敗時只跳過該格點，
    不讓整次掃描中斷。
    """

    points = []

    for (
        name,
        lon_min,
        lon_max,
        lat_min,
        lat_max,
    ) in NLSC_BOXES:

        grid = build_grid(
            lon_min,
            lon_max,
            lat_min,
            lat_max,
        )

        print(
            f"🛰️ {name} 格點 {len(grid)}"
        )

        points += grid

    print(
        f"🛰️ 總格點 {len(points)}"
    )

    found = {}

    lock = threading.Lock()

    progress = [0]

    def fetch(point):

        longitude, latitude = point

        url = (
            f"{NLSC_ENDPOINT}"
            f"/{longitude}"
            f"/{latitude}"
            f"/{NLSC_RADIUS}"
        )

        rows = []

        for attempt in range(3):

            try:

                with urllib.request.urlopen(
                    url,
                    timeout=40,
                    context=GOV_SSL_CONTEXT,
                ) as response:

                    rows = json.loads(
                        response.read().decode(
                            "utf-8"
                        )
                    )

                break

            except Exception:

                if attempt == 2:
                    rows = []

                time.sleep(
                    1.5 * (attempt + 1)
                )

        with lock:

            for row in rows:

                if (
                    row.get("marktype")
                    != NLSC_HOSPITAL_TYPE
                ):
                    continue

                found[row["id"]] = {
                    "id": row["id"],
                    "name": row["name"],
                    "addr": row.get("addr"),
                    "tel": row.get("tel"),
                    "lon": row["lon"],
                    "lat": row["lat"],
                }

            progress[0] += 1

            if progress[0] % 200 == 0:
                print(
                    f"  {progress[0]}"
                    f"/{len(points)} 格點，"
                    f"已收 {len(found)} 家"
                )

    with ThreadPoolExecutor(
        max_workers=4
    ) as executor:

        list(
            executor.map(
                fetch,
                points,
            )
        )

    result = sorted(
        found.values(),
        key=lambda item: item["id"],
    )

    DATA_DIR.mkdir(
        exist_ok=True
    )

    POINTS_PATH.write_text(
        json.dumps(
            result,
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    print(
        f"✅ NLSC 掃描完成："
        f"{len(result)} 家 → {POINTS_PATH.name}"
    )

    return result


def load_nlsc_points() -> list:
    """
    讀取座標快取，沒有就重新掃描。
    """

    if POINTS_PATH.exists():

        return json.loads(
            POINTS_PATH.read_text(
                encoding="utf-8"
            )
        )

    print(
        "⚠️ 找不到座標快取，改為重新掃描"
    )

    return sweep_nlsc_points()


# ============================================================
# 座標比對
# ============================================================

def address_key(
    address: str
):
    """
    取「縣市 + 區 + 路名 + 號」骨架當比對鍵。

    健保署與 NLSC 的路段寫法不同
    （３段 / 三段），
    因此段號一併正規化。
    """

    value = to_halfwidth(
        address
    ).replace(
        "臺",
        "台",
    )

    value = re.split(
        r"[;；]",
        value,
    )[0]

    for index, chinese in enumerate(
        "一二三四五六七八九",
        start=1,
    ):
        value = value.replace(
            f"{chinese}段",
            f"{index}段",
        )

    # 健保署地址常多寫一層「里」，NLSC 則無，
    # 例：豐原區中山里中正路199號 → 豐原區中正路199號
    value = re.sub(
        r"([區鄉鎮市])[^區鄉鎮市路街道大巷弄號]{1,4}里",
        r"\1",
        value,
    )

    value = re.sub(
        r"[\s,、，．.\-－─()（）]",
        "",
        value,
    )

    matched = re.match(
        r"(.{2,3}[市縣].{1,4}[區鄉鎮市])(.*?)(\d+)號",
        value,
    )

    if not matched:
        return None

    return (
        matched.group(1),
        matched.group(2),
        matched.group(3),
    )


# ============================================================
# 掛號網址人工補登
#
# 健保署開放資料沒有掛號網址，
# 只能逐家從院方官網查證後填入。
#
# 目前收錄五都 23 家醫學中心。
# 每一筆都以瀏覽器 User-Agent 實際請求驗證過回應 200
# （部分院方會擋非瀏覽器的 User-Agent，
#   用預設 curl 會拿到 403，那不代表網址失效）。
#
# 沒有列在這裡的醫院一律留 NULL，
# 代表「我們沒有這家醫院的掛號資訊」，
# 不可顯示成「僅提供現場掛號」——
# 那是我們不知道的事。
#
# 同體系共用一套掛號系統的（馬偕、台大、長庚、中國醫）
# 沿用同一個網址。
# ============================================================

MANUAL_BOOKING_URLS = {

    # --- 臺北市 ---
    "TP001": "https://www2.ndmctsgh.edu.tw/newwebreg/",
    "TP002": "https://www.mmh.org.tw/register_info.php",
    "TP003": "https://www.mmh.org.tw/register_info.php",
    "TP004": "https://reg.cgh.org.tw/tw/reg/main.jsp",
    "TP005": "https://reg.ntuh.gov.tw/webadministration/nav.html",
    "TP006": "https://reg.ntuh.gov.tw/webadministration/nav.html",
    "TP007": "https://www.skh.org.tw/skh_regis/",
    "TP008": (
        "https://wwww.wanfang.gov.tw"
        "/reg/register_ec_cload.aspx"
    ),
    "TP009": "https://www6.vghtpe.gov.tw/reg/home.do",
    "TP010": "https://register.cgmh.org.tw/Register/1",

    # --- 新北市 ---
    "NT001": "https://taipei.tzuchi.com.tw/",
    "NT002": "https://www.mmh.org.tw/register_info.php",
    "NT003": (
        "https://shh.tmu.edu.tw"
        "/page/Shhreg.aspx?deptCode=12"
    ),
    "NT004": "https://www.femh.org.tw/webregs/start.aspx",

    # --- 桃園市 ---
    "TY001": "https://register.cgmh.org.tw/Register/3",

    # --- 臺中市 ---
    "TC001": (
        "https://www.cmuh.cmu.edu.tw"
        "/Service/OnlineAppointment"
    ),
    "TC002": (
        "https://www.cmuh.cmu.edu.tw"
        "/Service/OnlineAppointment"
    ),
    "TC003": (
        "https://sysint.csh.org.tw"
        "/Register/DoctorClinic.aspx"
    ),
    "TC004": (
        "https://register.vghtc.gov.tw"
        "/register/listSection.jsp"
    ),

    # --- 高雄市 ---
    "KH001": "https://webreg.edah.org.tw/",
    "KH002": (
        "https://www.kmuh.org.tw"
        "/KMUHWeb/Pages/P02Register/NetReg/NetRegFirst.aspx"
    ),
    "KH003": "https://register.cgmh.org.tw/Register/8",
    "KH004": "https://webreg.vghks.gov.tw/",
}


# ============================================================
# 座標人工補登
#
# NLSC 醫院圖層更新頻率不定，
# 新設或改名的醫院可能還沒收錄。
#
# 這裡以 hospital_code 為鍵補上座標，
# 每一筆都必須註明來源，
# 不可憑印象或估算填入。
# ============================================================

MANUAL_COORDINATES = {

    # NLSC 收錄名稱為「衛生福利部樂生療養院」，
    # 與健保署的「衛生福利部樂生醫院」為同一機構，
    # 院區橫跨新北市新莊區與桃園市龜山區。
    # 來源：NLSC 查詢醫療設施 id A0000021324
    "NT047": (
        25.020379,
        121.407948,
        "nlsc_alias",
    ),

    # 2025 年新設，NLSC 圖層尚未收錄。
    # 來源：醫院官網 dkoh.com.tw 自行公布的
    #       Google Maps 連結 maps.app.goo.gl/oAZv2B631sPdprgh8
    "TC028": (
        24.1883898,
        120.6585436,
        "official_website",
    ),
}


def district_of(
    address: str
):
    """
    取出「縣市 + 行政區」，
    例：臺中市豐原區。

    用來擋掉分院被比對到本院的情況。
    """

    value = to_halfwidth(
        address
    ).replace(
        "臺",
        "台",
    )

    matched = re.match(
        r"(.{2,3}[市縣].{1,4}[區鄉鎮市])",
        value,
    )

    return (
        matched.group(1)
        if matched
        else None
    )


def city_of(
    address: str
):
    """
    取出縣市，例：台中市。
    """

    value = to_halfwidth(
        address
    ).replace(
        "臺",
        "台",
    )

    matched = re.match(
        r"(.{2,3}[市縣])",
        value,
    )

    return (
        matched.group(1)
        if matched
        else None
    )


def build_coordinate_index(
    points: list
):
    """
    建立名稱與地址兩組索引。

    名稱會撞：
    全民醫院、台安醫院、祐民醫院
    等名稱在不同縣市各有一家，
    因此名稱索引存的是清單而不是單一點位，
    交由 lookup_coordinate 依行政區挑選。
    """

    by_name = {}

    by_address = {}

    for point in points:

        by_name.setdefault(
            match_key(
                point["name"]
            ),
            [],
        ).append(
            point
        )

        key = address_key(
            point.get("addr")
            or ""
        )

        if key:
            by_address.setdefault(
                key,
                point,
            )

    return (
        by_name,
        by_address,
    )


def pick_same_area(
    candidates: list,
    address: str,
):
    """
    從同名候選中挑出行政區相符者。

    先比對到區，再退到縣市；
    兩者都對不上就回 None ——
    寧可留空座標，
    也不要把使用者導到別的縣市。

    回傳 (point, 比對精細度)，
    精細度為 district 或 city。
    只對到縣市的要另外列出人工確認，
    因為那可能是同名的另一家。
    """

    if not candidates:
        return (
            None,
            None,
        )

    district = district_of(
        address
    )

    if district:

        for point in candidates:

            if district_of(
                point.get("addr")
                or ""
            ) == district:
                return (
                    point,
                    "district",
                )

    city = city_of(
        address
    )

    if city:

        for point in candidates:

            if city_of(
                point.get("addr")
                or ""
            ) == city:
                return (
                    point,
                    "city",
                )

    return (
        None,
        None,
    )


def lookup_coordinate(
    hospital: dict,
    by_name: dict,
    by_address: dict,
):
    """
    依序用三種方式找官方座標，
    找不到就回 None，不做任何估算。

    回傳 (point, 比對方式)
    """

    # 0. 人工補登優先
    override = MANUAL_COORDINATES.get(
        hospital["hospital_code"]
    )

    if override:

        latitude, longitude, source = override

        return (
            {
                "lat": latitude,
                "lon": longitude,
            },
            source,
        )

    name_key = match_key(
        hospital["name"]
    )

    # 1. 名稱完全相符，且行政區也對得上
    point, precision = pick_same_area(
        by_name.get(
            name_key,
            [],
        ),
        hospital["address"],
    )

    if (
        point
        and precision == "district"
    ):
        return (
            point,
            "name",
        )

    # 只對到縣市層級一律不採用。
    #
    # 例：健保署的「全民醫院」在三重區三和路四段，
    #     NLSC 的「全民醫院」在蘆洲區三民路，
    #     街道對不上，可能是同名的另一家。
    #
    # 寧可留空座標讓它排到最後，
    # 也不要把使用者導到錯的建築物。
    # 人工查證後再寫進 MANUAL_COORDINATES。
    if point:
        return (
            None,
            "needs_review",
        )

    # 2. 地址骨架相符
    key = address_key(
        hospital["address"]
    )

    if key:

        point = by_address.get(
            key
        )

        if point:
            return (
                point,
                "address",
            )

    # 3. 名稱包含關係
    #    （例：官方寫「臺北市立萬芳醫院－委託臺北醫學大學辦理」，
    #      NLSC 寫「臺北市立萬芳醫院」）
    #
    #    必須同時位於同一個行政區才採用。
    #    否則「亞洲大學附屬醫院豐中分院」會被
    #    比對到 30 公里外的「亞洲大學附屬醫院」本院。
    district = district_of(
        hospital["address"]
    )

    if not district:
        return (
            None,
            None,
        )

    for candidate_key, candidates in by_name.items():

        if (
            len(candidate_key) < 5
            or candidate_key not in name_key
        ):
            continue

        for point in candidates:

            if district_of(
                point.get("addr")
                or ""
            ) == district:

                return (
                    point,
                    "contains",
                )

    return (
        None,
        None,
    )


# ============================================================
# 建立醫院資料
# ============================================================

def build_hospitals() -> list:
    """
    下載健保署資料、篩選五都醫院、補上官方座標。
    """

    today = date.today().strftime(
        "%Y%m%d"
    )

    rows = []

    for level, resource_id in NHI_DATASETS:

        dataset = download_nhi_csv(
            resource_id
        )

        print(
            f"✅ {level} "
            f"{len(dataset)} 筆"
        )

        for row in dataset:
            row["_level"] = level
            rows.append(row)

    hospitals = []

    skipped_closed = 0

    for row in rows:

        address = (
            row.get("地址")
            or ""
        ).strip()

        city = next(
            (
                name
                for name in CITY_PREFIX
                if address.startswith(name)
            ),
            None,
        )

        if not city:
            continue

        # 合約已終止或已歇業者不收錄
        closed_at = (
            row.get("終止合約或歇業日期")
            or ""
        ).strip()

        if (
            closed_at
            and closed_at < today
        ):
            skipped_closed += 1
            continue

        hospitals.append(
            {
                "city": city,

                "level": row["_level"],

                "nhi_code": row[
                    "醫事機構代碼"
                ].strip(),

                "name": row[
                    "醫事機構名稱"
                ].strip(),

                "kind": row[
                    "醫事機構種類"
                ].strip(),

                "phone": normalize_phone(
                    row.get("電話")
                    or ""
                ),

                "address": to_halfwidth(
                    address
                ),

                "departments": extract_departments(
                    row.get("診療科別")
                    or ""
                ),

                "opening_sessions": (
                    row.get("固定看診時段")
                    or ""
                ).strip()
                or None,
            }
        )

    print(
        f"ℹ️ 排除已終止合約／歇業 "
        f"{skipped_closed} 家"
    )

    # --------------------------------------------------------
    # 依 縣市 → 層級 → 名稱 排序後編號，
    # 讓 hospital_code 可重現。
    # --------------------------------------------------------

    city_order = list(
        CITY_PREFIX
    )

    hospitals.sort(
        key=lambda item: (
            city_order.index(
                item["city"]
            ),
            LEVEL_RANK[
                item["level"]
            ],
            item["name"],
        )
    )

    counters = {}

    for hospital in hospitals:

        city = hospital["city"]

        counters[city] = (
            counters.get(city, 0)
            + 1
        )

        hospital[
            "hospital_code"
        ] = "%s%03d" % (
            CITY_PREFIX[city],
            counters[city],
        )

        # 掛號網址沒有開放資料，只有人工查證過的才填。
        # 其餘留 None，代表「我們不知道」，
        # 不是「這家醫院沒有線上掛號」。
        hospital[
            "booking_url"
        ] = MANUAL_BOOKING_URLS.get(
            hospital["hospital_code"]
        )

    # --------------------------------------------------------
    # 補官方座標
    # --------------------------------------------------------

    points = load_nlsc_points()

    by_name, by_address = (
        build_coordinate_index(
            points
        )
    )

    missing = []

    for hospital in hospitals:

        point, source = lookup_coordinate(
            hospital,
            by_name,
            by_address,
        )

        if point:

            hospital["latitude"] = point["lat"]

            hospital["longitude"] = point["lon"]

            hospital["coordinate_source"] = source

        else:

            hospital["latitude"] = None

            hospital["longitude"] = None

            hospital["coordinate_source"] = source

            missing.append(hospital)

        hospital[
            "import_version"
        ] = IMPORT_VERSION

    if missing:

        print(
            f"⚠️ {len(missing)} 家沒有座標，"
            f"latitude/longitude 留空："
        )

        for hospital in missing:

            note = (
                "同名不同區，需人工查證"
                if hospital["coordinate_source"]
                == "needs_review"
                else "NLSC 圖層未收錄"
            )

            print(
                f"    {hospital['hospital_code']} "
                f"{hospital['name']} "
                f"｜{note}"
            )

    # --------------------------------------------------------
    # 座標合理性檢核
    # --------------------------------------------------------

    invalid = validate_coordinates(
        hospitals
    )

    if invalid:

        print(
            f"❌ {len(invalid)} 家座標落在所屬縣市範圍外，"
            f"請檢查比對邏輯："
        )

        for hospital in invalid:
            print(
                f"    {hospital['hospital_code']} "
                f"{hospital['name']} "
                f"｜{hospital['address'][:26]} "
                f"｜{hospital['latitude']},"
                f"{hospital['longitude']}"
            )

    else:
        print("✅ 座標合理性檢核通過")

    return hospitals


# ============================================================
# 座標合理性檢核
#
# 同名醫院跨縣市誤配過一次
# （新北全民醫院被配到台中的全民醫院），
# 因此每次建檔都要檢查座標有沒有落在該縣市範圍內。
# ============================================================

CITY_BOUNDS = {
    "臺北市": (24.95, 25.22, 121.44, 121.68),
    "新北市": (24.65, 25.31, 121.26, 122.02),
    "桃園市": (24.58, 25.14, 120.95, 121.49),
    "臺中市": (23.98, 24.45, 120.42, 121.47),
    "高雄市": (22.44, 23.50, 120.09, 121.07),
}


def validate_coordinates(
    hospitals: list
) -> list:
    """
    檢查座標是否落在所屬縣市的範圍內。

    回傳有問題的醫院清單。
    """

    invalid = []

    for hospital in hospitals:

        if hospital["latitude"] is None:
            continue

        bounds = CITY_BOUNDS.get(
            hospital["city"]
        )

        if not bounds:
            continue

        (
            lat_min,
            lat_max,
            lon_min,
            lon_max,
        ) = bounds

        if not (
            lat_min
            <= hospital["latitude"]
            <= lat_max
            and lon_min
            <= hospital["longitude"]
            <= lon_max
        ):
            invalid.append(
                hospital
            )

    return invalid


# ============================================================
# 輸出檢視用 JSON
# ============================================================

def write_output(
    hospitals: list
) -> None:

    DATA_DIR.mkdir(
        exist_ok=True
    )

    OUTPUT_PATH.write_text(
        json.dumps(
            hospitals,
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    print(
        f"✅ 已輸出 {len(hospitals)} 家 "
        f"→ {OUTPUT_PATH}"
    )


# ============================================================
# 統計
# ============================================================

def print_summary(
    hospitals: list
) -> None:

    from collections import Counter

    print("\n" + "=" * 44)

    print(
        f"總計 {len(hospitals)} 家"
    )

    print(
        "各市：",
        dict(
            Counter(
                item["city"]
                for item in hospitals
            )
        ),
    )

    print(
        "層級：",
        dict(
            Counter(
                item["level"]
                for item in hospitals
            )
        ),
    )

    print(
        "座標來源：",
        dict(
            Counter(
                item["coordinate_source"]
                for item in hospitals
            )
        ),
    )

    print("\n收錄科別涵蓋家數：")

    counter = Counter()

    for hospital in hospitals:
        for dept in hospital["departments"]:
            counter[dept] += 1

    for dept in STORED_DEPARTMENTS:
        print(
            f"    {dept:<6} "
            f"{counter.get(dept, 0)} 家"
        )

    print(
        "\n有掛號網址：",
        sum(
            1
            for item in hospitals
            if item["booking_url"]
        ),
        "家",
    )

    print(
        "\n完全沒有收錄科別的醫院：",
        sum(
            1
            for item in hospitals
            if not item["departments"]
        ),
        "家",
    )

    print("=" * 44 + "\n")


# ============================================================
# 寫入資料庫
# ============================================================

SCHEMA_SQL = """
ALTER TABLE hospitals
    ADD COLUMN IF NOT EXISTS nhi_code VARCHAR(20);

ALTER TABLE hospitals
    ADD COLUMN IF NOT EXISTS departments JSONB
    NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE hospitals
    ADD COLUMN IF NOT EXISTS opening_sessions TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS hospitals_nhi_code_key
    ON hospitals (nhi_code)
    WHERE nhi_code IS NOT NULL;
"""


def write_db(
    hospitals: list
) -> None:
    """
    以 hospital_code 為鍵 upsert 進 hospitals。

    既有台南資料（TN*）不會被動到。
    """

    from psycopg2.extras import Json

    from services import get_db_connection

    conn = get_db_connection()

    if not conn:
        print("❌ 無法連線至資料庫")
        sys.exit(1)

    try:

        with conn.cursor() as cur:

            # ---------------------------------------------
            # schema 手動同步
            # ---------------------------------------------

            cur.execute(SCHEMA_SQL)

            print("✅ schema 已同步")

            inserted = 0

            updated = 0

            for hospital in hospitals:

                cur.execute(
                    """
                    INSERT INTO hospitals (
                        hospital_code,
                        nhi_code,
                        name,
                        address,
                        phone,
                        latitude,
                        longitude,
                        departments,
                        opening_sessions,
                        booking_url
                    )
                    VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s
                    )
                    ON CONFLICT (hospital_code)
                    DO UPDATE SET
                        nhi_code = EXCLUDED.nhi_code,
                        name = EXCLUDED.name,
                        address = EXCLUDED.address,
                        phone = EXCLUDED.phone,
                        latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude,
                        departments = EXCLUDED.departments,
                        opening_sessions =
                            EXCLUDED.opening_sessions,
                        booking_url =
                            EXCLUDED.booking_url
                    RETURNING (xmax = 0) AS is_insert;
                    """,
                    (
                        hospital["hospital_code"],
                        hospital["nhi_code"],
                        hospital["name"],
                        hospital["address"],
                        hospital["phone"] or None,
                        hospital["latitude"],
                        hospital["longitude"],
                        Json(
                            hospital["departments"]
                        ),
                        hospital["opening_sessions"],
                        hospital["booking_url"],
                    ),
                )

                if cur.fetchone()[0]:
                    inserted += 1
                else:
                    updated += 1

        conn.commit()

        print(
            f"✅ 寫入完成："
            f"新增 {inserted} 家，"
            f"更新 {updated} 家"
        )

    except Exception as error:

        conn.rollback()

        print(f"❌ 寫入失敗，已 rollback：{error}")

        raise

    finally:
        conn.close()


# ============================================================
# CLI
# ============================================================

def main() -> None:

    parser = argparse.ArgumentParser(
        description="五都醫院資料匯入"
    )

    parser.add_argument(
        "--build",
        action="store_true",
        help="重新產生 data/hospitals_5city.json",
    )

    parser.add_argument(
        "--sweep",
        action="store_true",
        help="重新掃描 NLSC 座標（約 8 分鐘）",
    )

    parser.add_argument(
        "--write",
        action="store_true",
        help="將 JSON 寫入 hospitals 資料表",
    )

    args = parser.parse_args()

    if args.sweep:
        sweep_nlsc_points()

    if args.build or args.sweep:

        hospitals = build_hospitals()

        write_output(hospitals)

        print_summary(hospitals)

    if args.write:

        if not OUTPUT_PATH.exists():
            print(
                "❌ 找不到 "
                f"{OUTPUT_PATH.name}，"
                "請先執行 --build"
            )
            sys.exit(1)

        hospitals = json.loads(
            OUTPUT_PATH.read_text(
                encoding="utf-8"
            )
        )

        write_db(hospitals)

    if not (
        args.build
        or args.sweep
        or args.write
    ):
        parser.print_help()


if __name__ == "__main__":
    main()
