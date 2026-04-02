import React, { useState, useCallback, useRef } from 'react';
import { 
  Upload, 
  FileText, 
  Scissors, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  ChevronRight,
  BookOpen,
  X,
  Sparkles,
  Plus,
  Trash2,
  Edit2,
  Save
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { parsePdfChapters, splitPdf, Chapter, extractPdfText } from './services/pdfService';
import { createTarGz } from './services/archiveService';
import { GoogleGenAI, Type } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'ready' | 'splitting' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [splitResults, setSplitResults] = useState<{ title: string; blob: Blob }[]>([]);
  const [isAiScanning, setIsAiScanning] = useState(false);
  
  // Manual entry state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editStartPage, setEditStartPage] = useState<number>(1);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (selectedFile: File) => {
    if (selectedFile.type !== 'application/pdf') {
      setError('Please upload a valid PDF file.');
      return;
    }

    setFile(selectedFile);
    setError(null);
    setStatus('parsing');
    setIsProcessing(true);

    try {
      const { chapters: detectedChapters, totalPages: pages } = await parsePdfChapters(selectedFile);
      setChapters(detectedChapters);
      setTotalPages(pages);
      setStatus('ready');
    } catch (err) {
      console.error(err);
      setError('Failed to parse PDF. The file might be corrupted or protected.');
      setStatus('error');
    } finally {
      setIsProcessing(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleSplit = async () => {
    if (!file || chapters.length === 0) return;

    setStatus('splitting');
    setIsProcessing(true);

    try {
      const results = await splitPdf(file, chapters);
      setSplitResults(results);
      setStatus('done');
    } catch (err) {
      console.error(err);
      setError('Failed to split PDF.');
      setStatus('error');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadArchive = async () => {
    if (splitResults.length === 0) return;

    try {
      const files = await Promise.all(
        splitResults.map(async (res) => ({
          name: `${res.title}.pdf`,
          data: new Uint8Array(await res.blob.arrayBuffer()),
        }))
      );

      const archiveBlob = createTarGz(files);
      const url = URL.createObjectURL(archiveBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file?.name.replace('.pdf', '')}_chapters.tar.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to create archive:', err);
      setError('Failed to create archive.');
    }
  };

  const reset = () => {
    setFile(null);
    setChapters([]);
    setTotalPages(0);
    setSplitResults([]);
    setStatus('idle');
    setError(null);
    setEditingIndex(null);
  };

  const handleAiScan = async () => {
    if (!file) return;
    setIsAiScanning(true);
    setError(null);

    try {
      const text = await extractPdfText(file, 25); // Scan first 25 pages for clinical manuals
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze this text from the beginning of a clinical psychotherapy manual (like DBT for BPD) and extract the Table of Contents. 
        Focus on identifying:
        1. Major Parts (e.g., Part I, Part II)
        2. Chapters (e.g., Chapter 1, Chapter 2)
        3. Handouts or Worksheets sections if they appear in the TOC.
        
        Return ONLY a JSON array of objects with "title" and "startPage" properties. 
        The "startPage" MUST be the physical page number in the PDF (adjust for roman numeral offsets if possible, but usually the text says the page).
        
        Text: ${text}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                startPage: { type: Type.NUMBER }
              },
              required: ["title", "startPage"]
            }
          }
        }
      });

      const detected = JSON.parse(response.text || '[]');
      if (detected.length === 0) {
        throw new Error("No chapters detected in the first 25 pages.");
      }

      const formattedChapters: Chapter[] = detected
        .sort((a: any, b: any) => a.startPage - b.startPage)
        .map((c: any, i: number, arr: any[]) => ({
          title: c.title,
          startPage: c.startPage,
          endPage: i < arr.length - 1 ? arr[i + 1].startPage - 1 : totalPages
        }));

      setChapters(formattedChapters);
    } catch (err) {
      console.error(err);
      setError('AI scan failed. The book might have a complex layout or no clear TOC in the first 25 pages. Please try manual entry.');
    } finally {
      setIsAiScanning(false);
    }
  };

  const addChapter = () => {
    const newChapter: Chapter = {
      title: `Chapter ${chapters.length + 1}`,
      startPage: chapters.length > 0 ? chapters[chapters.length - 1].endPage + 1 : 1,
      endPage: 0
    };
    setChapters([...chapters, newChapter]);
    setEditingIndex(chapters.length);
    setEditTitle(newChapter.title);
    setEditStartPage(newChapter.startPage);
  };

  const deleteChapter = (index: number) => {
    setChapters(chapters.filter((_, i) => i !== index));
    if (editingIndex === index) setEditingIndex(null);
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditTitle(chapters[index].title);
    setEditStartPage(chapters[index].startPage);
  };

  const saveEdit = () => {
    if (editingIndex === null) return;
    const newChapters = [...chapters];
    newChapters[editingIndex] = {
      ...newChapters[editingIndex],
      title: editTitle,
      startPage: editStartPage
    };
    
    // Update end pages
    for (let i = 0; i < newChapters.length - 1; i++) {
      newChapters[i].endPage = newChapters[i + 1].startPage - 1;
    }
    if (newChapters.length > 0) {
      newChapters[newChapters.length - 1].endPage = totalPages;
    }
    
    setChapters(newChapters);
    setEditingIndex(null);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f5] text-[#1a1a1a] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="border-b border-black/5 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
              <Scissors size={18} />
            </div>
            <h1 className="font-semibold tracking-tight">PDF Chapter Splitter</h1>
          </div>
          {file && (
            <button 
              onClick={reset}
              className="text-sm text-gray-500 hover:text-black transition-colors flex items-center gap-1"
            >
              <X size={14} /> Reset
            </button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {status === 'idle' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto"
            >
              <div className="text-center mb-12">
                <h2 className="text-4xl font-light tracking-tight mb-4">
                  Split your psychotherapy books <br />
                  <span className="font-medium text-emerald-600">into focused chapters.</span>
                </h2>
                <p className="text-gray-500">
                  Upload a PDF to automatically detect and extract chapters. 
                  Perfect for organizing study materials and clinical references.
                </p>
              </div>

              <div
                onDrop={onDrop}
                onDragOver={onDragOver}
                onClick={() => fileInputRef.current?.click()}
                className="group relative border-2 border-dashed border-gray-300 rounded-3xl p-16 text-center hover:border-emerald-500 hover:bg-emerald-50/30 transition-all cursor-pointer overflow-hidden"
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                  className="hidden" 
                  accept=".pdf"
                />
                <div className="relative z-10">
                  <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-black/5 flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
                    <Upload className="text-emerald-600" />
                  </div>
                  <p className="text-lg font-medium mb-1">Click or drag PDF here</p>
                  <p className="text-sm text-gray-400">Supports books up to 500MB</p>
                </div>
              </div>
            </motion.div>
          )}

          {(status === 'parsing' || status === 'splitting') && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-24"
            >
              <Loader2 className="w-12 h-12 text-emerald-600 animate-spin mb-6" />
              <h3 className="text-xl font-medium mb-2">
                {status === 'parsing' ? 'Analyzing PDF structure...' : 'Extracting chapters...'}
              </h3>
              <p className="text-gray-500">This may take a few moments depending on the file size.</p>
            </motion.div>
          )}

          {status === 'ready' && (
            <motion.div
              key="ready"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              <div className="lg:col-span-2">
                <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-black/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <BookOpen className="text-emerald-600" size={20} />
                      <h3 className="font-semibold">Detected Chapters</h3>
                    </div>
                    <span className="text-xs font-medium px-2 py-1 bg-gray-100 rounded-full text-gray-500 uppercase tracking-wider">
                      {chapters.length} Found
                    </span>
                  </div>
                  
                  <div className="divide-y divide-black/5 max-h-[600px] overflow-y-auto">
                    {chapters.length > 0 ? (
                      chapters.map((chapter, idx) => (
                        <div key={idx} className="p-4 hover:bg-gray-50 transition-colors flex items-center justify-between group">
                          {editingIndex === idx ? (
                            <div className="flex-1 flex items-center gap-2">
                              <input 
                                type="text" 
                                value={editTitle} 
                                onChange={(e) => setEditTitle(e.target.value)}
                                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                placeholder="Chapter Title"
                              />
                              <input 
                                type="number" 
                                value={editStartPage} 
                                onChange={(e) => setEditStartPage(parseInt(e.target.value) || 1)}
                                className="w-20 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                placeholder="Page"
                              />
                              <button onClick={saveEdit} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save size={16} /></button>
                              <button onClick={cancelEdit} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X size={16} /></button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-4">
                                <span className="text-xs font-mono text-gray-400 w-6">
                                  {(idx + 1).toString().padStart(2, '0')}
                                </span>
                                <div>
                                  <p className="font-medium text-sm">{chapter.title}</p>
                                  <p className="text-xs text-gray-400">
                                    Pages {chapter.startPage} – {chapter.endPage || '?'}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => startEdit(idx)} className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                                  <Edit2 size={14} />
                                </button>
                                <button onClick={() => deleteChapter(idx)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                  <Trash2 size={14} />
                                </button>
                                <ChevronRight size={16} className="text-gray-300" />
                              </div>
                            </>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="p-12 text-center">
                        <AlertCircle className="mx-auto mb-4 text-amber-500" size={32} />
                        <p className="font-medium mb-1">No chapters detected</p>
                        <p className="text-sm text-gray-500 mb-6">
                          We couldn't find a table of contents in this PDF. 
                          Try scanning with AI or adding chapters manually.
                        </p>
                        <div className="flex items-center justify-center gap-3">
                          <button 
                            onClick={handleAiScan}
                            disabled={isAiScanning}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
                          >
                            {isAiScanning ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                            Scan with AI
                          </button>
                          <button 
                            onClick={addChapter}
                            className="flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            <Plus size={16} />
                            Add Manually
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {chapters.length > 0 && (
                    <div className="p-4 bg-gray-50 border-t border-black/5 flex items-center justify-between">
                      <button 
                        onClick={addChapter}
                        className="text-sm text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
                      >
                        <Plus size={14} /> Add Chapter
                      </button>
                      <button 
                        onClick={handleAiScan}
                        disabled={isAiScanning}
                        className="text-sm text-gray-500 hover:text-black flex items-center gap-1 disabled:opacity-50"
                      >
                        {isAiScanning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        Re-scan with AI
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-6">
                  <h4 className="font-semibold mb-4">File Details</h4>
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl mb-6">
                    <FileText className="text-emerald-600" size={20} />
                    <div className="overflow-hidden">
                      <p className="text-sm font-medium truncate">{file?.name}</p>
                      <p className="text-xs text-gray-400">{(file!.size / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                  </div>
                  
                  <button
                    disabled={chapters.length === 0}
                    onClick={handleSplit}
                    className="w-full py-4 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2"
                  >
                    <Scissors size={18} />
                    Split into {chapters.length} PDFs
                  </button>
                </div>

                <div className="bg-emerald-50 rounded-2xl p-6 border border-emerald-100">
                  <h4 className="text-emerald-800 font-semibold mb-2 text-sm">Pro Tip</h4>
                  <p className="text-emerald-700/80 text-xs leading-relaxed">
                    Splitting large books into chapters makes it easier to use them with AI study tools or read them on mobile devices.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {status === 'done' && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-2xl mx-auto text-center"
            >
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-8">
                <CheckCircle2 size={40} />
              </div>
              <h2 className="text-3xl font-semibold mb-4">Splitting Complete!</h2>
              <p className="text-gray-500 mb-12">
                We've successfully generated {splitResults.length} individual chapter files.
                You can download them all as a single archive.
              </p>

              <div className="grid grid-cols-1 gap-4 mb-12">
                <button
                  onClick={downloadArchive}
                  className="w-full py-4 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
                >
                  <Download size={18} />
                  Download All as .tar.gz
                </button>
                <button
                  onClick={reset}
                  className="w-full py-4 bg-white border border-black/5 rounded-xl font-medium hover:bg-gray-50 transition-all"
                >
                  Process Another Book
                </button>
              </div>

              <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-6 text-left">
                <h4 className="font-semibold mb-4 text-sm uppercase tracking-wider text-gray-400">Individual Files</h4>
                <div className="space-y-2">
                  {splitResults.map((result, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-xl transition-colors">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-8 h-8 bg-red-50 text-red-600 rounded flex items-center justify-center flex-shrink-0">
                          <FileText size={14} />
                        </div>
                        <p className="text-sm font-medium truncate">{result.title}.pdf</p>
                      </div>
                      <button 
                        onClick={() => {
                          const url = URL.createObjectURL(result.blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${result.title}.pdf`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="p-2 hover:bg-emerald-50 text-emerald-600 rounded-lg transition-colors"
                      >
                        <Download size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {status === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="max-w-md mx-auto text-center py-24"
            >
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertCircle size={32} />
              </div>
              <h3 className="text-xl font-semibold mb-2">Something went wrong</h3>
              <p className="text-gray-500 mb-8">{error || 'An unexpected error occurred.'}</p>
              <button
                onClick={reset}
                className="px-8 py-3 bg-black text-white rounded-xl font-medium hover:bg-gray-800 transition-all"
              >
                Try Again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="py-12 border-t border-black/5 mt-auto">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-4">Secure & Private</p>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            All processing happens locally in your browser. Your psychotherapy books and personal data never leave your device.
          </p>
        </div>
      </footer>
    </div>
  );
}
