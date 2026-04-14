import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';

// Set worker path for pdfjs using a reliable CDN
// For pdfjs-dist 4.0+, the worker is an ESM module (.mjs)
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export async function extractTextFromPdf(pdfBytes: Uint8Array): Promise<string> {
  // Use a slice to prevent detachment if the buffer is transferred to a worker
  const loadingTask = pdfjs.getDocument({ data: pdfBytes.slice() });
  const pdf = await loadingTask.promise;
  let fullText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(' ');
    fullText += `--- Page ${i} ---\n${pageText}\n\n`;
  }
  
  return fullText;
}

export async function splitPdfByRanges(pdfBytes: Uint8Array, ranges: string): Promise<{ name: string; bytes: Uint8Array }[]> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const results: { name: string; bytes: Uint8Array }[] = [];
  
  // Parse ranges like "1-3, 5, 7-10"
  const rangeParts = ranges.split(',').map(r => r.trim());
  
  for (const part of rangeParts) {
    const newDoc = await PDFDocument.create();
    const [start, end] = part.split('-').map(Number);
    
    const pageIndices: number[] = [];
    if (end) {
      for (let i = start; i <= end; i++) {
        if (i > 0 && i <= srcDoc.getPageCount()) pageIndices.push(i - 1);
      }
    } else {
      if (start > 0 && start <= srcDoc.getPageCount()) pageIndices.push(start - 1);
    }
    
    if (pageIndices.length > 0) {
      const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
      copiedPages.forEach(page => newDoc.addPage(page));
      const bytes = await newDoc.save();
      results.push({ name: `split_${part}.pdf`, bytes });
    }
  }
  
  return results;
}

export async function getChunkedPageRanges(pdfBytes: Uint8Array, maxChunkSizeMb: number = 40): Promise<{ start: number; end: number }[]> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const totalPages = srcDoc.getPageCount();
  const totalSize = pdfBytes.byteLength;
  const avgPageSize = totalSize / totalPages;
  const maxChunkSizeBytes = maxChunkSizeMb * 1024 * 1024;
  
  const chunks: { start: number; end: number }[] = [];
  let currentStart = 1;
  
  while (currentStart <= totalPages) {
    // Estimate how many pages fit in the chunk
    let pagesInChunk = Math.floor(maxChunkSizeBytes / avgPageSize);
    if (pagesInChunk < 1) pagesInChunk = 1;
    
    let currentEnd = Math.min(currentStart + pagesInChunk - 1, totalPages);
    chunks.push({ start: currentStart, end: currentEnd });
    currentStart = currentEnd + 1;
  }
  
  return chunks;
}

export async function extractPdfChunk(pdfBytes: Uint8Array, start: number, end: number): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const newDoc = await PDFDocument.create();
  const pageIndices: number[] = [];
  
  for (let i = start; i <= end; i++) {
    if (i > 0 && i <= srcDoc.getPageCount()) pageIndices.push(i - 1);
  }
  
  if (pageIndices.length > 0) {
    const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
    copiedPages.forEach(page => newDoc.addPage(page));
    return await newDoc.save();
  }
  
  return new Uint8Array();
}

export async function prependToc(pdfBytes: Uint8Array, tocTitle: string, tocContent: string): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const tocDoc = await PDFDocument.create();
  const font = await tocDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await tocDoc.embedFont(StandardFonts.HelveticaBold);
  
  let page = tocDoc.addPage();
  let { width, height } = page.getSize();
  
  page.drawText(tocTitle, {
    x: 50,
    y: height - 50,
    size: 20,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  
  const lines = tocContent.split('\n');
  let y = height - 100;
  const margin = 50;
  const lineHeight = 15;

  for (const line of lines) {
    if (y < margin) {
      page = tocDoc.addPage();
      y = height - margin;
    }
    
    // Simple text wrapping if line is too long
    const maxWidth = width - (margin * 2);
    const fontSize = 10;
    const textWidth = font.widthOfTextAtSize(line, fontSize);
    
    if (textWidth > maxWidth) {
      const words = line.split(' ');
      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (font.widthOfTextAtSize(testLine, fontSize) > maxWidth) {
          page.drawText(currentLine, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
          y -= lineHeight;
          if (y < margin) {
            page = tocDoc.addPage();
            y = height - margin;
          }
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      page.drawText(currentLine, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
    } else {
      page.drawText(line, {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
    y -= lineHeight;
  }
  
  const mergedDoc = await PDFDocument.create();
  const tocPages = await mergedDoc.copyPages(tocDoc, tocDoc.getPageIndices());
  tocPages.forEach(p => mergedDoc.addPage(p));
  
  const srcPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
  srcPages.forEach(p => mergedDoc.addPage(p));
  
  return await mergedDoc.save();
}
