import os
import re
from pathlib import Path

import pypdf
import fitz  # PyMuPDF
from pdf2image import convert_from_path
import pytesseract
from PIL import Image

# ------------------------------------------------------------
# Helper: check if PDF is already searchable (has text)
# ------------------------------------------------------------
def is_searchable_pdf(pdf_path):
    try:
        doc = fitz.open(pdf_path)
        for page in doc:
            if page.get_text("text").strip():
                doc.close()
                return True
        doc.close()
        return False
    except Exception:
        return False

# ------------------------------------------------------------
# 1. Split by pages or page ranges
# ------------------------------------------------------------
def split_by_pages(pdf_path, ranges_str):
    """
    ranges_str example: "1-3,5,7-10"
    """
    reader = pypdf.PdfReader(pdf_path)
    total_pages = len(reader.pages)

    # parse ranges
    ranges = []
    for part in ranges_str.split(','):
        if '-' in part:
            start, end = map(int, part.split('-'))
            ranges.extend(range(start - 1, min(end, total_pages)))
        else:
            pg = int(part) - 1
            if 0 <= pg < total_pages:
                ranges.append(pg)

    if not ranges:
        print("No valid pages selected.")
        return

    writer = pypdf.PdfWriter()
    for pg_idx in ranges:
        writer.add_page(reader.pages[pg_idx])

    out_name = f"{Path(pdf_path).stem}_split.pdf"
    with open(out_name, 'wb') as f:
        writer.write(f)
    print(f"Saved split PDF: {out_name}")

# ------------------------------------------------------------
# 2. Split by chapters (detects "Chapter X", "1.", "INTRODUCTION")
# ------------------------------------------------------------
def split_by_chapters(pdf_path):
    doc = fitz.open(pdf_path)
    toc = doc.get_toc()  # list of [level, title, page]

    if not toc:
        print("No TOC found. Trying heuristic detection...")
        # Heuristic: look for bold/large text lines that might be chapter titles
        chapters = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            blocks = page.get_text("dict")["blocks"]
            for b in blocks:
                if "lines" in b:
                    for line in b["lines"]:
                        text = " ".join([s["text"] for s in line["spans"]])
                        if re.match(r"^(Chapter\s+\d+|(\d+\.\s+)|INTRODUCTION|PREFACE|APPENDIX|BIBLIOGRAPHY)", text, re.I):
                            chapters.append((text.strip(), page_num))
        if not chapters:
            print("No chapters detected. Splitting not possible.")
            return
        # first chapter from page 0
        splits = []
        for i, (title, page) in enumerate(chapters):
            start = page
            end = chapters[i+1][1] if i+1 < len(chapters) else len(doc)
            splits.append((title, start, end))
    else:
        # Use TOC
        splits = []
        for i, entry in enumerate(toc):
            level, title, page = entry
            if level == 1:  # top-level chapters
                start = page - 1
                next_level1 = next((toc[j][2] for j in range(i + 1, len(toc)) if toc[j][0] == 1), len(doc))
                end = next_level1 - 1        
                #end = toc[i+1][2] - 1 if i+1 < len(toc) else len(doc)
                splits.append((title, start, end))

    # Create separate PDFs
    base = Path(pdf_path).stem
    for idx, (title, start, end) in enumerate(splits):
        writer = pypdf.PdfWriter()
        reader = pypdf.PdfReader(pdf_path)
        for pg in range(start, end):
            writer.add_page(reader.pages[pg])
        safe_title = re.sub(r'[\\/*?:"<>|]', "", title)[:30]
        out_name = f"{base}_ch_{idx+1}_{safe_title}.pdf"
        with open(out_name, 'wb') as f:
            writer.write(f)
        print(f"Saved chapter: {out_name}")

# ------------------------------------------------------------
# 3. Make searchable PDF (OCR) if not already
# ------------------------------------------------------------
def make_searchable(pdf_path):
    if is_searchable_pdf(pdf_path):
        print("PDF is already searchable. No OCR needed.")
        return

    print("OCR in progress (this may take a while)...")
    images = convert_from_path(pdf_path, dpi=300)
    doc = fitz.open()
    for i, img in enumerate(images):
        # OCR the image
        text = pytesseract.image_to_string(img)
        # Create a new PDF page with same size as original
        pdf_page = doc.new_page(width=img.width, height=img.height)
        # Insert image
        img_bytes = img.tobytes()
        rect = fitz.Rect(0, 0, img.width, img.height)
        pdf_page.insert_image(rect, stream=img_bytes)
        # Add invisible text layer
        pdf_page.insert_text((10, 10), text, fontsize=0.1, color=(1,1,1))  # invisible
        # Alternatively for real searchable: use fitz.TextWriter but above works

    out_name = f"{Path(pdf_path).stem}_searchable.pdf"
    doc.save(out_name)
    doc.close()
    print(f"Saved searchable PDF: {out_name}")

# ------------------------------------------------------------
# 4. Make detailed TOC and prepend to PDF copy
# ------------------------------------------------------------
def make_detailed_toc(pdf_path, mode="normal"):
    """
    mode: "normal" = skip only proper text, "summary" = replace each para with one sentence
    """
    doc = fitz.open(pdf_path)
    toc = []
    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text("text")
        if not text.strip():
            continue

        # Try to get headings (heuristic: short lines, all caps, or bold)
        blocks = page.get_text("dict")["blocks"]
        headings = []
        for b in blocks:
            if "lines" in b:
                for line in b["lines"]:
                    for span in line["spans"]:
                        txt = span["text"].strip()
                        if len(txt) < 100 and (txt.isupper() or span["size"] > 12):
                            headings.append(txt)

        # If we found headings, use them; otherwise use first sentence of first paragraph
        if headings:
            for h in headings[:2]:  # avoid too many per page
                toc.append((page_num + 1, h))
        else:
            # Extract first sentence of first paragraph
            paras = text.split('\n\n')
            if paras:
                first_para = paras[0].strip()
                # Take first sentence (up to .!? followed by space)
                match = re.search(r'^.*?[.!?](?=\s|$)', first_para)
                if match:
                    summary = match.group(0)
                else:
                    summary = first_para[:100] + "..." if len(first_para) > 100 else first_para
                if mode == "summary":
                    toc.append((page_num + 1, summary))
                else:
                    # normal: skip only proper text – i.e., keep headings, skip full paragraphs
                    if not headings:
                        continue

    # Write TOC to a new PDF
    toc_doc = fitz.open()
    toc_page = toc_doc.new_page()
    y = 50
    for pg, title in toc[:100]:  # limit to avoid huge pages
        line = f"Page {pg}: {title}"
        toc_page.insert_text((50, y), line, fontsize=10)
        y += 15
        if y > 800:
            toc_page = toc_doc.new_page()
            y = 50

    # Merge TOC + original PDF
    original = fitz.open(pdf_path)
    merged = fitz.open()
    merged.insert_pdf(toc_doc)
    merged.insert_pdf(original)
    out_name = f"{Path(pdf_path).stem}_with_TOC.pdf"
    merged.save(out_name)
    merged.close()
    toc_doc.close()
    original.close()
    print(f"Saved PDF with prepended TOC: {out_name}")

# ------------------------------------------------------------
# Main CLI
# ------------------------------------------------------------
def main():
    pdf_file = input("Enter the path to the PDF file: ").strip()
    if not os.path.exists(pdf_file):
        print("File not found.")
        return

    print("\nChoose an operation:")
    print("1 - Split by pages or page ranges")
    print("2 - Split by chapters")
    print("3 - Make searchable (OCR)")
    print("4 - Make detailed TOC and prepend to copy")
    choice = input("Enter 1/2/3/4: ").strip()

    if choice == "1":
        ranges = input("Enter page ranges (e.g., 1-3,5,7-10): ")
        split_by_pages(pdf_file, ranges)
    elif choice == "2":
        #split_by_chapters(pdf_file)
        print('Not implemented. Sorry')
    elif choice == "3":
        make_searchable(pdf_file)
    elif choice == "4":
        mode = input("TOC mode (normal/summary): ").strip().lower()
        if mode not in ["normal", "summary"]:
            mode = "normal"
        #make_detailed_toc(pdf_file, mode)
        print('Not implememted. Sorry')
    else:
        print("Invalid choice")

if __name__ == "__main__":
    main()
