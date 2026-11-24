// AI providers. Both speak the OpenAI chat completions format, so they share one
// request path; each keeps its own API key and model in settings so switching
// providers doesn't lose either.
export const PROVIDERS = {
    openrouter: {
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        modelsPath: "/models",
        keyUrl: "https://openrouter.ai/keys",
        keyPlaceholder: "sk-or-...",
        // Existing installs stored the OpenRouter key/model under these names
        keySetting: "apiKey",
        modelSetting: "modelName",
        defaultModel: "google/gemini-2.0-flash-lite-001",
    },
    nanogpt: {
        label: "NanoGPT",
        baseUrl: "https://api.nano-gpt.com/api/v1",
        // detailed=true adds display names and flags paused models as unavailable
        modelsPath: "/models?detailed=true",
        keyUrl: "https://nano-gpt.com/api",
        keyPlaceholder: "sk-nano-...",
        keySetting: "nanogptApiKey",
        modelSetting: "nanogptModelName",
        defaultModel: "google/gemini-3.1-flash-lite",
    },
};

export const DEFAULT_PROVIDER = "openrouter";

export function getProvider(id) {
    return PROVIDERS[id] || PROVIDERS[DEFAULT_PROVIDER];
}

// The active provider plus its key and model, read from extension settings
export function getActiveConfig(settings) {
    const provider = getProvider(settings.provider);
    return {
        provider,
        apiKey: (settings[provider.keySetting] || "").trim(),
        modelName: settings[provider.modelSetting] || provider.defaultModel,
    };
}

// Pull a readable message out of an error body. Providers nest it differently:
// {"error":{"message":...}}, {"message":...} or {"error":"..."}.
function errorMessageFrom(body, status) {
    let data;
    try {
        data = JSON.parse(body);
    } catch {
        return body?.trim() ? `API error ${status}: ${body.trim().slice(0, 200)}` : `API error ${status}`;
    }
    const message =
        (typeof data?.error === "object" && data.error?.message) ||
        (typeof data?.error === "string" && data.error) ||
        data?.message;
    return message ? `${message} (${status})` : `API error ${status}`;
}

export async function chatCompletion({ settings, messages, maxTokens, signal }) {
    const { provider, apiKey, modelName } = getActiveConfig(settings);
    if (!apiKey) {
        throw new Error(`Please configure a ${provider.label} API key in the Spell Checker settings.`);
    }

    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: modelName,
            messages,
            max_tokens: maxTokens,
        }),
        signal,
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`${provider.label}: ${errorMessageFrom(body, response.status)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
}

export async function fetchProviderModels(providerId) {
    const provider = getProvider(providerId);
    const response = await fetch(`${provider.baseUrl}${provider.modelsPath}`);
    if (!response.ok) throw new Error(`Failed to fetch ${provider.label} models: ${response.status}`);

    const data = await response.json();
    return (data.data || []).filter(m => m.available !== false);
}
