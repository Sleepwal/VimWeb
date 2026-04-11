/**
 * Tab List System for Vim Web
 *
 * 提供标签页快速切换功能，类似 Vimium 的 b 命令。
 *
 * 快捷键：
 * - b：打开当前窗口的标签页列表
 *
 * 功能：
 * - 显示当前窗口所有标签页（标题 + URL）
 * - 当前标签页高亮标记
 * - 搜索过滤（实时，150ms 防抖）
 * - 键盘导航（j/k 上下移动，Enter 切换，Esc 关闭）
 * - 点击标签页切换到对应标签
 *
 * 依赖：window.VimWebUtils（DOMSafe、debounce）
 * 权限：chrome.tabs（通过 background.js 中转）
 */
const VimTabs = {
  container: null,
  overlay: null,
  input: null,
  listEl: null,
  /** @type {Array<{id: number, title: string, url: string, active: boolean}>} 标签页列表 */
  items: [],
  /** @type {Array} 过滤后的标签页列表 */
  filteredItems: [],
  /** @type {number} 当前选中项索引 */
  selectedIndex: 0,
  /** @type {boolean} 列表是否处于活动状态 */
  isActive: false,

  /**
   * 打开标签页列表
   *
   * 通过 chrome.runtime.sendMessage 向 background.js 请求标签页数据，
   * 然后创建 UI 并显示列表。
   */
  open() {
    if (this.isActive) {
      this.close();
      return;
    }

    this.isActive = true;
    this.selectedIndex = 0;
    this._createUI();
    this._loadTabs();
  },

  /**
   * 关闭标签页列表
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
   * 创建标签页列表 UI
   *
   * 包含：标题、搜索输入框、列表容器。
   * @private
   */
  _createUI() {
    const Utils = window.VimWebUtils;

    this.overlay = Utils.DOMSafe.createElement('div', 'vim-web-list-overlay');
    this.overlay.addEventListener('click', () => this.close());

    this.container = Utils.DOMSafe.createElement('div', 'vim-web-list-container');

    const header = Utils.DOMSafe.createElement('div', 'vim-web-list-header', '标签页');

    this.input = document.createElement('input');
    this.input.className = 'vim-web-list-input';
    this.input.type = 'text';
    this.input.placeholder = '搜索标签页...';
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
        this._switchToSelected();
      }
    });

    this.input.focus();
  },

  /**
   * 从 background.js 加载标签页列表
   * @private
   */
  async _loadTabs() {
    try {
      const response = await new Promise((resolve) => {
        if (!chrome.runtime || !chrome.runtime.sendMessage) {
          resolve({ success: false });
          return;
        }
        chrome.runtime.sendMessage({ type: 'tabAction', action: 'getTabList' }, (resp) => {
          if (chrome.runtime.lastError) {
            console.warn('[Vim Web] Get tab list error:', chrome.runtime.lastError.message);
            resolve({ success: false });
            return;
          }
          resolve(resp || { success: false });
        });
      });

      if (response.success && response.tabs) {
        this.items = response.tabs;
        const activeIdx = this.items.findIndex(t => t.active);
        if (activeIdx >= 0) {
          this.selectedIndex = activeIdx;
        }
      } else {
        this.items = [];
      }
      this._filter('');
    } catch (error) {
      console.warn('[Vim Web] Failed to load tabs:', error.message);
      this.items = [];
      this._filter('');
    }
  },

  /**
   * 过滤标签页列表
   * @param {string} query - 搜索关键词
   * @private
   */
  _filter(query) {
    if (!query) {
      this.filteredItems = this.items.slice();
    } else {
      const q = query.toLowerCase();
      this.filteredItems = this.items.filter(item =>
        item.title.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q)
      );
    }

    if (this.filteredItems.length > 0) {
      const activeIdx = this.filteredItems.findIndex(t => t.active);
      this.selectedIndex = activeIdx >= 0 ? activeIdx : 0;
    } else {
      this.selectedIndex = 0;
    }

    this._renderList();
  },

  /**
   * 渲染标签页列表
   * @private
   */
  _renderList() {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';

    if (this.filteredItems.length === 0) {
      const empty = window.VimWebUtils.DOMSafe.createElement('div', 'vim-web-list-empty', '无匹配标签页');
      this.listEl.appendChild(empty);
      return;
    }

    this.filteredItems.forEach((item, index) => {
      const row = document.createElement('div');
      let cls = 'vim-web-list-item';
      if (index === this.selectedIndex) cls += ' selected';
      if (item.active) cls += ' vim-web-tabs-active';
      row.className = cls;
      row.dataset.index = index;

      const title = document.createElement('span');
      title.className = 'vim-web-list-item-title';
      title.textContent = (item.active ? '● ' : '') + item.title;

      const url = document.createElement('span');
      url.className = 'vim-web-list-item-url';
      url.textContent = item.url;

      row.appendChild(title);
      row.appendChild(url);

      row.addEventListener('click', () => {
        this.selectedIndex = index;
        this._switchToSelected();
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
   * 切换到选中的标签页
   *
   * 通过 chrome.runtime.sendMessage 向 background.js 发送切换请求。
   * @private
   */
  async _switchToSelected() {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.filteredItems.length) return;
    const item = this.filteredItems[this.selectedIndex];
    if (!item || !item.id) return;

    this.close();

    try {
      await new Promise((resolve) => {
        if (!chrome.runtime || !chrome.runtime.sendMessage) {
          resolve({ success: false });
          return;
        }
        chrome.runtime.sendMessage(
          { type: 'tabAction', action: 'switchToTab', tabId: item.id },
          (resp) => {
            if (chrome.runtime.lastError) {
              console.warn('[Vim Web] Switch tab error:', chrome.runtime.lastError.message);
            }
            resolve(resp || { success: false });
          }
        );
      });
    } catch (error) {
      console.warn('[Vim Web] Failed to switch tab:', error.message);
    }
  }
};

window.VimTabs = VimTabs;
