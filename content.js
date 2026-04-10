/**
 * Vim-Web Content Script
 *
 * 扩展的核心入口文件，在所有网页中自动注入。
 * 采用 IIFE 封装，避免与页面脚本冲突。
 *
 * 核心职责：
 * 1. 黑名单检查：根据用户配置决定是否在当前页面启用
 * 2. 键盘事件监听：捕获按键并分发到对应的命令处理器
 * 3. 模式管理：维护 NORMAL/INSERT/HINT/SEARCH 四种模式的切换
 * 4. 按键缓冲区：支持 gg、gt 等多键命令的输入
 * 5. 滚动处理：使用 requestAnimationFrame 优化滚动性能
 * 6. 快捷键映射：支持用户自定义快捷键绑定
 *
 * 依赖：
 * - window.VimWebUtils：共享工具模块（utils.js）
 * - window.VimHint：Hint 系统（hint.js）
 * - window.VimSearch：搜索系统（search.js）
 */
(() => {
  const Utils = window.VimWebUtils;
  console.log("[Vim Web] Loaded");

  // ==========================================
  // 黑名单检查
  // ==========================================

  /**
   * 异步检查当前页面是否在黑名单中
   *
   * 从 chrome.storage.sync 读取黑名单配置，
   * 如果当前域名匹配黑名单模式，则不初始化扩展。
   * 如果检查过程出错，仍然初始化扩展（宁可误启也不误禁）。
   */
  (async function checkBlacklist() {
    try {
      await Utils.StorageManager.migrate();
      const items = await Utils.StorageManager.get(['blacklist']);
      if (Utils.isBlacklisted(items.blacklist)) {
        console.log('[Vim Web] Disabled on blacklisted domain:', window.location.hostname);
        return;
      }
      initVimWeb();
    } catch (error) {
      Utils.ErrorHandler.handle(error, { phase: 'blacklist_check' });
      initVimWeb();
    }
  })();

  /**
   * 初始化 Vim Web 扩展
   *
   * 创建所有核心类实例，注册事件监听器。
   * 只在黑名单检查通过后调用。
   */
  function initVimWeb() {
    console.log('[Vim Web] Initialized on', window.location.hostname);

    // ==========================================
    // KeyBuffer 类
    // ==========================================

    /**
     * 按键缓冲区
     *
     * 用于处理多键命令（如 'gg'、'gt'、'gT'）。
     * 每次按键追加到缓冲区，如果在超时时间内没有后续按键则自动清空。
     *
     * @example
     * const buf = new KeyBuffer(400);
     * buf.push('g'); // buffer = 'g'
     * buf.push('g'); // buffer = 'gg' → 匹配命令，执行后 reset
     */
    class KeyBuffer {
      /**
       * @param {number} [timeout=400] - 缓冲区超时时间（毫秒），超时后自动清空
       */
      constructor(timeout = 400) {
        /** @type {string} 当前缓冲的按键序列 */
        this.buffer = '';
        /** @type {number} 超时时间 */
        this.timeout = timeout;
        /** @type {number|null} 超时定时器 ID */
        this.timer = null;
      }

      /**
       * 追加按键到缓冲区
       *
       * 每次追加后重置超时定时器，确保用户有时间输入下一个键。
       *
       * @param {string} key - 按键字符
       */
      push(key) {
        this.buffer += key;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.reset(), this.timeout);
      }

      /**
       * 清空缓冲区
       */
      reset() {
        this.buffer = '';
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
      }

      /**
       * 获取当前缓冲区内容
       * @returns {string} 缓冲的按键序列
       */
      get value() {
        return this.buffer;
      }
    }

    // ==========================================
    // ScrollHandler 类
    // ==========================================

    /**
     * 滚动处理器
     *
     * 封装页面滚动操作，支持百分比和像素两种步长单位。
     * 使用 requestAnimationFrame 防止滚动事件堆积，
     * 缓存视口尺寸避免频繁读取 DOM 属性。
     *
     * @note 百分比模式下，滚动距离 = 视口高度 × (步长值 / 100) × 方向
     *       像素模式下，滚动距离 = 步长值 × 方向
     */
    class ScrollHandler {
      constructor() {
        /** @type {{ value: number, unit: string }} 滚动步长配置 */
        this.settings = { value: 15, unit: '%' };
        /** @type {number|null} 当前 requestAnimationFrame ID，用于防止重复触发 */
        this._scrollRAF = null;
        /** @type {number} 缓存的视口高度，避免频繁读取 window.innerHeight */
        this._cachedViewportH = window.innerHeight;
        /** @type {number} 缓存的视口宽度，避免频繁读取 window.innerWidth */
        this._cachedViewportW = window.innerWidth;
        this._initSettings();
        this._initViewportCache();
      }

      /**
       * 从存储加载滚动步长配置，并监听变更
       * @private
       */
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

      /**
       * 初始化视口尺寸缓存，窗口 resize 时更新（防抖100ms）
       * @private
       */
      _initViewportCache() {
        window.addEventListener('resize', Utils.debounce(() => {
          this._cachedViewportH = window.innerHeight;
          this._cachedViewportW = window.innerWidth;
        }, 100), { passive: true });
      }

      /**
       * 按步长执行滚动
       *
       * 使用 requestAnimationFrame 确保每帧最多执行一次滚动，
       * 防止快速连续按键导致滚动堆积。
       *
       * @param {number} [dirY=0] - 垂直方向，1=向下，-1=向上，0=不滚动
       * @param {number} [dirX=0] - 水平方向，1=向右，-1=向左，0=不滚动
       */
      perform(dirY = 0, dirX = 0) {
        if (this._scrollRAF) return;

        this._scrollRAF = requestAnimationFrame(() => {
          let top = 0;
          let left = 0;

          if (dirY !== 0) {
            if (this.settings.unit === '%') {
              top = this._cachedViewportH * (this.settings.value / 100) * dirY;
            } else {
              top = this.settings.value * dirY;
            }
          }

          if (dirX !== 0) {
            if (this.settings.unit === '%') {
              left = this._cachedViewportW * (this.settings.value / 100) * dirX;
            } else {
              left = this.settings.value * dirX;
            }
          }

          window.scrollBy({ top, left, behavior: "smooth" });
          this._scrollRAF = null;
        });
      }

      /**
       * 按视口比例执行滚动
       *
       * 用于 Ctrl+d/u 等半页滚动命令，ratioY=0.5 表示向下滚动半个视口高度。
       *
       * @param {number} [ratioY=0] - 垂直滚动比例，0.5=半屏，1=整屏
       * @param {number} [ratioX=0] - 水平滚动比例
       */
      byRatio(ratioY = 0, ratioX = 0) {
        if (this._scrollRAF) return;

        this._scrollRAF = requestAnimationFrame(() => {
          window.scrollBy({
            top: this._cachedViewportH * ratioY,
            left: this._cachedViewportW * ratioX,
            behavior: "smooth"
          });
          this._scrollRAF = null;
        });
      }

      /**
       * 滚动到页面顶部
       */
      toTop() {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }

      /**
       * 滚动到页面底部
       */
      toBottom() {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      }
    }

    // ==========================================
    // Indicator 类
    // ==========================================

    /**
     * 模式指示器
     *
     * 在页面右下角显示当前模式名称（NORMAL/INSERT/HINT/SEARCH），
     * 3秒后自动淡出。不同模式使用不同背景色：
     * - NORMAL：绿色 (#4caf50)
     * - INSERT：橙色 (#ff9800)
     * - HINT：蓝色 (#2196f3)
     * - SEARCH：紫色 (#9c27b0)
     */
    class Indicator {
      constructor() {
        /** @type {HTMLElement|null} 指示器 DOM 元素 */
        this.el = null;
        /** @type {number|null} 自动隐藏定时器 ID */
        this.timer = null;
      }

      /**
       * 更新指示器显示的模式
       *
       * 如果指示器尚未创建，会自动创建并添加到 document.body。
       * 每次更新后重置3秒自动隐藏定时器。
       *
       * @param {string} mode - 模式名称（NORMAL/INSERT/HINT/SEARCH）
       */
      update(mode) {
        if (!this.el) {
          this.el = Utils.DOMSafe.createElement('div', 'vim-web-indicator');
          document.body.appendChild(this.el);
        }

        if (this.timer) clearTimeout(this.timer);

        const modeNames = {
          NORMAL: 'NORMAL',
          INSERT: 'INSERT',
          HINT: 'HINT',
          SEARCH: 'SEARCH'
        };

        Utils.DOMSafe.setText(this.el, modeNames[mode] || mode);
        this.el.className = `vim-web-indicator mode-${mode.toLowerCase()} show`;

        this.timer = setTimeout(() => {
          if (this.el) this.el.classList.remove('show');
        }, 3000);
      }

      /**
       * 销毁指示器，移除 DOM 元素并清除定时器
       */
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

    /**
     * 模式管理器
     *
     * 维护扩展的四种操作模式，模式切换时自动更新指示器。
     *
     * 模式说明：
     * - NORMAL：默认模式，所有快捷键生效
     * - INSERT：焦点在输入框时激活，只响应 Escape
     * - HINT：按 f 激活，按键用于选择 Hint 标签
     * - SEARCH：按 / 激活，按键由搜索框处理
     */
    class ModeManager {
      /**
       * @param {Indicator} indicator - 模式指示器实例
       */
      constructor(indicator) {
        /** @type {Object} 模式常量枚举 */
        this.MODE = {
          NORMAL: 'NORMAL',
          HINT: 'HINT',
          INSERT: 'INSERT',
          SEARCH: 'SEARCH'
        };
        /** @type {string} 当前模式 */
        this.current = this.MODE.NORMAL;
        /** @type {Indicator} 关联的指示器 */
        this.indicator = indicator;
      }

      /**
       * 切换到指定模式
       * @param {string} mode - 目标模式（使用 MODE 常量）
       */
      switchTo(mode) {
        this.current = mode;
        this.indicator.update(mode);
      }

      /**
       * 检查是否处于指定模式
       * @param {string} mode - 要检查的模式
       * @returns {boolean}
       */
      is(mode) {
        return this.current === mode;
      }

      /** @returns {boolean} 是否处于 INSERT 模式 */
      isInsert() {
        return this.current === this.MODE.INSERT;
      }

      /** @returns {boolean} 是否处于 HINT 模式 */
      isHint() {
        return this.current === this.MODE.HINT;
      }

      /** @returns {boolean} 是否处于 NORMAL 模式 */
      isNormal() {
        return this.current === this.MODE.NORMAL;
      }

      /** @returns {boolean} 是否处于 SEARCH 模式 */
      isSearch() {
        return this.current === this.MODE.SEARCH;
      }
    }

    // ==========================================
    // TabMessenger 类
    // ==========================================

    /**
     * 标签页消息发送器
     *
     * 通过 chrome.runtime.sendMessage 向 background.js 发送标签页操作请求。
     * 所有方法都是静态的，无需实例化。
     *
     * @note 如果 chrome.runtime 不可用（如扩展被卸载），返回失败响应而非抛出异常
     */
    class TabMessenger {
      /**
       * 发送标签页操作消息
       *
       * @param {string} action - 操作类型（nextTab/prevTab/closeCurrentTab/restoreLastTab）
       * @param {Object} [data={}] - 附加数据
       * @returns {Promise<{success: boolean, error?: string}>} 操作结果
       */
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
    // KeyMapper 类
    // ==========================================

    /**
     * 快捷键映射管理器
     *
     * 管理默认快捷键映射和用户自定义映射的合并。
     * 用户映射优先于默认映射，允许用户重新绑定任何命令。
     *
     * 映射格式：{ '按键': '命令名' }
     * 例如：{ 'j': 'scrollDown', 'gg': 'scrollToTop' }
     */
    class KeyMapper {
      constructor() {
        /** @type {Object<string, string>} 内置默认映射 */
        this.defaultMappings = {
          'j': 'scrollDown',
          'k': 'scrollUp',
          'h': 'scrollLeft',
          'l': 'scrollRight',
          'gg': 'scrollToTop',
          'G': 'scrollToBottom',
          'f': 'enterHintMode',
          ' ': 'clickAtCursor',
          'q': 'goBack',
          'Q': 'goBack',
          'x': 'closeTab',
          'X': 'restoreTab',
          'gt': 'nextTab',
          'gT': 'prevTab',
          '/': 'openSearch',
          'n': 'searchNext',
          'N': 'searchPrev',
          '*': 'searchWordUnderCursor',
          'B': 'openBookmarks',
          'H': 'openHistory',
          'gi': 'jumpToLastInput',
          'gI': 'jumpToFirstInput',
          ']]': 'jumpToNextLink',
          '[[': 'jumpToPrevLink'
        };
        /** @type {Object<string, string>} 用户自定义映射，优先于默认映射 */
        this.userMappings = {};
        this._init();
      }

      /**
       * 从存储加载用户映射，并监听变更
       * @private
       */
      async _init() {
        const items = await Utils.StorageManager.get(['keyMappings']);
        if (items.keyMappings && Object.keys(items.keyMappings).length > 0) {
          this.userMappings = items.keyMappings;
        }
        Utils.StorageManager.onChange((changes) => {
          if (changes.keyMappings) {
            this.userMappings = changes.keyMappings;
          }
        });
      }

      /**
       * 获取按键对应的命令名
       *
       * 优先查找用户映射，找不到则回退到默认映射。
       *
       * @param {string} key - 按键字符
       * @returns {string|undefined} 命令名，未找到返回 undefined
       */
      getAction(key) {
        return this.userMappings[key] || this.defaultMappings[key];
      }

      /**
       * 获取按键对应的命令名（与 getAction 相同，保留用于兼容）
       * @param {string} key - 按键字符
       * @returns {string|undefined} 命令名
       */
      getActionForKey(key) {
        const action = this.getAction(key);
        return action;
      }

      /**
       * 获取所有映射的合并结果（用户映射覆盖默认映射）
       * @returns {Object<string, string>} 合并后的映射
       */
      getAllMappings() {
        return { ...this.defaultMappings, ...this.userMappings };
      }

      /**
       * 获取用户自定义映射的副本
       * @returns {Object<string, string>} 用户映射
       */
      getUserMappings() {
        return { ...this.userMappings };
      }

      /**
       * 设置单个快捷键映射
       * @param {string} key - 按键字符
       * @param {string} action - 命令名
       */
      async setMapping(key, action) {
        this.userMappings[key] = action;
        await Utils.StorageManager.set({ keyMappings: this.userMappings });
      }

      /**
       * 删除单个用户快捷键映射（回退到默认）
       * @param {string} key - 要删除的按键
       */
      async removeMapping(key) {
        delete this.userMappings[key];
        await Utils.StorageManager.set({ keyMappings: this.userMappings });
      }

      /**
       * 重置所有用户映射为空（恢复全部默认）
       */
      async resetMappings() {
        this.userMappings = {};
        await Utils.StorageManager.set({ keyMappings: {} });
      }

      /**
       * 从外部对象导入映射（覆盖当前用户映射）
       *
       * @param {Object} mappings - 要导入的映射对象
       * @throws {Error} 如果映射格式无效
       */
      async importMappings(mappings) {
        if (!Utils.Validators.keyMappings(mappings)) {
          throw new Error('Invalid key mappings format');
        }
        this.userMappings = { ...mappings };
        await Utils.StorageManager.set({ keyMappings: this.userMappings });
      }
    }

    // ==========================================
    // 初始化实例
    // ==========================================

    /** @type {KeyBuffer} 按键缓冲区实例 */
    const keyBuffer = new KeyBuffer();
    /** @type {ScrollHandler} 滚动处理器实例 */
    const scrollHandler = new ScrollHandler();
    /** @type {Indicator} 模式指示器实例 */
    const indicator = new Indicator();
    /** @type {ModeManager} 模式管理器实例 */
    const modeManager = new ModeManager(indicator);
    /** @type {KeyMapper} 快捷键映射管理器实例 */
    const keyMapper = new KeyMapper();

    /** @type {number} 鼠标当前 X 坐标，用于 Space 点击功能 */
    let mouseX = window.innerWidth / 2;
    /** @type {number} 鼠标当前 Y 坐标，用于 Space 点击功能 */
    let mouseY = window.innerHeight / 2;

    // 追踪鼠标位置，用于 Space 键点击光标处元素
    document.addEventListener("mousemove", (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    }, { passive: true });

    // ==========================================
    // 辅助函数
    // ==========================================

    /**
     * 检查元素是否为可编辑元素
     *
     * 可编辑元素包括：input、textarea、select 以及 contentEditable 的元素。
     * 当焦点在可编辑元素上时，切换到 INSERT 模式，不拦截按键。
     *
     * @param {HTMLElement} [el] - 要检查的 DOM 元素
     * @returns {boolean} 是否为可编辑元素
     */
    function isEditable(el) {
      if (!el) return false;
      return el.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    }

    /**
     * 点击鼠标光标处的元素
     *
     * 使用 elementFromPoint 获取光标下的元素，
     * 如果该元素本身不可点击，尝试找到最近的可点击祖先元素。
     */
    function clickAtCursor() {
      const el = document.elementFromPoint(mouseX, mouseY);
      if (el) {
        const clickable = el.closest('a, button, input, [role="button"]') || el;
        clickable.focus();
        clickable.click();
      }
    }

    // ==========================================
    // 命令执行器
    // ==========================================

    /**
     * 命令名到执行函数的映射
     *
     * 每个命令函数执行对应操作，返回值含义：
     * - false（默认）：不清空按键缓冲区
     * - true：清空按键缓冲区（用于 G 等单键命令后不需要等待多键序列的情况）
     *
     * @type {Object<string, Function>}
     */
    const commandActions = {
      scrollDown: () => { scrollHandler.perform(1, 0); return false; },
      scrollUp: () => { scrollHandler.perform(-1, 0); return false; },
      scrollLeft: () => { scrollHandler.perform(0, -1); return false; },
      scrollRight: () => { scrollHandler.perform(0, 1); return false; },
      scrollToTop: () => { scrollHandler.toTop(); },
      scrollToBottom: () => { scrollHandler.toBottom(); return true; },
      enterHintMode: () => {
        modeManager.switchTo(modeManager.MODE.HINT);
        if (window.VimHint) window.VimHint.createHints();
        return false;
      },
      clickAtCursor: () => { clickAtCursor(); return false; },
      goBack: () => { window.history.back(); return false; },
      closeTab: () => { TabMessenger.send('closeCurrentTab'); return false; },
      restoreTab: () => { TabMessenger.send('restoreLastTab'); return false; },
      nextTab: () => { TabMessenger.send('nextTab'); },
      prevTab: () => { TabMessenger.send('prevTab'); },
      openSearch: () => {
        modeManager.switchTo(modeManager.MODE.SEARCH);
        if (window.VimSearch) window.VimSearch.open();
        return false;
      },
      searchNext: () => {
        if (window.VimSearch) window.VimSearch.next();
        return false;
      },
      searchPrev: () => {
        if (window.VimSearch) window.VimSearch.prev();
        return false;
      },
      searchWordUnderCursor: () => {
        if (window.VimSearch) window.VimSearch.searchWordUnderCursor();
        return false;
      },
      openBookmarks: () => {
        if (window.VimBookmarks) window.VimBookmarks.openBookmarks();
        return false;
      },
      openHistory: () => {
        if (window.VimBookmarks) window.VimBookmarks.openHistory();
        return false;
      },
      jumpToLastInput: () => {
        if (window.VimJumper) window.VimJumper.jumpToLastInput();
        return false;
      },
      jumpToFirstInput: () => {
        if (window.VimJumper) window.VimJumper.jumpToFirstInput();
        return false;
      },
      jumpToNextLink: () => {
        if (window.VimJumper) window.VimJumper.jumpToNextLink();
        return false;
      },
      jumpToPrevLink: () => {
        if (window.VimJumper) window.VimJumper.jumpToPrevLink();
        return false;
      }
    };

    // ==========================================
    // 核心按键处理
    // ==========================================

    /**
     * 处理 Vim 风格的按键事件
     *
     * 按键处理优先级：
     * 1. Escape：退出当前模式
     * 2. HINT 模式：将按键传递给 Hint 系统
     * 3. SEARCH 模式：不拦截，由搜索框自行处理
     * 4. INSERT 模式：不拦截，让浏览器原生处理
     * 5. NORMAL 模式：
     *    a. 先尝试匹配单键命令
     *    b. 再追加到缓冲区，尝试匹配多键命令
     *
     * @param {KeyboardEvent} e - 键盘事件
     */
    function handleVimKey(e) {
      const key = e.key;

      // Escape 键：退出当前模式
      if (key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();

        if (modeManager.isHint()) {
          if (window.VimHint) window.VimHint.removeHints();
          modeManager.switchTo(modeManager.MODE.NORMAL);
        } else if (modeManager.isSearch()) {
          if (window.VimSearch) window.VimSearch.close();
          modeManager.switchTo(modeManager.MODE.NORMAL);
        } else if (window.VimBookmarks && window.VimBookmarks.isActive) {
          window.VimBookmarks.close();
        } else if (modeManager.isInsert()) {
          if (document.activeElement) document.activeElement.blur();
          modeManager.switchTo(modeManager.MODE.NORMAL);
        } else {
          keyBuffer.reset();
        }
        return;
      }

      // HINT 模式：将单字符按键传递给 Hint 系统处理
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

      // SEARCH 模式：不拦截，由搜索框的 keydown 监听器处理
      if (modeManager.isSearch()) {
        return;
      }

      // INSERT 模式：不拦截任何按键
      if (modeManager.isInsert()) {
        return;
      }

      // NORMAL 模式：先尝试单键命令
      const action = keyMapper.getActionForKey(key);
      if (action && commandActions[action]) {
        e.preventDefault();
        const result = commandActions[action]();
        if (result === true) keyBuffer.reset();
        return;
      }

      // 追加到缓冲区，尝试匹配多键命令（如 gg、gt）
      keyBuffer.push(key);

      const multiAction = keyMapper.getActionForKey(keyBuffer.value);
      if (multiAction && commandActions[multiAction]) {
        e.preventDefault();
        commandActions[multiAction]();
        keyBuffer.reset();
        return;
      }
    }

    // ==========================================
    // 模式自动切换
    // ==========================================

    /**
     * 焦点事件监听：当焦点进入可编辑元素时，自动切换到 INSERT 模式
     * 使用捕获阶段（true）确保在其他事件处理器之前执行
     */
    document.addEventListener('focus', (e) => {
      if (isEditable(e.target)) {
        modeManager.switchTo(modeManager.MODE.INSERT);
        if (window.VimJumper) window.VimJumper.recordLastInput(e.target);
      }
    }, true);

    /**
     * 失焦事件监听：当焦点离开可编辑元素时，自动切换回 NORMAL 模式
     * 使用 10ms 延迟避免焦点切换过程中的闪烁
     */
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

    /**
     * 全局键盘事件处理器
     *
     * 使用捕获阶段（true）确保在其他事件处理器之前拦截按键。
     *
     * 处理逻辑：
     * 1. INSERT 模式下只拦截 Escape
     * 2. Ctrl+d/u 执行半页滚动
     * 3. 忽略带有 Meta/Ctrl/Alt 修饰键的按键（避免干扰浏览器快捷键）
     * 4. 其他按键交给 handleVimKey 处理
     */
    document.addEventListener("keydown", (e) => {
      if (modeManager.isInsert() && e.key !== 'Escape') return;

      // Ctrl+d：向下半页，Ctrl+u：向上半页
      if (e.ctrlKey && (e.key === 'd' || e.key === 'u')) {
        e.preventDefault();
        if (e.key === 'd') {
          scrollHandler.byRatio(0.5, 0);
        } else {
          scrollHandler.byRatio(-0.5, 0);
        }
        return;
      }

      // 忽略带有修饰键的按键，避免与浏览器快捷键冲突
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      handleVimKey(e);
    }, true);

  } // end of initVimWeb

})();
