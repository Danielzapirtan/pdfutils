import * as pdfjs from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';

// Set up the worker for pdfjs using Vite's ?url import
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface Chapter {
  title: string;
  startPage: number; // 1-indexed
  endPage?: number;   // 1-indexed
}

export interface PdfMetadata {
  chapters: Chapter[];
  totalPages: number;
}

export async function parsePdfChapters(file: File): Promise<PdfMetadata> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  
  // 1. Try to get bookmarks (outline)
  const outline = await pdf.getOutline();
  
  if (outline && outline.length > 0) {
    const chapters: Chapter[] = [];
    
    for (let i = 0; i < outline.length; i++) {
      const item = outline[i];
      if (item.dest) {
        const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
        if (dest) {
          const pageIndex = await pdf.getPageIndex(dest[0]);
          chapters.push({
            title: item.title,
            startPage: pageIndex + 1,
          });
        }
      }
    }

    chapters.sort((a, b) => a.startPage - b.startPage);
    for (let i = 0; i < chapters.length; i++) {
      if (i < chapters.length - 1) {
        chapters[i].endPage = chapters[i + 1].startPage - 1;
      } else {
        chapters[i].endPage = totalPages;
      }
    }
    
    return { chapters, totalPages };
  }

  // 2. Fallback: Heuristic scan for pages starting with a number (e.g., "1", "2")
  // We avoid page numbers by checking vertical position and frequency
  const heuristicChapters: Chapter[] = [];
  const pageNumbersFound: number[] = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    
    if (textContent.items.length > 0) {
      // Sort items by vertical position (top to bottom) then horizontal
      const items = (textContent.items as any[]).sort((a, b) => {
        if (Math.abs(a.transform[5] - b.transform[5]) < 5) {
          return a.transform[4] - b.transform[4];
        }
        return b.transform[5] - a.transform[5];
      });

      // Group items into lines
      const lines: { text: string; y: number }[] = [];
      let currentLine: { text: string; y: number } | null = null;
      
      for (const item of items) {
        const text = item.str;
        const y = item.transform[5];
        
        if (!currentLine || Math.abs(currentLine.y - y) > 5) {
          currentLine = { text, y };
          lines.push(currentLine);
        } else {
          currentLine.text += ' ' + text;
        }
      }

      // Detect if we are on a TOC page
      const pageText = lines.map(l => l.text).join(' ');
      const isTOCPage = /Table of Contents|CONTENTS|Table des matières/i.test(pageText) && i < 30;

      // Scan lines for chapter markers
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        const text = line.text.trim();
        const y = line.y;
        
        // Skip bottom 15% (likely footers/page numbers)
        if (y < viewport.height * 0.15) continue;

        // CRITICAL: Ignore lines that look like TOC entries (e.g., "Chapter 1 .... 5" or "Chapter 1  5")
        // A TOC entry usually has a page number at the end of the line.
        const isTOCEntry = /\d+\s*$/.test(text) && text.length > 15; 
        if ((isTOCEntry || isTOCPage) && i < 50) continue; 

        // Normalization for common publisher/OCR errors
        let normalized = text.trim();
        if (normalized === 'I' || normalized === 'l' || normalized === '|') {
          normalized = '1';
        }

        // Pattern 1: "Chapter 11", "CHAPTER 11", "Part I", "Module 2"
        if (/^(Chapter|CHAPTER|Part|PART|Module|MODULE|Session|SESSION)\s+(\d+|[IVXLCDM]+)$/i.test(text)) {
          heuristicChapters.push({ title: text, startPage: i });
          break;
        }

        // Pattern 2: Standalone number (Chapter 1, 2, 11, etc)
        if (/^\d+$/.test(normalized)) {
          const isTop = y > viewport.height * 0.92;
          const matchesPageNum = normalized === i.toString();
          
          // If it's a standalone number in the middle of the page, it's likely a chapter start
          if (y < viewport.height * 0.85 && y > viewport.height * 0.2) {
            heuristicChapters.push({ title: `Chapter ${normalized}`, startPage: i });
            break;
          }
          // If it's at the top but doesn't match the physical page number
          if (isTop && !matchesPageNum) {
            heuristicChapters.push({ title: `Chapter ${normalized}`, startPage: i });
            break;
          }
        }

        // Pattern 3: "Chapter" or "Part" on one line, number on the next
        if (/^(Chapter|CHAPTER|Part|PART|Module|MODULE)$/i.test(text) && lineIdx < lines.length - 1) {
          const nextLine = lines[lineIdx + 1];
          const nextText = nextLine.text.trim();
          if (/^\d+$/.test(nextText) || /^[IVXLCDM]+$/i.test(nextText)) {
            heuristicChapters.push({ title: `${text} ${nextText}`, startPage: i });
            break;
          }
        }

        // Pattern 4: "11 - Chapter Title" (at any line, but only once per page)
        if (/^\d+\s+\-\s+/.test(text)) {
          heuristicChapters.push({ title: text, startPage: i });
          break;
        }

        // Pattern 5: "Handout 1", "Worksheet 5" (Common in clinical manuals like DSD/DBT)
        if (/^(Handout|Worksheet|Activity)\s+\d+/i.test(text)) {
          heuristicChapters.push({ title: text, startPage: i });
          break;
        }
      }
    }
  }

  if (heuristicChapters.length > 0) {
    heuristicChapters.sort((a, b) => a.startPage - b.startPage);
    for (let i = 0; i < heuristicChapters.length; i++) {
      if (i < heuristicChapters.length - 1) {
        heuristicChapters[i].endPage = heuristicChapters[i + 1].startPage - 1;
      } else {
        heuristicChapters[i].endPage = totalPages;
      }
    }
    return { chapters: heuristicChapters, totalPages };
  }

  return { chapters: [], totalPages };
}

export async function extractPdfText(file: File, maxPages: number = 10): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  
  let fullText = '';
  const pagesToScan = Math.min(pdf.numPages, maxPages);
  
  for (let i = 1; i <= pagesToScan; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    fullText += `--- Page ${i} ---\n${pageText}\n\n`;
  }
  
  return fullText;
}

export async function splitPdf(file: File, chapters: Chapter[]): Promise<{ title: string; blob: Blob }[]> {
  const arrayBuffer = await file.arrayBuffer();
  const sourcePdf = await PDFDocument.load(arrayBuffer);
  const totalPages = sourcePdf.getPageCount();
  const results: { title: string; blob: Blob }[] = [];

  for (const chapter of chapters) {
    const startPage = chapter.startPage;
    const endPage = chapter.endPage || totalPages;
    
    if (startPage > totalPages) continue;
    
    const newPdf = await PDFDocument.create();
    const pageIndices = [];
    const actualEndPage = Math.min(endPage, totalPages);
    
    for (let i = startPage - 1; i < actualEndPage; i++) {
      pageIndices.push(i);
    }
    
    if (pageIndices.length === 0) continue;
    
    const copiedPages = await newPdf.copyPages(sourcePdf, pageIndices);
    copiedPages.forEach((page) => newPdf.addPage(page));
    
    const pdfBytes = await newPdf.save();
    results.push({
      title: chapter.title.replace(/[/\\?%*:|"<>]/g, '-'), // Sanitize filename
      blob: new Blob([pdfBytes], { type: 'application/pdf' }),
    });
  }

  return results;
}
