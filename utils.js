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
    handle(error, context = {}) {
      console.error('[Vim Web Error]', error.message || error, context);
    },

    wrap(fn, context = {}) {
      return (...args) => {
        try {
          return fn(...args);
        } catch (error) {
          this.handle(error, { ...context, function: fn.name });
          return undefined;
        }
      };
    }
  };

  const StorageManager = {
    DEFAULTS: {
      scrollStep: { value: 15, unit: '%' },
      blacklist: '',
      configVersion: 1
    },

    async get(keys) {
      return new Promise((resolve) => {
        if (!chrome.storage || !chrome.storage.sync) {
          const result = {};
          if (Array.isArray(keys)) {
            keys.forEach(k => { result[k] = this.DEFAULTS[k]; });
          } else {
            Object.keys(keys).forEach(k => { result[k] = this.DEFAULTS[k] || keys[k]; });
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
