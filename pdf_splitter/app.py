import os
from pathlib import Path
from typing import List, Tuple

from PyPDF2 import PdfReader, PdfWriter


def parse_range(range_str: str, max_page: int) -> Tuple[int, int]:
    """
    Convert a user‑supplied range like "3-7" or "5" into a zero‑based
    (start, end) tuple where ``end`` is inclusive.
    Raises ValueError for malformed input or out‑of‑bounds pages.
    """
    parts = range_str.strip().split("-")
    if len(parts) == 1:                     # single page, e.g. "5"
        start = end = int(parts[0])
    elif len(parts) == 2:                    # range, e.g. "3-7"
        start, end = map(int, parts)
    else:
        raise ValueError(f'Invalid range format: "{range_str}"')

    if not (1 <= start <= max_page) or not (1 <= end <= max_page):
        raise ValueError("Page numbers must be within the document length.")
    if start > end:
        raise ValueError("Start page must be less than or equal to end page.")

    # Convert to zero‑based indices used by PyPDF2
    return start - 1, end - 1


def extract_slice(reader: PdfReader, start: int, end: int) -> PdfWriter:
    """Create a new PdfWriter containing pages start…end (inclusive)."""
    writer = PdfWriter()
    for page_num in range(start, end + 1):
        writer.add_page(reader.pages[page_num])
    return writer


def main() -> None:
    # ------------------------------------------------------------------
    # 1️⃣ Get the PDF path from the user
    # ------------------------------------------------------------------
    pdf_path_input = input("Enter the full path to the PDF file: ").strip()
    pdf_path = Path(pdf_path_input).expanduser().resolve()

    if not pdf_path.is_file():
        print(f"❌ File not found: {pdf_path}")
        return

    # ------------------------------------------------------------------
    # 2️⃣ Load the PDF
    # ------------------------------------------------------------------
    try:
        reader = PdfReader(str(pdf_path))
    except Exception as exc:
        print(f"❌ Failed to read PDF: {exc}")
        return

    total_pages = len(reader.pages)
    print(f"✅ Loaded '{pdf_path.name}' – {total_pages} page(s)")

    # ------------------------------------------------------------------
    # 3️⃣ Ask the user for slice definitions
    # ------------------------------------------------------------------
    slices: List[Tuple[int, int]] = []
    print(
        "\nDefine page slices you want to extract."
        "\nEnter ranges like '1-3' or a single page like '5'."
        "\nWhen you are done, just press Enter on an empty line."
    )
    while True:
        raw = input(f"Slice #{len(slices)+1}: ").strip()
        if raw == "":
            break
        try:
            start_idx, end_idx = parse_range(raw, total_pages)
            slices.append((start_idx, end_idx))
        except ValueError as ve:
            print(f"⚠️  {ve}. Please try again.")

    if not slices:
        print("No slices defined – exiting.")
        return

    # ------------------------------------------------------------------
    # 4️⃣ Extract each slice and write it out
    # ------------------------------------------------------------------
    output_dir = pdf_path.parent / f"{pdf_path.stem}_slices"
    os.makedirs(output_dir, exist_ok=True)

    for i, (start, end) in enumerate(slices, start=1):
        writer = extract_slice(reader, start, end)
        out_name = f"{pdf_path.stem}_slice_{i}_pages_{start+1}-{end+1}.pdf"
        out_path = output_dir / out_name
        try:
            with open(out_path, "wb") as out_f:
                writer.write(out_f)
            print(f"🗂️  Saved slice #{i} → {out_path}")
        except Exception as exc:
            print(f"❌ Failed to write slice #{i}: {exc}")

    print("\nAll done! Slices are stored in:", output_dir)


if __name__ == "__main__":
    main()
