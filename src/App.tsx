/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  FileUp, 
  Scissors, 
  BookOpen, 
  Search, 
  ListOrdered, 
  Download, 
  Settings, 
  X, 
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { splitPdfByRanges, prependToc } from './lib/pdf';
import { detectChapters, generateDetailedToc, extractTextForOcr, type Chapter } from './services/gemini';
import { PDFDocument } from 'pdf-lib';

type Tool = 'split' | 'chapters' | 'ocr' | 'toc';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [customApiKey, setCustomApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  
  // Tool specific states
  const [ranges, setRanges] = useState('1-5, 6-10');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [tocResult, setTocResult] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<string | null>(null);

  const apiKey = useMemo(() => customApiKey || process.env.GEMINI_API_KEY || '', [customApiKey]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (selectedFile) {
      setFile(selectedFile);
      selectedFile.arrayBuffer().then(buffer => {
        const bytes = new Uint8Array(buffer);
        setPdfBytes(bytes);
      });
      setActiveTool(null);
      setChapters([]);
      setTocResult(null);
      setOcrResult(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false,
    noClick: false,
    noKeyboard: false
  } as any);

  const handleDownload = (bytes: Uint8Array, filename: string) => {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toBase64 = (bytes: Uint8Array) => {
    return btoa(
      bytes.reduce((data, byte) => data + String.fromCharCode(byte), '')
    );
  };

  const runSplit = async () => {
    if (!pdfBytes) return;
    setLoading(true);
    setStatus('Splitting PDF...');
    try {
      const results = await splitPdfByRanges(pdfBytes, ranges);
      results.forEach(res => handleDownload(res.bytes, res.name));
      setStatus('Success! Files downloaded.');
    } catch (e) {
      console.error(e);
      setStatus('Error splitting PDF.');
    } finally {
      setLoading(false);
    }
  };

  const runChapterDetect = async () => {
    if (!pdfBytes || !apiKey) return;
    setLoading(true);
    setStatus('Analyzing chapters with AI...');
    try {
      const base64 = toBase64(pdfBytes);
      const detected = await detectChapters(base64, apiKey);
      setChapters(detected);
      setStatus(`Detected ${detected.length} chapters.`);
    } catch (e) {
      console.error(e);
      setStatus('Error detecting chapters.');
    } finally {
      setLoading(false);
    }
  };

  const splitByChapters = async () => {
    if (!pdfBytes || chapters.length === 0) return;
    setLoading(true);
    setStatus('Splitting by chapters...');
    try {
      const srcDoc = await PDFDocument.load(pdfBytes);
      for (let i = 0; i < chapters.length; i++) {
        const start = chapters[i].startPage;
        const end = i < chapters.length - 1 ? chapters[i + 1].startPage - 1 : srcDoc.getPageCount();
        
        const newDoc = await PDFDocument.create();
        const pageIndices = [];
        for (let p = start; p <= end; p++) {
          if (p > 0 && p <= srcDoc.getPageCount()) pageIndices.push(p - 1);
        }
        
        if (pageIndices.length > 0) {
          const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
          copiedPages.forEach(page => newDoc.addPage(page));
          const bytes = await newDoc.save();
          handleDownload(bytes, `Chapter_${i + 1}_${chapters[i].title.replace(/\s+/g, '_')}.pdf`);
        }
      }
      setStatus('Success! Chapters downloaded.');
    } catch (e) {
      console.error(e);
      setStatus('Error splitting by chapters.');
    } finally {
      setLoading(false);
    }
  };

  const runOcr = async () => {
    if (!pdfBytes || !apiKey) return;
    setLoading(true);
    setStatus('Performing OCR/Text Extraction...');
    try {
      const base64 = toBase64(pdfBytes);
      const text = await extractTextForOcr(base64, apiKey);
      setOcrResult(text);
      setStatus('OCR Complete.');
    } catch (e) {
      console.error(e);
      setStatus('Error during OCR.');
    } finally {
      setLoading(false);
    }
  };

  const runToc = async () => {
    if (!pdfBytes || !apiKey) return;
    setLoading(true);
    setStatus('Generating detailed TOC...');
    try {
      const base64 = toBase64(pdfBytes);
      const toc = await generateDetailedToc(base64, apiKey);
      setTocResult(toc);
      
      const newPdfBytes = await prependToc(pdfBytes, 'Pedagogical Architecture - Detailed TOC', toc);
      handleDownload(newPdfBytes, `pedagogical_architecture_${file?.name || 'document'}.pdf`);
      setStatus('Success! Enhanced PDF downloaded.');
    } catch (e) {
      console.error(e);
      setStatus('Error generating TOC.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-6 md:p-12 max-w-5xl mx-auto">
      {/* Header */}
      <header className="w-full flex justify-between items-center mb-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-sage rounded-xl flex items-center justify-center text-white shadow-lg">
            <BookOpen size={24} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-sage">pdfutils</h1>
        </div>
        <button 
          onClick={() => setShowSettings(true)}
          className="p-2 hover:bg-sage/10 rounded-full transition-colors text-sage"
        >
          <Settings size={20} />
        </button>
      </header>

      {/* Main Content */}
      <main className="w-full space-y-8">
        {!file ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            {...getRootProps()} 
            className={cn(
              "w-full aspect-[16/6] rounded-3xl border-2 border-dashed flex flex-col items-center justify-center gap-4 cursor-pointer transition-all",
              isDragActive ? "border-sage bg-sage/5" : "border-sage/20 hover:border-sage/40 hover:bg-sage/5"
            )}
          >
            <input {...getInputProps()} />
            <div className="w-16 h-16 bg-sage/10 rounded-full flex items-center justify-center text-sage">
              <FileUp size={32} />
            </div>
            <div className="text-center">
              <p className="text-xl font-medium text-sage">Drop your psychotherapy book here</p>
              <p className="text-sage/60">or click to browse files</p>
            </div>
          </motion.div>
        ) : (
          <div className="space-y-8">
            {/* File Info */}
            <div className="glass-panel p-6 rounded-3xl flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-sage/10 rounded-2xl flex items-center justify-center text-sage">
                  <BookOpen size={24} />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{file.name}</h3>
                  <p className="text-sm text-sage/60">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
              <button 
                onClick={() => setFile(null)}
                className="p-2 hover:bg-red-50 text-red-400 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Tools Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ToolCard 
                icon={<Scissors />}
                title="Split by Pages"
                description="Extract specific page ranges"
                active={activeTool === 'split'}
                onClick={() => setActiveTool('split')}
              />
              <ToolCard 
                icon={<ChevronRight />}
                title="Split by Chapters"
                description="AI-powered chapter detection"
                active={activeTool === 'chapters'}
                onClick={() => setActiveTool('chapters')}
              />
              <ToolCard 
                icon={<Search />}
                title="Searchable PDF"
                description="OCR and text extraction"
                active={activeTool === 'ocr'}
                onClick={() => setActiveTool('ocr')}
              />
              <ToolCard 
                icon={<ListOrdered />}
                title="Detailed TOC"
                description="Generate pedagogical architecture"
                active={activeTool === 'toc'}
                onClick={() => setActiveTool('toc')}
              />
            </div>

            {/* Tool Options */}
            <AnimatePresence mode="wait">
              {activeTool && (
                <motion.div
                  key={activeTool}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="glass-panel p-8 rounded-3xl overflow-hidden"
                >
                  {activeTool === 'split' && (
                    <div className="space-y-4">
                      <h4 className="text-xl font-semibold text-sage">Split by Page Ranges</h4>
                      <p className="text-sage/60">Enter ranges separated by commas (e.g., 1-10, 15, 20-25)</p>
                      <input 
                        type="text" 
                        value={ranges}
                        onChange={(e) => setRanges(e.target.value)}
                        className="w-full p-4 bg-paper border border-sage/20 rounded-2xl focus:outline-none focus:ring-2 focus:ring-sage/20"
                      />
                      <button 
                        onClick={runSplit}
                        disabled={loading}
                        className="w-full py-4 bg-sage text-white rounded-2xl font-semibold hover:bg-sage/90 transition-colors flex items-center justify-center gap-2"
                      >
                        {loading ? <Loader2 className="animate-spin" /> : <Download size={20} />}
                        Download Split Files
                      </button>
                    </div>
                  )}

                  {activeTool === 'chapters' && (
                    <div className="space-y-4">
                      <h4 className="text-xl font-semibold text-sage">Split by Chapters</h4>
                      <p className="text-sage/60">Gemini will analyze the book structure to find chapters.</p>
                      
                      {chapters.length === 0 ? (
                        <button 
                          onClick={runChapterDetect}
                          disabled={loading || !apiKey}
                          className="w-full py-4 bg-sage text-white rounded-2xl font-semibold hover:bg-sage/90 transition-colors flex items-center justify-center gap-2"
                        >
                          {loading ? <Loader2 className="animate-spin" /> : <Search size={20} />}
                          Detect Chapters
                        </button>
                      ) : (
                        <div className="space-y-4">
                          <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                            {chapters.map((ch, i) => (
                              <div key={i} className="flex justify-between p-3 bg-paper rounded-xl border border-sage/10">
                                <span className="font-medium">{ch.title}</span>
                                <span className="text-sage/60">Page {ch.startPage}</span>
                              </div>
                            ))}
                          </div>
                          <button 
                            onClick={splitByChapters}
                            disabled={loading}
                            className="w-full py-4 bg-sage text-white rounded-2xl font-semibold hover:bg-sage/90 transition-colors flex items-center justify-center gap-2"
                          >
                            {loading ? <Loader2 className="animate-spin" /> : <Download size={20} />}
                            Download All Chapters
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {activeTool === 'ocr' && (
                    <div className="space-y-4">
                      <h4 className="text-xl font-semibold text-sage">Searchable PDF / OCR</h4>
                      <p className="text-sage/60">Extract text content from scanned psychotherapy books.</p>
                      
                      {!ocrResult ? (
                        <button 
                          onClick={runOcr}
                          disabled={loading || !apiKey}
                          className="w-full py-4 bg-sage text-white rounded-2xl font-semibold hover:bg-sage/90 transition-colors flex items-center justify-center gap-2"
                        >
                          {loading ? <Loader2 className="animate-spin" /> : <Search size={20} />}
                          Start OCR Process
                        </button>
                      ) : (
                        <div className="space-y-4">
                          <div className="p-4 bg-paper rounded-2xl border border-sage/10 max-h-60 overflow-y-auto text-sm whitespace-pre-wrap">
                            {ocrResult}
                          </div>
                          <button 
                            onClick={() => {
                              const blob = new Blob([ocrResult], { type: 'text/plain' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `${file.name.replace('.pdf', '')}_text.txt`;
                              a.click();
                            }}
                            className="w-full py-4 bg-sage/10 text-sage rounded-2xl font-semibold hover:bg-sage/20 transition-colors flex items-center justify-center gap-2"
                          >
                            <Download size={20} />
                            Download Extracted Text
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {activeTool === 'toc' && (
                    <div className="space-y-4">
                      <h4 className="text-xl font-semibold text-sage">Pedagogical Architecture</h4>
                      <p className="text-sage/60">Generate a detailed TOC and prepend it to your book.</p>
                      <button 
                        onClick={runToc}
                        disabled={loading || !apiKey}
                        className="w-full py-4 bg-sage text-white rounded-2xl font-semibold hover:bg-sage/90 transition-colors flex items-center justify-center gap-2"
                      >
                        {loading ? <Loader2 className="animate-spin" /> : <ListOrdered size={20} />}
                        Generate & Download Enhanced PDF
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Status Toast */}
        <AnimatePresence>
          {status && (
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="fixed bottom-8 left-1/2 -translate-x-1/2 glass-panel px-6 py-3 rounded-full flex items-center gap-3 shadow-xl z-50"
            >
              {status.includes('Error') ? <AlertCircle className="text-red-500" /> : <CheckCircle2 className="text-green-500" />}
              <span className="font-medium">{status}</span>
              <button onClick={() => setStatus(null)} className="ml-2 text-sage/40 hover:text-sage">
                <X size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-ink/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-md bg-paper p-8 rounded-[2rem] shadow-2xl border border-sage/10"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold text-sage">Settings</h3>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-sage/10 rounded-full">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-sage/60 mb-2">Custom Gemini API Key</label>
                  <input 
                    type="password" 
                    placeholder="Enter your API key..."
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                    className="w-full p-4 bg-white border border-sage/20 rounded-2xl focus:outline-none focus:ring-2 focus:ring-sage/20"
                  />
                  <p className="mt-2 text-xs text-sage/40">
                    If left blank, the application will use the default system key.
                  </p>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full py-4 bg-sage text-white rounded-2xl font-semibold hover:bg-sage/90 transition-colors"
                >
                  Save Settings
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="mt-auto py-12 text-sage/40 text-sm flex flex-col items-center gap-2">
        <p>© 2026 Antoniu-Daniel Zăpîrțan • Professional PDF Suite</p>
        <p className="italic">Optimized for psychotherapy and academic literature</p>
      </footer>
    </div>
  );
}

function ToolCard({ icon, title, description, active, onClick }: { 
  icon: React.ReactNode, 
  title: string, 
  description: string, 
  active: boolean,
  onClick: () => void 
}) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "glass-panel p-6 rounded-[2rem] text-left transition-all group",
        active ? "ring-2 ring-sage bg-sage/5" : "hover:bg-sage/5 hover:border-sage/30"
      )}
    >
      <div className={cn(
        "w-12 h-12 rounded-2xl flex items-center justify-center mb-4 transition-colors",
        active ? "bg-sage text-white" : "bg-sage/10 text-sage group-hover:bg-sage/20"
      )}>
        {icon}
      </div>
      <h3 className="font-bold text-lg mb-1">{title}</h3>
      <p className="text-sm text-sage/60">{description}</p>
    </button>
  );
}

