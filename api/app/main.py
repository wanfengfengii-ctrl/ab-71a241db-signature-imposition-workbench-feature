"""FastAPI 入口：只暴露书帖编排这一条链路。"""

from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from .imposition import impose
from .validation import (
    parse_page_segments,
    parse_special_pages,
    validate_imposition_request,
)

app = FastAPI(title="骑马订书帖编排 API", version="1.1.0")


class ImposeRequest(BaseModel):
    # 全部收为 Any 并手工严格校验：空串、null、浮点、布尔、越权枚举都要返回统一字段错误
    model_config = ConfigDict(extra="ignore")

    total_pages: Any = None
    pages_per_signature: Any = None
    flip: Any = None
    special_pages: Any = None
    auto_mode: Any = None
    unbreakable_segments: Any = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/impose")
def impose_endpoint(request: ImposeRequest) -> Any:
    values = request.model_dump()
    errors = validate_imposition_request(values)
    if errors:
        return JSONResponse(
            status_code=422,
            content={"error": "validation_failed", "fields": errors},
        )

    # 可选的特种纸页码范围：留空即按原参数编排，响应保持原结构
    special_pages = None
    raw_special = values.get("special_pages")
    if isinstance(raw_special, str) and raw_special.strip():
        special_pages, _ = parse_special_pages(
            raw_special, values["total_pages"]
        )

    auto_mode = values.get("auto_mode") is True
    protected_segments = None
    if auto_mode:
        raw_segments = values.get("unbreakable_segments")
        if isinstance(raw_segments, str) and raw_segments.strip():
            protected_segments, _ = parse_page_segments(
                raw_segments,
                values["total_pages"],
                values["pages_per_signature"],
            )

    try:
        return impose(
            total_pages=values["total_pages"],
            pages_per_signature=values["pages_per_signature"],
            flip=values["flip"],
            special_pages=special_pages,
            auto_mode=auto_mode,
            protected_segments=protected_segments,
        )
    except ValueError as exc:
        # 约束阻断：字段值都合法，但不可拆页段让全部候选容量方案无解
        return JSONResponse(
            status_code=422,
            content={
                "error": "planning_failed",
                "fields": {"unbreakable_segments": str(exc)},
            },
        )
