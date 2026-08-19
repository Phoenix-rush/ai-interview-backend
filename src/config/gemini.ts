let GoogleGenAI: any = null;

export const geminiModel = {
  generateContent: async (prompt: string) => {
    if (!GoogleGenAI) {
      const genai = await import('@google/genai');
      GoogleGenAI = genai.GoogleGenAI;
    }
    
    const apiKey = process.env.GEMINI_API_KEY || '';
    const genAI = new GoogleGenAI({ apiKey });

    const response = await genAI.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
    });
    
    return {
      response: {
        text: () => response.text || ''
      }
    };
  }
};