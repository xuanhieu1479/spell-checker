# Spell Checker for SillyTavern

A SillyTavern extension that checks spelling **only when you ask it to**. It fixes misspelled words without touching your punctuation, formatting, or sentence structure.

## Why This Exists

For non-native English speakers who write roleplay dialogue with intentional "incorrect" grammar — deliberate comma placement for pauses, sentence fragments, ellipses, asterisks for emphasis. Tools like QuillBot aggressively restructure sentences and change meaning. This extension respects your writing style.

## Features

- **Ctrl+Space to check** — No background scanning, no timers, no overhead when idle
- **Local dictionary** with 172k words — instant, free, works offline
- **AI fallback** for hard cases (garbled words the dictionary can't match)
- **Ambiguous word detection** — shows all options when multiple corrections are equally likely
- **Fix All button** — applies all unambiguous corrections at once
- **Custom dictionary** — add character names, fantasy terms, slang
- **Never touches punctuation** — your asterisks, quotes, and commas stay exactly as you wrote them

## How It Works

### Layer 1: Local Dictionary (Free, Instant)
- Checks each word against 172,782 common English words
- Uses Damerau-Levenshtein distance for typo detection
- Suggests closest matches ranked by word frequency
- **Ambiguous words** (like "claming" → "claiming" or "calming") show all options — you choose

### Layer 2: AI Fallback (For Hard Cases)
- Words with no close dictionary match (edit distance > 2) can be sent to AI
- Only sends the misspelled word + context, not the full message
- Configurable API endpoint (OpenAI, Google, Anthropic compatible)
- Default: Gemini Flash Lite (~$0.0005 per check)

### Layer 3: Post-Processing Safety Net
- Ensures AI corrections don't add apostrophes, remove asterisks, or change punctuation
- Preserves your original formatting character-by-character

## Installation

Copy the `spell-checker` folder to:
```
SillyTavern/public/scripts/extensions/third_party/spell-checker
```

Reload SillyTavern. The extension appears in the Extensions panel.

## Usage

1. Type in the chat input box (`#send_textarea`)
2. Press **Ctrl+Space** to run spell check
3. Click highlighted words to see suggestions
4. Click "Fix All" to apply all unambiguous corrections
5. Ambiguous words (yellow highlight) must be fixed manually

## Settings

- **Keyboard shortcut** — Change from Ctrl+Space if needed
- **AI API** — Configure endpoint, key, and model for hard cases
- **Custom prompt** — Customize what's sent to the AI
- **Custom dictionary** — Words to never flag (one per line)

## What This Extension Will NOT Do

- Scan automatically in the background
- Touch your punctuation or formatting
- Add apostrophes to "dont" or "whats"
- Remove your asterisks from `*emphasis*`
- Close your unclosed quotation marks
- Restructure your sentences
- Run on any timer or interval
- Store data in IndexedDB

## License

MIT
