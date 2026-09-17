"""pytest：自动混合 8/16/32 容量 + 不可拆页段（四个验收场景）。

场景一：未启用自动模式——请求/响应与旧版完全兼容；
场景二：存在同成本候选时按“从前向后较大者优先”决胜唯一；
场景三：受保护页段迫使容量次序改变，补白/约束命中/材料计划同结果计算；
场景四：非法页段（倒序/越界/格式/超长）与全部候选被约束阻断（无解）。
"""

import pytest
from fastapi.testclient import TestClient

from app.imposition import impose, iter_placed_pages, plan_auto_capacities
from app.main import app
from app.validation import merge_intervals, parse_page_segments

client = TestClient(app)

BASE_PAYLOAD = {
    "total_pages": 24,
    "pages_per_signature": 32,
    "flip": "long_edge",
}


def _post(**overrides):
    payload = {**BASE_PAYLOAD, **overrides}
    return client.post("/impose", json=payload)


def _placed_pages(body):
    """全部非空白页码（排序后即应等于 1…total_pages，验重页/漏页/唯一性）。"""
    return sorted(
        value
        for signature in body["signatures"]
        for sheet in signature["sheets"]
        for side in ("front", "back")
        for value in (sheet[side]["left"], sheet[side]["right"])
        if value is not None
    )


def _boundaries(capacities):
    """各书帖边界所在页码位置（最后一帖到正文末尾，无下刀）。"""
    positions = []
    running = 0
    for capacity in capacities[:-1]:
        running += capacity
        positions.append(running)
    return positions


# ---------- 规划器：合并、决胜、约束 ----------


def test_merge_overlapping_and_adjacent_intervals():
    assert merge_intervals([(5, 8), (7, 10)]) == [(5, 10)]
    assert merge_intervals([(5, 8), (9, 12)]) == [(5, 12)]
    # 相邻即合并；乱序输入先排序
    assert merge_intervals([(20, 24), (1, 3), (2, 4)]) == [(1, 4), (20, 24)]
    assert merge_intervals([]) == []


def test_parse_segments_normalizes_overlap_and_adjacency():
    segments, error = parse_page_segments("17-20,16-17", 24, 32)
    assert error is None
    assert segments == [(16, 20)]


@pytest.mark.parametrize(
    "raw,keyword",
    [
        ("abc", "格式"),
        ("16", "格式"),
        ("1-2-3", "格式"),
        ("9-16,", "格式"),
        ("20-10", "倒序"),
        ("20-25", "超出"),
        ("0-5", "超出"),
    ],
)
def test_parse_segments_rejects_bad_inputs(raw, keyword):
    segments, error = parse_page_segments(raw, 24, 32)
    assert segments is None
    assert keyword in error


def test_parse_segments_rejects_segment_longer_than_capacity():
    segments, error = parse_page_segments("1-20", 48, 16)
    assert segments is None
    assert "超过容量上限 16" in error


# ---------- 场景一：固定模式兼容 ----------


def test_fixed_mode_response_shape_is_unchanged():
    response = _post()
    assert response.status_code == 200
    body = response.json()
    assert "auto_mode" not in body
    assert "auto_plan" not in body
    assert [s["capacity"] for s in body["signatures"]] == [32]
    for signature in body["signatures"]:
        assert "padding" not in signature
        assert "protected_segments" not in signature
    # 24 页装进 32 容量单帖：末帖补白 8
    assert body["summary"] == {
        "signature_count": 1,
        "sheet_count": 8,
        "blank_count": 8,
    }


def test_fixed_mode_explicit_false_ignores_auto_fields():
    response = _post(auto_mode=False, unbreakable_segments="garbage")
    assert response.status_code == 200
    body = response.json()
    assert "auto_plan" not in body
    assert [s["capacity"] for s in body["signatures"]] == [32]


@pytest.mark.parametrize("total", [1, 8, 9, 25, 2000])
@pytest.mark.parametrize("size", [8, 16, 32])
def test_fixed_mode_pages_unique_and_padding_in_tail(total, size):
    result = impose(total, size, "long_edge")
    pages = sorted(v for *_, v in iter_placed_pages(result) if v is not None)
    assert pages == list(range(1, total + 1))
    assert result["summary"]["blank_count"] == (
        result["summary"]["signature_count"] * size - total
    )
    # 空白只位于最后一帖
    last = result["signatures"][-1]
    earlier_blanks = sum(
        1
        for signature in result["signatures"][:-1]
        for sheet in signature["sheets"]
        for side in ("front", "back")
        for value in (sheet[side]["left"], sheet[side]["right"])
        if value is None
    )
    assert earlier_blanks == 0
    assert last["content_pages"] == total - last["offset"]


def test_auto_mode_false_with_special_pages_keeps_material_plan():
    response = _post(special_pages="1,2,7-8")
    body = response.json()
    assert "material_plan" in body and "auto_plan" not in body


# ---------- 场景二：同成本候选决胜唯一 ----------


def test_equal_cost_plans_resolved_by_lexicographically_larger_sequence():
    # 24 = 16+8 = 8+16：补白均为 0、均为 2 帖，从前向后较大者 [16,8] 唯一胜出
    assert plan_auto_capacities(24, 32, None) == [16, 8]
    assert plan_auto_capacities(40, 32, None) == [32, 8]
    assert plan_auto_capacities(48, 32, None) == [32, 16]


def test_padding_minimized_before_signature_count():
    # 9 页上限 32：[16] 补白 7（1 帖）优于 [8,?]（第二帖至少再补 7，共 2 帖）
    assert plan_auto_capacities(9, 32, None) == [16]
    # 17 页上限 32：[16,8] 总容量 24 补白 7、2 帖；[32] 补白 15 更差
    assert plan_auto_capacities(17, 32, None) == [16, 8]


def test_api_returns_unique_winning_plan():
    response = _post(auto_mode=True)
    assert response.status_code == 200
    body = response.json()
    assert body["auto_mode"] is True
    assert body["auto_plan"]["capacities"] == [16, 8]
    assert body["auto_plan"]["candidate_capacities"] == [8, 16, 32]
    assert body["auto_plan"]["protected_pages"] == []
    assert body["summary"]["signature_count"] == 2
    assert body["summary"]["blank_count"] == 0


def test_auto_mode_page_numbers_unique_and_offsets_cumulative():
    body = _post(auto_mode=True).json()
    assert _placed_pages(body) == list(range(1, 25))
    offsets = [s["offset"] for s in body["signatures"]]
    assert offsets == [0, 16]
    # 边界在 16，恰好是帖间接缝
    assert _boundaries(body["auto_plan"]["capacities"]) == [16]


# ---------- 场景三：受保护页段迫使容量次序改变 ----------


def test_protected_segment_forces_smaller_first_signature():
    # 无约束时 [16,8] 在第 16 页后下刀；段 16-17 覆盖该接缝，迫使 [8,16]
    assert plan_auto_capacities(24, 32, [(16, 17)]) == [8, 16]
    assert plan_auto_capacities(24, 32, [(9, 17)]) == [8, 16]
    # 段只覆盖到 16（接缝在段末页之后，不在段内部），原方案不受影响
    assert plan_auto_capacities(24, 32, [(9, 16)]) == [16, 8]


def test_no_boundary_falls_inside_any_protected_segment():
    body = _post(auto_mode=True, unbreakable_segments="9-17,20-21").json()
    capacities = body["auto_plan"]["capacities"]
    assert capacities == [8, 16]
    for position in _boundaries(capacities):
        for start, end in body["auto_plan"]["protected_pages"]:
            assert not (start <= position < end)


def test_per_signature_padding_and_constraint_hits():
    # 18 页、段 9-17 迫使 [8,16]：末帖只装 10 页，补白 6
    body = _post(
        total_pages=18,
        auto_mode=True,
        unbreakable_segments="9-17",
    ).json()
    assert body["auto_plan"]["capacities"] == [8, 16]
    signatures = body["signatures"]
    assert signatures[0]["padding"] == 0
    assert signatures[0]["protected_segments"] == []
    assert signatures[1]["padding"] == 6
    # 页段 9-17 完整落在第二帖（offset 8、容量 16，覆盖正文 9..24）
    assert signatures[1]["protected_segments"] == [[9, 17]]
    assert body["summary"]["blank_count"] == 6
    # 页码唯一性 + 空白只在末帖
    assert _placed_pages(body) == list(range(1, 19))


def test_material_plan_computed_from_same_auto_result():
    body = _post(
        auto_mode=True,
        special_pages="1,17",
        unbreakable_segments="16-17",
    ).json()
    capacities = body["auto_plan"]["capacities"]
    assert capacities == [8, 16]
    # 第一帖（8 页容量）首纸 {8,1,2,7}：特种页 1 与普通页同纸 → 混纸冲突；
    # 第二帖含第 17 页，材料标记按 16 页帖的页位公式照常计算。
    plan = body["material_plan"]
    assert plan["special_pages"] == [1, 17]
    first_sig_sheets = body["signatures"][0]["sheets"]
    assert first_sig_sheets[0]["material"] == "mixed"
    assert plan["mixed_sheet_count"] >= 1
    conflict = plan["conflicts"][0]
    assert conflict["signature_index"] == 0
    assert conflict["sheet_index"] == 0
    assert conflict["special_pages"] == [1]
    # 全部正文页仍恰好出现一次
    assert _placed_pages(body) == list(range(1, 25))


def test_short_edge_flip_applied_per_mixed_capacity_signature():
    body = _post(
        auto_mode=True,
        flip="short_edge",
        unbreakable_segments="16-17",
    ).json()
    first_sheet = body["signatures"][0]["sheets"][0]
    # 8 页帖短边：正面 8|1，背面左右互换为 7|2
    assert first_sheet["front"] == {"left": 8, "right": 1}
    assert first_sheet["back"] == {"left": 7, "right": 2}


# ---------- 场景四：非法页段 / 无解 ----------


@pytest.mark.parametrize(
    "raw,keyword",
    [
        ("abc", "格式"),
        ("16", "格式"),
        ("1-2-3", "格式"),
        ("20-10", "倒序"),
        ("20-25", "1 至 24"),
    ],
)
def test_api_rejects_invalid_segments_with_field_error(raw, keyword):
    response = _post(auto_mode=True, unbreakable_segments=raw)
    assert response.status_code == 422
    body = response.json()
    assert body["error"] == "validation_failed"
    assert keyword in body["fields"]["unbreakable_segments"]


def test_api_rejects_segment_longer_than_capacity():
    response = _post(
        total_pages=48,
        pages_per_signature=16,
        auto_mode=True,
        unbreakable_segments="1-20",
    )
    assert response.status_code == 422
    assert "超过容量上限" in (
        response.json()["fields"]["unbreakable_segments"]
    )


def test_api_rejects_non_boolean_auto_mode():
    response = _post(auto_mode="true")
    assert response.status_code == 422
    assert "布尔" in response.json()["fields"]["auto_mode"]


def test_api_returns_chinese_reason_when_all_candidates_blocked():
    # 上限 8（唯一候选容量）：段 5-10 横跨第 8 页这一唯一下刀位置 → 无解
    response = _post(
        total_pages=16,
        pages_per_signature=8,
        auto_mode=True,
        unbreakable_segments="5-10",
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"] == "planning_failed"
    message = body["fields"]["unbreakable_segments"]
    assert "不可拆页段" in message and "无解" in message


def test_no_solution_when_segment_cannot_fit_any_alignment():
    # 24 页上限 16（候选 8/16）：段 7-17 使 8、16 两个网格边界全部被阻断
    assert plan_auto_capacities(24, 16, [(7, 17)]) is None
    response = _post(
        pages_per_signature=16,
        auto_mode=True,
        unbreakable_segments="7-17",
    )
    assert response.status_code == 422
    assert response.json()["error"] == "planning_failed"
