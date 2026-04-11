import OpenAI from 'openai';

export interface Chapter {
  title: string;
  startPage: number;
}

export async function detectChaptersOpenAI(text: string, apiKey: string): Promise<Chapter[]> {
  const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  
  const response = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    messages: [
      {
        role: "system",
        content: "You are an expert at analyzing book structures. You will be provided with the text extracted from a PDF. Identify the chapters and return a JSON array of objects with 'title' and 'startPage' (1-indexed). Focus on the main structure of the book."
      },
      {
        role: "user",
        content: text.slice(0, 100000) // Limit text to avoid token limits if book is huge
      }
    ],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0].message.content;
  try {
    const parsed = JSON.parse(content || '{"chapters": []}');
    return parsed.chapters || [];
  } catch (e) {
    console.error("Failed to parse chapters from OpenAI", e);
    return [];
  }
}

export async function generateDetailedTocOpenAI(text: string, apiKey: string): Promise<string> {
  const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  
  const response = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    messages: [
      {
        role: "system",
        content: "Generate a very detailed Table of Contents for this book text. This is for a 'pedagogical architecture' copy of the book. Include sub-chapters, key concepts, and page numbers. Format it as a clean text list."
      },
      {
        role: "user",
        content: text.slice(0, 100000)
      }
    ]
  });

  return response.choices[0].message.content || "No TOC generated.";
}

export async function extractTextForOcrOpenAI(text: string, apiKey: string): Promise<string> {
  const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  
  const response = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    messages: [
      {
        role: "system",
        content: "The following text was extracted from a PDF. Clean it up, fix any OCR errors, and return the full text content in order."
      },
      {
        role: "user",
        content: text.slice(0, 100000)
      }
    ]
  });

  return response.choices[0].message.content || "";
}
