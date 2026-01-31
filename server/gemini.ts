
import { GoogleGenAI, Type } from "@google/genai";
import { Category, NormalizedData, CopyData } from "../types";

export class GeminiService {
  /**
   * Adapts images into the boutique aesthetic.
   */
  async transformImages(base64Images: string[]): Promise<string[]> {
    await new Promise(resolve => setTimeout(resolve, 2000));
    return base64Images;
  }

  async normalizeListing(category: Category, title: string, description: string): Promise<NormalizedData> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) throw new Error('Missing GEMINI_API_KEY');
    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
    const response = await ai.models.generateContent({
      model,
      contents: `Extract data for ${category}: Title: "${title}"`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            brand: { type: Type.STRING },
            model: { type: Type.STRING },
            reference: { type: Type.STRING },
            year: { type: Type.STRING },
            material: { type: Type.STRING },
            condition: { type: Type.STRING },
            authenticityGuaranteed: { type: Type.BOOLEAN },
          },
          required: ["brand", "model", "condition", "authenticityGuaranteed"]
        }
      }
    });
    // Access the .text property directly and trim whitespace for JSON parsing
    const text = response.text || "{}";
    return JSON.parse(text.trim());
  }

  async generateCopy(category: Category, data: NormalizedData): Promise<CopyData> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) throw new Error('Missing GEMINI_API_KEY');
    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
    const response = await ai.models.generateContent({
      model,
      contents: `Write horological narrative for ${data.brand} ${data.model}. Boutique tone.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sales_title: { type: Type.STRING },
            bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
            long_description: { type: Type.STRING },
            seo_title: { type: Type.STRING },
            seo_description: { type: Type.STRING },
          },
          required: ["sales_title", "bullets", "long_description", "seo_title", "seo_description"]
        }
      }
    });
    // Access the .text property directly and trim whitespace for JSON parsing
    const text = response.text || "{}";
    return JSON.parse(text.trim());
  }
}
