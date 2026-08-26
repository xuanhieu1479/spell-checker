import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";
import { registerSlashCommand } from "../../../slash-commands.js";

const extensionName = "spell-checker";
const extensionFolderPath = `scripts/extensions/third_party/${extensionName}`;

const defaultSettings = {
    enabled: true,
    checkOnInput: true,
    highlightColor: "#ff6b6b",
    underlineStyle: "wavy",
    customDictionary: [],
    ignoredPatterns: [
        "\\{\\{[^}]+\\}\\}",
        "\\[\\[[^\\]]+\\]\\]",
        "<[^>]+>",
    ],
    minWordLength: 2,
    checkUserInput: true,
    checkAIResponses: false,
};

let spellCheckDebounce = null;
let lastCheckedText = "";
let currentSuggestions = new Map();

function settings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    for (const [k, v] of Object.entries(defaultSettings)) {
        if (extension_settings[extensionName][k] === undefined) {
            extension_settings[extensionName][k] = structuredClone(v);
        }
    }
    return extension_settings[extensionName];
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shouldIgnoreWord(word) {
    const s = settings();
    if (word.length < s.minWordLength) return true;
    if (/^\d+$/.test(word)) return true;
    if (s.customDictionary.includes(word.toLowerCase())) return true;

    for (const pattern of s.ignoredPatterns) {
        try {
            if (new RegExp(pattern, "i").test(word)) return true;
        } catch {}
    }
    return false;
}

function stripIgnoredPatterns(text) {
    const s = settings();
    let result = text;
    for (const pattern of s.ignoredPatterns) {
        try {
            result = result.replace(new RegExp(pattern, "gi"), " ");
        } catch {}
    }
    return result;
}

function extractWords(text) {
    const cleaned = stripIgnoredPatterns(text);
    const words = cleaned.match(/[a-zA-Z']+/g) || [];
    return words.filter(w => !shouldIgnoreWord(w));
}

async function checkSpelling(word) {
    if (typeof window.spellCheckAPI === "function") {
        return await window.spellCheckAPI(word);
    }

    if ("queryLocalDictionary" in navigator) {
        try {
            return await navigator.queryLocalDictionary(word);
        } catch {}
    }

    return { correct: true, suggestions: [] };
}

async function checkText(text) {
    const words = extractWords(text);
    const results = [];
    const uniqueWords = [...new Set(words.map(w => w.toLowerCase()))];

    for (const word of uniqueWords) {
        const result = await checkSpelling(word);
        if (!result.correct) {
            results.push({
                word,
                suggestions: result.suggestions || [],
            });
        }
    }
    return results;
}

function highlightMisspellings($textarea, misspellings) {
    const s = settings();
    if (!s.enabled || misspellings.length === 0) {
        clearHighlights();
        return;
    }

    let $overlay = $("#spellcheck_overlay");
    if (!$overlay.length) {
        $overlay = $('<div id="spellcheck_overlay" class="spellcheck-overlay"></div>');
        $textarea.parent().css("position", "relative").append($overlay);
    }

    const text = $textarea.val();
    let html = escapeHtml(text);

    for (const m of misspellings) {
        const pattern = new RegExp(`\\b(${escapeRegex(m.word)})\\b`, "gi");
        html = html.replace(pattern, `<span class="spellcheck-error" data-word="$1" data-suggestions="${m.suggestions.slice(0, 5).join(",")}">$1</span>`);
    }

    $overlay.html(html);
    syncOverlayPosition($textarea, $overlay);
}

function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function syncOverlayPosition($textarea, $overlay) {
    $overlay.css({
        width: $textarea.width() + "px",
        height: $textarea.height() + "px",
        top: $textarea.position().top + "px",
        left: $textarea.position().left + "px",
        padding: $textarea.css("padding"),
        fontSize: $textarea.css("font-size"),
        fontFamily: $textarea.css("font-family"),
        lineHeight: $textarea.css("line-height"),
        whiteSpace: "pre-wrap",
        wordWrap: "break-word",
        overflow: "hidden",
    });
    $overlay.scrollTop($textarea.scrollTop());
}

function clearHighlights() {
    $("#spellcheck_overlay").remove();
    currentSuggestions.clear();
}

function showSuggestionsPopup(word, suggestions, x, y) {
    closeSuggestionsPopup();

    if (!suggestions || suggestions.length === 0) {
        suggestions = ["(no suggestions)"];
    }

    const $popup = $('<div id="spellcheck_popup" class="spellcheck-popup"></div>');
    $popup.css({ left: x + "px", top: y + "px" });

    for (const suggestion of suggestions) {
        const $item = $(`<div class="spellcheck-suggestion">${suggestion}</div>`);
        if (suggestion !== "(no suggestions)") {
            $item.on("click", () => {
                replaceWord(word, suggestion);
                closeSuggestionsPopup();
            });
        }
        $popup.append($item);
    }

    const $addToDict = $('<div class="spellcheck-suggestion spellcheck-add">Add to dictionary</div>');
    $addToDict.on("click", () => {
        addToDictionary(word);
        closeSuggestionsPopup();
    });
    $popup.append($("<hr>")).append($addToDict);

    $("body").append($popup);

    $(document).one("click", closeSuggestionsPopup);
}

function closeSuggestionsPopup() {
    $("#spellcheck_popup").remove();
}

function replaceWord(oldWord, newWord) {
    const $textarea = $("#send_textarea");
    const text = $textarea.val();
    const pattern = new RegExp(`\\b${escapeRegex(oldWord)}\\b`, "gi");
    $textarea.val(text.replace(pattern, newWord));
    $textarea.trigger("input");
}

function addToDictionary(word) {
    const s = settings();
    const lower = word.toLowerCase();
    if (!s.customDictionary.includes(lower)) {
        s.customDictionary.push(lower);
        saveSettingsDebounced();
        toastr.success(`Added "${word}" to dictionary`);
        triggerSpellCheck();
    }
}

function removeFromDictionary(word) {
    const s = settings();
    const lower = word.toLowerCase();
    const idx = s.customDictionary.indexOf(lower);
    if (idx !== -1) {
        s.customDictionary.splice(idx, 1);
        saveSettingsDebounced();
        toastr.info(`Removed "${word}" from dictionary`);
    }
}

async function triggerSpellCheck() {
    const s = settings();
    if (!s.enabled || !s.checkOnInput) return;

    const $textarea = $("#send_textarea");
    const text = $textarea.val();

    if (text === lastCheckedText) return;
    lastCheckedText = text;

    if (!text.trim()) {
        clearHighlights();
        return;
    }

    const misspellings = await checkText(text);
    currentSuggestions.clear();
    for (const m of misspellings) {
        currentSuggestions.set(m.word.toLowerCase(), m.suggestions);
    }
    highlightMisspellings($textarea, misspellings);
}

async function spellCheckCommand(args, value) {
    const s = settings();
    s.enabled = !s.enabled;
    saveSettingsDebounced();
    $("#spellcheck_enabled").prop("checked", s.enabled);

    if (s.enabled) {
        toastr.success("Spell checker enabled");
        triggerSpellCheck();
    } else {
        toastr.info("Spell checker disabled");
        clearHighlights();
    }
    return "";
}

async function addWordCommand(args, value) {
    const word = (value || "").trim();
    if (!word) {
        toastr.warning("Usage: /addword <word>");
        return "";
    }
    addToDictionary(word);
    return "";
}

async function removeWordCommand(args, value) {
    const word = (value || "").trim();
    if (!word) {
        toastr.warning("Usage: /removeword <word>");
        return "";
    }
    removeFromDictionary(word);
    return "";
}

function renderDictionaryList() {
    const s = settings();
    const $list = $("#spellcheck_dictionary_list");
    $list.empty();

    if (s.customDictionary.length === 0) {
        $list.append('<div class="spellcheck-empty">No custom words added yet</div>');
        return;
    }

    const sorted = [...s.customDictionary].sort();
    for (const word of sorted) {
        const $item = $(`
            <div class="spellcheck-dict-item">
                <span class="spellcheck-dict-word">${word}</span>
                <span class="spellcheck-dict-remove fa-solid fa-xmark" title="Remove"></span>
            </div>
        `);
        $item.find(".spellcheck-dict-remove").on("click", () => {
            removeFromDictionary(word);
            renderDictionaryList();
        });
        $list.append($item);
    }
}

function openDictionaryModal() {
    renderDictionaryList();
    $("#spellcheck_dictionary_modal").show();
}

function closeDictionaryModal() {
    $("#spellcheck_dictionary_modal").hide();
}

jQuery(async () => {
    registerSlashCommand("spellcheck", spellCheckCommand, [], "Toggle spell checker on/off");
    registerSlashCommand("addword", addWordCommand, [], "Add a word to the custom dictionary. Usage: /addword <word>");
    registerSlashCommand("removeword", removeWordCommand, [], "Remove a word from the custom dictionary. Usage: /removeword <word>");

    const html = await $.get(`${extensionFolderPath}/settings.html`);
    $("#extensions_settings").append(html);

    $("#spellcheck_dictionary_modal").detach().appendTo("body");

    const s = settings();
    $("#spellcheck_enabled").prop("checked", s.enabled);
    $("#spellcheck_check_on_input").prop("checked", s.checkOnInput);
    $("#spellcheck_highlight_color").val(s.highlightColor);
    $("#spellcheck_underline_style").val(s.underlineStyle);
    $("#spellcheck_min_word_length").val(s.minWordLength);
    $("#spellcheck_ignored_patterns").val(s.ignoredPatterns.join("\n"));

    $("#spellcheck_enabled").on("change", () => {
        settings().enabled = $("#spellcheck_enabled").prop("checked");
        saveSettingsDebounced();
        if (settings().enabled) triggerSpellCheck();
        else clearHighlights();
    });

    $("#spellcheck_check_on_input").on("change", () => {
        settings().checkOnInput = $("#spellcheck_check_on_input").prop("checked");
        saveSettingsDebounced();
    });

    $("#spellcheck_highlight_color").on("input", () => {
        settings().highlightColor = $("#spellcheck_highlight_color").val();
        saveSettingsDebounced();
        updateHighlightStyle();
    });

    $("#spellcheck_underline_style").on("change", () => {
        settings().underlineStyle = $("#spellcheck_underline_style").val();
        saveSettingsDebounced();
        updateHighlightStyle();
    });

    $("#spellcheck_min_word_length").on("input", () => {
        settings().minWordLength = parseInt($("#spellcheck_min_word_length").val(), 10) || 2;
        saveSettingsDebounced();
    });

    $("#spellcheck_ignored_patterns").on("input", () => {
        const patterns = $("#spellcheck_ignored_patterns").val()
            .split("\n")
            .map(p => p.trim())
            .filter(Boolean);
        settings().ignoredPatterns = patterns;
        saveSettingsDebounced();
    });

    $("#spellcheck_open_dictionary").on("click", openDictionaryModal);
    $("#spellcheck_dictionary_close").on("click", closeDictionaryModal);
    $("#spellcheck_dictionary_cancel").on("click", closeDictionaryModal);

    $("#spellcheck_add_word_btn").on("click", () => {
        const word = $("#spellcheck_add_word_input").val().trim();
        if (word) {
            addToDictionary(word);
            $("#spellcheck_add_word_input").val("");
            renderDictionaryList();
        }
    });

    $("#spellcheck_add_word_input").on("keypress", (e) => {
        if (e.key === "Enter") {
            $("#spellcheck_add_word_btn").click();
        }
    });

    updateHighlightStyle();

    $("#send_textarea").on("input", () => {
        clearTimeout(spellCheckDebounce);
        spellCheckDebounce = setTimeout(triggerSpellCheck, 300);
    });

    $(document).on("click", ".spellcheck-error", function (e) {
        e.stopPropagation();
        const word = $(this).data("word");
        const suggestionsStr = $(this).data("suggestions") || "";
        const suggestions = suggestionsStr ? suggestionsStr.split(",") : [];
        showSuggestionsPopup(word, suggestions, e.pageX, e.pageY);
    });

    try {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            clearHighlights();
            lastCheckedText = "";
        });
    } catch {}
});

function updateHighlightStyle() {
    const s = settings();
    let $style = $("#spellcheck_dynamic_style");
    if (!$style.length) {
        $style = $('<style id="spellcheck_dynamic_style"></style>');
        $("head").append($style);
    }
    $style.text(`
        .spellcheck-error {
            text-decoration: underline;
            text-decoration-style: ${s.underlineStyle};
            text-decoration-color: ${s.highlightColor};
            cursor: pointer;
        }
    `);
}
