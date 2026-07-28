# 專長匹配排序的最小自我檢查：python test_specialty_score.py
from routes.diagnose import specialty_score


def test_score():
    # 對症的專長分數要高於不相關的
    causes = "胃食道逆流急性腸胃炎"
    assert specialty_score("胃食道逆流、消化性潰瘍", causes) > specialty_score("白內障、青光眼", causes)

    # 空值不會炸
    assert specialty_score("", causes) == 0
    assert specialty_score(None, causes) == 0
    assert specialty_score("家庭醫學", "") == 0

    # 完全無關 = 0 分
    assert specialty_score("牙周病、植牙", "心肌梗塞") == 0


def test_sort_order():
    # 排序邏輯：先距離取候選，再依匹配分數；同分近的優先
    causes = "心律不整"
    docs = [("白內障", 8000), ("心律不整、心臟衰竭", 3000), ("心律不整", 1000)]
    scored = [(specialty_score(s, causes), d) for s, d in docs]
    scored.sort(key=lambda t: t[1])
    scored.sort(key=lambda t: (-t[0], t[1]))
    assert scored[0][1] == 1000, scored  # 滿分且最近的排第一
    assert scored[-1][0] == 0, scored    # 不相關的排最後


if __name__ == "__main__":
    test_score()
    test_sort_order()
    print("✅ specialty_score 與排序邏輯通過")
