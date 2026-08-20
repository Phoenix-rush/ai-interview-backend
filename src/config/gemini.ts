let GoogleGenAI: any = null;

export const geminiModel = {
  generateContent: async (prompt: string) => {
    if (!GoogleGenAI) {
      const genai = await import('@google/genai');
      GoogleGenAI = genai.GoogleGenAI;
    }
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is missing from environment variables!');
    }
    
    const genAI = new GoogleGenAI({ apiKey });

    const response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    
    return {
      response: {
        text: () => response.text || ''
      }
    };
  }
};