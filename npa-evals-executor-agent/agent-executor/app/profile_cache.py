from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

import pandas as pd


def _safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    return cleaned.strip("._") or "sheet"


def _normalize_columns(columns: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    normalized: list[str] = []
    for index, raw in enumerate(columns, start=1):
        value = str(raw or "").strip()
        if not value or value.lower().startswith("unnamed:"):
            value = f"column_{index}"
        value = re.sub(r"\s+", "_", value)
        value = re.sub(r"[^A-Za-z0-9_]+", "_", value).strip("_").lower() or f"column_{index}"
        count = seen.get(value, 0)
        seen[value] = count + 1
        normalized.append(value if count == 0 else f"{value}_{count + 1}")
    return normalized


def _profile_dataframe(
    df: pd.DataFrame,
    file_name: str,
    sheet_name: str,
    shared_cache_dir: Path,
) -> dict:
    original_columns = [str(column) for column in df.columns]
    normalized_columns = _normalize_columns(original_columns)
    profiled_df = df.copy()
    profiled_df.columns = normalized_columns

    cleaned_dir = shared_cache_dir / "cleaned" / _safe_name(file_name)
    cleaned_dir.mkdir(parents=True, exist_ok=True)
    cleaned_path = cleaned_dir / f"{_safe_name(sheet_name)}.csv"
    profiled_df.to_csv(cleaned_path, index=False)

    sample_records = (
        profiled_df.head(5)
        .fillna("")
        .astype(str)
        .to_dict(orient="records")
    )

    return {
        "sheet_name": sheet_name,
        "row_count": int(profiled_df.shape[0]),
        "column_count": int(profiled_df.shape[1]),
        "original_columns": original_columns,
        "normalized_columns": normalized_columns,
        "column_mapping": [
            {"original": original, "normalized": normalized}
            for original, normalized in zip(original_columns, normalized_columns, strict=False)
        ],
        "dtypes": {column: str(dtype) for column, dtype in profiled_df.dtypes.items()},
        "missing_counts": {column: int(profiled_df[column].isna().sum()) for column in profiled_df.columns},
        "sample_rows": sample_records,
        "cleaned_csv": str(cleaned_path.relative_to(shared_cache_dir)),
    }


def _profile_pdf(file_path: Path, shared_cache_dir: Path) -> dict:
    """Extract text and tables from a PDF using pdfplumber."""
    try:
        import pdfplumber
    except ImportError:
        return {"error": "pdfplumber not available", "pages": []}

    pages_info = []
    tables_found = []

    cleaned_dir = shared_cache_dir / "cleaned" / _safe_name(file_path.name)
    cleaned_dir.mkdir(parents=True, exist_ok=True)

    all_text_parts: list[str] = []

    with pdfplumber.open(file_path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            page_text = page.extract_text() or ""
            all_text_parts.append(f"--- Page {page_idx + 1} ---\n{page_text}")

            page_tables = page.extract_tables()
            for table_idx, table in enumerate(page_tables):
                if not table or len(table) < 2:
                    continue
                headers = [str(cell or f"col_{i}") for i, cell in enumerate(table[0])]
                rows = table[1:]
                df = pd.DataFrame(rows, columns=headers)
                table_name = f"page{page_idx + 1}_table{table_idx + 1}"
                csv_path = cleaned_dir / f"{table_name}.csv"
                df.to_csv(csv_path, index=False)
                tables_found.append({
                    "page": page_idx + 1,
                    "table_index": table_idx + 1,
                    "rows": len(rows),
                    "columns": headers,
                    "cleaned_csv": str(csv_path.relative_to(shared_cache_dir)),
                })

            pages_info.append({
                "page": page_idx + 1,
                "char_count": len(page_text),
                "tables_on_page": len(page_tables),
                "text_preview": page_text[:300],
            })

        # Save full extracted text
        text_path = cleaned_dir / "full_text.txt"
        text_path.write_text("\n\n".join(all_text_parts), encoding="utf-8")

    return {
        "page_count": len(pages_info),
        "pages": pages_info,
        "tables": tables_found,
        "full_text_path": str(text_path.relative_to(shared_cache_dir)),
    }


def ensure_tabular_profile(file_path: Path, file_type: str, shared_profiles_dir: Path, shared_cache_dir: Path) -> Path:
    profile_path = shared_profiles_dir / f"{_safe_name(file_path.name)}.json"
    if profile_path.exists():
        return profile_path

    shared_profiles_dir.mkdir(parents=True, exist_ok=True)
    shared_cache_dir.mkdir(parents=True, exist_ok=True)

    profile: dict[str, object] = {
        "file_name": file_path.name,
        "file_type": file_type,
        "generated_at": datetime.utcnow().isoformat(),
        "tables": [],
    }

    tables: list[dict] = []
    if file_type in {"xlsx", "xls", "tabular_pdf"}:
        workbook = pd.ExcelFile(file_path)
        for sheet_name in workbook.sheet_names:
            df = pd.read_excel(workbook, sheet_name=sheet_name)
            tables.append(_profile_dataframe(df, file_path.name, sheet_name, shared_cache_dir))
    elif file_type in {"csv", "tsv"}:
        delimiter = "\t" if file_type == "tsv" else ","
        df = pd.read_csv(file_path, sep=delimiter)
        tables.append(_profile_dataframe(df, file_path.name, "data", shared_cache_dir))
    elif file_type == "pdf":
        pdf_profile = _profile_pdf(file_path, shared_cache_dir)
        profile["pdf_info"] = pdf_profile
        # If tables were extracted from the PDF, also add them to tables list
        tables = []
        for table_info in pdf_profile.get("tables", []):
            csv_rel = table_info.get("cleaned_csv", "")
            if csv_rel:
                csv_path = shared_cache_dir / csv_rel
                if csv_path.exists():
                    df = pd.read_csv(csv_path)
                    tables.append(_profile_dataframe(df, file_path.name, f"page{table_info['page']}_table{table_info['table_index']}", shared_cache_dir))
    else:
        profile["tables"] = []
        profile_path.write_text(json.dumps(profile, indent=2), encoding="utf-8")
        return profile_path

    profile["tables"] = tables
    profile_path.write_text(json.dumps(profile, indent=2), encoding="utf-8")
    return profile_path
