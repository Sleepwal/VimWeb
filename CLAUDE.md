# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vim Web is a lightweight Chrome extension (MV3) that provides Vim-style keyboard navigation for web browsing. It uses vanilla JavaScript with no external dependencies.

## Development Workflow

### Loading the Extension
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the project root directory
4. After code changes, click the refresh icon on the extension card or press `Ctrl+R` on the extensions page

### Project Structure

```
wim/
├── manifest.json       # MV3 extension configuration
├── content.js          # Core keyboard handling, mode management, blacklist check, mode indicator
├── hint.js             # F-mode hint system (exposed as window.VimHint)
├── hint.css            # Hint overlay styles
├── indicator.css       # Mode indicator styles (NORMAL/INSERT/HINT)
├── options.js/html/css # Extension settings page (scroll step, blacklist)
├── popup.html/css      # Help popup UI
└── doc/                # Development documentation
```

### Architecture

**Mode System**: The extension operates in three modes (defined in `content.js`):
- `NORMAL`: Default mode for navigation commands (j/k/h/l scrolling, gg/G for top/bottom, f for hint mode, Ctrl+d/u for half-page scroll)
- `INSERT`: Activated when focused on input/textarea/contenteditable elements; shortcuts are disabled
- `HINT`: F-mode for keyboard clicking on links/elements via alphabet hints

**Key Components**:
- `content.js`: Event listener with `capture: true` for priority handling; maintains key buffer for multi-key commands (e.g., "gg"); tracks mouse position for Space-click feature; syncs scroll settings from `chrome.storage.sync`; implements blacklist check and mode indicator
- `hint.js`: Global `VimHint` object creates overlays on clickable elements (a-z, then aa-az labels); filters visible elements by viewport intersection and computed styles
- `options.js`: Settings UI with live preview; validates scroll step values (5-200% or px); manages blacklist configuration

**Storage Schema**:
```javascript
{
  scrollStep: { value: number, unit: '%' | 'px' },
  blacklist: string  // newline-separated domain patterns, supports wildcards (*)
}
```

**Command Mapping**: Normal mode commands are defined in `normalKeyMap` (single-key) and `multiKeyCommands` (multi-key like "gg") objects for maintainability.

### Code Style
- Use vanilla JavaScript (ES6+) with JSDoc comments
- CSS class prefix: `.vim-web-*` to avoid conflicts with host pages
- Z-index for overlays: `2147483647` (maximum safe value)
