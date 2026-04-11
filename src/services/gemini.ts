import { GoogleGenAI, Type } from "@google/genai";

export interface Chapter {
  title: string;
  startPage: number;
}

export async function detectChapters(pdfBase64: string, apiKey: string, model: string = "gemini-3.1-flash-lite-preview"): Promise<Chapter[]> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: model,
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            text: "Analyze this PDF and identify the chapters. Return a JSON array of objects with 'title' and 'startPage' (1-indexed). Focus on the main structure of the book.",
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            startPage: { type: Type.INTEGER },
          },
          required: ["title", "startPage"],
        },
      },
    },
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    console.error("Failed to parse chapters", e);
    return [];
  }
}

export async function generateDetailedToc(pdfBase64: string, apiKey: string, model: string = "gemini-3.1-flash-lite-preview"): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: model,
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            text: "Generate a very detailed Table of Contents for this PDF. This is for a 'pedagogical architecture' copy of the book. Include sub-chapters, key concepts, and page numbers. Format it as a clean text list.",
          },
        ],
      },
    ],
  });

  return response.text || "No TOC generated.";
}

export async function extractTextForOcr(pdfBase64: string, apiKey: string, model: string = "gemini-3.1-flash-lite-preview"): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: model,
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            text: "Extract all text from this PDF. If it's an image-based PDF, perform OCR. Return the full text content in order.",
          },
        ],
      },
    ],
  });

  return response.text || "";
}
