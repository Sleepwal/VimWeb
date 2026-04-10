/**
 * Vim-Web Content Script
 * 核心逻辑入口
 * 
 * 职责：
 * 1. 监听全局键盘事件
 * 2. 维护按键缓冲区 (处理多键命令如 'gg')
 * 3. 执行页面滚动和导航操作
 * 4. 避免干扰原生输入框操作
 */
(() => {
  const Utils = window.VimWebUtils;
  console.log("[Vim Web] Loaded");

  // ==========================================
  // 黑名单检查
  // ==========================================
  (async function checkBlacklist() {
    const items = await Utils.StorageManager.get(['blacklist']);
    if (Utils.isBlacklisted(items.blacklist)) {
      console.log('[Vim Web] Disabled on blacklisted domain:', window.location.hostname);
      return;
    }
    initVimWeb();
  })();

  function initVimWeb() {
    console.log('[Vim Web] Initialized on', window.location.hostname);

    // ==========================================
    // KeyBuffer 类
    // ==========================================
    class KeyBuffer {
      constructor(timeout = 400) {
        this.buffer = '';
        this.timeout = timeout;
        this.timer = null;
      }

      push(key) {
        this.buffer += key;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.reset(), this.timeout);
      }

      reset() {
        this.buffer = '';
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
      }

      get value() {
        return this.buffer;
      }
    }

    // ==========================================
    // ScrollHandler 类
    // ==========================================
    class ScrollHandler {
      constructor() {
        this.settings = { value: 15, unit: '%' };
        this._initSettings();
      }

      async _initSettings() {
        const items = await Utils.StorageManager.get(['scrollStep']);
        if (items.scrollStep) {
          this.settings = items.scrollStep;
        }
        Utils.StorageManager.onChange((changes) => {
          if (changes.scrollStep) {
            this.settings = changes.scrollStep;
          }
        });
      }

      perform(dirY = 0, dirX = 0) {
        let top = 0;
        let left = 0;

        if (dirY !== 0) {
          if (this.settings.unit === '%') {
            top = window.innerHeight * (this.settings.value / 100) * dirY;
          } else {
            top = this.settings.value * dirY;
          }
        }

        if (dirX !== 0) {
          if (this.settings.unit === '%') {
            left = window.innerWidth * (this.settings.value / 100) * dirX;
          } else {
            left = this.settings.value * dirX;
          }
        }

        window.scrollBy({ top, left, behavior: "smooth" });
      }

      byRatio(ratioY = 0, ratioX = 0) {
        window.scrollBy({
          top: window.innerHeight * ratioY,
          left: window.innerWidth * ratioX,
          behavior: "smooth"
        });
      }

      toTop() {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }

      toBottom() {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      }
    }

    // ==========================================
    // Indicator 类
    // ==========================================
    class Indicator {
      constructor() {
        this.el = null;
        this.timer = null;
      }

      update(mode) {
        if (!this.el) {
          this.el = Utils.DOMSafe.createElement('div', 'vim-web-indicator');
          document.body.appendChild(this.el);
        }

        if (this.timer) clearTimeout(this.timer);

        const modeNames = {
          NORMAL: 'NORMAL',
          INSERT: 'INSERT',
          HINT: 'HINT'
        };

        Utils.DOMSafe.setText(this.el, modeNames[mode] || mode);
        this.el.className = `vim-web-indicator mode-${mode.toLowerCase()} show`;

        this.timer = setTimeout(() => {
          if (this.el) this.el.classList.remove('show');
        }, 3000);
      }

      destroy() {
        if (this.el) {
          this.el.remove();
          this.el = null;
        }
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
      }
    }

    // ==========================================
    // ModeManager 类
    // ==========================================
    class ModeManager {
      constructor(indicator) {
        this.MODE = {
          NORMAL: 'NORMAL',
          HINT: 'HINT',
          INSERT: 'INSERT'
        };
        this.current = this.MODE.NORMAL;
        this.indicator = indicator;
      }

      switchTo(mode) {
        this.current = mode;
        this.indicator.update(mode);
      }

      is(mode) {
        return this.current === mode;
      }

      isInsert() {
        return this.current === this.MODE.INSERT;
      }

      isHint() {
        return this.current === this.MODE.HINT;
      }

      isNormal() {
        return this.current === this.MODE.NORMAL;
      }
    }

    // ==========================================
    // TabMessenger 类
    // ==========================================
    class TabMessenger {
      static async send(action, data = {}) {
        return new Promise((resolve) => {
          if (!chrome.runtime || !chrome.runtime.sendMessage) {
            resolve({ success: false, error: 'Runtime not available' });
            return;
          }
          chrome.runtime.sendMessage({ type: 'tabAction', action, ...data }, (response) => {
            if (chrome.runtime.lastError) {
              console.warn('[Vim Web] Tab message error:', chrome.runtime.lastError.message);
              resolve({ success: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(response || { success: false });
          });
        });
      }
    }

    // ==========================================
    // 初始化实例
    // ==========================================
    const keyBuffer = new KeyBuffer();
    const scrollHandler = new ScrollHandler();
    const indicator = new Indicator();
    const modeManager = new ModeManager(indicator);

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;

    document.addEventListener("mousemove", (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    }, { passive: true });

    // ==========================================
    // 辅助函数
    // ==========================================

    function isEditable(el) {
      if (!el) return false;
      return el.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    }

    function clickAtCursor() {
      const el = document.elementFromPoint(mouseX, mouseY);
      if (el) {
        const clickable = el.closest('a, button, input, [role="button"]') || el;
        clickable.focus();
        clickable.click();
      }
    }

    // ==========================================
    // 命令映射
    // ==========================================
    const normalKeyMap = {
      'f': () => {
        modeManager.switchTo(modeManager.MODE.HINT);
        if (window.VimHint) window.VimHint.createHints();
        return false;
      },
      ' ': () => {
        clickAtCursor();
        return false;
      },
      'q': () => {
        window.history.back();
        return false;
      },
      'Q': () => {
        window.history.back();
        return false;
      },
      'j': () => {
        scrollHandler.perform(1, 0);
        return false;
      },
      'k': () => {
        scrollHandler.perform(-1, 0);
        return false;
      },
      'h': () => {
        scrollHandler.perform(0, -1);
        return false;
      },
      'l': () => {
        scrollHandler.perform(0, 1);
        return false;
      },
      'G': () => {
        scrollHandler.toBottom();
        return true;
      },
      'x': () => {
        TabMessenger.send('closeCurrentTab');
        return false;
      },
      'X': () => {
        TabMessenger.send('restoreLastTab');
        return false;
      }
    };

    const multiKeyCommands = {
      'gg': () => {
        scrollHandler.toTop();
      },
      'gt': () => {
        TabMessenger.send('nextTab');
      },
      'gT': () => {
        TabMessenger.send('prevTab');
      }
    };

    // ==========================================
    // 核心按键处理
    // ==========================================
    function handleVimKey(e) {
      const key = e.key;

      if (key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();

        if (modeManager.isHint()) {
          if (window.VimHint) window.VimHint.removeHints();
          modeManager.switchTo(modeManager.MODE.NORMAL);
        } else if (modeManager.isInsert()) {
          if (document.activeElement) document.activeElement.blur();
          modeManager.switchTo(modeManager.MODE.NORMAL);
        } else {
          keyBuffer.reset();
        }
        return;
      }

      if (modeManager.isHint()) {
        e.preventDefault();
        e.stopPropagation();

        if (key.length === 1) {
          const finished = window.VimHint.handleInput(key);
          if (finished) {
            modeManager.switchTo(modeManager.MODE.NORMAL);
          }
        }
        return;
      }

      if (modeManager.isInsert()) {
        return;
      }

      if (normalKeyMap[key]) {
        e.preventDefault();
        const shouldReset = normalKeyMap[key]();
        if (shouldReset) keyBuffer.reset();
        return;
      }

      keyBuffer.push(key);

      if (multiKeyCommands[keyBuffer.value]) {
        e.preventDefault();
        multiKeyCommands[keyBuffer.value]();
        keyBuffer.reset();
        return;
      }
    }

    // ==========================================
    // 模式自动切换
    // ==========================================
    document.addEventListener('focus', (e) => {
      if (isEditable(e.target)) {
        modeManager.switchTo(modeManager.MODE.INSERT);
      }
    }, true);

    document.addEventListener('blur', () => {
      setTimeout(() => {
        if (!isEditable(document.activeElement)) {
          modeManager.switchTo(modeManager.MODE.NORMAL);
        }
      }, 10);
    }, true);

    // ==========================================
    // 全局键盘事件监听
    // ==========================================
    document.addEventListener("keydown", (e) => {
      if (modeManager.isInsert() && e.key !== 'Escape') return;

      if (e.ctrlKey && (e.key === 'd' || e.key === 'u')) {
        e.preventDefault();
        if (e.key === 'd') {
          scrollHandler.byRatio(0.5, 0);
        } else {
          scrollHandler.byRatio(-0.5, 0);
        }
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      handleVimKey(e);
    }, true);

  } // end of initVimWeb

})();
