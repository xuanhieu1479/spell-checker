const OPENROUTER_API = "https://openrouter.ai/api/v1";

export async function callAI(text, misspelledWord, settings) {
    const { apiKey, modelName, customPrompt } = settings;

    if (!apiKey) {
        throw new Error("API key must be configured");
    }

    const contextWords = extractContext(text, misspelledWord, 3);
    const promptText = customPrompt
        ? `${customPrompt}\n\n${contextWords}`
        : `A word is misspelled in this fragment. What is the correct word? Only reply with the corrected word, nothing else.\n\nFragment: "${contextWords}"\nMisspelled word: "${misspelledWord}"`;

    const response = await fetch(`${OPENROUTER_API}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: modelName,
            max_tokens: 50,
            messages: [{ role: "user", content: promptText }],
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
