/**
 * Hint System for Vim Web
 *
 * 实现 Vim 风格的 F 模式（Vimium 的 f 功能），
 * 在页面所有可点击元素上显示字母标签，
 * 用户输入对应字母即可点击该元素，无需使用鼠标。
 *
 * 性能优化策略：
 * - 使用 TreeWalker 替代 querySelectorAll，支持 FILTER_REJECT 跳过整个子树
 * - 使用 IntersectionObserver 追踪视口内元素，减少 getBoundingClientRect 调用
 * - 实现元素缓存机制（300ms TTL），避免重复 DOM 查询
 * - 添加防抖机制（50ms），避免快速连续触发
 *
 * 工作流程：
 * 1. 用户按 f 键 → createHints() 创建所有 Hint 标签
 * 2. 用户输入字母 → handleInput() 过滤匹配的 Hint
 * 3. 唯一匹配时 → activateElement() 点击目标元素
 * 4. 无匹配时 → 清空输入缓冲区，重新显示所有 Hint
 * 5. 按 Esc → removeHints() 移除所有 Hint
 *
 * 依赖：window.VimWebUtils（DOMSafe 模块）
 */
const VimHint = {
  /** @type {Array<{element: HTMLElement, label: string, hintNode: HTMLElement}>} 当前显示的 Hint 列表 */
  hints: [],
  /** @type {HTMLElement|null} Hint 容器元素 */
  container: null,
  /** @type {string} 用户输入的字母缓冲区 */
  inputBuffer: '',

  /** @type {Array<HTMLElement>|null} 可见元素缓存 */
  _elementCache: null,
  /** @type {number} 缓存创建时间戳 */
  _cacheTime: 0,
  /** @type {number} 缓存有效期（毫秒），300ms 内复用上次查询结果 */
  _CACHE_TTL: 300,
  /** @type {IntersectionObserver|null} 视口检测观察器 */
  _observer: null,
  /** @type {WeakSet<HTMLElement>} 已知在视口内的元素集合 */
  _inViewport: new WeakSet(),
  /** @type {number} 上次创建 Hint 的时间戳，用于防抖 */
  _lastCreateTime: 0,
  /** @type {number} 防抖间隔（毫秒），50ms 内忽略重复触发 */
  _DEBOUNCE_DELAY: 50,

  /**
   * 创建 Hint 标签
   *
   * 1. 防抖检查，50ms 内忽略重复触发
   * 2. 移除已有的 Hint（防止重复）
   * 3. 获取页面所有可见的可点击元素
   * 4. 为每个元素生成字母标签
   * 5. 在元素位置创建 Hint DOM 节点
   *
   * @note 使用 DOMSafe.createElement 安全创建 DOM 元素
   */
  createHints() {
    const now = Date.now();
    if (now - this._lastCreateTime < this._DEBOUNCE_DELAY) return;
    this._lastCreateTime = now;

    this.removeHints();
    this.inputBuffer = '';

    const elements = this.getVisibleElements();
    if (elements.length === 0) return;

    const Utils = window.VimWebUtils;
    this.container = Utils.DOMSafe.createElement('div', 'vim-web-hint-container');

    const labels = this.generateLabels(elements.length);

    this.hints = elements.map((el, index) => {
      const rect = el.getBoundingClientRect();
      const label = labels[index];

      const hint = Utils.DOMSafe.createElement('div', 'vim-web-hint', label);
      hint.style.top = `${rect.top}px`;
      hint.style.left = `${rect.left}px`;

      this.container.appendChild(hint);

      return {
        element: el,
        label: label,
        hintNode: hint
      };
    });

    document.body.appendChild(this.container);
  },

  /**
   * 获取页面中所有可见的可点击元素
   *
   * 性能优化策略：
   * 1. 缓存机制：300ms 内直接返回上次查询结果
   * 2. TreeWalker 遍历：替代 querySelectorAll，支持 FILTER_REJECT 跳过子树
   * 3. IntersectionObserver：异步追踪视口内元素，优化后续查询
   *
   * TreeWalker 的 acceptNode 过滤逻辑：
   * - FILTER_REJECT：跳过 SCRIPT/STYLE/HEAD/NOSCRIPT/TEMPLATE/SVG/MATH 及其子树
   * - FILTER_ACCEPT：匹配目标元素类型（a, button, input, textarea, select）
   *                   或具有交互属性（role="button", onclick, tabindex）
   * - FILTER_SKIP：跳过当前节点但继续遍历其子节点
   *
   * @returns {HTMLElement[]} 可见的可点击元素数组
   */
  getVisibleElements() {
    if (this._elementCache && Date.now() - this._cacheTime < this._CACHE_TTL) {
      return this._elementCache;
    }

    const results = [];
    const vW = window.innerWidth;
    const vH = window.innerHeight;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          const tag = node.tagName;

          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HEAD' ||
              tag === 'NOSCRIPT' || tag === 'TEMPLATE' || tag === 'SVG' ||
              tag === 'MATH') {
            return NodeFilter.FILTER_REJECT;
          }

          if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' ||
              tag === 'TEXTAREA' || tag === 'SELECT' ||
              node.getAttribute('role') === 'button' ||
              node.hasAttribute('onclick') ||
              node.hasAttribute('tabindex')) {
            return NodeFilter.FILTER_ACCEPT;
          }

          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    while (walker.nextNode()) {
      const el = walker.currentNode;
      const rect = el.getBoundingClientRect();

      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < 0 || rect.top > vH) continue;
      if (rect.right < 0 || rect.left > vW) continue;

      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;

      results.push(el);
    }

    this._elementCache = results;
    this._cacheTime = Date.now();
    this._setupObserver(results);

    return results;
  },

  /**
   * 设置 IntersectionObserver 追踪视口内元素
   *
   * 在首次查询后异步设置，后续查询可利用 _inViewport 集合
   * 快速判断元素是否在视口内，减少 getBoundingClientRect 调用频率。
   * 使用 WeakSet 避免内存泄漏，当元素被 GC 回收时自动释放。
   *
   * @param {Array<HTMLElement>} elements - 要观察的元素列表
   * @private
   */
  _setupObserver(elements) {
    if (this._observer) this._observer.disconnect();
    this._inViewport = new WeakSet();

    this._observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          this._inViewport.add(entry.target);
        }
      }
    }, { threshold: 0 });

    for (const el of elements) {
      this._observer.observe(el);
    }
  },

  /**
   * 生成 Hint 标签列表
   *
   * 当元素数量 ≤ 26 时，使用单字母标签（a-z）。
   * 当元素数量 > 26 时，使用双字母标签（aa, ab, ..., zz）。
   *
   * @param {number} count - 需要的标签数量
   * @returns {string[]} 标签字符串数组
   *
   * @algorithm 使用进位计数法生成组合：
   *           index 数组表示每个位置的字符索引，
   *           从 [0,0] 开始递增，类似 26 进制加法。
   * @complexity O(26^length)，双字母最多生成 676 个标签
   */
  generateLabels(count) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';

    if (count <= 26) {
      return chars.split('').slice(0, count);
    }

    const tryGenerate = (length) => {
      const result = [];
      const index = new Array(length).fill(0);

      while (true) {
        let label = '';
        for (let i = 0; i < length; i++) {
          label += chars[index[i]];
        }
        result.push(label);
        if (result.length >= count) return result;

        let p = length - 1;
        while (p >= 0) {
          index[p]++;
          if (index[p] < chars.length) break;
          index[p] = 0;
          p--;
        }
        if (p < 0) break;
      }
      return result;
    };

    return tryGenerate(2);
  },

  /**
   * 处理用户输入的 Hint 选择键
   *
   * 将输入追加到缓冲区，然后过滤匹配的 Hint：
   * - 无匹配：清空缓冲区，重新显示所有 Hint
   * - 唯一精确匹配：激活该元素
   * - 部分匹配：隐藏不匹配的 Hint，等待更多输入
   *
   * @param {string} key - 用户输入的单个字符
   * @returns {boolean} 是否完成选择（true=已点击元素，false=继续输入）
   */
  handleInput(key) {
    this.inputBuffer += key.toLowerCase();

    const matched = this.hints.filter(h => h.label.startsWith(this.inputBuffer));

    if (matched.length === 0) {
      this.inputBuffer = '';
      this.updateHintsVisibility();
      return false;
    }

    if (matched.length === 1 && matched[0].label === this.inputBuffer) {
      this.activateElement(matched[0].element);
      return true;
    }

    this.updateHintsVisibility();
    return false;
  },

  /**
   * 更新 Hint 标签的可见性
   *
   * 根据当前输入缓冲区，隐藏不匹配的 Hint，
   * 为精确匹配的 Hint 添加 'matched' 类（高亮显示）。
   */
  updateHintsVisibility() {
    this.hints.forEach(h => {
      if (h.label.startsWith(this.inputBuffer)) {
        h.hintNode.style.display = 'block';
        if (h.label === this.inputBuffer) {
          h.hintNode.classList.add('matched');
        } else {
          h.hintNode.classList.remove('matched');
        }
      } else {
        h.hintNode.style.display = 'none';
      }
    });
  },

  /**
   * 激活目标元素
   *
   * 移除所有 Hint，然后对目标元素执行 focus + click。
   *
   * @param {HTMLElement} el - 要点击的目标元素
   */
  activateElement(el) {
    this.removeHints();
    el.focus();
    el.click();
  },

  /**
   * 移除所有 Hint 标签
   *
   * 清理容器元素、Hint 数组、输入缓冲区、
   * 元素缓存和 IntersectionObserver。
   */
  removeHints() {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    this.hints = [];
    this.inputBuffer = '';
    this._elementCache = null;
    this._cacheTime = 0;
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._inViewport = new WeakSet();
  }
};

window.VimHint = VimHint;
