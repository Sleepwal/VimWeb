/**
 * Bookmarks & History System for Vim Web
 *
 * 提供书签和历史记录的快速访问功能，类似 Vimium 的 B 和 H 命令。
 *
 * 快捷键：
 * - B：打开书签列表
 * - H：打开历史记录列表
 *
 * 基于 SelectableList 组合实现，共享列表 UI 逻辑。
 * 使用组合模式替代继承，避免 class extends 的解析时依赖问题。
 *
 * 依赖：window.VimWebUtils（DOMSafe、debounce、SelectableList）
 * 权限：chrome.bookmarks, chrome.history
 */
const VimBookmarks = {
  /** @type {Utils.SelectableList|null} 内部列表实例 */
  _list: null,
  /** @type {'bookmarks'|'history'} 当前模式 */
  mode: 'bookmarks',

  openBookmarks() {
    this.mode = 'bookmarks';
    this._open('书签');
  },

  openHistory() {
    this.mode = 'history';
    this._open('历史记录');
  },

  close() {
    if (this._list) {
      this._list.close();
      this._list = null;
    }
  },

  get isActive() {
    return this._list ? this._list.isActive : false;
  },

  _open(title) {
    if (this._list && this._list.isActive) {
      this._list.close();
      this._list = null;
      return;
    }

    const Utils = window.VimWebUtils;
    this._list = new Utils.SelectableList({
      title: title,
      placeholder: '搜索...',
      maxItems: 50,
      emptyText: '无结果'
    });

    this._list._loadData = async () => {
      try {
        if (this.mode === 'bookmarks') {
          this._list.items = await this._getBookmarks();
        } else {
          this._list.items = await this._getHistory();
        }
        this._list._filter('');
      } catch (error) {
        console.warn('[Vim Web] Failed to load', this.mode, error.message);
        this._list.items = [];
        this._list._filter('');
      }
    };

    this._list._onSelect = (item) => {
      if (item && item.url) {
        window.location.href = item.url;
      }
      this._list.close();
    };

    this._list.open();
  },

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
  }
};

window.VimBookmarks = VimBookmarks;
