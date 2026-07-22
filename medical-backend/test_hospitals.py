"""地圖後端 self-check：python3 test_hospitals.py"""
from routes.hospitals import HOSPITALS, haversine_meters, list_hospitals

assert len(HOSPITALS) == 29

# 台南車站 → 衛福部臺南醫院 約 500m 內外（實際約 400 多公尺）
d = haversine_meters(22.997, 120.212, 22.997354, 120.209057)
assert 200 < d < 800, d

# 無座標：原樣回傳
assert len(list_hospitals()["hospitals"]) == 29

# 帶座標：有 distance_meters 且由近到遠
res = list_hospitals(lat=22.997, lng=120.212)["hospitals"]
dists = [h["distance_meters"] for h in res]
assert dists == sorted(dists) and dists[0] < 1000
print("OK:", res[0]["name"], dists[0], "m")
