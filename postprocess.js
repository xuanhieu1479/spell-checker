export function postProcessCorrection(original, corrected) {
    const originalWords = tokenize(original);
    const correctedWords = tokenize(corrected);

    if (correctedWords.length !== originalWords.length) {
        return original;
    }

    const result = [];

    for (let i = 0; i < originalWords.length; i++) {
        const origToken = originalWords[i];
        const corrToken = correctedWords[i];

        const processed = processWord(origToken, corrToken);
        result.push(processed);
    }

    return result.join("");
}

function tokenize(text) {
    const tokens = [];
    const regex = /(\s+)|([^\s]+)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        tokens.push(match[0]);
    }
    return tokens;
}

function processWord(original, corrected) {
    if (/^\s+$/.test(original)) {
        return original;
    }

    const origAlpha = extractAlpha(original);
    const corrAlpha = extractAlpha(corrected);

    if (!origAlpha || !corrAlpha) {
        return original;
    }

    let finalAlpha = corrAlpha;

    if (!original.includes("'") && corrected.includes("'")) {
        finalAlpha = corrAlpha.replace(/'/g, "");
    }

    if (original.includes("'") && !corrected.includes("'")) {
        const origAposIndex = origAlpha.indexOf("'");
        if (origAposIndex > 0 && origAposIndex < finalAlpha.length) {
            finalAlpha = finalAlpha.slice(0, origAposIndex) + "'" + finalAlpha.slice(origAposIndex);
        }
    }

    finalAlpha = matchCase(origAlpha, finalAlpha);

    const { prefix, suffix } = extractPunctuation(original);
    return prefix + finalAlpha + suffix;
}

function extractAlpha(word) {
    const match = word.match(/[a-zA-Z']+/);
    return match ? match[0] : "";
}

function extractPunctuation(word) {
    const prefixMatch = word.match(/^([^a-zA-Z']*)/);
    const suffixMatch = word.match(/([^a-zA-Z']*)$/);
    return {
        prefix: prefixMatch ? prefixMatch[1] : "",
        suffix: suffixMatch ? suffixMatch[1] : "",
    };
}

function matchCase(original, corrected) {
    if (!original || !corrected) return corrected;

    const origAlphaOnly = original.replace(/'/g, "");
    const corrAlphaOnly = corrected.replace(/'/g, "");

    if (origAlphaOnly === origAlphaOnly.toUpperCase() && origAlphaOnly.length > 1) {
        return corrected.toUpperCase();
    }

    if (origAlphaOnly === origAlphaOnly.toLowerCase()) {
        return corrected.toLowerCase();
    }

    if (
        origAlphaOnly.length > 0 &&
        origAlphaOnly[0] === origAlphaOnly[0].toUpperCase() &&
        origAlphaOnly.slice(1) === origAlphaOnly.slice(1).toLowerCase()
    ) {
        return corrected.charAt(0).toUpperCase() + corrected.slice(1).toLowerCase();
    }

    return corrected;
}

export function applySingleCorrection(originalWord, suggestion) {
    const { prefix, suffix } = extractPunctuation(originalWord);
    const origAlpha = extractAlpha(originalWord);

    let finalSuggestion = suggestion;

    if (!originalWord.includes("'") && suggestion.includes("'")) {
        finalSuggestion = suggestion.replace(/'/g, "");
    }

    finalSuggestion = matchCase(origAlpha, finalSuggestion);

    return prefix + finalSuggestion + suffix;
}
