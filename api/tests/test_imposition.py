"""pytest：FastAPI 编排链路（与前端、E2E 覆盖同一套规则）。"""

from fastapi.testclient import TestClient

from app.imposition import (
    FLIP_MODES,
    SHORT_EDGE,
    impose,
    iter_placed_pages,
)
from app.main import app

client = TestClient(app)


def test_basic_eight_page_signature_long_edge():
    result = impose(8, 8, "long_edge")
    sheet0 = result["signatures"][0]["sheets"][0]
    assert sheet0["front"] == {"left": 8, "right": 1}
    assert sheet0["back"] == {"left": 2, "right": 7}
    sheet1 = result["signatures"][0]["sheets"][1]
    assert sheet1["front"] == {"left": 6, "right": 3}
    assert sheet1["back"] == {"left": 4, "right": 5}
    assert result["summary"]["blank_count"] == 0


def test_short_edge_swaps_back_positions():
    long_edge = impose(8, 8, "long_edge")
    short_edge = impose(8, 8, "short_edge")
    for long_sheet, short_sheet in zip(
        long_edge["signatures"][0]["sheets"],
        short_edge["signatures"][0]["sheets"],
    ):
        assert short_sheet["front"] == long_sheet["front"]
        assert short_sheet["back"]["left"] == long_sheet["back"]["right"]
        assert short_sheet["back"]["right"] == long_sheet["back"]["left"]


def test_padding_only_in_last_signature_tail():
    result = impose(5, 8, "long_edge")
    assert result["summary"]["signature_count"] == 1
    assert result["summary"]["blank_count"] == 3
    values = [item[4] for item in iter_placed_pages(result)]
    assert values.count(None) == 3
    pages = [v for v in values if v is not None]
    assert sorted(pages) == [1, 2, 3, 4, 5]
    sheets = result["signatures"][0]["sheets"]
    # N=8 共 2 张纸；超出正文的位置 6/7/8 即帖尾三处空白
    assert sheets[0]["front"] == {"left": None, "right": 1}
    assert sheets[0]["back"] == {"left": 2, "right": None}
    assert sheets[1]["front"] == {"left": None, "right": 3}
    assert sheets[1]["back"] == {"left": 4, "right": 5}


def test_offsets_across_signatures():
    result = impose(9, 8, "long_edge")
    assert result["summary"]["signature_count"] == 2
    second = result["signatures"][1]
    assert second["offset"] == 8
    assert second["sheets"][0]["front"] == {"left": None, "right": 9}
    blanks = [item[4] for item in iter_placed_pages(result) if item[4] is None]
    assert len(blanks) == 7
    pages = [item[4] for item in iter_placed_pages(result) if item[4] is not None]
    assert sorted(pages) == list(range(1, 10))


def test_sixteen_page_signature_sheet_count():
    result = impose(16, 16, "long_edge")
    assert len(result["signatures"][0]["sheets"]) == 4
    assert result["signatures"][0]["sheets"][0]["front"] == {"left": 16, "right": 1}


def test_every_content_page_appears_exactly_once():
    for total in (1, 7, 8, 9, 2000):
        for size in (8, 16, 32):
            for flip in FLIP_MODES:
                result = impose(total, size, flip)
                pages = [
                    item[4]
                    for item in iter_placed_pages(result)
                    if item[4] is not None
                ]
                assert sorted(pages) == list(range(1, total + 1))
                assert result["summary"]["blank_count"] == (
                    result["summary"]["signature_count"] * size - total
                )


def test_api_accepts_valid_request():
    response = client.post(
        "/impose",
        json={"total_pages": 12, "pages_per_signature": 8, "flip": "long_edge"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["total_pages"] == 12
    assert data["summary"]["signature_count"] == 2


def test_api_returns_field_errors():
    cases = [
        {},
        {"total_pages": None, "pages_per_signature": 8, "flip": "long_edge"},
        {"total_pages": "", "pages_per_signature": 8, "flip": "long_edge"},
        {"total_pages": "12", "pages_per_signature": 8, "flip": "long_edge"},
        {"total_pages": 12.0, "pages_per_signature": 8, "flip": "long_edge"},
        {"total_pages": 0, "pages_per_signature": 8, "flip": "long_edge"},
        {"total_pages": 2001, "pages_per_signature": 8, "flip": "long_edge"},
        {"total_pages": 12, "pages_per_signature": 4, "flip": "long_edge"},
        {"total_pages": 12, "pages_per_signature": "8", "flip": "long_edge"},
        {"total_pages": 12, "pages_per_signature": 8, "flip": "sideways"},
        {"total_pages": 12, "pages_per_signature": 8, "flip": ""},
    ]
    for payload in cases:
        response = client.post("/impose", json=payload)
        assert response.status_code == 422, payload
        body = response.json()
        assert body["error"] == "validation_failed"
        assert body["fields"]


def test_health():
    assert client.get("/health").json() == {"status": "ok"}
