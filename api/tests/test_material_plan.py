"""pytest：特种纸页码范围 → 材料计划（换料 / 混纸冲突 / 非法范围 / 未填写兼容）。"""

from fastapi.testclient import TestClient

from app.imposition import impose
from app.main import app
from app.validation import parse_special_pages

client = TestClient(app)

BASE_PAYLOAD = {"total_pages": 8, "pages_per_signature": 8, "flip": "long_edge"}


def _post(**overrides):
    payload = {**BASE_PAYLOAD, **overrides}
    return client.post("/impose", json=payload)


# ---------- 范围解析：归一化与非法输入 ----------


def test_parse_normalizes_duplicates_and_unordered_tokens():
    pages, error = parse_special_pages("8, 1,2,7-8,7,2", 8)
    assert error is None
    assert pages == {1, 2, 7, 8}


def test_parse_rejects_bad_format_reversed_and_out_of_range():
    for raw, keyword in [
        ("abc", "格式"),
        ("1,,2", "格式"),
        ("1-2-3", "格式"),
        ("-3", "格式"),
        ("3,", "格式"),
        ("5-3", "倒序"),
        ("9", "超出"),
        ("0", "超出"),
    ]:
        pages, error = parse_special_pages(raw, 8)
        assert pages is None, raw
        assert keyword in error, raw


# ---------- 场景一：未填写范围，保持原响应结构 ----------


def test_omitted_special_pages_keeps_original_response_shape():
    for payload_extra in ({}, {"special_pages": ""}, {"special_pages": "   "}):
        response = client.post("/impose", json={**BASE_PAYLOAD, **payload_extra})
        assert response.status_code == 200
        body = response.json()
        assert "material_plan" not in body
        assert body["summary"] == {
            "signature_count": 1,
            "sheet_count": 2,
            "blank_count": 0,
        }
        for signature in body["signatures"]:
            for sheet in signature["sheets"]:
                assert "material" not in sheet


def test_impose_without_special_pages_matches_previous_result():
    assert impose(8, 8, "long_edge") == impose(8, 8, "long_edge", None)


# ---------- 场景二：有效换料 ----------


def test_valid_special_pages_marks_switchable_sheets():
    response = _post(special_pages="1,2,7-8")
    assert response.status_code == 200
    body = response.json()
    sheets = body["signatures"][0]["sheets"]
    # 第 1 张纸 {8,1,2,7} 全为特种页 → 可整纸换料；第 2 张 {6,3,4,5} 全普通
    assert sheets[0]["material"] == "special"
    assert sheets[1]["material"] == "normal"
    plan = body["material_plan"]
    assert plan["special_pages"] == [1, 2, 7, 8]
    assert plan["special_sheet_count"] == 1
    assert plan["mixed_sheet_count"] == 0
    assert plan["conflicts"] == []


def test_blank_slots_do_not_participate_in_material_judgement():
    # 5 页正文：第 1 张纸带两个空白位，正文页 1、2 全为特种页 → 仍判特种纸
    response = _post(total_pages=5, special_pages="1,2")
    assert response.status_code == 200
    sheets = response.json()["signatures"][0]["sheets"]
    assert sheets[0]["material"] == "special"
    assert sheets[1]["material"] == "normal"


# ---------- 场景三：混纸冲突 ----------


def test_mixed_sheet_reports_conflict_detail():
    response = _post(special_pages="3-5")
    assert response.status_code == 200
    body = response.json()
    sheets = body["signatures"][0]["sheets"]
    assert sheets[0]["material"] == "normal"
    assert sheets[1]["material"] == "mixed"
    plan = body["material_plan"]
    assert plan["special_sheet_count"] == 0
    assert plan["mixed_sheet_count"] == 1
    assert plan["conflicts"] == [
        {
            "signature_index": 0,
            "sheet_index": 1,
            "special_pages": [3, 4, 5],
            "normal_pages": [6],
        }
    ]


def test_conflicts_span_multiple_signatures():
    # 16 页两帖：第 1 帖第 1 张 {8,1,2,7}、第 2 帖第 1 张 {16,9,10,15} 均混纸
    response = _post(total_pages=16, special_pages="1,9")
    assert response.status_code == 200
    plan = response.json()["material_plan"]
    assert plan["mixed_sheet_count"] == 2
    assert plan["conflicts"] == [
        {
            "signature_index": 0,
            "sheet_index": 0,
            "special_pages": [1],
            "normal_pages": [2, 7, 8],
        },
        {
            "signature_index": 1,
            "sheet_index": 0,
            "special_pages": [9],
            "normal_pages": [10, 15, 16],
        },
    ]


# ---------- 场景四：非法范围 → 字段错误 ----------


def test_invalid_special_pages_returns_field_error():
    for raw, keyword in [
        ("abc", "格式"),
        ("1-2-3", "格式"),
        ("5-3", "倒序"),
        ("9", "1 至 8"),
        ("0", "1 至 8"),
    ]:
        response = _post(special_pages=raw)
        assert response.status_code == 422, raw
        body = response.json()
        assert body["error"] == "validation_failed"
        assert keyword in body["fields"]["special_pages"], raw


def test_special_pages_error_alongside_other_field_errors():
    response = _post(total_pages="x", special_pages="5-3")
    assert response.status_code == 422
    fields = response.json()["fields"]
    assert "total_pages" in fields
    assert "倒序" in fields["special_pages"]
