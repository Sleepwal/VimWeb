/**
 * Hint System for Vim Web
 *
 * 实现 Vim 风格的 F 模式（Vimium 的 f 功能），
 * 在页面所有可点击元素上显示字母标签，
 * 用户输入对应字母即可点击该元素，无需使用鼠标。
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

  /**
   * 创建 Hint 标签
   *
   * 1. 移除已有的 Hint（防止重复）
   * 2. 获取页面所有可见的可点击元素
   * 3. 为每个元素生成字母标签
   * 4. 在元素位置创建 Hint DOM 节点
   *
   * @note 使用 DOMSafe.createElement 安全创建 DOM 元素
   */
  createHints() {
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
   * 使用 querySelectorAll 查询匹配选择器的元素，
   * 然后过滤掉不可见（零尺寸、超出视口、隐藏）的元素。
   *
   * @returns {HTMLElement[]} 可见的可点击元素数组
   *
   * @note 选择器覆盖了常见的可交互元素：
   *       a, button, input, textarea, select,
   *       [role="button"], [onclick], [tabindex]
   */
  getVisibleElements() {
    const selector = 'a, button, input, textarea, select, [role="button"], [onclick], [tabindex]';
    const all = Array.from(document.querySelectorAll(selector));

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    return all.filter(el => {
      const rect = el.getBoundingClientRect();
      // 零尺寸元素不可见
      if (rect.width === 0 || rect.height === 0) return false;
      // 超出视口范围
      if (rect.bottom < 0 || rect.top > viewportHeight) return false;
      if (rect.right < 0 || rect.left > viewportWidth) return false;
      // CSS 隐藏
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;

      return true;
    });
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

        // 进位：从最低位开始递增，满 26 进位
        let p = length - 1;
        while (p >= 0) {
          index[p]++;
          if (index[p] < chars.length) break;
          index[p] = 0;
          p--;
        }
        if (p < 0) break; // 所有组合已用完
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
   * 清理容器元素、Hint 数组和输入缓冲区。
   * 在退出 Hint 模式或完成选择时调用。
   */
  removeHints() {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    this.hints = [];
    this.inputBuffer = '';
  }
};

window.VimHint = VimHint;
