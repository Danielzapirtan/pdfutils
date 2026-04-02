import os
import sys
from pathlib import Path
import tempfile
from typing import Optional

# PDF processing libraries
import fitz  # PyMuPDF for searchable PDFs
import pytesseract
from pdf2image import convert_from_path
from PIL import Image


def is_searchable_pdf(pdf_path: str) -> bool:
    """
    Check if PDF contains extractable text by attempting to extract from first page
    """
    try:
        doc = fitz.open(pdf_path)
        if len(doc) == 0:
            return False
        
        # Check first page for text
        page = doc[0]
        text = page.get_text()
        doc.close()
        
        # If we have at least some non-whitespace text, consider it searchable
        return len(text.strip()) > 0
    except Exception as e:
        print(f"Error checking PDF: {e}")
        return False


def extract_text_searchable(pdf_path: str) -> str:
    """
    Extract text from searchable PDF using PyMuPDF
    """
    text_content = []
    try:
        doc = fitz.open(pdf_path)
        for page_num in range(len(doc)):
            page = doc[page_num]
            text_content.append(page.get_text())
        doc.close()
        return "\n".join(text_content)
    except Exception as e:
        raise Exception(f"Error extracting text from searchable PDF: {e}")


def extract_text_ocr(pdf_path: str) -> str:
    """
    Extract text from non-searchable PDF using OCR (Tesseract)
    """
    text_content = []
    temp_dir = tempfile.mkdtemp()
    
    try:
        print("Converting PDF to images for OCR...")
        # Convert PDF to images
        images = convert_from_path(pdf_path, dpi=300)
        
        for i, image in enumerate(images):
            print(f"Processing page {i+1}/{len(images)} with OCR...")
            
            # Save image temporarily
            image_path = os.path.join(temp_dir, f'page_{i+1}.jpg')
            image.save(image_path, 'JPEG')
            
            # Perform OCR
            try:
                # Try with multiple language support (add 'eng' for English)
                text = pytesseract.image_to_string(
                    Image.open(image_path), 
                    lang='eng',  # Change or add languages as needed
                    config='--psm 6'  # Assume uniform block of text
                )
                text_content.append(f"--- Page {i+1} ---\n{text}")
            except Exception as e:
                print(f"OCR failed on page {i+1}: {e}")
                text_content.append(f"--- Page {i+1} ---\n[OCR FAILED FOR THIS PAGE]")
        
        return "\n\n".join(text_content)
    
    finally:
        # Clean up temporary images
        import shutil
        try:
            shutil.rmtree(temp_dir)
        except:
            pass


def pdf_to_text(pdf_path: str, force_ocr: bool = False) -> str:
    """
    Convert PDF to text, using OCR if necessary or forced
    """
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")
    
    # Check if we should use OCR
    use_ocr = force_ocr
    
    if not force_ocr:
        print("Checking if PDF has searchable text...")
        if is_searchable_pdf(pdf_path):
            print("PDF appears to be searchable. Using text extraction...")
            return extract_text_searchable(pdf_path)
        else:
            print("PDF does not contain searchable text. Switching to OCR...")
            use_ocr = True
    
    if use_ocr:
        return extract_text_ocr(pdf_path)
    
    return ""  # Fallback


def get_output_filename(pdf_path: str) -> str:
    """
    Generate output filename based on input PDF name
    """
    pdf_name = Path(pdf_path).stem
    return f"/content/drive/MyDrive/{pdf_name}.txt"


def main():
    print("=" * 50)
    print("PDF to Text Converter")
    print("=" * 50)
    
    while True:
        # Get PDF path from user
        pdf_path = input("\nEnter the path to your PDF file (or 'q' to quit): ").strip()
        
        if pdf_path.lower() in ['q', 'quit', 'exit']:
            print("Goodbye!")
            break
        
        if not pdf_path:
            print("Please enter a valid path.")
            continue
        
        # Expand user path if present (e.g., ~/document.pdf)
        #pdf_path = os.path.expanduser(pdf_path)
        
        if not os.path.exists(pdf_path):
            print(f"File not found: {pdf_path}")
            continue
        
        if not pdf_path.lower().endswith('.pdf'):
            print("File does not appear to be a PDF (doesn't end with .pdf)")
            continue
        
        try:
            # Ask user if they want to force OCR
            force_ocr_input = input("Force OCR even if text is searchable? (y/N): ").strip().lower()
            force_ocr = force_ocr_input in ['y', 'yes']
            
            print(f"\nProcessing: {pdf_path}")
            print("This may take a while for large PDFs or OCR processing...")
            
            # Convert PDF to text
            text_content = pdf_to_text(pdf_path, force_ocr)
            
            if text_content.strip():
                # Save to file
                output_filename = get_output_filename(pdf_path)
                output_path = os.path.join(os.getcwd(), output_filename)
                
                with open(output_path, 'w', encoding='utf-8') as f:
                    f.write(text_content)
                
                print(f"\n✅ Successfully saved text to: {output_path}")
                print(f"Extracted {len(text_content)} characters")
            else:
                print("\n⚠️ No text was extracted from the PDF.")
        
        except FileNotFoundError as e:
            print(f"\n❌ Error: {e}")
        except Exception as e:
            print(f"\n❌ Unexpected error: {e}")
            print("Please check your PDF file and try again.")
        
        print("\n" + "-" * 50)


if __name__ == "__main__":
    # Check for required OCR dependency
    try:
        pytesseract.get_tesseract_version()
    except Exception:
        print("⚠️ Warning: Tesseract OCR is not properly installed or configured.")
        print("OCR functionality will not work. Please install Tesseract:")
        print("  - Ubuntu/Debian: sudo apt-get install tesseract-ocr")
        print("  - macOS: brew install tesseract")
        print("  - Windows: Download from https://github.com/UB-Mannheim/tesseract/wiki")
        print("\nContinuing with searchable PDFs only...\n")
    
    main()