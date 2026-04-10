/**
 * Bookmarks & History System for Vim Web
 *
 * 提供书签和历史记录的快速访问功能，类似 Vimium 的 B 和 H 命令。
 *
 * 快捷键：
 * - B：打开书签列表
 * - H：打开历史记录列表
 *
 * 两者共享相同的列表 UI，通过 chrome.bookmarks 和 chrome.history API 获取数据。
 * 列表支持：
 * - 搜索过滤（实时）
 * - 键盘导航（j/k 上下移动，Enter 打开，Esc 关闭）
 * - 显示 URL 和标题
 *
 * 依赖：window.VimWebUtils（DOMSafe、debounce）
 * 权限：chrome.bookmarks, chrome.history
 */
const VimBookmarks = {
  container: null,
  overlay: null,
  input: null,
  listEl: null,
  items: [],
  filteredItems: [],
  selectedIndex: 0,
  mode: 'bookmarks',
  isActive: false,

  /**
   * 打开书签列表
   */
  openBookmarks() {
    this.mode = 'bookmarks';
    this._open();
  },

  /**
   * 打开历史记录列表
   */
  openHistory() {
    this.mode = 'history';
    this._open();
  },

  /**
   * 通用打开逻辑
   *
   * 创建 UI，加载数据，显示列表。
   * @private
   */
  _open() {
    if (this.isActive) {
      this.close();
    }

    this.isActive = true;
    this.selectedIndex = 0;
    this._createUI();
    this._loadData();
  },

  /**
   * 关闭列表
   */
  close() {
    this.isActive = false;
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.items = [];
    this.filteredItems = [];
    this.input = null;
    this.listEl = null;
  },

  /**
   * 创建列表 UI
   *
   * 包含：标题、搜索输入框、列表容器。
   * @private
   */
  _createUI() {
    const Utils = window.VimWebUtils;

    this.overlay = Utils.DOMSafe.createElement('div', 'vim-web-list-overlay');
    this.overlay.addEventListener('click', () => this.close());

    this.container = Utils.DOMSafe.createElement('div', 'vim-web-list-container');

    const title = this.mode === 'bookmarks' ? '书签' : '历史记录';
    const header = Utils.DOMSafe.createElement('div', 'vim-web-list-header', title);

    this.input = document.createElement('input');
    this.input.className = 'vim-web-list-input';
    this.input.type = 'text';
    this.input.placeholder = '搜索...';
    this.input.setAttribute('autocomplete', 'off');
    this.input.setAttribute('spellcheck', 'false');

    this.listEl = Utils.DOMSafe.createElement('div', 'vim-web-list-items');

    this.container.appendChild(header);
    this.container.appendChild(this.input);
    this.container.appendChild(this.listEl);

    document.body.appendChild(this.overlay);
    document.body.appendChild(this.container);

    this.input.addEventListener('input', Utils.debounce(() => {
      this._filter(this.input.value);
    }, 150));

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        this._selectNext();
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        this._selectPrev();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this._openSelected();
      }
    });

    this.input.focus();
  },

  /**
   * 加载数据
   *
   * 根据当前模式调用对应的 Chrome API 获取数据。
   * @private
   */
  async _loadData() {
    try {
      if (this.mode === 'bookmarks') {
        this.items = await this._getBookmarks();
      } else {
        this.items = await this._getHistory();
      }
      this._filter('');
    } catch (error) {
      console.warn('[Vim Web] Failed to load', this.mode, error.message);
      this.items = [];
      this._filter('');
    }
  },

  /**
   * 获取所有书签（递归遍历书签树）
   * @returns {Array<{title: string, url: string}>} 书签列表
   * @private
   */
  async _getBookmarks() {
    if (!chrome.bookmarks) return [];

    const tree = await chrome.bookmarks.getTree();
    const results = [];

    function walk(nodes) {
      for (const node of nodes) {
        if (node.url) {
          results.push({ title: node.title || node.url, url: node.url });
        }
        if (node.children) {
          walk(node.children);
        }
      }
    }

    walk(tree);
    return results;
  },

  /**
   * 获取最近的历史记录
   * @returns {Array<{title: string, url: string}>} 历史记录列表
   * @private
   */
  async _getHistory() {
    if (!chrome.history) return [];

    const items = await chrome.history.search({
      text: '',
      maxResults: 200,
      startTime: Date.now() - 7 * 24 * 60 * 60 * 1000
    });

    return items.map(item => ({
      title: item.title || item.url,
      url: item.url
    }));
  },

  /**
   * 过滤列表项
   *
   * 根据搜索关键词过滤标题和 URL，然后渲染列表。
   *
   * @param {string} query - 搜索关键词（不区分大小写）
   * @private
   */
  _filter(query) {
    if (!query) {
      this.filteredItems = this.items.slice(0, 50);
    } else {
      const q = query.toLowerCase();
      this.filteredItems = this.items.filter(item =>
        item.title.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q)
      ).slice(0, 50);
    }

    this.selectedIndex = 0;
    this._renderList();
  },

  /**
   * 渲染列表项
   * @private
   */
  _renderList() {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';

    if (this.filteredItems.length === 0) {
      const empty = window.VimWebUtils.DOMSafe.createElement('div', 'vim-web-list-empty', '无结果');
      this.listEl.appendChild(empty);
      return;
    }

    this.filteredItems.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'vim-web-list-item' + (index === this.selectedIndex ? ' selected' : '');
      row.dataset.index = index;

      const title = document.createElement('span');
      title.className = 'vim-web-list-item-title';
      title.textContent = item.title;

      const url = document.createElement('span');
      url.className = 'vim-web-list-item-url';
      url.textContent = item.url;

      row.appendChild(title);
      row.appendChild(url);

      row.addEventListener('click', () => {
        this.selectedIndex = index;
        this._openSelected();
      });

      row.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this._updateSelection();
      });

      this.listEl.appendChild(row);
    });
  },

  /**
   * 选择下一项
   * @private
   */
  _selectNext() {
    if (this.filteredItems.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.filteredItems.length;
    this._updateSelection();
  },

  /**
   * 选择上一项
   * @private
   */
  _selectPrev() {
    if (this.filteredItems.length === 0) return;
    this.selectedIndex = (this.selectedIndex - 1 + this.filteredItems.length) % this.filteredItems.length;
    this._updateSelection();
  },

  /**
   * 更新选中项的视觉状态
   * @private
   */
  _updateSelection() {
    if (!this.listEl) return;
    const rows = this.listEl.querySelectorAll('.vim-web-list-item');
    rows.forEach((row, i) => {
      row.classList.toggle('selected', i === this.selectedIndex);
    });

    const selected = rows[this.selectedIndex];
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  },

  /**
   * 打开选中项
   * @private
   */
  _openSelected() {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.filteredItems.length) return;
    const item = this.filteredItems[this.selectedIndex];
    if (item && item.url) {
      window.location.href = item.url;
    }
    this.close();
  }
};

window.VimBookmarks = VimBookmarks;
