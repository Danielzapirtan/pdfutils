import PyPDF2
import os
import re
from pathlib import Path

pattern_pos = r'^\d+$'
pattern_neg = [
    r'^\s*\d+\s+.*$',
    r'^.*\s+\d+\s*$',
    r'^\s*[ivx]+\s+.*$',
    r'^.*\s+[ivx]+\s*$'
]
pattern_dsd = r'^\s*\d+\s+-\s+'
pattern_dfl = [
    r'^\s*Chapter\s+\d+',
    r'^\s*Foreword',
    r'^\s*Preface',
    r'^\s*Acknowledgements',
    r'^\s*Introduction',
    r'^\s*Backword',
    r'^\s*Index',
    r'^\s*Contents',
    r'^\s*References'
]

def split_by_headers(input_path, dsdok):
    with open(input_path, 'rb') as file:
        pdf_reader = PyPDF2.PdfReader(file)
        total_pages = len(pdf_reader.pages)
        delimiter_positions = []
        delimiter_positions.append(0)
        for page_num in range(total_pages - 1):
            page = pdf_reader.pages[page_num]
            text = page.extract_text()
            ok = False
            if text:
                ok = True
                if dsdok:
                    lines = text.split('\n') if '\n' in text else [text]
                    for line in lines:
                        if re.search(pattern_dsd, line):
                            delimiter_positions.append(page_num)
                            ok = False
                        for pattern in pattern_dfl:
                            if re.search(pattern, line):
                                delimiter_positions.append(page_num)
                                ok = False
                first_line = text.split('\n')[0] if '\n' in text else text
                if ok and re.search(pattern_pos, first_line.strip()):
                    delimiter_positions.append(page_num)
                    ok = False
                if ok:
                    for pattern in pattern_neg:
                        if re.search(pattern, first_line.strip()):
                            ok = False
                if ok:
                    for pattern in pattern_dfl:
                        if re.search(pattern, first_line.strip()):
                            delimiter_positions.append(page_num)
        if total_pages > 0:
            delimiter_positions.append(total_pages)
        delimiter_positions = sorted(set(delimiter_positions))
        return delimiter_positions

def main():
    #input_path = '/content/drive/MyDrive/input.pdf'
    input_path = input("Introduceți calea către PDF (exemplu: /content/drive/MyDrive/input.pdf): ")
    dsdok = input("Permiteți heading de capitol mai jos în pagină (d/n)?") != "n"
    input_file = Path(input_path)
    output_dir = input_file.parent/f"{input_file.stem}_split_chapters"
    if not os.path.exists(input_path):
        print(f"❌ Error: Input file not found at {input_path}")
        return
    print("=" * 70)
    print("📚 PDF CHAPTER SPLITTER")
    print("=" * 70)
    print(f"📂 Input file: {input_path}")
    print(f"📂 Output directory: {output_dir}")
    print("=" * 70)
    os.makedirs(output_dir, exist_ok=True)
    delimiter_positions = split_by_headers(input_path, dsdok)
    with open(input_path, 'rb') as file:
        pdf_reader = PyPDF2.PdfReader(file)
        total_pages = len(pdf_reader.pages)
        for i in range(len(delimiter_positions) - 1):
            start_page = delimiter_positions[i]
            end_page = delimiter_positions[i + 1]
            pdf_writer = PyPDF2.PdfWriter()
            for page_num in range(start_page, end_page):
                pdf_writer.add_page(pdf_reader.pages[page_num])
            output_filename = f"chapter_{i+1:03d}_pages_{start_page+1:03d}_to_{end_page:03d}.pdf"
            output_path = os.path.join(output_dir, output_filename)
            with open(output_path, 'wb') as output_file:
                pdf_writer.write(output_file)
            print(f"✅ Created: {output_filename} (pages {start_page+1}-{end_page})")
    print("=" * 70)
    print(f"🎉 Successfully split PDF into {len(delimiter_positions)-1} chapters!")
    print("=" * 70)

if __name__ == "__main__":
    main()
