import json
import re
from pathlib import Path

import fitz  # PyMuPDF


INPUT_PATH = Path("/content/drive/MyDrive/input.pdf")
OUTPUT_PATH = Path("/content/drive/MyDrive/exhaustive_toc.json")


ROMAN_RE = r"(?:M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3}))"
ARABIC_RE = r"\d+(?:\.\d+)*"
CHAPTER_KEYWORDS = (
    r"(chapter|capitol|section|part|parte|appendix|anexa|"
    r"introduction|introducere|conclusion|concluzie|"
    r"preface|foreword|epilogue|prologue)"
)


def normalize(text: str) -> str:
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def collapse_spaced_letters(text: str) -> str:
    tokens = text.split()
    result = []
    i = 0
    while i < len(tokens):
        if len(tokens[i]) == 1 and tokens[i].isalpha():
            j = i
            while j < len(tokens) and len(tokens[j]) == 1 and tokens[j].isalpha():
                j += 1
            if j - i >= 3:
                result.append("".join(tokens[i:j]))
                i = j
                continue
        result.append(tokens[i])
        i += 1
    return " ".join(result)


def clean_text(text: str) -> str:
    return collapse_spaced_letters(normalize(text))


def is_index_line(text: str) -> bool:
    t = text.strip()
    if not t:
        return False
    if re.fullmatch(r"\d+", t):
        return True
    if re.fullmatch(rf"{ROMAN_RE}", t, re.IGNORECASE):
        return True
    return False


def is_heading_candidate(text: str) -> bool:
    t = text.strip()
    if len(t) < 3 or len(t) > 300:
        return False
    if re.match(rf"^\s*{CHAPTER_KEYWORDS}\b", t, re.IGNORECASE):
        return True
    if re.match(rf"^\s*{ROMAN_RE}\.?\s+", t):
        return True
    if re.match(rf"^\s*{ARABIC_RE}\s+", t):
        return True
    letters = re.sub(r"[^A-Za-z]", "", t)
    if letters and letters.isupper() and len(letters) > 5:
        return True
    return False


def infer_level(text: str) -> int:
    t = text.strip()
    if re.match(rf"^\s*{ROMAN_RE}\.?\s+", t):
        return 1
    if re.match(r"^\s*\d+\.\d+\.\d+\s+", t):
        return 3
    if re.match(r"^\s*\d+\.\d+\s+", t):
        return 2
    if re.match(r"^\s*\d+\s+", t):
        return 1
    if re.match(rf"^\s*{CHAPTER_KEYWORDS}\b", t, re.IGNORECASE):
        return 1
    return 2


def extract_flat_toc(pdf_path: Path):
    doc = fitz.open(pdf_path)
    flat_entries = []
    seen_pairs = set()
    for page_index in range(len(doc)):
        page = doc.load_page(page_index)
        blocks = page.get_text("blocks")
        lines_in_order = []
        for block in blocks:
            text = clean_text(block[4])
            if not text:
                continue
            for line in text.split("\n"):
                candidate = clean_text(line)
                if candidate:
                    lines_in_order.append(candidate)
        if not lines_in_order:
            continue
        # Omit first line (page header)
        content_lines = lines_in_order[1:]
        # Omit last line if page index
        if content_lines and is_index_line(content_lines[-1]):
            content_lines = content_lines[:-1]
        for candidate in content_lines:
            if not is_heading_candidate(candidate):
                continue
            level = infer_level(candidate)
            pair_key = (level, candidate.lower())
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)
            flat_entries.append(
                {"rank": level, "title": candidate, "page": page_index + 1}
            )
    doc.close()
    flat_entries.sort(key=lambda x: (x["page"], x["rank"]))
    return flat_entries


def build_nested_toc(flat_entries):
    nested = []
    stack = []
    element_counter = 1

    for entry in flat_entries:
        node = {
            "element": element_counter,
            "parent": None,
            "rank": entry["rank"],
            "title": entry["title"],
            "page": entry["page"],
            "children": [],
        }

        # Determine parent based on rank hierarchy
        while stack and stack[-1]["rank"] >= node["rank"]:
            stack.pop()

        if stack:
            node["parent"] = stack[-1]["element"]
            stack[-1]["children"].append(node)

        else:
            nested.append(node)

        stack.append(node)
        element_counter += 1

    # Remove children field from final output if empty
    def strip_empty_children(nodes):
        for n in nodes:
            if not n["children"]:
                n.pop("children")
            else:
                strip_empty_children(n["children"])

    strip_empty_children(nested)
    return nested


def main():
    if not INPUT_PATH.exists():
        raise FileNotFoundError(f"Input PDF not found: {INPUT_PATH}")

    flat_toc = extract_flat_toc(INPUT_PATH)
    nested_toc = build_nested_toc(flat_toc)

    book_structure = {
        "file": str(INPUT_PATH),
        "total_elements": len(flat_toc),
        "toc": nested_toc,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(book_structure, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
