# Spell Checker

A SillyTavern extension that provides real-time spell checking for your chat input.

## Features

- Real-time spell checking as you type
- Customizable highlight color and underline style
- Custom dictionary for adding words that shouldn't be flagged
- Ignore patterns using regex (e.g., skip template tags like `{{char}}`)
- Click on misspelled words to see suggestions
- Slash commands for quick access

## Installation

1. Copy the `spell-checker` folder to your SillyTavern extensions directory:
   ```
   SillyTavern/public/scripts/extensions/third_party/spell-checker
   ```

2. Restart SillyTavern or reload the page

3. The extension will appear in the Extensions panel

## Slash Commands

- `/spellcheck` - Toggle spell checker on/off
- `/addword <word>` - Add a word to the custom dictionary
- `/removeword <word>` - Remove a word from the custom dictionary

## Settings

- **Enable spell checking** - Toggle the extension on/off
- **Check while typing** - Enable real-time checking as you type
- **Highlight color** - Color of the underline for misspelled words
- **Underline style** - Style of underline (wavy, dotted, dashed, solid, double)
- **Min word length** - Minimum length for words to be checked
- **Ignored Patterns** - Regex patterns for text to ignore (one per line)

## Custom Dictionary

Click "Manage Dictionary" to add or remove words from your custom dictionary. Words in the custom dictionary will never be flagged as misspellings.

## Default Ignored Patterns

The following patterns are ignored by default:
- `\{\{[^}]+\}\}` - SillyTavern template tags (e.g., `{{char}}`, `{{user}}`)
- `\[\[[^\]]+\]\]` - Wiki-style links
- `<[^>]+>` - HTML tags

## License

MIT
