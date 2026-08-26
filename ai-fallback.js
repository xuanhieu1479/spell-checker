export async function callAI(text, misspelledWord, settings) {
    const { apiEndpoint, apiKey, modelName, apiFormat, customPrompt } = settings;

    if (!apiEndpoint || !apiKey) {
        throw new Error("API endpoint and key must be configured");
    }

    const contextWords = extractContext(text, misspelledWord, 3);
    const promptText = customPrompt
        ? `${customPrompt}\n\n${contextWords}`
        : `A word is misspelled in this fragment. What is the correct word? Only reply with the corrected word, nothing else.\n\nFragment: "${contextWords}"\nMisspelled word: "${misspelledWord}"`;

    const payload = buildPayload(promptText, modelName, apiFormat);
    const headers = buildHeaders(apiKey, apiFormat);
    const url = buildUrl(apiEndpoint, apiFormat, modelName);

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return parseResponse(data, apiFormat);
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

function buildPayload(promptText, modelName, apiFormat) {
    switch (apiFormat) {
        case "google":
            return {
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: { maxOutputTokens: 50 },
            };

        case "anthropic":
            return {
                model: modelName,
                max_tokens: 50,
                messages: [{ role: "user", content: promptText }],
            };

        case "openai":
        default:
            return {
                model: modelName,
                max_tokens: 50,
                messages: [{ role: "user", content: promptText }],
            };
    }
}

function buildHeaders(apiKey, apiFormat) {
    const headers = { "Content-Type": "application/json" };

    switch (apiFormat) {
        case "google":
            break;
        case "anthropic":
            headers["x-api-key"] = apiKey;
            headers["anthropic-version"] = "2024-01-01";
            break;
        case "openai":
        default:
            headers["Authorization"] = `Bearer ${apiKey}`;
            break;
    }

    return headers;
}

function buildUrl(apiEndpoint, apiFormat, modelName) {
    let url = apiEndpoint.replace(/\/$/, "");

    switch (apiFormat) {
        case "google":
            if (!url.includes("generateContent")) {
                url = `${url}/models/${modelName}:generateContent`;
            }
            if (!url.includes("key=")) {
                url += url.includes("?") ? "&" : "?";
            }
            break;
        case "anthropic":
            if (!url.endsWith("/messages")) {
                url = `${url}/messages`;
            }
            break;
        case "openai":
        default:
            if (!url.endsWith("/chat/completions")) {
                url = `${url}/chat/completions`;
            }
            break;
    }

    return url;
}

function parseResponse(data, apiFormat) {
    try {
        switch (apiFormat) {
            case "google":
                return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

            case "anthropic":
                return data.content?.[0]?.text?.trim() || "";

            case "openai":
            default:
                return data.choices?.[0]?.message?.content?.trim() || "";
        }
    } catch {
        return "";
    }
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
