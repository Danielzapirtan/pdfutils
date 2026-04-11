import Anthropic from '@anthropic-ai/sdk';

export interface Chapter {
  title: string;
  startPage: number;
}

export async function detectChaptersClaude(text: string, apiKey: string): Promise<Chapter[]> {
  const anthropic = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  
  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-latest",
    max_tokens: 4096,
    system: "You are an expert at analyzing book structures. You will be provided with the text extracted from a PDF. Identify the chapters and return a JSON array of objects with 'title' and 'startPage' (1-indexed). Focus on the main structure of the book. Return ONLY the JSON object with a 'chapters' key.",
    messages: [
      {
        role: "user",
        content: text.slice(0, 100000)
      }
    ]
  });

  const content = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    // Attempt to extract JSON if Claude wraps it in markdown
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    const parsed = JSON.parse(jsonStr || '{"chapters": []}');
    return parsed.chapters || [];
  } catch (e) {
    console.error("Failed to parse chapters from Claude", e);
    return [];
  }
}

export async function generateDetailedTocClaude(text: string, apiKey: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  
  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-latest",
    max_tokens: 4096,
    system: "Generate a very detailed Table of Contents for this book text. This is for a 'pedagogical architecture' copy of the book. Include sub-chapters, key concepts, and page numbers. Format it as a clean text list.",
    messages: [
      {
        role: "user",
        content: text.slice(0, 100000)
      }
    ]
  });

  return response.content[0].type === 'text' ? response.content[0].text : "No TOC generated.";
}

export async function extractTextForOcrClaude(text: string, apiKey: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  
  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-latest",
    max_tokens: 4096,
    system: "The following text was extracted from a PDF. Clean it up, fix any OCR errors, and return the full text content in order.",
    messages: [
      {
        role: "user",
        content: text.slice(0, 100000)
      }
    ]
  });

  return response.content[0].type === 'text' ? response.content[0].text : "";
}
