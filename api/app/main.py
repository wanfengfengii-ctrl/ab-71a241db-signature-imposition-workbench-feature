"""FastAPI 入口：只暴露书帖编排这一条链路。"""

from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from .imposition import impose
from .validation import (
    parse_protected_segments,
    parse_special_pages,
    validate_imposition_request,
)

app = FastAPI(title="骑马订书帖编排 API", version="1.0.0")


class ImposeRequest(BaseModel):
    # 全部收为 Any 并手工严格校验：空串、null、浮点、布尔、越权枚举都要返回统一字段错误
    model_config = ConfigDict(extra="ignore")

    total_pages: Any = None
    pages_per_signature: Any = None
    flip: Any = None
    special_pages: Any = None
    auto_mode: Any = None
    protected_segments: Any = None


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
    # 自动混合容量：仅 auto_mode 为 true 时启用；不可拆页段留空则不设约束。
    # 未启用时 protected_segments 被忽略，请求 / 响应保持兼容。
    protected_segments = None
    if values.get("auto_mode") is True:
        protected_segments = []
        raw_segments = values.get("protected_segments")
        if isinstance(raw_segments, str) and raw_segments.strip():
            protected_segments, _ = parse_protected_segments(
                raw_segments,
                values["total_pages"],
                values["pages_per_signature"],
            )
    return impose(
        total_pages=values["total_pages"],
        pages_per_signature=values["pages_per_signature"],
        flip=values["flip"],
        special_pages=special_pages,
        protected_segments=protected_segments,
    )
