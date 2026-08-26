const OPENROUTER_API = "https://openrouter.ai/api/v1";

const DEFAULT_SYSTEM_PROMPT = `You are a spell checker. A word is misspelled in the text fragment provided. Reply with ONLY the corrected word, nothing else. No punctuation, no explanation.`;

export async function callAI(text, misspelledWord, settings) {
    const { apiKey, modelName, customPrompt } = settings;

    if (!apiKey) {
        throw new Error("API key must be configured");
    }

    const contextWords = extractContext(text, misspelledWord, 3);
    const systemPrompt = customPrompt || DEFAULT_SYSTEM_PROMPT;
    const userMessage = `Fragment: "${contextWords}"\nMisspelled word: "${misspelledWord}"`;

    const isAnthropic = modelName.startsWith("anthropic/");

    const messages = [
        {
            role: "system",
            content: isAnthropic
                ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
                : systemPrompt,
        },
        { role: "user", content: userMessage },
    ];

    const response = await fetch(`${OPENROUTER_API}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: modelName,
            max_tokens: 50,
            messages,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
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
