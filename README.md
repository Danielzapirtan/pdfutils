# pdfutils

A browser-based PDF utility suite tailored for psychotherapy and academic books. It helps you split PDFs by page range or chapter, extract searchable text from scanned documents, and generate a detailed pedagogical table of contents for enhanced reading workflows.

## Features

- Split PDFs into custom page ranges
- Detect chapter boundaries using Gemini AI
- Export chapter-based PDF files
- Extract text from scanned or image-heavy PDFs
- Generate a pedagogical architecture-style table of contents
- Add a generated TOC page to the beginning of a PDF

## Tech stack

- React + Vite
- TypeScript
- pdf-lib for PDF manipulation
- Google Gemini API for chapter detection and text extraction

## Prerequisites

- Node.js 18+
- A Google Gemini API key

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file named `.env.local` with your Gemini API key:

   ```env
   GEMINI_API_KEY=your_api_key_here
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open the local Vite URL shown in the terminal, usually `http://localhost:3000`.

## Available scripts

```bash
npm run dev     # start the Vite dev server
npm run build   # production build
npm run preview # preview the production build
npm run lint    # run TypeScript checks
npm run clean   # remove the dist folder
```

## Project structure

```text
.
├── src/
│   ├── App.tsx                 # Main PDF utility interface
│   ├── lib/
│   │   └── pdf.ts              # PDF splitting and TOC prepending
│   ├── services/
│   │   └── gemini.ts           # Gemini-powered chapter and OCR logic
│   ├── index.css               # App styles
│   └── main.tsx                # React entry point
├── index.html                  # Vite HTML entry
├── package.json                # Scripts and dependencies
├── tsconfig.json               # TypeScript config
├── vite.config.ts             # Vite config
├── metadata.json              # App metadata
├── README.md                  # Project documentation
└── package-lock.json          # Lockfile for npm dependencies
```

## Notes

This project is designed for processing educational and clinical psychology PDFs, especially books with complex structures that benefit from chapter-aware splitting and pedagogical TOC generation. The AI features depend on the Gemini API and work best with high-quality PDFs and valid API credentials.

