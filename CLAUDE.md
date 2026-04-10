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
├── background.js       # Service worker: tab management, message handling
├── utils.js            # Shared utilities: validators, DOMSafe, ErrorHandler, StorageManager
├── content.js          # Core keyboard handling, mode management, key buffer, scroll handler, key mapper
├── hint.js             # F-mode hint system (exposed as window.VimHint)
├── search.js           # Page search system (exposed as window.VimSearch)
├── hint.css            # Hint overlay styles
├── indicator.css       # Mode indicator styles (NORMAL/INSERT/HINT/SEARCH)
├── search.css          # Search UI and highlight styles
├── options.js/html/css # Extension settings page (scroll step, key mappings, blacklist)
├── popup.html/css      # Help popup UI
└── doc/                # Development documentation
```

### Architecture

**Module System**: Scripts are loaded in order via manifest.json content_scripts. Shared utilities are exposed as `window.VimWebUtils`.

**Core Classes** (in content.js):
- `KeyBuffer`: Manages key input buffer with timeout for multi-key commands (e.g., "gg", "gt")
- `ScrollHandler`: Handles scroll operations with requestAnimationFrame optimization, configurable step settings, and viewport cache
- `Indicator`: Manages the mode indicator UI element
- `ModeManager`: Manages NORMAL/INSERT/HINT/SEARCH mode transitions
- `TabMessenger`: Sends tab action messages to background.js via chrome.runtime.sendMessage
- `KeyMapper`: Manages custom key mappings with user overrides, import/export support

**Search System** (in search.js):
- `VimSearch`: Page text search with TreeWalker-based matching, highlight, and navigation
- Supports / (open search), n/N (next/prev), * (search word under cursor)
- Highlight with mark elements, current match indicator

**Background Script** (background.js):
- Handles tab operations: next/prev tab, close tab, restore closed tab
- Maintains tabInfoMap for proactive tab info tracking
- Maintains a stack of recently closed tabs (max 10)
- Responds to messages from content scripts

**Shared Utilities** (utils.js - window.VimWebUtils):
- `Validators`: Validates scrollStep, blacklist patterns, keyMappings
- `DOMSafe`: Safe DOM creation and text setting (prevents XSS)
- `ErrorHandler`: Centralized error handling with log, wrap, wrapAsync, showUserError
- `StorageManager`: Async storage access with validation, defaults, and change notification
- `matchBlacklist`/`isBlacklisted`: Blacklist matching with input validation
- `debounce`: Utility debounce function

**Mode System**: The extension operates in four modes:
- `NORMAL`: Default mode for navigation commands
- `INSERT`: Activated when focused on input/textarea/contenteditable elements
- `HINT`: F-mode for keyboard clicking on links/elements
- `SEARCH`: Search mode for page text search

**Key Commands** (default mappings):
- Single-key: j/k/h/l (scroll), f (hint), Space (click at cursor), q/Q (back), G (bottom), x (close tab), X (restore tab), / (search), n (next match), N (prev match), * (search word)
- Multi-key: gg (top), gt (next tab), gT (prev tab)
- Ctrl combos: Ctrl+d (half page down), Ctrl+u (half page up)
- Escape: Exit current mode

**Command System**: KeyMapper resolves keys to action names, commandActions map executes them. This allows user-customizable key bindings.

**Storage Schema**:
```javascript
{
  scrollStep: { value: number, unit: '%' | 'px' },
  blacklist: string,  // newline-separated domain patterns, supports wildcards (*)
  keyMappings: { [key: string]: string },  // user key mapping overrides
  configVersion: number  // schema version for migration
}
```

### Code Style
- Use vanilla JavaScript (ES6+) with JSDoc comments
- CSS class prefix: `.vim-web-*` to avoid conflicts with host pages
- Z-index for overlays: `2147483647` (maximum safe value)
- Use `window.VimWebUtils` for shared utilities
- Use `Utils.DOMSafe` for DOM operations in content scripts
- Validate all user input with `Utils.Validators` before storage
- Use `requestAnimationFrame` for scroll operations
- Use `Utils.debounce` for input handlers
