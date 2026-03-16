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
  console.log("[Vim Web] Loaded");

  // ==========================================
  // 黑名单检查
  // ==========================================

  /**
   * 检查域名是否匹配黑名单规则
   * @param {string} hostname - 当前域名
   * @param {string} pattern - 黑名单规则（支持通配符 *）
   * @returns {boolean}
   */
  function matchBlacklist(hostname, pattern) {
    pattern = pattern.trim();
    if (!pattern) return false;

    // 转换为正则表达式
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*');

    const regex = new RegExp('^' + regexPattern + '$', 'i');
    return regex.test(hostname);
  }

  /**
   * 检查当前页面是否在黑名单中
   * @param {string} blacklist - 黑名单文本（每行一个规则）
   * @returns {boolean}
   */
  function isBlacklisted(blacklist) {
    if (!blacklist) return false;
    const hostname = window.location.hostname;
    const patterns = blacklist.split('\n');
    return patterns.some(pattern => matchBlacklist(hostname, pattern));
  }

  // 检查黑名单并决定是否启用插件
  if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(['blacklist'], (items) => {
      if (isBlacklisted(items.blacklist)) {
        console.log('[Vim Web] Disabled on blacklisted domain:', window.location.hostname);
        return;
      }
      initVimWeb();
    });
  } else {
    initVimWeb();
  }

  /**
   * 初始化 Vim Web 插件
   */
  function initVimWeb() {
  console.log('[Vim Web] Initialized on', window.location.hostname);

  // ==========================================
  // 状态管理
  // ==========================================
  
  /** @type {string} 按键缓冲区，用于存储组合键序列（如 "gg"） */
  let keyBuffer = "";
  
  /** @type {number} 缓冲区超时时间 (ms)，超过此时间未输入新键则清空缓冲区 */
  const BUFFER_TIMEOUT = 400;
  
  /** @type {number|null} 定时器 ID */
  let bufferTimer = null;

  /** @type {number} 鼠标 X 坐标 */
  let mouseX = window.innerWidth / 2;

  /** @type {number} 鼠标 Y 坐标 */
  let mouseY = window.innerHeight / 2;

  /** @type {object} 滚动配置 */
  let scrollSettings = { value: 15, unit: '%' };

  // ==========================================
  // 模式管理
  // ==========================================
  const MODE = {
    NORMAL: 'NORMAL',
    HINT: 'HINT',
    INSERT: 'INSERT'
  };

  let currentMode = MODE.NORMAL;

  // ==========================================
  // 模式指示器
  // ==========================================
  let indicatorEl = null;
  let indicatorTimer = null;

  /**
   * 创建或更新模式指示器
   * @param {string} mode - 当前模式
   */
  function updateIndicator(mode) {
    if (!indicatorEl) {
      indicatorEl = document.createElement('div');
      indicatorEl.className = 'vim-web-indicator';
      document.body.appendChild(indicatorEl);
    }

    // 清除之前的定时器
    if (indicatorTimer) {
      clearTimeout(indicatorTimer);
    }

    // 更新文本和样式
    const modeNames = {
      [MODE.NORMAL]: 'NORMAL',
      [MODE.INSERT]: 'INSERT',
      [MODE.HINT]: 'HINT'
    };

    indicatorEl.textContent = modeNames[mode] || mode;
    indicatorEl.className = `vim-web-indicator mode-${mode.toLowerCase()} show`;

    // 3秒后淡出
    indicatorTimer = setTimeout(() => {
      if (indicatorEl) {
        indicatorEl.classList.remove('show');
      }
    }, 3000);
  }

  // 初始化设置
  if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(['scrollStep'], (items) => {
      if (items.scrollStep) {
        scrollSettings = items.scrollStep;
      }
    });

    // 监听设置变更
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.scrollStep) {
        scrollSettings = changes.scrollStep.newValue;
      }
    });
  }

  // 跟踪鼠标位置
  document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }, { passive: true });

  // ==========================================
  // 辅助函数
  // ==========================================

  /**
   * 判断当前焦点元素是否为可编辑区域
   * 用于防止在输入框打字时触发 Vim 快捷键
   * 
   * @param {Element} el - 触发事件的 DOM 元素
   * @returns {boolean} - 如果是输入框或可编辑区域返回 true
   */
  function isEditable(el) {
    if (!el) return false;
    // 检查 contenteditable 属性或标签名
    return el.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
  }

  /**
   * 执行滚动操作
   * 支持百分比或像素单位
   * 
   * @param {number} dirY - 垂直方向 (1: 下, -1: 上, 0: 无)
   * @param {number} dirX - 水平方向 (1: 右, -1: 左, 0: 无)
   */
  function performScroll(dirY = 0, dirX = 0) {
    let top = 0;
    let left = 0;

    // 计算垂直滚动
    if (dirY !== 0) {
      if (scrollSettings.unit === '%') {
        top = window.innerHeight * (scrollSettings.value / 100) * dirY;
      } else {
        top = scrollSettings.value * dirY;
      }
    }

    // 计算水平滚动 (复用 scrollSettings 配置)
    if (dirX !== 0) {
      if (scrollSettings.unit === '%') {
        left = window.innerWidth * (scrollSettings.value / 100) * dirX;
      } else {
        left = scrollSettings.value * dirX;
      }
    }

    window.scrollBy({ top, left, behavior: "smooth" });
  }

  /**
   * 按屏幕比例滚动页面
   * 比固定像素滚动更符合直觉，能适应不同高度的显示器
   * 
   * @param {number} ratioY - 垂直滚动比例 (负数向上，正数向下)
   * @param {number} ratioX - 水平滚动比例 (负数向左，正数向右)
   */
  function scrollByRatio(ratioY = 0, ratioX = 0) {
    const h = window.innerHeight;
    const w = window.innerWidth;
    window.scrollBy({
      top: h * ratioY,
      left: w * ratioX,
      behavior: "smooth" // 平滑滚动
    });
  }

  /**
   * 滚动到页面顶部 (对应 'gg')
   */
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /**
   * 滚动到页面底部 (对应 'G')
   */
  function scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  /**
   * 重置按键缓冲区
   * 当命令执行完成或超时后调用
   */
  function resetBuffer() {
    keyBuffer = "";
    if (bufferTimer) {
      clearTimeout(bufferTimer);
      bufferTimer = null;
    }
  }

  /**
   * 将按键推入缓冲区
   * 并重置超时定时器
   * 
   * @param {string} key - 按下的键值
   */
  function pushKey(key) {
    keyBuffer += key;
    // 如果之前有定时器，清除它，重新开始计时
    if (bufferTimer) clearTimeout(bufferTimer);
    bufferTimer = setTimeout(resetBuffer, BUFFER_TIMEOUT);
  }

  // ==========================================
  // 核心逻辑
  // ==========================================

  /**
   * 模拟鼠标点击当前光标所在位置的元素
   * 对应 Space 键
   */
  function clickAtCursor() {
    // 获取光标位置最上层的元素
    const el = document.elementFromPoint(mouseX, mouseY);

    if (el) {
      // 尝试点击元素本身或其最近的可点击祖先
      const clickable = el.closest('a, button, input, [role="button"]') || el;

      clickable.focus();
      clickable.click();

      // 可选：添加视觉反馈
      // console.log("Clicked:", clickable);
    }
  }

  /**
   * Normal 模式单键命令映射表
   * 键: 执行函数 (返回 true 表示命令执行后需要清空缓冲区)
   */
  const normalKeyMap = {
    'f': () => {
      currentMode = MODE.HINT;
      updateIndicator(currentMode);
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
      performScroll(1, 0);
      return false;
    },
    'k': () => {
      performScroll(-1, 0);
      return false;
    },
    'h': () => {
      performScroll(0, -1);
      return false;
    },
    'l': () => {
      performScroll(0, 1);
      return false;
    },
    'G': () => {
      scrollToBottom();
      return true;
    }
  };

  /**
   * 多键命令处理函数映射表
   * 键: 执行函数
   */
  const multiKeyCommands = {
    'gg': () => {
      scrollToTop();
    }
  };

  /**
   * 处理 Vim 风格的按键逻辑
   *
   * @param {KeyboardEvent} e - 键盘事件对象
   */
  function handleVimKey(e) {
    const key = e.key;

    // --- ESC: 全局退出/复位 ---
    if (key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();

      if (currentMode === MODE.HINT) {
        if (window.VimHint) window.VimHint.removeHints();
        currentMode = MODE.NORMAL;
        updateIndicator(currentMode);
      } else if (currentMode === MODE.INSERT) {
        if (document.activeElement) document.activeElement.blur();
        currentMode = MODE.NORMAL;
        updateIndicator(currentMode);
      } else {
        // Normal 模式下清除缓冲区
        resetBuffer();
      }
      return;
    }

    // --- Hint 模式处理 ---
    if (currentMode === MODE.HINT) {
      e.preventDefault();
      e.stopPropagation();

      // 允许功能键 (如 Backspace 删除输入?)
      // 简单起见，只允许单字符输入
      if (key.length === 1) {
        const finished = window.VimHint.handleInput(key);
        if (finished) {
          currentMode = MODE.NORMAL;
          updateIndicator(currentMode);
        }
      }
      return;
    }

    // --- Insert 模式处理 ---
    if (currentMode === MODE.INSERT) {
      // 不拦截任何按键，除了上面的 ESC
      return;
    }

    // --- Normal 模式逻辑 ---

    // 首先尝试直接执行单键命令
    if (normalKeyMap[key]) {
      e.preventDefault();
      const shouldReset = normalKeyMap[key]();
      if (shouldReset) {
        resetBuffer();
      }
      return;
    }

    // 将按键加入缓冲区以检测多键命令
    pushKey(key);

    // 检查多键命令
    if (multiKeyCommands[keyBuffer]) {
      e.preventDefault();
      multiKeyCommands[keyBuffer]();
      resetBuffer();
      return;
    }
  }

  // 自动切换模式
  document.addEventListener('focus', (e) => {
    if (isEditable(e.target)) {
      currentMode = MODE.INSERT;
      updateIndicator(currentMode);
    }
  }, true);

  document.addEventListener('blur', (e) => {
    setTimeout(() => {
      if (!isEditable(document.activeElement)) {
        currentMode = MODE.NORMAL;
        updateIndicator(currentMode);
      }
    }, 10);
  }, true);

  /**
   * 全局键盘事件监听
   * 使用 capture: true (捕获阶段) 以确保优先处理，
   * 防止被页面上的其他事件监听器阻止 (stopImmediatePropagation)。
   */
  document.addEventListener("keydown", (e) => {
    // 1. 如果是 Insert 模式，且不是 ESC，直接返回
    if (currentMode === MODE.INSERT && e.key !== 'Escape') return;

    // 2. 特殊处理 Ctrl+d / Ctrl+u (半页滚动)
    if (e.ctrlKey && (e.key === 'd' || e.key === 'u')) {
      e.preventDefault();
      if (e.key === 'd') {
        scrollByRatio(0.5, 0); // 向下半页
      } else {
        scrollByRatio(-0.5, 0); // 向上半页
      }
      return;
    }

    // 3. 如果按下了其他组合功能键 (Ctrl/Alt/Meta)，通常是浏览器快捷键，放行
    // 注意：Shift 键不在此列，因为 'G' 需要 Shift
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // 4. 进入 Vim 处理逻辑
    handleVimKey(e);
  }, true); // true = 捕获阶段监听

  } // end of initVimWeb function

})();


