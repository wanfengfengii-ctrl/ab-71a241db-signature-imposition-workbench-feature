import { useMemo, useState } from "react";

import { requestImposition, downloadResultJson } from "./lib/api.js";
import {
  ALLOWED_SIGNATURE_SIZES,
  FLIP_MODES,
  auditResult,
} from "./lib/imposition.js";

const FLIP_LABELS = {
  long_edge: "长边翻转（沿竖边翻页，背面保持次序）",
  short_edge: "短边翻转（沿横边翻页，交换每张纸背面左右）",
};

const MATERIAL_LABELS = {
  normal: "普通纸",
  special: "特种纸",
  mixed: "混纸冲突",
};

function PageCell({ value, side, position, sheetIndex, materialRole }) {
  const isBlank = value === null || value === undefined;
  const roleClass = !isBlank && materialRole ? `is-${materialRole}-page` : "";
  return (
    <td
      className={`page-cell ${isBlank ? "is-blank" : ""} ${roleClass}`}
      data-testid={`cell-${side}-${position}`}
      data-side={side}
      data-position={position}
      data-sheet-index={sheetIndex}
      data-material-role={isBlank ? undefined : materialRole}
    >
      {isBlank ? <span className="blank">空白</span> : value}
    </td>
  );
}

function SheetRow({ sheet, showMaterial, specialPages }) {
  const material = sheet.material;
  // 混纸冲突时逐页位标出特种页 / 普通页，空白位不参与
  const roleOf = (value) =>
    material === "mixed" && value !== null && value !== undefined
      ? specialPages.has(value)
        ? "special"
        : "normal"
      : null;
  return (
    <tr data-sheet={sheet.index} className={material ? `is-${material}` : ""}>
      <th scope="row" className="sheet-label">
        第 {sheet.index + 1} 张纸
      </th>
      <PageCell
        value={sheet.front.left}
        side="front"
        position="left"
        sheetIndex={sheet.index}
        materialRole={roleOf(sheet.front.left)}
      />
      <PageCell
        value={sheet.front.right}
        side="front"
        position="right"
        sheetIndex={sheet.index}
        materialRole={roleOf(sheet.front.right)}
      />
      <PageCell
        value={sheet.back.left}
        side="back"
        position="left"
        sheetIndex={sheet.index}
        materialRole={roleOf(sheet.back.left)}
      />
      <PageCell
        value={sheet.back.right}
        side="back"
        position="right"
        sheetIndex={sheet.index}
        materialRole={roleOf(sheet.back.right)}
      />
      {showMaterial && (
        <td
          className={`material-cell material-${material}`}
          data-testid="cell-material"
          data-material={material}
        >
          {MATERIAL_LABELS[material] ?? material}
        </td>
      )}
    </tr>
  );
}

function SignatureCard({ signature, flip, materialPlan }) {
  const showMaterial = Boolean(materialPlan);
  const specialPages = useMemo(
    () => new Set(materialPlan?.special_pages ?? []),
    [materialPlan]
  );
  const hasConflict =
    materialPlan?.conflicts.some(
      (conflict) => conflict.signature_index === signature.index
    ) ?? false;
  return (
    <section
      className={`signature-card ${hasConflict ? "has-conflict" : ""}`}
      data-testid="signature-card"
    >
      <h3>
        第 {signature.index + 1} 帖
        <span className="sig-meta">
          （含正文 {signature.content_pages} 页 / 容量 {signature.capacity}
          ，帖偏移 {signature.offset}）
        </span>
        {hasConflict && <span className="conflict-flag">含混纸冲突</span>}
      </h3>
      <table className="sheets-table">
        <thead>
          <tr>
            <th rowSpan={2}>纸张</th>
            <th colSpan={2}>正面</th>
            <th colSpan={2}>背面</th>
            {showMaterial && <th rowSpan={2}>材料</th>}
          </tr>
          <tr>
            <th>左</th>
            <th>右</th>
            <th>左{flip === "short_edge" ? " ·短边" : ""}</th>
            <th>右</th>
          </tr>
        </thead>
        <tbody>
          {signature.sheets.map((sheet) => (
            <SheetRow
              key={sheet.index}
              sheet={sheet}
              showMaterial={showMaterial}
              specialPages={specialPages}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function FieldError({ children }) {
  if (!children) return null;
  return (
    <p className="field-error" role="alert">
      {children}
    </p>
  );
}

function Check({ ok, children }) {
  return (
    <p className={`check ${ok ? "ok" : "bad"}`}>
      <span aria-hidden="true">{ok ? "✓" : "✗"}</span> {children}
    </p>
  );
}

function MaterialPlanPanel({ plan }) {
  const hasConflicts = plan.conflicts.length > 0;
  return (
    <section
      className={`material-plan ${hasConflicts ? "has-conflict" : ""}`}
      data-testid="material-plan"
    >
      <h3>材料计划</h3>
      <ul className="material-summary">
        <li data-testid="summary-special-sheets">
          可换料纸张 <strong>{plan.special_sheet_count}</strong> 张
        </li>
        <li data-testid="summary-mixed-sheets">
          混纸冲突 <strong>{plan.mixed_sheet_count}</strong> 张
        </li>
        <li data-testid="summary-special-pages">
          特种纸页码：
          <strong>{plan.special_pages.join("、")}</strong>
        </li>
      </ul>
      {hasConflicts ? (
        <div className="conflicts" data-testid="conflict-list">
          <p className="conflict-title">
            以下纸张同时承载普通页与特种页，无法按当前编排换料生产：
          </p>
          <ul>
            {plan.conflicts.map((conflict) => (
              <li
                key={`${conflict.signature_index}-${conflict.sheet_index}`}
                className="conflict-item"
                data-testid="conflict-item"
              >
                第 {conflict.signature_index + 1} 帖 · 第{" "}
                {conflict.sheet_index + 1} 张纸：特种页{" "}
                <strong className="special-pages">
                  {conflict.special_pages.join("、")}
                </strong>
                ，普通页{" "}
                <strong className="normal-pages">
                  {conflict.normal_pages.join("、")}
                </strong>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="check ok" data-testid="no-conflict">
          <span aria-hidden="true">✓</span> 无混纸冲突，特种页均可整纸换料
        </p>
      )}
    </section>
  );
}

export default function App() {
  const [totalPagesInput, setTotalPagesInput] = useState("");
  const [pagesPerSignature, setPagesPerSignature] = useState(8);
  const [flip, setFlip] = useState("long_edge");
  const [specialPagesInput, setSpecialPagesInput] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fatalError, setFatalError] = useState("");

  const audit = useMemo(() => (result ? auditResult(result) : null), [result]);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setFatalError("");
    try {
      const trimmed = totalPagesInput.trim();
      // 空输入直接送 null，由 API 判定“为空”；数字解析交给 API 严格校验
      const totalPages = trimmed === "" ? null : Number(trimmed);
      // 特种纸范围留空时不带该字段，按原参数调用
      const specialTrimmed = specialPagesInput.trim();
      const response = await requestImposition({
        totalPages,
        pagesPerSignature,
        flip,
        specialPages: specialTrimmed === "" ? null : specialTrimmed,
      });
      if (!response.ok) {
        // 任一输入为空/非整数/越界/不在集合内：清除旧版面并显示字段错误
        setResult(null);
        setFieldErrors(response.fields);
        return;
      }
      setFieldErrors({});
      setResult(response.data);
    } catch {
      setResult(null);
      setFieldErrors({});
      setFatalError("编排服务暂时不可用，请稍后重试或检查 API。");
    } finally {
      setLoading(false);
    }
  }

  function handleTotalPagesChange(value) {
    setTotalPagesInput(value);
    // 输入被清空时立即清除旧版面，避免展示与当前输入不符的结果
    if (value.trim() === "") {
      setResult(null);
      setFieldErrors({});
      setFatalError("");
    }
  }

  return (
    <main className="page">
      <h1>骑马订书帖编排</h1>
      <p className="intro">
        输入正文总页数、每帖页数与翻转方式，系统按每帖独立补白、逐纸落位，
        帮你避免倒页、重页、漏页。可另填特种纸页码范围（如 3,5-8），
        直接看出哪些纸张可换料、哪些因混纸无法按当前编排生产。
      </p>

      <form className="controls" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="totalPages">正文总页数</label>
          <input
            id="totalPages"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={totalPagesInput}
            onChange={(event) => handleTotalPagesChange(event.target.value)}
            placeholder="1 – 2000 的整数"
            aria-invalid={Boolean(fieldErrors.total_pages)}
            data-testid="input-total-pages"
          />
          <FieldError>{fieldErrors.total_pages}</FieldError>
        </div>

        <div className="field">
          <label htmlFor="pagesPerSignature">每帖页数</label>
          <select
            id="pagesPerSignature"
            value={pagesPerSignature}
            onChange={(event) => setPagesPerSignature(Number(event.target.value))}
            data-testid="select-size"
          >
            {ALLOWED_SIGNATURE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} 页/帖
              </option>
            ))}
          </select>
          <FieldError>{fieldErrors.pages_per_signature}</FieldError>
        </div>

        <div className="field">
          <label htmlFor="flip">翻转方式</label>
          <select
            id="flip"
            value={flip}
            onChange={(event) => setFlip(event.target.value)}
            data-testid="select-flip"
          >
            {FLIP_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {FLIP_LABELS[mode]}
              </option>
            ))}
          </select>
          <FieldError>{fieldErrors.flip}</FieldError>
        </div>

        <div className="field">
          <label htmlFor="specialPages">特种纸页码范围（可选）</label>
          <input
            id="specialPages"
            type="text"
            autoComplete="off"
            value={specialPagesInput}
            onChange={(event) => setSpecialPagesInput(event.target.value)}
            placeholder="如 3,5-8；留空为全部普通纸"
            aria-invalid={Boolean(fieldErrors.special_pages)}
            data-testid="input-special-pages"
          />
          <FieldError>{fieldErrors.special_pages}</FieldError>
        </div>

        <button type="submit" disabled={loading} data-testid="submit-btn">
          {loading ? "编排中…" : "生成书帖"}
        </button>
      </form>

      {fatalError && (
        <p className="fatal-error" role="alert">
          {fatalError}
        </p>
      )}

      {result && (
        <div className="result" data-testid="result-panel">
          <div className="result-head">
            <h2>编排结果</h2>
            <button
              type="button"
              className="secondary"
              onClick={() => downloadResultJson(result)}
              data-testid="download-json"
            >
              下载 JSON（同内容）
            </button>
          </div>

          <ul className="summary">
            <li>
              正文 <strong>{result.total_pages}</strong> 页
            </li>
            <li>
              每帖 <strong>{result.pages_per_signature}</strong> 页
            </li>
            <li data-testid="summary-signatures">
              共 <strong>{result.summary.signature_count}</strong> 帖 /{" "}
              <strong>{result.summary.sheet_count}</strong> 张纸
            </li>
            <li data-testid="summary-blanks">
              补白 <strong>{result.summary.blank_count}</strong> 处
            </li>
            <li>
              翻转方式：
              <strong>
                {result.flip === "short_edge" ? "短边翻转" : "长边翻转"}
              </strong>
            </li>
          </ul>

          <section className="audit" data-testid="audit">
            <h3>印前自检</h3>
            <Check ok={audit?.everyPageOnce}>
              每个正文页 1…{result.total_pages} 恰好出现一次（无倒页、重页、漏页）
            </Check>
            <Check ok={audit?.blanksOnlyInTail}>
              空白页位全部位于最后一帖（补白只在末帖尾部，不会变成页码）
            </Check>
            <Check ok>
              {result.flip === "short_edge"
                ? "短边翻转：每张纸背面左右已交换，可据此区分正背面"
                : "长边翻转：每张纸背面保持次序，可据此区分正背面"}
            </Check>
          </section>

          {result.material_plan && (
            <MaterialPlanPanel plan={result.material_plan} />
          )}

          <div className="signatures" data-testid="signatures">
            {result.signatures.map((signature) => (
              <SignatureCard
                key={signature.index}
                signature={signature}
                flip={result.flip}
                materialPlan={result.material_plan ?? null}
              />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
