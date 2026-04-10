/**
 * Search System for Vim Web
 *
 * 实现页面内文本搜索与导航功能，类似 Vim 的 / 搜索。
 *
 * 快捷键：
 * - / ：打开搜索框
 * - n ：跳转到下一个匹配项
 * - N ：跳转到上一个匹配项
 * - * ：搜索当前选中的文本
 * - Esc：关闭搜索
 * - Enter：跳转到下一个匹配项
 * - Shift+Enter：跳转到上一个匹配项
 *
 * 搜索流程：
 * 1. 用户按 / → open() 创建搜索 UI
 * 2. 输入关键词 → search() 执行搜索
 * 3. TreeWalker 遍历文本节点 → _findMatches() 记录匹配位置
 * 4. 使用 <mark> 元素高亮匹配项 → _highlightMatches()
 * 5. n/N 跳转 → next()/prev() 滚动到对应位置
 * 6. Esc → close() 清理所有高亮和 UI
 *
 * 性能保护：
 * - 搜索输入使用 200ms 防抖
 * - 匹配项超过 500 个时跳过高亮
 * - 高亮时按文档顺序排序 Range，避免 DOM 操作冲突
 *
 * 依赖：window.VimWebUtils（DOMSafe、debounce）
 */
const VimSearch = {
  /** @type {HTMLInputElement|null} 搜索输入框 */
  searchBox: null,
  /** @type {HTMLElement|null} 搜索容器（包含输入框和按钮） */
  searchContainer: null,
  /** @type {HTMLElement|null} 搜索遮罩层 */
  overlay: null,
  /** @type {Array<{textNode: Text, offset: number, length: number}>} 匹配结果列表 */
  matches: [],
  /** @type {number} 当前高亮的匹配项索引，-1 表示无选中 */
  currentMatchIndex: -1,
  /** @type {string} 当前搜索关键词 */
  keyword: '',
  /** @type {boolean} 搜索是否激活 */
  isActive: false,

  /**
   * 打开搜索界面
   *
   * 如果搜索已激活，仅聚焦输入框。
   * 否则创建搜索 UI 并聚焦输入框。
   */
  open() {
    if (this.isActive) {
      if (this.searchBox) this.searchBox.focus();
      return;
    }
    this.isActive = true;
    this._createSearchUI();
  },

  /**
   * 关闭搜索界面
   *
   * 清除所有高亮、移除搜索 UI、重置状态。
   */
  close() {
    this.isActive = false;
    this._clearHighlights();
    this._removeSearchUI();
    this.matches = [];
    this.currentMatchIndex = -1;
    this.keyword = '';
  },

  /**
   * 执行搜索
   *
   * 1. 清除之前的高亮
   * 2. 使用 TreeWalker 查找所有匹配的文本节点
   * 3. 高亮匹配项（不超过 500 个）
   * 4. 滚动到第一个匹配项
   *
   * @param {string} keyword - 搜索关键词（不区分大小写）
   */
  search(keyword) {
    this._clearHighlights();
    this.keyword = keyword;

    if (!keyword || keyword.length === 0) {
      this.matches = [];
      this.currentMatchIndex = -1;
      this._updateCountDisplay();
      return;
    }

    this._findMatches(keyword);
    this._highlightMatches(keyword);

    if (this.matches.length > 0) {
      this.currentMatchIndex = 0;
      this._scrollToMatch(0);
    } else {
      this.currentMatchIndex = -1;
    }

    this._updateCountDisplay();
  },

  /**
   * 跳转到下一个匹配项
   *
   * 循环跳转：到达末尾后回到第一个匹配项。
   */
  next() {
    if (this.matches.length === 0) return;

    this.currentMatchIndex = (this.currentMatchIndex + 1) % this.matches.length;
    this._scrollToMatch(this.currentMatchIndex);
    this._updateCountDisplay();
  },

  /**
   * 跳转到上一个匹配项
   *
   * 循环跳转：到达开头后回到最后一个匹配项。
   */
  prev() {
    if (this.matches.length === 0) return;

    this.currentMatchIndex = (this.currentMatchIndex - 1 + this.matches.length) % this.matches.length;
    this._scrollToMatch(this.currentMatchIndex);
    this._updateCountDisplay();
  },

  /**
   * 搜索当前选中的文本
   *
   * 获取 window.getSelection() 的文本，
   * 打开搜索框并自动搜索该文本。
   */
  searchWordUnderCursor() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const word = selection.toString().trim();
    if (word) {
      this.open();
      this.searchBox.value = word;
      this.search(word);
    }
  },

  /**
   * 创建搜索 UI
   *
   * 包含：搜索输入框、匹配计数、上/下/关闭按钮。
   * 输入事件使用 200ms 防抖，避免频繁搜索。
   * @private
   */
  _createSearchUI() {
    const Utils = window.VimWebUtils;

    this.overlay = Utils.DOMSafe.createElement('div', 'vim-web-search-overlay');
    this.searchContainer = Utils.DOMSafe.createElement('div', 'vim-web-search-container');

    this.searchBox = document.createElement('input');
    this.searchBox.className = 'vim-web-search-input';
    this.searchBox.type = 'text';
    this.searchBox.placeholder = '搜索...';
    this.searchBox.setAttribute('autocomplete', 'off');
    this.searchBox.setAttribute('spellcheck', 'false');

    const countDisplay = Utils.DOMSafe.createElement('span', 'vim-web-search-count', '');
    countDisplay.id = 'vim-web-search-count';

    const prevBtn = Utils.DOMSafe.createElement('button', 'vim-web-search-btn', '▲');
    prevBtn.title = '上一个 (N)';
    prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.prev();
    });

    const nextBtn = Utils.DOMSafe.createElement('button', 'vim-web-search-btn', '▼');
    nextBtn.title = '下一个 (n)';
    nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.next();
    });

    const closeBtn = Utils.DOMSafe.createElement('button', 'vim-web-search-btn vim-web-search-close', '✕');
    closeBtn.title = '关闭 (Esc)';
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.close();
    });

    this.searchContainer.appendChild(this.searchBox);
    this.searchContainer.appendChild(countDisplay);
    this.searchContainer.appendChild(prevBtn);
    this.searchContainer.appendChild(nextBtn);
    this.searchContainer.appendChild(closeBtn);

    document.body.appendChild(this.overlay);
    document.body.appendChild(this.searchContainer);

    // 输入防抖：200ms 内只执行最后一次搜索
    this.searchBox.addEventListener('input', Utils.debounce(() => {
      this.search(this.searchBox.value);
    }, 200));

    // 搜索框内的键盘事件
    this.searchBox.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this.prev();
        } else {
          this.next();
        }
      }
    });

    this.searchBox.focus();
  },

  /**
   * 移除搜索 UI 元素
   * @private
   */
  _removeSearchUI() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    if (this.searchContainer) {
      this.searchContainer.remove();
      this.searchContainer = null;
    }
    this.searchBox = null;
  },

  /**
   * 使用 TreeWalker 查找所有匹配的文本节点
   *
   * 遍历 document.body 中的所有文本节点，跳过：
   * - Vim Web 自身的 UI 元素（class 以 'vim-web-' 开头）
   * - 搜索容器内的文本
   * - script 和 style 标签内的文本
   * - 空白文本节点
   *
   * @param {string} keyword - 搜索关键词
   * @note 搜索不区分大小写
   * @private
   */
  _findMatches(keyword) {
    this.matches = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node.parentElement) return NodeFilter.FILTER_REJECT;
          const className = node.parentElement.className || '';
          if (className.startsWith('vim-web-')) return NodeFilter.FILTER_REJECT;
          if (node.parentElement.closest('.vim-web-search-container')) return NodeFilter.FILTER_REJECT;
          if (node.parentElement.tagName === 'SCRIPT' || node.parentElement.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
          if (node.textContent.trim().length === 0) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const keywordLower = keyword.toLowerCase();

    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const text = textNode.textContent.toLowerCase();
      let pos = 0;

      while ((pos = text.indexOf(keywordLower, pos)) !== -1) {
        this.matches.push({
          textNode,
          offset: pos,
          length: keyword.length
        });
        pos += keyword.length;
      }
    }
  },

  /**
   * 高亮所有匹配项
   *
   * 为每个匹配创建 Range 并用 <mark> 元素包裹。
   * 超过 500 个匹配项时跳过高亮以保护性能。
   *
   * @param {string} keyword - 搜索关键词（用于确定高亮长度）
   * @note Range 必须按文档顺序排序后处理，
   *       否则前面的 surroundContents 会影响后面 Range 的偏移量。
   * @private
   */
  _highlightMatches(keyword) {
    if (this.matches.length === 0) return;
    if (this.matches.length > 500) return;

    const ranges = [];

    for (const match of this.matches) {
      try {
        const range = document.createRange();
        range.setStart(match.textNode, match.offset);
        range.setEnd(match.textNode, match.offset + match.length);
        ranges.push(range);
      } catch (e) {
        continue;
      }
    }

    // 按文档顺序排序，确保 surroundContents 不互相干扰
    ranges.sort((a, b) => {
      const posA = a.startContainer.compareDocumentPosition(b.startContainer);
      if (posA & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (posA & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return a.startOffset - b.startOffset;
    });

    for (const range of ranges) {
      try {
        const mark = document.createElement('mark');
        mark.className = 'vim-web-search-highlight';
        range.surroundContents(mark);
      } catch (e) {
        // 跨元素边界的 Range 无法用 surroundContents 包裹
        continue;
      }
    }

    this._highlightElements = document.querySelectorAll('.vim-web-search-highlight');
  },

  /**
   * 清除所有搜索高亮
   *
   * 将 <mark> 元素的子文本节点提取出来，
   * 移除 <mark> 标签，然后调用 normalize() 合并相邻文本节点。
   * @private
   */
  _clearHighlights() {
    const highlights = document.querySelectorAll('.vim-web-search-highlight');
    highlights.forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
        parent.normalize();
      }
    });
    this._highlightElements = null;
  },

  /**
   * 滚动到指定索引的匹配项
   *
   * 移除所有匹配项的 'current' 类，
   * 为目标匹配项添加 'current' 类并滚动到可见区域。
   *
   * @param {number} index - 目标匹配项索引
   * @private
   */
  _scrollToMatch(index) {
    const highlights = this._highlightElements || document.querySelectorAll('.vim-web-search-highlight');
    if (!highlights || highlights.length === 0 || index < 0 || index >= highlights.length) return;

    highlights.forEach(h => h.classList.remove('current'));
    highlights[index].classList.add('current');
    highlights[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  /**
   * 更新搜索计数显示
   *
   * 显示格式：当前位置/总数（如 "3/15"）
   * 无匹配时显示"无匹配"，无关键词时为空。
   * @private
   */
  _updateCountDisplay() {
    const countEl = document.getElementById('vim-web-search-count');
    if (!countEl) return;

    if (this.matches.length === 0) {
      countEl.textContent = this.keyword ? '无匹配' : '';
    } else {
      countEl.textContent = `${this.currentMatchIndex + 1}/${this.matches.length}`;
    }
  }
};

window.VimSearch = VimSearch;
