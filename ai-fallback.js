import { PROVIDERS, chatCompletion, getActiveConfig } from "./providers.js";

const DEFAULT_SYSTEM_PROMPT = `You are a spell checker. A word is misspelled in the text fragment provided. Reply with ONLY the corrected word, nothing else. No punctuation, no explanation.`;

// settings: the extension settings object (provider, keys, models, customPrompt)
export async function callAI(text, misspelledWord, settings) {
    const { provider, modelName } = getActiveConfig(settings);

    const contextWords = extractContext(text, misspelledWord, 3);
    const systemPrompt = settings.customPrompt || DEFAULT_SYSTEM_PROMPT;
    const userMessage = `Fragment: "${contextWords}"\nMisspelled word: "${misspelledWord}"`;

    // OpenRouter passes cache_control through to Anthropic; other providers get plain text
    const useCacheControl = provider === PROVIDERS.openrouter && modelName.startsWith("anthropic/");

    const messages = [
        {
            role: "system",
            content: useCacheControl
                ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
                : systemPrompt,
        },
        { role: "user", content: userMessage },
    ];

    return chatCompletion({ settings, messages, maxTokens: 50 });
}

function extractContext(text, misspelledWord, windowSize) {
    const words = text.split(/\s+/);
    const wordIndex = words.findIndex(w =>
        w.toLowerCase().includes(misspelledWord.toLowerCase())
    );

    if (wordIndex === -1) return misspelledWord;

    const start = Math.max(0, wordIndex - windowSize);
    const end = Math.min(words.length, wordIndex + windowSize + 1);
    return words.slice(start, end).join(" ");
}

export async function checkWordWithAI(text, misspelledWord, settings) {
    try {
        const corrected = await callAI(text, misspelledWord, settings);
        if (!corrected || corrected === misspelledWord) {
            return { success: false };
        }
        const cleanCorrected = corrected.replace(/[^\w'-]/g, "").trim();
        if (!cleanCorrected) return { success: false };
        return { success: true, suggestion: cleanCorrected };
    } catch (error) {
        console.error("[Spell Checker] AI fallback error:", error);
        return { success: false, error: error.message };
    }
}
