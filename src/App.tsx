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
import JSZip from 'jszip';
import { cn } from './lib/utils';
import { splitPdfByRanges, prependToc, extractTextFromPdf } from './lib/pdf';
import { detectChapters, generateDetailedToc, extractTextForOcr, type Chapter } from './services/gemini';
import { detectChaptersOpenAI, generateDetailedTocOpenAI, extractTextForOcrOpenAI } from './services/openai';
import { detectChaptersClaude, generateDetailedTocClaude, extractTextForOcrClaude } from './services/claude';
import { PDFDocument } from 'pdf-lib';

type Tool = 'split' | 'chapters' | 'ocr' | 'toc';
type Provider = 'gemini' | 'openai' | 'claude';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [customApiKey, setCustomApiKey] = useState('');
  const [customOpenAiKey, setCustomOpenAiKey] = useState('');
  const [customClaudeApiKey, setCustomClaudeApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-3.1-flash-lite-preview');
  const [openaiModel, setOpenaiModel] = useState('gpt-4o-mini');
  const [claudeModel, setClaudeModel] = useState('claude-3-haiku-20240307');
  const [provider, setProvider] = useState<Provider>('openai');
  const [showSettings, setShowSettings] = useState(false);
  const [timer, setTimer] = useState(0);
  const [timerInterval, setTimerInterval] = useState<NodeJS.Timeout | null>(null);
  
  // Tool specific states
  const [ranges, setRanges] = useState('1-5, 6-10');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [tocResult, setTocResult] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<string | null>(null);

  const apiKey = useMemo(() => {
    if (provider === 'gemini') {
      return customApiKey || process.env.GEMINI_API_KEY || '';
    } else if (provider === 'openai') {
      return customOpenAiKey || process.env.OPENAI_API_KEY || '';
    } else {
      return customClaudeApiKey || process.env.ANTHROPIC_API_KEY || '';
    }
  }, [customApiKey, customOpenAiKey, customClaudeApiKey, provider]);

  const currentModel = useMemo(() => {
    if (provider === 'gemini') return geminiModel;
    if (provider === 'openai') return openaiModel;
    return claudeModel;
  }, [provider, geminiModel, openaiModel, claudeModel]);

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
    if (bytes.byteLength === 0) {
      throw new Error("PDF data is unavailable (detached buffer). Please re-upload the file.");
    }
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const handleError = (e: any, defaultMsg: string) => {
    console.error(e);
    const msg = e?.message || String(e);
    if (msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('credit balance')) {
      const fallbackMsg = provider !== 'gemini' 
        ? `Quota exceeded for ${provider}. Auto-switching to Gemini (free). Please try again.`
        : 'API Quota/Credit Exceeded. Please check your billing or switch providers in Settings.';
      
      setStatus(fallbackMsg);
      
      if (provider !== 'gemini') {
        setProvider('gemini');
      }
    } else if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
      setStatus(`Model "${currentModel}" not found. Please select a different model in Settings.`);
    } else {
      setStatus(defaultMsg);
    }
  };

  const startTimer = () => {
    setTimer(0);
    const interval = setInterval(() => {
      setTimer(prev => prev + 1);
    }, 1000);
    setTimerInterval(interval);
  };

  const stopTimer = () => {
    if (timerInterval) {
      clearInterval(timerInterval);
      setTimerInterval(null);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const runSplit = async () => {
    if (!pdfBytes) return;
    setLoading(true);
    setStatus('Splitting PDF...');
    startTimer();
    try {
      const results = await splitPdfByRanges(pdfBytes, ranges);
      results.forEach(res => handleDownload(res.bytes, res.name));
      setStatus(`Success! Files downloaded in ${formatTime(timer + 1)}.`);
    } catch (e) {
      handleError(e, 'Error splitting PDF.');
    } finally {
      setLoading(false);
      stopTimer();
    }
  };

  const runChapterDetect = async () => {
    if (!pdfBytes || !apiKey) return;
    setLoading(true);
    setStatus('Analyzing chapters with AI...');
    startTimer();
    try {
      let detected: Chapter[] = [];
      if (provider === 'gemini') {
        const base64 = toBase64(pdfBytes);
        detected = await detectChapters(base64, apiKey, geminiModel);
      } else if (provider === 'openai') {
        const text = await extractTextFromPdf(pdfBytes);
        detected = await detectChaptersOpenAI(text, apiKey, openaiModel);
      } else {
        const text = await extractTextFromPdf(pdfBytes);
        detected = await detectChaptersClaude(text, apiKey, claudeModel);
      }
      setChapters(detected);
      setStatus(`Detected ${detected.length} chapters in ${formatTime(timer + 1)}.`);
    } catch (e) {
      handleError(e, 'Error detecting chapters.');
    } finally {
      setLoading(false);
      stopTimer();
    }
  };

  const splitByChapters = async () => {
    if (!pdfBytes || chapters.length === 0) return;
    setLoading(true);
    setStatus('Splitting by chapters and creating ZIP...');
    startTimer();
    try {
      const zip = new JSZip();
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
          const fileName = `Chapter_${i + 1}_${chapters[i].title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_')}.pdf`;
          zip.file(fileName, bytes);
        }
      }
      
      const zipContent = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipContent);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file?.name.replace('.pdf', '')}_chapters.zip`;
      a.click();
      URL.revokeObjectURL(url);
      
      setStatus(`Success! ZIP downloaded in ${formatTime(timer + 1)}.`);
    } catch (e) {
      handleError(e, 'Error splitting by chapters.');
    } finally {
      setLoading(false);
      stopTimer();
    }
  };

  const runOcr = async () => {
    if (!pdfBytes || !apiKey) return;
    setLoading(true);
    setStatus('Performing OCR/Text Extraction...');
    startTimer();
    try {
      let text = '';
      if (provider === 'gemini') {
        const base64 = toBase64(pdfBytes);
        text = await extractTextForOcr(base64, apiKey, geminiModel);
      } else if (provider === 'openai') {
        const extracted = await extractTextFromPdf(pdfBytes);
        text = await extractTextForOcrOpenAI(extracted, apiKey, openaiModel);
      } else {
        const extracted = await extractTextFromPdf(pdfBytes);
        text = await extractTextForOcrClaude(extracted, apiKey, claudeModel);
      }
      setOcrResult(text);
      setStatus(`OCR Complete in ${formatTime(timer + 1)}.`);
    } catch (e) {
      handleError(e, 'Error during OCR.');
    } finally {
      setLoading(false);
      stopTimer();
    }
  };

  const runToc = async () => {
    if (!pdfBytes || !apiKey) return;
    setLoading(true);
    setStatus('Generating detailed TOC...');
    startTimer();
    try {
      let toc = '';
      if (provider === 'gemini') {
        const base64 = toBase64(pdfBytes);
        toc = await generateDetailedToc(base64, apiKey, geminiModel);
      } else if (provider === 'openai') {
        const text = await extractTextFromPdf(pdfBytes);
        toc = await generateDetailedTocOpenAI(text, apiKey, openaiModel);
      } else {
        const text = await extractTextFromPdf(pdfBytes);
        toc = await generateDetailedTocClaude(text, apiKey, claudeModel);
      }
      setTocResult(toc);
      
      const newPdfBytes = await prependToc(pdfBytes, 'Pedagogical Architecture - Detailed TOC', toc);
      handleDownload(newPdfBytes, `pedagogical_architecture_${file?.name || 'document'}.pdf`);
      setStatus(`Success! Enhanced PDF downloaded in ${formatTime(timer + 1)}.`);
    } catch (e) {
      handleError(e, 'Error generating TOC.');
    } finally {
      setLoading(false);
      stopTimer();
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
              {status.includes('Error') || status.includes('Exceeded') ? <AlertCircle className="text-red-500" /> : <CheckCircle2 className="text-green-500" />}
              <div className="flex flex-col">
                <span className="font-medium text-sm">{status}</span>
                {loading && (
                  <div className="flex gap-2 items-center">
                    <span className="text-[10px] text-sage/60 font-mono">
                      Elapsed: {formatTime(timer)}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-sage/10 text-sage rounded uppercase font-bold tracking-wider">
                      {currentModel}
                    </span>
                  </div>
                )}
              </div>
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
                  <label className="block text-sm font-medium text-sage/60 mb-2">AI Provider</label>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setProvider('gemini')}
                      className={cn(
                        "flex-1 py-2 rounded-xl text-sm font-medium transition-all",
                        provider === 'gemini' ? "bg-sage text-white" : "bg-sage/5 text-sage hover:bg-sage/10"
                      )}
                    >
                      Gemini
                    </button>
                    <button 
                      onClick={() => setProvider('openai')}
                      className={cn(
                        "flex-1 py-2 rounded-xl text-sm font-medium transition-all",
                        provider === 'openai' ? "bg-sage text-white" : "bg-sage/5 text-sage hover:bg-sage/10"
                      )}
                    >
                      OpenAI
                    </button>
                    <button 
                      onClick={() => setProvider('claude')}
                      className={cn(
                        "flex-1 py-2 rounded-xl text-sm font-medium transition-all",
                        provider === 'claude' ? "bg-sage text-white" : "bg-sage/5 text-sage hover:bg-sage/10"
                      )}
                    >
                      Claude
                    </button>
                  </div>
                </div>
                {provider === 'gemini' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-sage/60 mb-2">Gemini Model</label>
                      <select 
                        value={geminiModel}
                        onChange={(e) => setGeminiModel(e.target.value)}
                        className="w-full p-4 bg-white border border-sage/20 rounded-2xl focus:outline-none focus:ring-2 focus:ring-sage/20 appearance-none"
                      >
                        <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite (High Quota)</option>
                        <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Complex Reasoning)</option>
                        <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash (Experimental)</option>
                        <option value="gemini-3-flash-preview">Gemini 3 Flash (Standard)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-sage/60 mb-2">Custom Gemini API Key</label>
                      <input 
                        type="password" 
                        placeholder="Enter your Gemini API key..."
                        value={customApiKey}
                        onChange={(e) => setCustomApiKey(e.target.value)}
                        className="w-full p-4 bg-white border border-sage/20 rounded-2xl focus:outline-none focus:ring-2 focus:ring-sage/20"
                      />
                    </div>
                  </div>
                )}
                {provider === 'openai' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-sage/60 mb-2">OpenAI Model</label>
                      <select 
                        value={openaiModel}
                        onChange={(e) => setOpenaiModel(e.target.value)}
                        className="w-full p-4 bg-white border border-sage/20 rounded-2xl focus:outline-none focus:ring-2 focus:ring-sage/20 appearance-none"
                      >
                        <option value="gpt-4o-mini">GPT-4o Mini (Fast & Cheap)</option>
                        <option value="gpt-4o">GPT-4o (Most Powerful)</option>
                        <option value="o1-mini">o1 Mini (Reasoning)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-sage/60 mb-2">Custom OpenAI API Key</label>
                      <input 
                        type="password" 
                        placeholder="Enter your OpenAI API key..."
                        value={customOpenAiKey}
                        onChange={(e) => setCustomOpenAiKey(e.target.value)}
                        className="w-full p-4 bg-white border border-sage/20 rounded-2xl focus:outline-none focus:ring-2 focus:ring-sage/20"
                      />
                    </div>
                  </div>
                )}
                {provider === 'claude' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-sage/60 mb-2">Claude Model</label>
                      <select 
                        value={claudeModel}
                        onChange={(e) => setClaudeModel(e.target.value)}
                        className="w-full p-4 bg-white border border-sage/20 rounded-2xl focus:outline-none focus:ring-2 focus:ring-sage/20 appearance-none"
                      >
                        <option value="claude-3-haiku-20240307">Claude 3 Haiku (Fastest)</option>
                        <option value="claude-3-5-sonnet-latest">Claude 3.5 Sonnet (Best Quality)</option>
                        <option value="claude-3-opus-latest">Claude 3 Opus (Most Powerful)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-sage/60 mb-2">Custom Claude API Key</label>
                      <input 
                        type="password" 
                        placeholder="Enter your Claude API key..."
                        value={customClaudeApiKey}
                        onChange={(e) => setCustomClaudeApiKey(e.target.value)}
                        className="w-full p-4 bg-white border border-sage/20 rounded-2xl focus:outline-none focus:ring-2 focus:ring-sage/20"
                      />
                    </div>
                  </div>
                )}
                <p className="mt-2 text-xs text-sage/40">
                  If left blank, the application will use the default system key if available.
                </p>
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

