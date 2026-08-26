import { DICTIONARY_WORDS } from "./dictionary.js";

let wordSet = null;
let wordRankMap = null;

export function initDictionary() {
    if (wordSet) return;
    wordSet = new Set(DICTIONARY_WORDS.map(w => w.toLowerCase()));
    wordRankMap = new Map();
    DICTIONARY_WORDS.forEach((word, index) => {
        wordRankMap.set(word.toLowerCase(), index);
    });
}

export function isInDictionary(word) {
    if (!wordSet) initDictionary();
    return wordSet.has(word.toLowerCase());
}

export function getWordRank(word) {
    if (!wordRankMap) initDictionary();
    return wordRankMap.get(word.toLowerCase()) ?? Infinity;
}

export function damerauLevenshtein(a, b) {
    const lenA = a.length;
    const lenB = b.length;
    if (lenA === 0) return lenB;
    if (lenB === 0) return lenA;

    const d = Array.from({ length: lenA + 1 }, () => Array(lenB + 1).fill(0));

    for (let i = 0; i <= lenA; i++) d[i][0] = i;
    for (let j = 0; j <= lenB; j++) d[0][j] = j;

    for (let i = 1; i <= lenA; i++) {
        for (let j = 1; j <= lenB; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(
                d[i - 1][j] + 1,
                d[i][j - 1] + 1,
                d[i - 1][j - 1] + cost
            );
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
            }
        }
    }
    return d[lenA][lenB];
}

export function shouldSkipWord(word) {
    if (word.length <= 2) return true;
    if (/^\d+$/.test(word)) return true;
    if (/\d/.test(word)) return true;
    if (word === word.toUpperCase() && word.length > 1) return true;
    if (/^https?:\/\//.test(word)) return true;
    if (/^www\./.test(word)) return true;
    if (/\.(com|org|net|io|co|dev)$/i.test(word)) return true;
    return false;
}

export function findSuggestions(word, maxDistance = 2, maxResults = 5) {
    if (!wordSet) initDictionary();
    const lowerWord = word.toLowerCase();
    const candidates = [];

    for (const dictWord of DICTIONARY_WORDS) {
        if (Math.abs(dictWord.length - lowerWord.length) > maxDistance) continue;
        const dist = damerauLevenshtein(lowerWord, dictWord.toLowerCase());
        if (dist > 0 && dist <= maxDistance) {
            candidates.push({ word: dictWord, distance: dist, rank: getWordRank(dictWord) });
        }
        if (candidates.length > 500) break;
    }

    candidates.sort((a, b) => {
        if (a.distance !== b.distance) return a.distance - b.distance;
        return a.rank - b.rank;
    });

    return candidates.slice(0, maxResults);
}

export function checkWord(word, customDictionary = []) {
    const stripped = stripFormatting(word);
    if (!stripped) return { valid: true };
    if (shouldSkipWord(stripped)) return { valid: true };

    const lowerStripped = stripped.toLowerCase();
    if (customDictionary.map(w => w.toLowerCase()).includes(lowerStripped)) {
        return { valid: true };
    }

    if (isInDictionary(stripped)) return { valid: true };

    const suggestions = findSuggestions(stripped, 2, 10);
    if (suggestions.length === 0) {
        return { valid: false, word: stripped, suggestions: [], needsAI: true };
    }

    const minDist = suggestions[0].distance;
    const equalDistSuggestions = suggestions.filter(s => s.distance === minDist);

    if (equalDistSuggestions.length > 1) {
        return {
            valid: false,
            word: stripped,
            suggestions: equalDistSuggestions.map(s => s.word),
            ambiguous: true,
            needsAI: false,
        };
    }

    return {
        valid: false,
        word: stripped,
        suggestions: suggestions.map(s => s.word),
        ambiguous: false,
        needsAI: false,
    };
}

export function stripFormatting(word) {
    let result = word;
    result = result.replace(/^[*_~`]+/, "");
    result = result.replace(/[*_~`]+$/, "");
    result = result.replace(/^[^\w']+/, "");
    result = result.replace(/[^\w']+$/, "");
    return result;
}

export function extractWords(text) {
    const words = [];
    const regex = /([*_~`]*[\w']+[*_~`]*)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        words.push({
            raw: match[1],
            start: match.index,
            end: match.index + match[1].length,
        });
    }
    return words;
}

export function checkText(text, customDictionary = []) {
    const words = extractWords(text);
    const results = [];

    for (const { raw, start, end } of words) {
        const result = checkWord(raw, customDictionary);
        if (!result.valid) {
            results.push({
                ...result,
                raw,
                start,
                end,
            });
        }
    }

    return results;
}
