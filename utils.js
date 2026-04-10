/**
 * Vim Web 共享工具模块
 *
 * 作为全局命名空间 window.VimWebUtils 暴露，供 content.js、hint.js、search.js、options.js 共同使用。
 * 采用 IIFE 封装，避免污染全局作用域。
 *
 * 包含四个核心子模块：
 * - Validators：数据验证器，确保存储数据的完整性和安全性
 * - DOMSafe：DOM 安全操作工具，防止 XSS 攻击
 * - ErrorHandler：集中式错误处理器，提供日志记录和用户提示
 * - StorageManager：异步存储管理器，封装 chrome.storage.sync 并内置数据验证
 *
 * 以及三个工具函数：
 * - matchBlacklist：单条黑名单模式匹配
 * - isBlacklisted：检查当前域名是否在黑名单中
 * - debounce：函数防抖
 */
window.VimWebUtils = (() => {
  /**
   * 黑名单模式合法字符正则
   * 允许：字母、数字、点号(.)、下划线(_)、连字符(-)、星号(*)
   * 星号作为通配符使用，点号和连字符是域名的合法字符，下划线用于 SRV 记录等场景
   * @type {RegExp}
   */
  const BLACKLIST_PATTERN_REGEX = /^[a-zA-Z0-9._\-*]+$/;

  /**
   * 数据验证器集合
   *
   * 每个验证器接收一个值，返回 boolean 表示是否通过验证。
   * 用于 StorageManager 读取数据时的完整性校验，以及 options.js 保存前的输入验证。
   */
  const Validators = {
    /**
     * 验证滚动步长配置
     *
     * @param {Object} value - 滚动步长配置对象
     * @param {number} value.value - 步长数值，必须为 1-10000 之间的数字
     * @param {string} value.unit - 步长单位，必须为 '%' 或 'px'
     * @returns {boolean} 配置是否合法
     */
    scrollStep(value) {
      if (typeof value !== 'object' || value === null) return false;
      if (typeof value.value !== 'number' || isNaN(value.value)) return false;
      if (value.value < 1 || value.value > 10000) return false;
      if (!['%', 'px'].includes(value.unit)) return false;
      return true;
    },

    /**
     * 验证单条黑名单模式
     *
     * @param {string} pattern - 单条黑名单模式字符串
     * @returns {boolean} 模式是否合法，空字符串视为合法（表示无限制）
     */
    blacklistPattern(pattern) {
      if (typeof pattern !== 'string') return false;
      const trimmed = pattern.trim();
      if (trimmed === '') return true;
      return BLACKLIST_PATTERN_REGEX.test(trimmed);
    },

    /**
     * 验证完整黑名单字符串（多行）
     *
     * 逐行检查每条模式是否合法，用于 options.js 保存前的整体验证。
     *
     * @param {string} value - 换行符分隔的黑名单字符串
     * @returns {boolean} 所有行是否都合法
     */
    blacklist(value) {
      if (typeof value !== 'string') return false;
      return value.split('\n').every(line => this.blacklistPattern(line));
    },

    /**
     * 验证自定义快捷键映射对象
     *
     * @param {Object} value - 快捷键映射对象 { key: action }
     * @param {string} value.key - 快捷键字符串，长度 1-3 个字符
     * @param {string} value.action - 命令名称字符串
     * @returns {boolean} 映射对象是否合法
     */
    keyMappings(value) {
      if (typeof value !== 'object' || value === null) return false;
      for (const [key, action] of Object.entries(value)) {
        if (typeof key !== 'string' || typeof action !== 'string') return false;
        if (key.length === 0 || key.length > 3) return false;
      }
      return true;
    }
  };

  /**
   * DOM 安全操作工具
   *
   * 所有 content script 中的 DOM 操作都应通过此模块进行，
   * 确保不使用 innerHTML 等可能导致 XSS 的 API。
   * 使用 textContent 替代 innerHTML，使用白名单过滤 setAttribute 的属性名。
   */
  const DOMSafe = {
    /**
     * 安全设置元素文本内容
     * 使用 textContent 而非 innerHTML，防止 HTML 注入
     *
     * @param {HTMLElement} element - 目标 DOM 元素
     * @param {string} text - 要设置的文本内容
     */
    setText(element, text) {
      if (element && typeof text === 'string') {
        element.textContent = text;
      }
    },

    /**
     * 安全设置元素属性
     * 仅允许设置白名单中的属性名，防止通过属性注入恶意代码
     *
     * @param {HTMLElement} element - 目标 DOM 元素
     * @param {string} name - 属性名，必须在 safeAttrs 白名单中
     * @param {string} value - 属性值
     */
    setAttribute(element, name, value) {
      const safeAttrs = ['class', 'id', 'style', 'tabindex', 'role', 'aria-label'];
      if (element && safeAttrs.includes(name)) {
        element.setAttribute(name, value);
      }
    },

    /**
     * 安全创建 DOM 元素
     * 使用 textContent 设置文本，避免 innerHTML
     *
     * @param {string} tag - HTML 标签名（如 'div', 'span'）
     * @param {string} [className] - CSS 类名
     * @param {string} [textContent] - 元素文本内容
     * @returns {HTMLElement} 新创建的 DOM 元素
     */
    createElement(tag, className, textContent) {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (textContent) el.textContent = textContent;
      return el;
    }
  };

  /**
   * 集中式错误处理器
   *
   * 提供错误日志记录、函数包装（同步/异步）和用户错误提示功能。
   * 日志保存在内存中（最多 _MAX_LOG_SIZE 条），可通过 getLog() 获取。
   */
  const ErrorHandler = {
    /** @type {Array<{message: string, context: Object, timestamp: number, stack: string|null}>} 错误日志数组 */
    _log: [],
    /** @type {number} 日志最大条数，超出后移除最早的记录 */
    _MAX_LOG_SIZE: 50,

    /**
     * 处理并记录错误
     *
     * 将错误信息、上下文、时间戳和调用栈记录到内存日志，
     * 同时输出到 console.error 以便开发者调试。
     *
     * @param {Error|string} error - 错误对象或错误消息
     * @param {Object} [context={}] - 错误上下文信息，用于定位问题
     */
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

    /**
     * 包装同步函数，自动捕获异常
     *
     * 被包装的函数如果抛出异常，会被 handle() 记录并返回 undefined，
     * 而不是让异常向上传播导致整个扩展崩溃。
     *
     * @param {Function} fn - 要包装的同步函数
     * @param {Object} [context={}] - 额外的上下文信息
     * @returns {Function} 包装后的函数，异常时返回 undefined
     */
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

    /**
     * 包装异步函数，自动捕获异常
     *
     * 与 wrap() 类似，但针对 async 函数，使用 await 捕获 Promise 中的异常。
     *
     * @param {AsyncFunction} fn - 要包装的异步函数
     * @param {Object} [context={}] - 额外的上下文信息
     * @returns {AsyncFunction} 包装后的异步函数，异常时返回 undefined
     */
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

    /**
     * 获取错误日志的副本
     *
     * @returns {Array} 错误日志数组的浅拷贝
     */
    getLog() {
      return [...this._log];
    },

    /**
     * 清空错误日志
     */
    clearLog() {
      this._log = [];
    },

    /**
     * 显示用户友好的错误提示（Toast 样式）
     *
     * 在页面右下角显示一个红色提示条，3秒后自动消失。
     * 如果已有提示在显示，会先移除旧的再显示新的。
     *
     * @param {string} message - 要显示给用户的错误消息
     */
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

  /**
   * 异步存储管理器
   *
   * 封装 chrome.storage.sync API，提供：
   * - 统一的异步读写接口
   * - 内置数据验证，读取时自动修复无效配置
   * - 默认值管理，确保所有配置项都有初始值
   * - 变更监听，当其他页面修改配置时自动通知
   *
   * @note chrome.storage.sync 有 1024 字节的单项限制和 100KB 总量限制，
   *       keyMappings 的值不宜过大。
   */
  const StorageManager = {
    /**
     * 默认配置值
     *
     * 当存储中没有对应键值时，使用这些默认值。
     * 同时作为 chrome.storage.sync.get() 的默认值参数。
     *
     * @type {Object}
     * @property {Object} scrollStep - 默认滚动步长：15% 屏幕高度
     * @property {string} blacklist - 默认黑名单：空（不禁用任何域名）
     * @property {Object} keyMappings - 默认自定义映射：空对象（使用内置默认）
     * @property {number} configVersion - 配置版本号，用于数据迁移
     */
    DEFAULTS: {
      scrollStep: { value: 15, unit: '%' },
      blacklist: '',
      keyMappings: {},
      configVersion: 2
    },

    /**
     * 异步读取存储数据
     *
     * 读取时自动调用 _validateAndFix 验证数据完整性，
     * 如果数据无效则自动回退到默认值。
     *
     * @param {string[]|Object} keys - 要读取的键名数组，或带默认值的对象
     * @returns {Promise<Object>} 包含请求键值对的对象
     *
     * @example
     * // 读取单个配置
     * const items = await StorageManager.get(['scrollStep']);
     *
     * @example
     * // 读取带默认值的配置
     * const items = await StorageManager.get({ scrollStep: { value: 20, unit: '%' } });
     */
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

    /**
     * 异步写入存储数据
     *
     * @param {Object} items - 要写入的键值对对象
     * @returns {Promise<void>}
     *
     * @example
     * await StorageManager.set({ scrollStep: { value: 20, unit: '%' } });
     */
    async set(items) {
      return new Promise((resolve) => {
        if (!chrome.storage || !chrome.storage.sync) {
          resolve();
          return;
        }
        chrome.storage.sync.set(items, resolve);
      });
    },

    /**
     * 验证并修复配置值
     *
     * 读取配置时调用，如果值无效则重置为默认值并输出警告。
     * 这确保了即使存储数据被手动篡改或版本升级导致格式变化，
     * 扩展也不会因无效配置而崩溃。
     *
     * @param {string} key - 配置键名
     * @param {*} value - 配置值
     * @returns {*} 验证后的值，如果无效则返回默认值
     * @private
     */
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

    /**
     * 监听存储变更
     *
     * 当其他页面（如 options.js）修改了 chrome.storage.sync 中的数据时，
     * 会触发回调。回调参数是经过验证的变更值。
     *
     * @param {Function} callback - 变更回调函数
     * @param {Object} callback.changes - 变更后的键值对（已验证）
     *
     * @example
     * StorageManager.onChange((changes) => {
     *   if (changes.scrollStep) {
     *     scrollHandler.settings = changes.scrollStep;
     *   }
     * });
     */
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

  /**
   * 匹配单条黑名单模式
   *
   * 将黑名单模式中的通配符 * 转换为正则表达式 .*，
   * 点号转义为 \.，然后与主机名进行不区分大小写的匹配。
   *
   * @param {string} hostname - 当前页面的主机名（如 'www.example.com'）
   * @param {string} pattern - 黑名单模式（如 '*.example.com'）
   * @returns {boolean} 主机名是否匹配该模式
   *
   * @example
   * matchBlacklist('mail.google.com', '*.google.com'); // true
   * matchBlacklist('google.com', 'google.com');        // true
   * matchBlacklist('evil.com', 'google.com');          // false
   */
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

  /**
   * 检查当前页面是否在黑名单中
   *
   * 逐行检查黑名单字符串，只要有一行匹配当前主机名即返回 true。
   *
   * @param {string} blacklist - 换行符分隔的黑名单字符串
   * @returns {boolean} 当前页面是否应禁用 Vim Web
   */
  function isBlacklisted(blacklist) {
    if (!blacklist) return false;
    const hostname = window.location.hostname;
    const patterns = blacklist.split('\n');
    return patterns.some(pattern => matchBlacklist(hostname, pattern));
  }

  /**
   * 函数防抖
   *
   * 在连续调用时，只执行最后一次。适用于搜索输入、窗口 resize 等高频事件。
   *
   * @param {Function} func - 要防抖的函数
   * @param {number} wait - 等待时间（毫秒）
   * @returns {Function} 防抖后的函数
   *
   * @example
   * const debouncedSearch = debounce(() => search(keyword), 200);
   * input.addEventListener('input', debouncedSearch);
   */
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
