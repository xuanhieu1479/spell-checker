import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { initDictionary, checkText } from "./spellcheck.js";
import { checkWordWithAI } from "./ai-fallback.js";
import { applySingleCorrection } from "./postprocess.js";

const extensionName = "spell-checker";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const OPENROUTER_API = "https://openrouter.ai/api/v1";

const defaultSettings = {
    modifier: "ctrl",
    key: " ",
    apiKey: "",
    modelName: "google/gemini-2.0-flash-lite-001",
    customPrompt: "",
    customDictionary: [],
};

let currentResults = [];
let isChecking = false;
let cachedModels = null;

async function fetchModels() {
    if (cachedModels) return cachedModels;

    const response = await fetch(`${OPENROUTER_API}/models`);
    if (!response.ok) throw new Error(`Failed to fetch models: ${response.status}`);

    const data = await response.json();
    const models = data.data || [];

    const grouped = {};
    for (const model of models) {
        const [provider] = model.id.split("/");
        if (!grouped[provider]) grouped[provider] = [];
        grouped[provider].push({
            id: model.id,
            name: model.name || model.id,
        });
    }

    for (const provider of Object.keys(grouped)) {
        grouped[provider].sort((a, b) => a.name.localeCompare(b.name));
    }

    cachedModels = grouped;
    return grouped;
}

function populateModelDropdown(grouped, selectedModel) {
    const $select = $("#spellcheck_model_name");
    $select.empty();

    const providers = Object.keys(grouped).sort();
    for (const provider of providers) {
        const $optgroup = $(`<optgroup label="${provider}"></optgroup>`);
        for (const model of grouped[provider]) {
            const selected = model.id === selectedModel ? "selected" : "";
            $optgroup.append(`<option value="${model.id}" ${selected}>${model.name}</option>`);
        }
        $select.append($optgroup);
    }
}

function settings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    for (const [k, v] of Object.entries(defaultSettings)) {
        if (extension_settings[extensionName][k] === undefined) {
            extension_settings[extensionName][k] = structuredClone(v);
        }
    }
    return extension_settings[extensionName];
}

function getCustomDictionary() {
    const s = settings();
    if (Array.isArray(s.customDictionary)) return s.customDictionary;
    if (typeof s.customDictionary === "string") {
        return s.customDictionary.split("\n").map(w => w.trim()).filter(Boolean);
    }
    return [];
}

function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function createOverlay($textarea) {
    let $overlay = $("#spellcheck_overlay");
    if ($overlay.length) $overlay.remove();

    $overlay = $('<div id="spellcheck_overlay" class="spellcheck-overlay"></div>');
    $textarea.parent().css("position", "relative");
    $textarea.after($overlay);
    return $overlay;
}

function syncOverlay($textarea, $overlay) {
    const styles = window.getComputedStyle($textarea[0]);
    $overlay.css({
        position: "absolute",
        top: $textarea.position().top + "px",
        left: $textarea.position().left + "px",
        width: $textarea.outerWidth() + "px",
        height: $textarea.outerHeight() + "px",
        padding: styles.padding,
        fontSize: styles.fontSize,
        fontFamily: styles.fontFamily,
        lineHeight: styles.lineHeight,
        letterSpacing: styles.letterSpacing,
        wordSpacing: styles.wordSpacing,
        textAlign: styles.textAlign,
        whiteSpace: "pre-wrap",
        wordWrap: "break-word",
        overflowWrap: "break-word",
        boxSizing: "border-box",
    });
    $overlay.scrollTop($textarea.scrollTop());
    $overlay.scrollLeft($textarea.scrollLeft());
}

function renderOverlay($textarea, $overlay, text, results) {
    if (results.length === 0) {
        $overlay.html("");
        return;
    }

    let html = "";
    let lastEnd = 0;

    const sorted = [...results].sort((a, b) => a.start - b.start);

    for (const r of sorted) {
        if (r.start > lastEnd) {
            html += escapeHtml(text.slice(lastEnd, r.start));
        }

        let className = "spellcheck-word spellcheck-error";
        if (r.ambiguous) className = "spellcheck-word spellcheck-ambiguous";
        else if (r.needsAI) className = "spellcheck-word spellcheck-ai-needed";

        const suggestions = (r.suggestions || []).slice(0, 5).join(",");
        const dataAttrs = `data-start="${r.start}" data-end="${r.end}" data-word="${escapeHtml(r.word)}" data-suggestions="${escapeHtml(suggestions)}" data-ambiguous="${r.ambiguous || false}" data-needs-ai="${r.needsAI || false}"`;

        html += `<span class="${className}" ${dataAttrs}>${escapeHtml(r.raw)}</span>`;
        lastEnd = r.end;
    }

    if (lastEnd < text.length) {
        html += escapeHtml(text.slice(lastEnd));
    }

    $overlay.html(html);
    syncOverlay($textarea, $overlay);
}

function showTooltip($word, x, y) {
    closeTooltip();

    const word = $word.data("word");
    const suggestionsStr = $word.data("suggestions") || "";
    const suggestions = suggestionsStr ? suggestionsStr.split(",") : [];
    const isAmbiguous = $word.data("ambiguous") === true || $word.data("ambiguous") === "true";
    const needsAI = $word.data("needs-ai") === true || $word.data("needs-ai") === "true";
    const start = parseInt($word.data("start"), 10);
    const end = parseInt($word.data("end"), 10);

    const $tooltip = $('<div class="spellcheck-tooltip"></div>');

    let headerText = `"${word}"`;
    let iconHtml = "";
    if (isAmbiguous) {
        iconHtml = '<span class="spellcheck-icon ambiguous">&#9878;</span>';
        headerText += " — pick one";
    } else if (needsAI) {
        iconHtml = '<span class="spellcheck-icon ai">&#10022;</span>';
        headerText += " — AI suggestion";
    }

    $tooltip.append(`<div class="spellcheck-tooltip-header">${iconHtml}<span>${headerText}</span></div>`);

    if (suggestions.length === 0 && !needsAI) {
        $tooltip.append('<div class="spellcheck-suggestion" style="color: #888; cursor: default;">(no suggestions)</div>');
    } else {
        for (let i = 0; i < suggestions.length; i++) {
            const sug = suggestions[i];
            const $item = $(`<div class="spellcheck-suggestion"><span class="suggestion-word">${escapeHtml(sug)}</span></div>`);
            $item.on("click", () => {
                applyCorrection(start, end, sug);
                closeTooltip();
            });
            $tooltip.append($item);
        }
    }

    if (needsAI && suggestions.length === 0) {
        const $aiBtn = $('<div class="spellcheck-tooltip-action">Ask AI for suggestion...</div>');
        $aiBtn.on("click", async () => {
            $aiBtn.html('Checking... <span class="spellcheck-loading"></span>');
            const $textarea = $("#send_textarea");
            const text = $textarea.val();
            const s = settings();
            const result = await checkWordWithAI(text, word, {
                apiEndpoint: s.apiEndpoint,
                apiKey: s.apiKey,
                modelName: s.modelName,
                customPrompt: s.customPrompt,
            });
            if (result.success && result.suggestion) {
                applyCorrection(start, end, result.suggestion);
                closeTooltip();
            } else {
                $aiBtn.text(result.error || "No suggestion found");
            }
        });
        $tooltip.append("<hr>").append($aiBtn);
    }

    $tooltip.append("<hr>");
    const $addDict = $('<div class="spellcheck-tooltip-action">Add to dictionary</div>');
    $addDict.on("click", () => {
        addToDictionary(word);
        closeTooltip();
        runSpellCheck();
    });
    $tooltip.append($addDict);

    $("body").append($tooltip);

    const tooltipWidth = $tooltip.outerWidth();
    const tooltipHeight = $tooltip.outerHeight();
    let left = x;
    let top = y + 10;

    if (left + tooltipWidth > window.innerWidth - 10) {
        left = window.innerWidth - tooltipWidth - 10;
    }
    if (top + tooltipHeight > window.innerHeight - 10) {
        top = y - tooltipHeight - 10;
    }

    $tooltip.css({ left: left + "px", top: top + "px" });

    setTimeout(() => {
        $(document).one("click", closeTooltip);
    }, 10);
}

function closeTooltip() {
    $(".spellcheck-tooltip").remove();
}

function applyCorrection(start, end, suggestion) {
    const $textarea = $("#send_textarea");
    const text = $textarea.val();
    const originalWord = text.slice(start, end);
    const corrected = applySingleCorrection(originalWord, suggestion);
    const newText = text.slice(0, start) + corrected + text.slice(end);
    $textarea.val(newText);

    const offset = corrected.length - (end - start);
    currentResults = currentResults
        .filter(r => r.start !== start)
        .map(r => {
            if (r.start > start) {
                return { ...r, start: r.start + offset, end: r.end + offset };
            }
            return r;
        });

    const $overlay = $("#spellcheck_overlay");
    if ($overlay.length) {
        renderOverlay($textarea, $overlay, newText, currentResults);
    }
    updateResultsPanel();
}

function addToDictionary(word) {
    const s = settings();
    const dict = getCustomDictionary();
    const lowerWord = word.toLowerCase();
    if (!dict.map(w => w.toLowerCase()).includes(lowerWord)) {
        dict.push(word);
        s.customDictionary = dict;
        saveSettingsDebounced();
        $("#spellcheck_custom_dict").val(dict.join("\n"));
        toastr.success(`Added "${word}" to dictionary`);
    }
}

function updateResultsPanel() {
    const $count = $("#spellcheck_results_count");
    const $list = $("#spellcheck_results_list");

    if (currentResults.length === 0) {
        $count.text("No issues found");
        $list.html('<div class="spellcheck-no-issues"><div class="fa-solid fa-check-circle"></div><div>All good!</div></div>');
        return;
    }

    const ambiguousCount = currentResults.filter(r => r.ambiguous).length;
    const aiCount = currentResults.filter(r => r.needsAI).length;
    const normalCount = currentResults.length - ambiguousCount - aiCount;

    let countText = `${currentResults.length} issue${currentResults.length !== 1 ? "s" : ""}`;
    if (ambiguousCount > 0) countText += ` (${ambiguousCount} ambiguous)`;

    $count.text(countText);
    $list.empty();

    for (const r of currentResults) {
        let badgeHtml = "";
        let wordClass = "spellcheck-result-word";
        if (r.ambiguous) {
            badgeHtml = '<span class="spellcheck-result-badge ambiguous">PICK</span>';
            wordClass += " ambiguous";
        } else if (r.needsAI) {
            badgeHtml = '<span class="spellcheck-result-badge ai">AI</span>';
            wordClass += " ai-needed";
        }

        const sugText = r.suggestions.length > 0
            ? `Suggestions: ${r.suggestions.slice(0, 3).join(", ")}`
            : "No local suggestions";

        const $item = $(`
            <div class="spellcheck-result-item" data-start="${r.start}">
                <div class="${wordClass}">${escapeHtml(r.word)}${badgeHtml}</div>
                <div class="spellcheck-result-suggestions">${sugText}</div>
            </div>
        `);

        $item.on("click", () => {
            const $word = $(`.spellcheck-word[data-start="${r.start}"]`);
            if ($word.length) {
                const rect = $word[0].getBoundingClientRect();
                showTooltip($word, rect.left, rect.bottom);
            }
        });

        $list.append($item);
    }
}

function showResultsPanel() {
    updateResultsPanel();
    $("#spellcheck_results_panel").show();
}

function hideResultsPanel() {
    $("#spellcheck_results_panel").hide();
}

function clearOverlay() {
    $("#spellcheck_overlay").remove();
    currentResults = [];
}

async function runSpellCheck() {
    if (isChecking) return;

    const $textarea = $("#send_textarea");
    const text = $textarea.val();

    if (!text.trim()) {
        clearOverlay();
        hideResultsPanel();
        toastr.info("Nothing to check");
        return;
    }

    isChecking = true;
    $("#spellcheck_status").html('Checking... <span class="spellcheck-loading"></span>');

    try {
        initDictionary();
        const customDict = getCustomDictionary();
        const results = checkText(text, customDict);

        currentResults = results;

        const $overlay = createOverlay($textarea);
        renderOverlay($textarea, $overlay, text, results);

        $textarea.on("scroll.spellcheck", () => syncOverlay($textarea, $overlay));
        $textarea.on("input.spellcheck", () => {
            clearOverlay();
            hideResultsPanel();
            $textarea.off(".spellcheck");
        });

        if (results.length === 0) {
            toastr.success("No spelling issues found!");
            hideResultsPanel();
        } else {
            const ambiguous = results.filter(r => r.ambiguous).length;
            const needsAI = results.filter(r => r.needsAI).length;
            let msg = `Found ${results.length} issue${results.length !== 1 ? "s" : ""}`;
            if (ambiguous > 0) msg += ` (${ambiguous} need your choice)`;
            if (needsAI > 0) msg += ` (${needsAI} need AI)`;
            toastr.warning(msg);
            showResultsPanel();
        }

        $("#spellcheck_status").text(`Found ${results.length} issue(s)`);
    } catch (error) {
        console.error("[Spell Checker] Error:", error);
        toastr.error("Spell check failed: " + error.message);
        $("#spellcheck_status").text("Error: " + error.message);
    } finally {
        isChecking = false;
    }
}

function fixAll() {
    const fixable = currentResults.filter(r => !r.ambiguous && !r.needsAI && r.suggestions.length > 0);
    if (fixable.length === 0) {
        toastr.info("Nothing to auto-fix. Ambiguous words and AI-needed words must be fixed manually.");
        return;
    }

    const sorted = [...fixable].sort((a, b) => b.start - a.start);

    const $textarea = $("#send_textarea");
    let text = $textarea.val();

    for (const r of sorted) {
        const originalWord = text.slice(r.start, r.end);
        const corrected = applySingleCorrection(originalWord, r.suggestions[0]);
        text = text.slice(0, r.start) + corrected + text.slice(r.end);
    }

    $textarea.val(text);

    currentResults = currentResults.filter(r => r.ambiguous || r.needsAI || r.suggestions.length === 0);

    const $overlay = $("#spellcheck_overlay");
    if ($overlay.length) {
        if (currentResults.length > 0) {
            const newResults = checkText(text, getCustomDictionary());
            currentResults = newResults;
            renderOverlay($textarea, $overlay, text, currentResults);
        } else {
            clearOverlay();
        }
    }

    updateResultsPanel();
    toastr.success(`Fixed ${sorted.length} word${sorted.length !== 1 ? "s" : ""}`);

    if (currentResults.length === 0) {
        hideResultsPanel();
    }
}

function handleKeydown(e) {
    const s = settings();
    const modifier = s.modifier || "ctrl";
    const key = (s.key || "Space").toLowerCase();

    let modifierPressed = false;
    switch (modifier) {
        case "ctrl": modifierPressed = e.ctrlKey; break;
        case "alt": modifierPressed = e.altKey; break;
        case "shift": modifierPressed = e.shiftKey; break;
    }

    const pressedKey = e.key.toLowerCase() === " " ? "space" : e.key.toLowerCase();

    if (modifierPressed && pressedKey === key) {
        e.preventDefault();
        e.stopPropagation();
        runSpellCheck();
    }
}

jQuery(async () => {
    const html = await $.get(`${extensionFolderPath}/settings.html`);
    $("#extensions_settings").append(html);
    $("#spellcheck_results_panel").detach().appendTo("body");

    const s = settings();
    $("#spellcheck_modifier").val(s.modifier);
    $("#spellcheck_key").val(s.key);
    $("#spellcheck_api_key").val(s.apiKey);
    $("#spellcheck_custom_prompt").val(s.customPrompt);
    $("#spellcheck_custom_dict").val(
        Array.isArray(s.customDictionary) ? s.customDictionary.join("\n") : s.customDictionary
    );

    async function loadModels() {
        const $btn = $("#spellcheck_refresh_models");
        const $select = $("#spellcheck_model_name");
        $btn.prop("disabled", true).find("i").addClass("fa-spin");

        try {
            const grouped = await fetchModels();
            populateModelDropdown(grouped, settings().modelName);
        } catch (error) {
            console.error("[Spell Checker] Failed to fetch models:", error);
            $select.html('<option value="">Failed to load models</option>');
        } finally {
            $btn.prop("disabled", false).find("i").removeClass("fa-spin");
        }
    }

    loadModels();

    $("#spellcheck_modifier").on("change", () => {
        settings().modifier = $("#spellcheck_modifier").val();
        saveSettingsDebounced();
    });

    $("#spellcheck_key").on("change", () => {
        settings().key = $("#spellcheck_key").val();
        saveSettingsDebounced();
    });

    $("#spellcheck_api_key").on("input", () => {
        settings().apiKey = $("#spellcheck_api_key").val();
        saveSettingsDebounced();
    });

    $("#spellcheck_model_name").on("change", () => {
        settings().modelName = $("#spellcheck_model_name").val();
        saveSettingsDebounced();
    });

    $("#spellcheck_refresh_models").on("click", () => {
        cachedModels = null;
        loadModels();
    });

    $("#spellcheck_custom_prompt").on("input", () => {
        settings().customPrompt = $("#spellcheck_custom_prompt").val();
        saveSettingsDebounced();
    });

    $("#spellcheck_custom_dict").on("input", () => {
        const lines = $("#spellcheck_custom_dict").val().split("\n").map(w => w.trim()).filter(Boolean);
        settings().customDictionary = lines;
        saveSettingsDebounced();
    });

    $("#spellcheck_fix_all").on("click", fixAll);
    $("#spellcheck_close_panel").on("click", hideResultsPanel);

    $(document).on("click", ".spellcheck-word", function(e) {
        e.stopPropagation();
        const $word = $(this);
        showTooltip($word, e.pageX, e.pageY);
    });

    $("#send_textarea").on("keydown", handleKeydown);

    try {
        initDictionary();
        $("#spellcheck_status").text("Ready. Dictionary loaded.");
    } catch (error) {
        console.error("[Spell Checker] Failed to load dictionary:", error);
        $("#spellcheck_status").text("Error loading dictionary");
    }
});
