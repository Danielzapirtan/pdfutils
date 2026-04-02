#!/usr/bin/env python3
"""
bpp.py - Big Print Picker
Extracts text from PDF using pdftext (pdfminer.six) and saves lines containing 
characters with bounding box area > threshold.
"""

import sys
import os
from typing import List, Dict, Any, Tuple
from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer, LTChar, LTLine, LTRect, LTFigure, LTTextLine
import json

class BPPProcessor:
    def __init__(self, min_area: float = 100.0):
        """
        Initialize the BPP processor.
        
        Args:
            min_area: Minimum bounding box area threshold
        """
        self.min_area = min_area
        self.large_chars = []
        self.lines_with_large_chars = []
        self.current_line_text = ""
        self.current_line_page = 0
        self.current_line_bbox = None
        self.chars_in_current_line = []
    
    def calculate_bbox_area(self, bbox: Tuple[float, float, float, float]) -> float:
        """
        Calculate the area of a bounding box.
        
        Args:
            bbox: Tuple of 4 floats (x1, y1, x2, y2)
            
        Returns:
            Area of the bounding box
        """
        x1, y1, x2, y2 = bbox
        width = abs(x2 - x1)
        height = abs(y2 - y1)
        return width * height
    
    def process_char(self, char: LTChar, page_num: int, line_text: str, line_bbox: Tuple) -> None:
        """
        Process a single character.
        
        Args:
            char: LTChar object from pdfminer
            page_num: Current page number
            line_text: Text of the line containing this character
            line_bbox: Bounding box of the line
        """
        # Get character bounding box
        bbox = (char.x0, char.y0, char.x1, char.y1)
        area = self.calculate_bbox_area(bbox)
        
        # Get character text
        char_text = char.get_text()
        
        if area > self.min_area:
            self.large_chars.append({
                'char': char_text,
                'area': area,
                'page': page_num,
                'bbox': bbox,
                'line_text': line_text,
                'line_bbox': line_bbox,
                'fontname': char.fontname,
                'size': char.size
            })
            
            # Add line to results if not already added
            line_entry = f"[Page {page_num}] {line_text}"
            if line_entry not in self.lines_with_large_chars:
                self.lines_with_large_chars.append(line_entry)
    
    def process_text_line(self, line: LTTextLine, page_num: int) -> None:
        """
        Process a text line and its characters.
        
        Args:
            line: LTTextLine object from pdfminer
            page_num: Current page number
        """
        line_text = line.get_text().strip()
        if not line_text:
            return
            
        line_bbox = (line.x0, line.y0, line.x1, line.y1)
        
        # Process each character in the line
        for element in line:
            if isinstance(element, LTChar):
                self.process_char(element, page_num, line_text, line_bbox)
    
    def process_page(self, page, page_num: int) -> None:
        """
        Process a single page.
        
        Args:
            page: LTPage object from pdfminer
            page_num: Page number
        """
        # Process all elements on the page
        for element in page:
            # Handle text containers
            if isinstance(element, LTTextContainer):
                for text_line in element:
                    if isinstance(text_line, LTTextLine):
                        self.process_text_line(text_line, page_num)
            
            # Handle direct text lines
            elif isinstance(element, LTTextLine):
                self.process_text_line(element, page_num)
            
            # Handle figures (may contain text)
            elif isinstance(element, LTFigure):
                for figure_element in element:
                    if isinstance(figure_element, LTTextLine):
                        self.process_text_line(figure_element, page_num)
    
    def process_pdf(self, pdf_path: str) -> None:
        """
        Process PDF file using pdfminer.
        
        Args:
            pdf_path: Path to the PDF file
        """
        try:
            print(f"Processing PDF: {pdf_path}")
            
            # Extract pages from PDF
            for page_num, page in enumerate(extract_pages(pdf_path), 1):
                print(f"Processing page {page_num}...")
                self.process_page(page, page_num)
            
        except Exception as e:
            print(f"Error processing PDF: {e}", file=sys.stderr)
            raise
    
    def save_results(self, output_path: str, verbose: bool = False) -> None:
        """
        Save results to output file.
        
        Args:
            output_path: Path to output text file
            verbose: If True, include detailed character information
        """
        try:
            # Create output directory if it doesn't exist
            output_dir = os.path.dirname(output_path)
            if output_dir and not os.path.exists(output_dir):
                os.makedirs(output_dir)
            
            with open(output_path, 'w', encoding='utf-8') as f:
                if not self.large_chars:
                    f.write(f"No characters found with area > {self.min_area}\n")
                    f.write("\nTry lowering the threshold with -t option.\n")
                    return
                
                # Sort large chars by page and position
                self.large_chars.sort(key=lambda x: (x['page'], x['bbox'][1]))
                
                f.write(f"{'='*60}\n")
                f.write(f"BIG PRINT PICKER RESULTS\n")
                f.write(f"Minimum character area: {self.min_area}\n")
                f.write(f"{'='*60}\n\n")
                
                if verbose:
                    f.write("DETAILED CHARACTER LIST:\n")
                    f.write("-" * 40 + "\n")
                    for i, char_info in enumerate(self.large_chars, 1):
                        f.write(f"{i:3}. Character: '{char_info['char']}'\n")
                        f.write(f"     Area: {char_info['area']:.2f} (min: {self.min_area})\n")
                        f.write(f"     Page: {char_info['page']}\n")
                        f.write(f"     Font: {char_info.get('fontname', 'Unknown')}, Size: {char_info.get('size', 0):.1f}\n")
                        f.write(f"     BBox: ({char_info['bbox'][0]:.1f}, {char_info['bbox'][1]:.1f}, "
                               f"{char_info['bbox'][2]:.1f}, {char_info['bbox'][3]:.1f})\n")
                        f.write(f"     Line: {char_info['line_text'][:50]}{'...' if len(char_info['line_text']) > 50 else ''}\n")
                        f.write("\n")
                    f.write("\n")
                
                f.write("LINES CONTAINING LARGE CHARACTERS:\n")
                f.write("-" * 40 + "\n")
                
                # Group lines by page
                current_page = 0
                for line in sorted(self.lines_with_large_chars):
                    f.write(f"{line}\n")
                
                f.write(f"\n{'='*60}\n")
                f.write(f"SUMMARY:\n")
                f.write(f"• Total large characters found: {len(self.large_chars)}\n")
                f.write(f"• Lines containing large characters: {len(self.lines_with_large_chars)}\n")
                f.write(f"• Threshold area: {self.min_area}\n")
                
                # Calculate statistics
                if self.large_chars:
                    areas = [c['area'] for c in self.large_chars]
                    f.write(f"• Character area range: {min(areas):.1f} - {max(areas):.1f}\n")
                    f.write(f"• Average character area: {sum(areas)/len(areas):.1f}\n")
                
                f.write(f"{'='*60}\n")
                
            print(f"✓ Results saved to: {output_path}")
            
            # Also print summary to console
            print(f"\n{'='*60}")
            print(f"SUMMARY")
            print(f"{'='*60}")
            print(f"Found {len(self.large_chars)} large characters in {len(self.lines_with_large_chars)} lines")
            print(f"Results saved to: {output_path}")
            
        except Exception as e:
            print(f"Error saving results: {e}", file=sys.stderr)
            raise
    
    def print_statistics(self):
        """Print statistics about the processing."""
        if not self.large_chars:
            print("\nNo large characters found.")
            return
        
        print(f"\n{'='*60}")
        print(f"STATISTICS")
        print(f"{'='*60}")
        print(f"Total large characters: {len(self.large_chars)}")
        print(f"Lines with large chars: {len(self.lines_with_large_chars)}")
        
        # Group by page
        pages = set(c['page'] for c in self.large_chars)
        print(f"Pages affected: {sorted(pages)}")
        
        # Show top 10 largest characters
        print(f"\nTop 10 largest characters:")
        sorted_chars = sorted(self.large_chars, key=lambda x: x['area'], reverse=True)[:10]
        for i, char in enumerate(sorted_chars, 1):
            print(f"  {i}. '{char['char']}' - area: {char['area']:.1f} (page {char['page']})")

def main():
    """Main function to run the BPP processor."""
    # Default paths
    input_pdf = "/content/drive/MyDrive/input.pdf"
    output_txt = "/content/drive/MyDrive/output.txt"
    min_area = 100.0  # Default threshold
    verbose = False
    
    # Parse command line arguments
    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg == "-v" or arg == "--verbose":
            verbose = True
        elif arg == "-t" or arg == "--threshold":
            if i + 1 < len(sys.argv):
                try:
                    min_area = float(sys.argv[i + 1])
                    i += 1
                except ValueError:
                    print(f"Error: Invalid threshold value")
                    sys.exit(1)
        elif arg == "-i" or arg == "--input":
            if i + 1 < len(sys.argv):
                input_pdf = sys.argv[i + 1]
                i += 1
        elif arg == "-o" or arg == "--output":
            if i + 1 < len(sys.argv):
                output_txt = sys.argv[i + 1]
                i += 1
        elif arg == "-h" or arg == "--help":
            print_help()
            sys.exit(0)
        i += 1
    
    # Check if input file exists
    if not os.path.exists(input_pdf):
        print(f"Error: Input PDF not found: {input_pdf}")
        print("\nPlease make sure:")
        print("1. The file exists at the specified path")
        print("2. You have mounted Google Drive (if using Colab):")
        print("   from google.colab import drive")
        print("   drive.mount('/content/drive')")
        sys.exit(1)
    
    try:
        print(f"\n{'='*60}")
        print(f"BIG PRINT PICKER")
        print(f"{'='*60}")
        print(f"Input PDF:  {input_pdf}")
        print(f"Output TXT: {output_txt}")
        print(f"Threshold:  {min_area}")
        print(f"Verbose:    {verbose}")
        print(f"{'='*60}\n")
        
        # Process the PDF
        processor = BPPProcessor(min_area=min_area)
        processor.process_pdf(input_pdf)
        
        # Save results
        processor.save_results(output_txt, verbose=verbose)
        
        # Print statistics
        processor.print_statistics()
        
        print(f"\n✓ Processing complete!")
        
    except Exception as e:
        print(f"\nError: {e}")
        print("\nTroubleshooting tips:")
        print("1. Make sure pdfminer.six is installed: pip install pdfminer.six")
        print("2. Check if the PDF is not corrupted")
        print("3. Try a lower threshold value")
        sys.exit(1)

def print_help():
    """Print help information."""
    print("""
bpp.py - Big Print Picker
Extracts text from PDF using pdftext (pdfminer.six) and saves lines containing 
characters with bounding box area > threshold.

USAGE:
    python bpp.py [options]

OPTIONS:
    -v, --verbose           Include detailed character information in output
    -t, --threshold VALUE   Set minimum area threshold (default: 100.0)
    -i, --input PATH        Input PDF path (default: /content/drive/MyDrive/input.pdf)
    -o, --output PATH       Output text file path (default: /content/drive/MyDrive/output.txt)
    -h, --help              Show this help message

EXAMPLES:
    # Basic usage
    python bpp.py
    
    # Custom threshold
    python bpp.py -t 50.0
    
    # Verbose output with custom paths
    python bpp.py -v -i myfile.pdf -o results.txt
    
    # All options
    python bpp.py -v -t 75.5 -i /path/to/input.pdf -o /path/to/output.txt

REQUIREMENTS:
    pip install pdfminer.six

NOTES:
    - The bounding box area is calculated as width × height
    - Characters with area > threshold are considered "large"
    - Results include the complete lines containing large characters
    - For Google Colab, mount drive first: drive.mount('/content/drive')
    """)

if __name__ == "__main__":
    main()
