"""
PDF Table of Contents Extractor API
A comprehensive solution for extracting TOC from PDF files using multiple strategies.
"""

import os
import re
import json
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from enum import Enum
import warnings
from pathlib import Path

# Core PDF libraries
import PyPDF2
from PyPDF2.generic import IndirectObject, NumberObject, TextStringObject, NameObject

# Optional but recommended libraries
try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    PDFPLUMBER_AVAILABLE = False
    warnings.warn("pdfplumber not installed. Some features will be limited.")

try:
    import fitz  # PyMuPDF
    FITZ_AVAILABLE = True
except ImportError:
    FITZ_AVAILABLE = False
    warnings.warn("PyMuPDF (fitz) not installed. Some features will be limited.")

try:
    import numpy as np
    from sklearn.cluster import DBSCAN
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False
    warnings.warn("scikit-learn not installed. ML-based TOC extraction will be disabled.")


class TOCEntryType(Enum):
    """Types of TOC entries"""
    HEADING = "heading"
    PAGE_REFERENCE = "page_reference"
    DOT_LEADER = "dot_leader"
    INDENTED = "indented"


@dataclass
class TOCEntry:
    """Represents a single TOC entry"""
    title: str
    page_number: Optional[int]
    level: int
    confidence: float
    raw_text: str
    bbox: Optional[Tuple[float, float, float, float]] = None
    entry_type: TOCEntryType = TOCEntryType.HEADING
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        result = asdict(self)
        result['entry_type'] = self.entry_type.value
        return result


@dataclass
class TOCResult:
    """Represents complete TOC extraction result"""
    entries: List[TOCEntry]
    method_used: str
    confidence_score: float
    metadata: Dict[str, Any]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            'entries': [entry.to_dict() for entry in self.entries],
            'method_used': self.method_used,
            'confidence_score': self.confidence_score,
            'metadata': self.metadata
        }
    
    def to_json(self, indent: int = 2) -> str:
        """Convert to JSON string"""
        return json.dumps(self.to_dict(), indent=indent)
    
    def to_markdown(self) -> str:
        """Convert to markdown format"""
        lines = ["# Table of Contents\n"]
        for entry in self.entries:
            indent = "  " * entry.level
            page_str = f" p.{entry.page_number}" if entry.page_number else ""
            lines.append(f"{indent}- {entry.title}{page_str}")
        return "\n".join(lines)


class PDFTOCExtractor:
    """
    Main API class for extracting Table of Contents from PDFs.
    Uses multiple strategies and falls back to different methods.
    """
    
    def __init__(self, use_ml: bool = True, min_confidence: float = 0.5):
        """
        Initialize the TOC extractor.
        
        Args:
            use_ml: Whether to use ML-based methods when available
            min_confidence: Minimum confidence score to include an entry
        """
        self.use_ml = use_ml and ML_AVAILABLE
        self.min_confidence = min_confidence
        
    def extract_from_file(self, pdf_path: str, **kwargs) -> TOCResult:
        """
        Extract TOC from a PDF file.
        
        Args:
            pdf_path: Path to the PDF file
            **kwargs: Additional extraction parameters
            
        Returns:
            TOCResult object containing extracted TOC entries
        """
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")
        
        # Try methods in order of reliability
        methods = [
            self._extract_native_toc,
            self._extract_via_outline,
            self._extract_via_text_analysis,
            self._extract_via_layout_analysis,
            self._extract_via_ml
        ]
        
        best_result = None
        best_confidence = 0
        
        for method in methods:
            try:
                result = method(pdf_path, **kwargs)
                if result and result.confidence_score > best_confidence:
                    best_result = result
                    best_confidence = result.confidence_score
                    
                    # If we have a high confidence result, stop trying
                    if best_confidence > 0.9:
                        break
                        
            except Exception as e:
                warnings.warn(f"Method {method.__name__} failed: {str(e)}")
                continue
        
        if best_result is None:
            # Return empty result with low confidence
            return TOCResult(
                entries=[],
                method_used="none",
                confidence_score=0.0,
                metadata={"error": "No TOC could be extracted"}
            )
        
        # Filter by confidence
        best_result.entries = [
            entry for entry in best_result.entries 
            if entry.confidence >= self.min_confidence
        ]
        
        return best_result
    
    def extract_from_bytes(self, pdf_bytes: bytes, **kwargs) -> TOCResult:
        """Extract TOC from PDF bytes"""
        import tempfile
        
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp_file:
            tmp_file.write(pdf_bytes)
            tmp_path = tmp_file.name
        
        try:
            return self.extract_from_file(tmp_path, **kwargs)
        finally:
            os.unlink(tmp_path)
    
    def _extract_native_toc(self, pdf_path: str, **kwargs) -> Optional[TOCResult]:
        """Extract native PDF TOC/outlines if they exist"""
        if not FITZ_AVAILABLE:
            return None
        
        doc = fitz.open(pdf_path)
        try:
            toc = doc.get_toc()
            if not toc:
                return None
            
            entries = []
            for level, title, page in toc:
                entry = TOCEntry(
                    title=title.strip(),
                    page_number=page,
                    level=level - 1,  # Convert to 0-based levels
                    confidence=1.0,
                    raw_text=title,
                    entry_type=TOCEntryType.HEADING
                )
                entries.append(entry)
            
            return TOCResult(
                entries=entries,
                method_used="native_toc",
                confidence_score=1.0,
                metadata={"source": "PDF native outline"}
            )
        finally:
            doc.close()
    
    def _extract_via_outline(self, pdf_path: str, **kwargs) -> Optional[TOCResult]:
        """Extract using PyPDF2 outline functionality"""
        with open(pdf_path, 'rb') as file:
            reader = PyPDF2.PdfReader(file)
            
            if not reader.outline:
                return None
            
            entries = []
            
            def process_outline_item(item, level=0):
                if isinstance(item, list):
                    for subitem in item:
                        process_outline_item(subitem, level + 1)
                else:
                    try:
                        title = item.get('/Title', '')
                        if hasattr(item, 'page'):
                            page_num = reader.get_page_number(item.page) + 1
                        else:
                            page_num = None
                        
                        entry = TOCEntry(
                            title=title,
                            page_number=page_num,
                            level=level,
                            confidence=0.9,
                            raw_text=title,
                            entry_type=TOCEntryType.HEADING
                        )
                        entries.append(entry)
                    except Exception as e:
                        warnings.warn(f"Failed to process outline item: {e}")
            
            process_outline_item(reader.outline)
            
            if entries:
                return TOCResult(
                    entries=entries,
                    method_used="outline",
                    confidence_score=0.9,
                    metadata={"source": "PDF outline structure"}
                )
        
        return None
    
    def _extract_via_text_analysis(self, pdf_path: str, **kwargs) -> Optional[TOCResult]:
        """Extract TOC by analyzing text patterns"""
        if not PDFPLUMBER_AVAILABLE:
            return None
        
        entries = []
        
        with pdfplumber.open(pdf_path) as pdf:
            # Look for TOC pages (usually in first few pages)
            toc_pages = []
            toc_patterns = [
                r'contents?',
                r'table\s+of\s+contents?',
                r'index',
                r'summary'
            ]
            
            # Find TOC pages
            for i, page in enumerate(pdf.pages[:20]):  # Check first 20 pages
                text = page.extract_text() or ""
                text_lower = text.lower()
                
                if any(re.search(pattern, text_lower) for pattern in toc_patterns):
                    toc_pages.append((i, page))
            
            if not toc_pages:
                return None
            
            # Process each potential TOC page
            for page_num, page in toc_pages:
                words = page.extract_words()
                if not words:
                    continue
                
                # Look for patterns: text followed by numbers (page numbers)
                lines = self._group_words_into_lines(words)
                
                for line in lines:
                    entry = self._parse_toc_line(line, page_num + 1)
                    if entry:
                        entries.append(entry)
        
        if entries:
            # Calculate confidence based on consistency
            confidence = self._calculate_confidence(entries)
            return TOCResult(
                entries=entries,
                method_used="text_analysis",
                confidence_score=confidence,
                metadata={"toc_pages": len(toc_pages)}
            )
        
        return None
    
    def _extract_via_layout_analysis(self, pdf_path: str, **kwargs) -> Optional[TOCResult]:
        """Extract TOC using layout analysis (indentation, dot leaders)"""
        if not PDFPLUMBER_AVAILABLE:
            return None
        
        entries = []
        
        with pdfplumber.open(pdf_path) as pdf:
            # Look for pages with consistent indentation patterns
            potential_toc_pages = []
            
            for i, page in enumerate(pdf.pages[:20]):
                words = page.extract_words()
                if not words:
                    continue
                
                # Check for varying x-coordinates (indentation)
                x_coords = [word['x0'] for word in words]
                if len(set(x_coords)) > 3:  # Multiple indentations
                    potential_toc_pages.append((i, page))
            
            for page_num, page in potential_toc_pages:
                words = page.extract_words()
                lines = self._group_words_into_lines(words)
                
                # Analyze layout patterns
                prev_x0 = None
                level = 0
                
                for line in lines:
                    if not line:
                        continue
                    
                    # Detect indentation level
                    current_x0 = line[0]['x0']
                    if prev_x0 is not None and current_x0 > prev_x0 + 5:
                        level += 1
                    elif prev_x0 is not None and current_x0 < prev_x0 - 5:
                        level = max(0, level - 1)
                    
                    # Check for dot leaders
                    text = ' '.join(word['text'] for word in line)
                    has_dots = '...' in text or '....' in text or '·' in text
                    
                    # Try to find page number at end
                    page_match = re.search(r'(\d+)\s*$', text)
                    
                    if page_match or has_dots:
                        entry_text = text
                        page_number = int(page_match.group(1)) if page_match else None
                        
                        # Clean up entry text
                        if page_number:
                            entry_text = entry_text.replace(str(page_number), '').strip()
                        if has_dots:
                            entry_text = re.sub(r'[\.·]{2,}', '', entry_text).strip()
                        
                        entry = TOCEntry(
                            title=entry_text,
                            page_number=page_number,
                            level=level,
                            confidence=0.8 if has_dots else 0.7,
                            raw_text=text,
                            bbox=(line[0]['x0'], line[0]['top'], 
                                  line[-1]['x1'], line[-1]['bottom']),
                            entry_type=TOCEntryType.DOT_LEADER if has_dots else TOCEntryType.INDENTED
                        )
                        entries.append(entry)
                    
                    prev_x0 = current_x0
        
        if entries:
            confidence = self._calculate_confidence(entries)
            return TOCResult(
                entries=entries,
                method_used="layout_analysis",
                confidence_score=confidence,
                metadata={"pages_analyzed": len(potential_toc_pages)}
            )
        
        return None
    
    def _extract_via_ml(self, pdf_path: str, **kwargs) -> Optional[TOCResult]:
        """Extract TOC using machine learning approaches"""
        if not self.use_ml or not PDFPLUMBER_AVAILABLE:
            return None
        
        entries = []
        
        with pdfplumber.open(pdf_path) as pdf:
            # Collect features from all pages
            features = []
            page_texts = []
            
            for page_num, page in enumerate(pdf.pages):
                words = page.extract_words()
                if not words:
                    continue
                
                text = page.extract_text() or ""
                page_texts.append(text)
                
                # Extract features for ML
                page_features = {
                    'page_num': page_num,
                    'num_words': len(words),
                    'avg_word_length': np.mean([len(w['text']) for w in words]) if words else 0,
                    'num_unique_x': len(set(w['x0'] for w in words)),
                    'has_numbers': any(w['text'].isdigit() for w in words),
                    'text_density': len(text) / (page.width * page.height) if page.width and page.height else 0
                }
                features.append(page_features)
            
            if len(features) < 3:
                return None
            
            # Use clustering to identify TOC pages
            X = np.array([[f['num_unique_x'], f['num_words']] for f in features])
            clustering = DBSCAN(eps=0.5, min_samples=2).fit(X)
            
            # Pages with high indentation variety (potential TOC)
            toc_page_indices = np.where(clustering.labels_ != -1)[0]
            
            for page_idx in toc_page_indices[:3]:  # Limit to first few TOC pages
                page = pdf.pages[page_idx]
                words = page.extract_words()
                lines = self._group_words_into_lines(words)
                
                for line in lines:
                    entry = self._parse_toc_line(line, page_idx + 1)
                    if entry:
                        # Boost confidence for ML-detected entries
                        entry.confidence *= 1.2
                        entries.append(entry)
        
        if entries:
            confidence = self._calculate_confidence(entries)
            return TOCResult(
                entries=entries,
                method_used="ml_analysis",
                confidence_score=min(confidence * 1.1, 1.0),  # Slight boost for ML
                metadata={"ml_pages_detected": len(toc_page_indices)}
            )
        
        return None
    
    def _group_words_into_lines(self, words: List[Dict]) -> List[List[Dict]]:
        """Group words into lines based on y-coordinates"""
        if not words:
            return []
        
        # Sort words by vertical position
        words = sorted(words, key=lambda w: (w['top'], w['x0']))
        
        lines = []
        current_line = [words[0]]
        current_top = words[0]['top']
        
        for word in words[1:]:
            # If vertical position is similar, add to current line
            if abs(word['top'] - current_top) < 5:  # Tolerance for same line
                current_line.append(word)
            else:
                # New line
                lines.append(current_line)
                current_line = [word]
                current_top = word['top']
        
        if current_line:
            lines.append(current_line)
        
        return lines
    
    def _parse_toc_line(self, line: List[Dict], page_num: int) -> Optional[TOCEntry]:
        """Parse a potential TOC line"""
        if not line:
            return None
        
        text = ' '.join(word['text'] for word in line)
        
        # Look for page number at the end
        page_match = re.search(r'(\d+)\s*$', text)
        if not page_match:
            return None
        
        page_number = int(page_match.group(1))
        
        # Basic validation: page number should be reasonable
        if page_number < 1 or page_number > 1000:
            return None
        
        # Extract title (everything before the page number)
        title_text = text[:text.rfind(str(page_number))].strip()
        
        # Clean up title
        title_text = re.sub(r'[\.·]{2,}', '', title_text).strip()
        
        if not title_text:
            return None
        
        # Determine confidence based on various factors
        confidence = 0.7  # Base confidence
        
        # Boost confidence if title looks like a proper heading
        if title_text[0].isupper():
            confidence += 0.1
        
        # Boost if page number is at the very end
        if text.endswith(str(page_number)):
            confidence += 0.1
        
        # Check for dot leaders
        if '...' in text or '....' in text:
            confidence += 0.1
            entry_type = TOCEntryType.DOT_LEADER
        else:
            entry_type = TOCEntryType.PAGE_REFERENCE
        
        return TOCEntry(
            title=title_text,
            page_number=page_number,
            level=0,  # Will be determined by layout analysis
            confidence=confidence,
            raw_text=text,
            bbox=(line[0]['x0'], line[0]['top'], line[-1]['x1'], line[-1]['bottom']),
            entry_type=entry_type
        )
    
    def _calculate_confidence(self, entries: List[TOCEntry]) -> float:
        """Calculate overall confidence score for extracted TOC"""
        if not entries:
            return 0.0
        
        # Average individual confidences
        avg_confidence = sum(e.confidence for e in entries) / len(entries)
        
        # Check consistency factors
        has_page_numbers = any(e.page_number is not None for e in entries)
        has_varying_levels = len(set(e.level for e in entries)) > 1
        
        consistency_bonus = 0.0
        if has_page_numbers:
            consistency_bonus += 0.1
        if has_varying_levels:
            consistency_bonus += 0.1
        
        return min(avg_confidence + consistency_bonus, 1.0)


# Convenience functions for common use cases
def extract_toc(pdf_path: str, **kwargs) -> TOCResult:
    """
    Extract Table of Contents from a PDF file.
    
    Args:
        pdf_path: Path to the PDF file
        **kwargs: Additional arguments for the extractor
        
    Returns:
        TOCResult object
    """
    extractor = PDFTOCExtractor(**kwargs)
    return extractor.extract_from_file(pdf_path)


def extract_toc_from_bytes(pdf_bytes: bytes, **kwargs) -> TOCResult:
    """
    Extract Table of Contents from PDF bytes.
    
    Args:
        pdf_bytes: PDF file as bytes
        **kwargs: Additional arguments for the extractor
        
    Returns:
        TOCResult object
    """
    extractor = PDFTOCExtractor(**kwargs)
    return extractor.extract_from_bytes(pdf_bytes)


# Example usage and testing
if __name__ == "__main__":
    import sys
    
    def main():
        """Example usage of the TOC extractor API"""
        if len(sys.argv) < 2:
            print("Usage: python pdf_toc_extractor.py <pdf_file>")
            return
        
        pdf_file = sys.argv[1]
        
        print(f"Extracting TOC from: {pdf_file}")
        print("-" * 50)
        
        # Basic extraction
        result = extract_toc(pdf_file)
        
        # Print results
        print(f"Method used: {result.method_used}")
        print(f"Confidence: {result.confidence_score:.2f}")
        print(f"Entries found: {len(result.entries)}")
        print("\nExtracted TOC:")
        print(result.to_markdown())
        
        # Save as markdown
        output_file = "/content/drive/MyDrive/" + Path(pdf_file).stem + "_toc.md"
        with open(output_file, 'w') as f:
            f.write(result.to_markdown())
        print(f"\nSaved markdown to: {output_file}")
        
        # Example with custom parameters
        print("\n" + "=" * 50)
        print("Advanced extraction with ML enabled:")
        extractor = PDFTOCExtractor(use_ml=True, min_confidence=0.6)
        result_ml = extractor.extract_from_file(pdf_file)
        print(f"ML Method used: {result_ml.method_used}")
        print(f"ML Confidence: {result_ml.confidence_score:.2f}")
        print(f"ML Entries: {len(result_ml.entries)}")
    
    main()
