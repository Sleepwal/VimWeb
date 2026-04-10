/**
 * Vim Web 共享工具模块
 * 
 * 职责：
 * 1. DOM 安全操作工具
 * 2. 数据验证器
 * 3. 错误处理器
 * 4. 存储管理器
 */
window.VimWebUtils = (() => {
  const BLACKLIST_PATTERN_REGEX = /^[a-zA-Z0-9._\-*]+$/;

  const Validators = {
    scrollStep(value) {
      if (typeof value !== 'object' || value === null) return false;
      if (typeof value.value !== 'number' || isNaN(value.value)) return false;
      if (value.value < 1 || value.value > 10000) return false;
      if (!['%', 'px'].includes(value.unit)) return false;
      return true;
    },

    blacklistPattern(pattern) {
      if (typeof pattern !== 'string') return false;
      const trimmed = pattern.trim();
      if (trimmed === '') return true;
      return BLACKLIST_PATTERN_REGEX.test(trimmed);
    },

    blacklist(value) {
      if (typeof value !== 'string') return false;
      return value.split('\n').every(line => this.blacklistPattern(line));
    },

    keyMappings(value) {
      if (typeof value !== 'object' || value === null) return false;
      for (const [key, action] of Object.entries(value)) {
        if (typeof key !== 'string' || typeof action !== 'string') return false;
        if (key.length === 0 || key.length > 3) return false;
      }
      return true;
    }
  };

  const DOMSafe = {
    setText(element, text) {
      if (element && typeof text === 'string') {
        element.textContent = text;
      }
    },

    setAttribute(element, name, value) {
      const safeAttrs = ['class', 'id', 'style', 'tabindex', 'role', 'aria-label'];
      if (element && safeAttrs.includes(name)) {
        element.setAttribute(name, value);
      }
    },

    createElement(tag, className, textContent) {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (textContent) el.textContent = textContent;
      return el;
    }
  };

  const ErrorHandler = {
    _log: [],
    _MAX_LOG_SIZE: 50,

    handle(error, context = {}) {
      const entry = {
        message: error.message || String(error),
        context,
        timestamp: Date.now(),
        stack: error.stack || null
      };

      this._log.push(entry);
      if (this._log.length > this._MAX_LOG_SIZE) {
        this._log.shift();
      }

      console.error('[Vim Web Error]', entry.message, context);
    },

    wrap(fn, context = {}) {
      const self = this;
      return function wrapped(...args) {
        try {
          return fn.apply(this, args);
        } catch (error) {
          self.handle(error, { ...context, function: fn.name });
          return undefined;
        }
      };
    },

    wrapAsync(fn, context = {}) {
      const self = this;
      return async function wrapped(...args) {
        try {
          return await fn.apply(this, args);
        } catch (error) {
          self.handle(error, { ...context, function: fn.name });
          return undefined;
        }
      };
    },

    getLog() {
      return [...this._log];
    },

    clearLog() {
      this._log = [];
    },

    showUserError(message) {
      const existing = document.querySelector('.vim-web-error-toast');
      if (existing) existing.remove();

      const toast = DOMSafe.createElement('div', 'vim-web-error-toast', message);
      document.body.appendChild(toast);

      requestAnimationFrame(() => {
        toast.classList.add('show');
      });

      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    }
  };

  const StorageManager = {
    DEFAULTS: {
      scrollStep: { value: 15, unit: '%' },
      blacklist: '',
      keyMappings: {},
      configVersion: 2
    },

    async get(keys) {
      return new Promise((resolve) => {
        if (!chrome.storage || !chrome.storage.sync) {
          const result = {};
          if (Array.isArray(keys)) {
            keys.forEach(k => { result[k] = this.DEFAULTS[k]; });
          } else {
            Object.keys(keys).forEach(k => { result[k] = this.DEFAULTS[k] !== undefined ? this.DEFAULTS[k] : keys[k]; });
          }
          resolve(result);
          return;
        }

        chrome.storage.sync.get(this.DEFAULTS, (items) => {
          const result = {};
          const keyList = Array.isArray(keys) ? keys : Object.keys(keys);
          keyList.forEach(k => {
            if (items[k] !== undefined) {
              result[k] = this._validateAndFix(k, items[k]);
            } else if (!Array.isArray(keys)) {
              result[k] = keys[k];
            }
          });
          resolve(result);
        });
      });
    },

    async set(items) {
      return new Promise((resolve) => {
        if (!chrome.storage || !chrome.storage.sync) {
          resolve();
          return;
        }
        chrome.storage.sync.set(items, resolve);
      });
    },

    _validateAndFix(key, value) {
      switch (key) {
        case 'scrollStep':
          if (!Validators.scrollStep(value)) {
            console.warn('[Vim Web] Invalid scrollStep config, resetting to default:', value);
            return { ...this.DEFAULTS.scrollStep };
          }
          return value;
        case 'blacklist':
          if (!Validators.blacklist(value)) {
            console.warn('[Vim Web] Invalid blacklist config, resetting to default');
            return this.DEFAULTS.blacklist;
          }
          return value;
        case 'keyMappings':
          if (!Validators.keyMappings(value)) {
            console.warn('[Vim Web] Invalid keyMappings config, resetting to default');
            return { ...this.DEFAULTS.keyMappings };
          }
          return value;
        default:
          return value;
      }
    },

    onChange(callback) {
      if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'sync') {
            const validated = {};
            for (const [key, change] of Object.entries(changes)) {
              validated[key] = this._validateAndFix(key, change.newValue);
            }
            callback(validated);
          }
        });
      }
    }
  };

  function matchBlacklist(hostname, pattern) {
    pattern = pattern.trim();
    if (!pattern) return false;

    if (!Validators.blacklistPattern(pattern)) {
      console.warn('[Vim Web] Invalid blacklist pattern skipped:', pattern);
      return false;
    }

    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*');

    try {
      const regex = new RegExp('^' + regexPattern + '$', 'i');
      return regex.test(hostname);
    } catch (e) {
      console.warn('[Vim Web] Blacklist regex error:', e.message);
      return false;
    }
  }

  function isBlacklisted(blacklist) {
    if (!blacklist) return false;
    const hostname = window.location.hostname;
    const patterns = blacklist.split('\n');
    return patterns.some(pattern => matchBlacklist(hostname, pattern));
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  return {
    Validators,
    DOMSafe,
    ErrorHandler,
    StorageManager,
    matchBlacklist,
    isBlacklisted,
    debounce
  };
})();
