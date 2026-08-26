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
let allModels = [];
let fixAllAbortController = null;
let originalTextBeforeSpellCheck = null;
let shortcutDebounceTimer = null;
const DOUBLE_TAP_THRESHOLD = 400; // ms

function trimProviderPrefix(name, provider) {
    const prefixes = [
        `${provider}:`,
        `${provider.charAt(0).toUpperCase() + provider.slice(1)}:`,
        `${provider.toUpperCase()}:`,
    ];
    for (const prefix of prefixes) {
        if (name.startsWith(prefix)) {
            return name.slice(prefix.length).trim();
        }
    }
    return name;
}

async function fetchModels() {
    const response = await fetch(`${OPENROUTER_API}/models`);
    if (!response.ok) throw new Error(`Failed to fetch models: ${response.status}`);

    const data = await response.json();
    const models = data.data || [];

    allModels = models.map(m => {
        const provider = m.id.split("/")[0];
        const rawName = m.name || m.id;
        return {
            id: m.id,
            name: trimProviderPrefix(rawName, provider),
            provider,
        };
    }).sort((a, b) => a.name.localeCompare(b.name));

    return allModels;
}

function filterModels(query) {
    if (!query) return allModels;
    const q = query.toLowerCase();
    return allModels.filter(m =>
        m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    );
}

function populateModelDropdown(models, selectedModel) {
    const $select = $("#spellcheck_model_name");
    $select.empty();

    const grouped = {};
    for (const model of models) {
        if (!grouped[model.provider]) grouped[model.provider] = [];
        grouped[model.provider].push(model);
    }

    const providers = Object.keys(grouped).sort();
    for (const provider of providers) {
        const $optgroup = $(`<optgroup label="${provider}"></optgroup>`);
        for (const model of grouped[provider]) {
            const selected = model.id === selectedModel ? "selected" : "";
            $optgroup.append(`<option value="${model.id}" ${selected}>${model.name}</option>`);
        }
        $select.append($optgroup);
    }

    if (models.length === 0) {
        $select.append('<option value="">No models match</option>');
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

function highlightWordInTextarea(start, end) {
    const $textarea = $("#send_textarea");
    const textarea = $textarea[0];
    textarea.focus();
    textarea.setSelectionRange(start, end);
}

function showTooltipForResult(r, x, y) {
    closeTooltip();

    const word = r.word;
    const suggestions = r.suggestions || [];
    const isAmbiguous = r.ambiguous;
    const needsAI = r.needsAI;
    const start = r.start;
    const end = r.end;

    const $tooltip = $('<div class="spellcheck-tooltip"></div>');

    $tooltip.on("mouseenter", () => {
        highlightWordInTextarea(start, end);
    });

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

function showUndoTooltip(originalText) {
    $(".spellcheck-undo-tooltip").remove();

    const $textarea = $("#send_textarea");
    const rect = $textarea[0].getBoundingClientRect();

    const $undo = $('<div class="spellcheck-undo-tooltip"><span class="undo-text">Undo</span></div>');
    $("body").append($undo);

    $undo.css({
        position: "fixed",
        top: (rect.top - 50) + "px",
        right: "150px",
    });

    $undo.on("click", () => {
        $textarea.val(originalText);
        $undo.remove();
    });

    // Disappear after 10 seconds
    setTimeout(() => {
        $undo.fadeOut(300, () => $undo.remove());
    }, 10000);
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

    updateResultsPanel();

    if (currentResults.length === 0) {
        hideResultsPanel();
    }
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
        $count.text("");
        $list.html('<div class="spellcheck-no-issues"><div class="fa-solid fa-check-circle"></div><div>All good!</div></div>');
        return;
    }

    $count.text("");
    $list.empty();

    for (const r of currentResults) {
        let badgeHtml = "";
        let wordClass = "spellcheck-result-word";
        let itemClass = "spellcheck-result-item";

        if (r.ambiguous) {
            badgeHtml = '<span class="spellcheck-result-badge ambiguous">PICK</span>';
            wordClass += " ambiguous";
        } else if (r.needsAI) {
            badgeHtml = '<span class="spellcheck-result-badge ai">AI</span>';
            wordClass += " ai-needed";
            itemClass += " disabled";
        }

        const sugText = r.suggestions.length > 0
            ? `Suggestions: ${r.suggestions.slice(0, 3).join(", ")}`
            : "No local suggestions";

        const $item = $(`
            <div class="${itemClass}" data-start="${r.start}">
                <div class="${wordClass}">${escapeHtml(r.word)}${badgeHtml}</div>
                <div class="spellcheck-result-suggestions">${sugText}</div>
            </div>
        `);

        $item.on("mouseenter", () => {
            highlightWordInTextarea(r.start, r.end);
        });

        // Only ambiguous items are clickable
        if (r.ambiguous) {
            $item.on("click", (e) => {
                e.stopPropagation();
                showTooltipForResult(r, e.pageX, e.pageY);
            });
        }

        $list.append($item);
    }
}

function showResultsPanel() {
    updateResultsPanel();
    $("#spellcheck_results_panel").show();
}

function hideResultsPanel() {
    // Abort any ongoing Fix All request
    if (fixAllAbortController) {
        fixAllAbortController.abort();
        fixAllAbortController = null;
    }
    $("#spellcheck_results_panel").hide();

    // Show undo if text was changed during spell check session
    if (originalTextBeforeSpellCheck !== null) {
        const currentText = $("#send_textarea").val();
        if (currentText !== originalTextBeforeSpellCheck) {
            showUndoTooltip(originalTextBeforeSpellCheck);
        }
        originalTextBeforeSpellCheck = null;
    }
}

function clearResults() {
    currentResults = [];
}

async function runSpellCheck() {
    if (isChecking) return;

    // Remove any existing undo tooltip
    $(".spellcheck-undo-tooltip").remove();

    const $textarea = $("#send_textarea");
    const text = $textarea.val();

    if (!text.trim()) {
        clearResults();
        hideResultsPanel();
        return;
    }

    // Store original text for undo
    originalTextBeforeSpellCheck = text;

    isChecking = true;
    $("#spellcheck_status").html('Checking... <span class="spellcheck-loading"></span>');

    try {
        initDictionary();
        const customDict = getCustomDictionary();
        const results = checkText(text, customDict);

        // Auto-fix red cases (clear corrections) silently
        const autoFixable = results.filter(r => !r.ambiguous && !r.needsAI && r.suggestions.length > 0);
        const fixedCount = autoFixable.length;

        if (fixedCount > 0) {
            // Apply fixes from end to start to preserve positions
            const sorted = [...autoFixable].sort((a, b) => b.start - a.start);
            let newText = text;
            for (const r of sorted) {
                const original = newText.slice(r.start, r.end);
                const corrected = applySingleCorrection(original, r.suggestions[0]);
                newText = newText.slice(0, r.start) + corrected + newText.slice(r.end);
            }
            $textarea.val(newText);
        }

        // Always re-run check after auto-fixes to get correct positions
        const freshResults = checkText($textarea.val(), customDict);
        currentResults = freshResults.filter(r => r.ambiguous || r.needsAI);
        const remainingCount = currentResults.length;

        if (remainingCount > 0) {
            $textarea.on("input.spellcheck", () => {
                clearResults();
                hideResultsPanel();
                $textarea.off(".spellcheck");
            });

            showResultsPanel();
        } else {
            // No panel needed - if we auto-fixed, show undo
            if (fixedCount > 0) {
                showUndoTooltip(originalTextBeforeSpellCheck);
            }
            originalTextBeforeSpellCheck = null;
        }
        let statusMsg = "";
        if (fixedCount > 0) statusMsg += `Fixed ${fixedCount}`;
        if (remainingCount > 0) statusMsg += (statusMsg ? ", " : "") + `${remainingCount} need attention`;
        if (!statusMsg) statusMsg = "No issues found";
        $("#spellcheck_status").text(statusMsg);
    } catch (error) {
        console.error("[Spell Checker] Error:", error);
        toastr.error("Spell check failed: " + error.message);
        $("#spellcheck_status").text("Error: " + error.message);
    } finally {
        isChecking = false;
    }
}

async function fixAll(skipPanelCheck = false) {
    const $textarea = $("#send_textarea");
    const text = $textarea.val();

    if (!text.trim()) {
        return;
    }

    const s = settings();
    if (!s.apiKey) {
        toastr.error("Please configure an OpenRouter API key in the Spell Checker settings.");
        return;
    }

    const panelVisible = $("#spellcheck_results_panel").is(":visible");

    // Show spinner in panel header if panel is open
    if (panelVisible) {
        const $count = $("#spellcheck_results_count");
        $count.html('Fixing... <span class="spellcheck-loading"></span>');
        $("#spellcheck_fix_all").css("pointer-events", "none").css("opacity", "0.5");
    }

    // Create abort controller
    fixAllAbortController = new AbortController();

    const defaultPrompt = "You are a spell checker. Fix all spelling and grammar errors in the following text. Return ONLY the corrected text, nothing else. Preserve the original formatting, line breaks, and punctuation style.";
    const systemPrompt = s.customPrompt?.trim() || defaultPrompt;

    try {
        const response = await fetch(`${OPENROUTER_API}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${s.apiKey}`,
            },
            body: JSON.stringify({
                model: s.modelName || "google/gemini-2.0-flash-lite-001",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: text },
                ],
                max_tokens: 4096,
            }),
            signal: fixAllAbortController.signal,
        });

        // Check if panel was closed while waiting (only for panel-triggered calls)
        if (!skipPanelCheck && !$("#spellcheck_results_panel").is(":visible")) {
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `API error: ${response.status}`);
        }

        const data = await response.json();
        const correctedText = data.choices?.[0]?.message?.content?.trim();

        if (!correctedText) {
            throw new Error("No response from AI");
        }

        // Check again if panel was closed (only for panel-triggered calls)
        if (!skipPanelCheck && !$("#spellcheck_results_panel").is(":visible")) {
            return;
        }

        // Replace text and show undo
        $textarea.val(correctedText);
        clearResults();

        if (panelVisible) {
            hideResultsPanel();
        } else {
            // Direct call (double-tap) - show undo directly
            if (originalTextBeforeSpellCheck !== null && correctedText !== originalTextBeforeSpellCheck) {
                showUndoTooltip(originalTextBeforeSpellCheck);
            }
            originalTextBeforeSpellCheck = null;
        }
        $("#spellcheck_status").text("Fixed by AI");

    } catch (error) {
        if (error.name === "AbortError") {
            // Request was cancelled
            return;
        }
        console.error("[Spell Checker] Fix All error:", error);
        toastr.error("Fix All failed: " + error.message);
        if (panelVisible) {
            $("#spellcheck_results_count").text("");
        }
    } finally {
        fixAllAbortController = null;
        $("#spellcheck_fix_all").css("pointer-events", "").css("opacity", "");
    }
}

function handleKeydown(e) {
    const panelOpen = $("#spellcheck_results_panel").is(":visible");
    const s = settings();
    const modifier = s.modifier || "ctrl";
    const rawKey = s.key || " ";
    const key = rawKey === " " ? "space" : rawKey.toLowerCase();

    let modifierPressed = false;
    switch (modifier) {
        case "ctrl": modifierPressed = e.ctrlKey; break;
        case "alt": modifierPressed = e.altKey; break;
        case "shift": modifierPressed = e.shiftKey; break;
    }

    const pressedKey = e.key === " " ? "space" : e.key.toLowerCase();

    if (modifierPressed && pressedKey === key) {
        e.preventDefault();
        e.stopPropagation();

        if (panelOpen) {
            // Panel open: shortcut = Fix All
            fixAll();
        } else if (shortcutDebounceTimer) {
            // Second tap within threshold: double-tap detected
            clearTimeout(shortcutDebounceTimer);
            shortcutDebounceTimer = null;
            $(".spellcheck-undo-tooltip").remove();
            originalTextBeforeSpellCheck = $("#send_textarea").val();
            fixAll(true); // skip panel check
        } else {
            // First tap: wait to see if double-tap
            shortcutDebounceTimer = setTimeout(() => {
                shortcutDebounceTimer = null;
                runSpellCheck();
            }, DOUBLE_TAP_THRESHOLD);
        }
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
        const $search = $("#spellcheck_model_search");
        $btn.prop("disabled", true).find("i").addClass("fa-spin");

        try {
            await fetchModels();
            populateModelDropdown(allModels, settings().modelName);
            const selected = allModels.find(m => m.id === settings().modelName);
            if (selected) $search.val(selected.name);
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

    $("#spellcheck_model_search").on("input", function() {
        const query = $(this).val();
        const filtered = filterModels(query);
        populateModelDropdown(filtered, settings().modelName);
    });

    $("#spellcheck_model_name").on("change", function() {
        const modelId = $(this).val();
        settings().modelName = modelId;
        saveSettingsDebounced();
        const model = allModels.find(m => m.id === modelId);
        if (model) $("#spellcheck_model_search").val(model.name);
    });

    $("#spellcheck_refresh_models").on("click", () => {
        allModels = [];
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
    $("#spellcheck_close_panel").on("click", () => {
        clearResults();
        hideResultsPanel();
    });

    $("#send_textarea").on("keydown", handleKeydown);

    // Esc to close panel from anywhere
    $(document).on("keydown", (e) => {
        if (e.key === "Escape") {
            if ($("#spellcheck_results_panel").is(":visible")) {
                e.preventDefault();
                clearResults();
                hideResultsPanel();
            } else if ($(".spellcheck-undo-tooltip").length) {
                e.preventDefault();
                $(".spellcheck-undo-tooltip").remove();
            }
        }
    });

    try {
        initDictionary();
        $("#spellcheck_status").text("Ready. Dictionary loaded.");
    } catch (error) {
        console.error("[Spell Checker] Failed to load dictionary:", error);
        $("#spellcheck_status").text("Error loading dictionary");
    }
});
