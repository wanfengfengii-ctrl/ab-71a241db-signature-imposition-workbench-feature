"""pytest：自动混合容量 + 不可拆页段（固定模式兼容 / 决胜唯一 / 页段约束 / 失败反馈）。"""

from fastapi.testclient import TestClient

from app.imposition import impose, iter_placed_pages, plan_capacities
from app.main import app
from app.validation import parse_protected_segments

client = TestClient(app)

AUTO_PAYLOAD = {
    "total_pages": 24,
    "pages_per_signature": 32,
    "flip": "long_edge",
    "auto_mode": True,
}


def _post(**overrides):
    payload = {**AUTO_PAYLOAD, **overrides}
    return client.post("/impose", json=payload)


def _placed_pages(body):
    pages = []
    for signature in body["signatures"]:
        for sheet in signature["sheets"]:
            for side in ("front", "back"):
                for position in ("left", "right"):
                    value = sheet[side][position]
                    if value is not None:
                        pages.append(value)
    return pages


# ---------- 容量规划：决胜规则 ----------


def test_plan_prefers_fewest_blanks_then_fewest_signatures():
    # 33 页：32+8 补白 7，优于 32+16（15）与 32+32（31）
    capacities, error = plan_capacities(33, 32, [])
    assert error is None
    assert capacities == [32, 8]
    # 8 页：直接 8，而不是补白更多的 16 / 32
    capacities, error = plan_capacities(8, 32, [])
    assert error is None
    assert capacities == [8]


def test_plan_unique_winner_among_same_cost_candidates():
    # 24 页上限 32：补白 0 且 2 帖的候选为 [8,16] 与 [16,8]，
    # 容量序列从前向后较大者优先 → 唯一方案 [16, 8]
    capacities, error = plan_capacities(24, 32, [])
    assert error is None
    assert capacities == [16, 8]
    # 40 页：同为补白 0、2 帖的 [8,32] 与 [32,8] → [32, 8]
    capacities, error = plan_capacities(40, 32, [])
    assert error is None
    assert capacities == [32, 8]


def test_plan_respects_capacity_cap():
    # 上限 16 时候选只有 8 / 16
    capacities, error = plan_capacities(24, 16, [])
    assert error is None
    assert capacities == [16, 8]
    # 上限 8 时只能全 8
    capacities, error = plan_capacities(24, 8, [])
    assert error is None
    assert capacities == [8, 8, 8]


def test_plan_protected_segment_forces_capacity_order_change():
    # 页段 16-24 禁止边界落在 16..23：[16,8] 的边界 16 被阻断，
    # 唯一可行次序变为 [8, 16]
    capacities, error = plan_capacities(24, 32, [(16, 24)])
    assert error is None
    assert capacities == [8, 16]


def test_plan_all_candidates_blocked_returns_reason():
    # 上限 8 时边界只能落在 8，而页段 3-10 禁止 3..9 → 无解
    capacities, error = plan_capacities(16, 8, [(3, 10)])
    assert capacities is None
    assert "阻断" in error


# ---------- 页段解析：合并与非法输入 ----------


def test_parse_merges_overlapping_and_adjacent_segments():
    segments, error = parse_protected_segments("10-12,1-4,3-6,8-8,14", 24, 32)
    assert error is None
    # 1-4 与 3-6 重叠合并为 1-6；单页 8 与 14 各自成段；乱序输入先排序
    assert segments == [(1, 6), (8, 8), (10, 12), (14, 14)]
    segments, error = parse_protected_segments("1-4,5-8", 24, 32)
    assert error is None
    assert segments == [(1, 8)]  # 相邻项合并


def test_parse_rejects_invalid_segments():
    for raw, keyword in [
        ("abc", "格式"),
        ("1,,2", "格式"),
        ("1-2-3", "格式"),
        ("3,", "格式"),
        ("5-3", "倒序"),
        ("9", "超出"),
        ("0", "超出"),
        ("2-9", "超出"),
    ]:
        segments, error = parse_protected_segments(raw, 8, 32)
        assert segments is None, raw
        assert keyword in error, raw


def test_parse_rejects_segment_longer_than_capacity_cap():
    # 合并前各自不超长，合并后 1-17 共 17 页超过上限 16
    segments, error = parse_protected_segments("1-10,11-17", 24, 16)
    assert segments is None
    assert "容量上限" in error
    segments, error = parse_protected_segments("1-20", 24, 16)
    assert segments is None
    assert "容量上限" in error


# ---------- 场景一：固定模式保持兼容 ----------


def test_fixed_mode_response_has_no_auto_fields():
    for payload_extra in (
        {},
        {"auto_mode": False},
        {"protected_segments": "16-24"},  # 未启用自动模式时忽略页段
    ):
        response = client.post(
            "/impose",
            json={
                "total_pages": 24,
                "pages_per_signature": 32,
                "flip": "long_edge",
                **payload_extra,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert "auto_plan" not in body
        assert body["summary"] == {
            "signature_count": 1,
            "sheet_count": 8,
            "blank_count": 8,
        }
        for signature in body["signatures"]:
            assert "blank_count" not in signature
            assert "protected_segments" not in signature


def test_impose_fixed_mode_result_unchanged():
    assert impose(24, 32, "long_edge") == impose(
        24, 32, "long_edge", None, None
    )


# ---------- 场景二：同成本候选，决胜唯一 ----------


def test_auto_plan_unique_winner_drives_original_formula():
    response = _post()
    assert response.status_code == 200
    body = response.json()
    plan = body["auto_plan"]
    assert plan["max_capacity"] == 32
    assert plan["candidates"] == [8, 16, 32]
    assert plan["capacities"] == [16, 8]
    assert plan["protected_segments"] == []

    first, second = body["signatures"]
    # 逐帖容量与累计偏移驱动原页位公式
    assert (first["capacity"], first["offset"]) == (16, 0)
    assert (second["capacity"], second["offset"]) == (8, 16)
    assert first["sheets"][0]["front"] == {"left": 16, "right": 1}
    assert first["sheets"][0]["back"] == {"left": 2, "right": 15}
    assert second["sheets"][0]["front"] == {"left": 24, "right": 17}
    assert second["sheets"][0]["back"] == {"left": 18, "right": 23}
    # 逐帖补白
    assert first["blank_count"] == 0
    assert second["blank_count"] == 0
    assert body["summary"]["blank_count"] == 0
    # 页码唯一性
    assert sorted(_placed_pages(body)) == list(range(1, 25))


def test_auto_blanks_only_in_last_signature_tail():
    response = _post(total_pages=33)
    assert response.status_code == 200
    body = response.json()
    assert body["auto_plan"]["capacities"] == [32, 8]
    first, second = body["signatures"]
    assert first["blank_count"] == 0
    assert second["blank_count"] == 7
    assert body["summary"]["blank_count"] == 7
    blanks = [
        (signature["index"], sheet["index"], side, position)
        for signature in body["signatures"]
        for sheet in signature["sheets"]
        for side in ("front", "back")
        for position in ("left", "right")
        if sheet[side][position] is None
    ]
    assert len(blanks) == 7
    assert all(signature_index == 1 for signature_index, *_ in blanks)
    assert sorted(_placed_pages(body)) == list(range(1, 34))


def test_auto_every_page_exactly_once_across_sizes():
    for total in (1, 7, 24, 33, 2000):
        for size in (8, 16, 32):
            result = impose(total, size, "long_edge", protected_segments=[])
            pages = [
                item[4] for item in iter_placed_pages(result) if item[4] is not None
            ]
            assert sorted(pages) == list(range(1, total + 1))
            assert result["summary"]["blank_count"] == (
                sum(result["auto_plan"]["capacities"]) - total
            )


# ---------- 场景三：受保护页段迫使容量次序改变 ----------


def test_protected_segment_changes_capacity_order():
    response = _post(protected_segments="16-24")
    assert response.status_code == 200
    body = response.json()
    assert body["auto_plan"]["capacities"] == [8, 16]
    assert body["auto_plan"]["protected_segments"] == [[16, 24]]
    first, second = body["signatures"]
    assert (first["capacity"], first["offset"]) == (8, 0)
    assert (second["capacity"], second["offset"]) == (16, 8)
    # 约束命中情况逐帖标注：页段 16-24 落在第 2 帖内
    assert first["protected_segments"] == []
    assert second["protected_segments"] == [[16, 24]]
    assert sorted(_placed_pages(body)) == list(range(1, 25))


def test_overlapping_and_adjacent_segments_merge_before_planning():
    response = _post(protected_segments="16-20,21-24")
    assert response.status_code == 200
    body = response.json()
    assert body["auto_plan"]["protected_segments"] == [[16, 24]]
    assert body["auto_plan"]["capacities"] == [8, 16]


# ---------- 场景四：非法或无解页段 → 字段错误 ----------


def test_invalid_segments_return_field_error():
    for raw, keyword in [
        ("abc", "格式"),
        ("1-2-3", "格式"),
        ("20-16", "倒序"),
        ("9-40", "1 至 24"),
        ("0", "1 至 24"),
    ]:
        response = _post(protected_segments=raw)
        assert response.status_code == 422, raw
        body = response.json()
        assert body["error"] == "validation_failed"
        assert keyword in body["fields"]["protected_segments"], raw


def test_segment_longer_than_capacity_cap_returns_field_error():
    response = _post(pages_per_signature=16, protected_segments="1-20")
    assert response.status_code == 422
    assert "容量上限" in response.json()["fields"]["protected_segments"]


def test_all_candidates_blocked_returns_field_error():
    response = _post(
        total_pages=16, pages_per_signature=8, protected_segments="3-10"
    )
    assert response.status_code == 422
    assert "阻断" in response.json()["fields"]["protected_segments"]


def test_invalid_auto_mode_returns_field_error():
    for bad in ("yes", 1, 0):
        response = _post(auto_mode=bad)
        assert response.status_code == 422, bad
        assert "auto_mode" in response.json()["fields"]


def test_non_string_segments_return_field_error():
    response = _post(protected_segments=123)
    assert response.status_code == 422
    assert "protected_segments" in response.json()["fields"]


# ---------- 自动模式 × 材料计划：同一结果计算既有标记 ----------


def test_auto_mode_with_material_plan():
    response = _post(special_pages="1,2,15-16")
    assert response.status_code == 200
    body = response.json()
    assert body["auto_plan"]["capacities"] == [16, 8]
    plan = body["material_plan"]
    assert plan["special_pages"] == [1, 2, 15, 16]
    # 第 1 帖第 1 张纸 {16,1,2,15} 全为特种页 → 可整纸换料
    assert plan["special_sheet_count"] == 1
    assert plan["mixed_sheet_count"] == 0
    assert body["signatures"][0]["sheets"][0]["material"] == "special"
    assert body["signatures"][0]["sheets"][1]["material"] == "normal"


def test_auto_mode_material_conflict_detail():
    response = _post(special_pages="9-16")
    assert response.status_code == 200
    plan = response.json()["material_plan"]
    # 特种页 9-16 落在第 1 帖全部 4 张纸上，每张均混纸
    assert plan["mixed_sheet_count"] == 4
    assert plan["conflicts"][0] == {
        "signature_index": 0,
        "sheet_index": 0,
        "special_pages": [15, 16],
        "normal_pages": [1, 2],
    }
