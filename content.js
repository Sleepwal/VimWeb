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

    // 计算水平滚动 (暂时保持固定 15% 比例，或复用配置)
    if (dirX !== 0) {
      left = window.innerWidth * 0.15 * dirX;
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
   * 处理 Vim 风格的按键逻辑
   * 
   * @param {KeyboardEvent} e - 键盘事件对象
   */
  function handleVimKey(e) {
    const key = e.key;

    // --- 单键导航指令 ---

    // Space: 点击当前光标位置
    if (key === " ") {
      e.preventDefault();
      clickAtCursor();
      return;
    }

    // Q: 返回上一页 (Shift + q 或 q)
    if (key === "Q" || key === "q") {
      e.preventDefault();
      window.history.back();
      return;
    }

    // j: 向下滚动
    if (key === "j") {
      e.preventDefault(); // 阻止浏览器默认滚动（如果有）或其他行为
      performScroll(1, 0);
      return;
    }

    // k: 向上滚动
    if (key === "k") {
      e.preventDefault();
      performScroll(-1, 0);
      return;
    }

    // h: 向左滚动
    if (key === "h") {
      e.preventDefault();
      performScroll(0, -1);
      return;
    }

    // l: 向右滚动
    if (key === "l") {
      e.preventDefault();
      performScroll(0, 1);
      return;
    }

    // --- 组合键/特殊指令 ---

    // G: 直接到底部 (Shift + g)
    if (key === "G") {
      e.preventDefault();
      scrollToBottom();
      resetBuffer();
      return;
    }

    // 将按键加入缓冲区以检测多键命令 (如 'gg')
    pushKey(key);

    // gg: 回到顶部
    if (keyBuffer === "gg") {
      e.preventDefault();
      scrollToTop();
      resetBuffer(); // 命令执行成功，清空缓冲
      return;
    }
  }

  /**
   * 全局键盘事件监听
   * 使用 capture: true (捕获阶段) 以确保优先处理，
   * 防止被页面上的其他事件监听器阻止 (stopImmediatePropagation)。
   */
  document.addEventListener("keydown", (e) => {
    // 1. 如果焦点在输入框内，不拦截，允许用户正常打字
    if (isEditable(e.target)) return;
    
    // 2. 如果按下了组合功能键 (Ctrl/Alt/Meta)，通常是浏览器快捷键，放行
    // 注意：Shift 键不在此列，因为 'G' 需要 Shift
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // 3. 进入 Vim 处理逻辑
    handleVimKey(e);
  }, true); // true = 捕获阶段监听

})();


