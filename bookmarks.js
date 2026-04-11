/**
 * Bookmarks & History System for Vim Web
 *
 * 提供书签和历史记录的快速访问功能，类似 Vimium 的 B 和 H 命令。
 *
 * 快捷键：
 * - B：打开书签列表
 * - H：打开历史记录列表
 *
 * 基于 SelectableList 基类实现，共享列表 UI 逻辑。
 *
 * 依赖：window.VimWebUtils（DOMSafe、debounce、SelectableList）
 * 权限：chrome.bookmarks, chrome.history
 */
class VimBookmarksImpl extends Utils.SelectableList {
  constructor() {
    super({ title: '书签', placeholder: '搜索...', maxItems: 50, emptyText: '无结果' });
    /** @type {'bookmarks'|'history'} 当前模式 */
    this.mode = 'bookmarks';
  }

  openBookmarks() {
    this.mode = 'bookmarks';
    this.title = '书签';
    this.open();
  }

  openHistory() {
    this.mode = 'history';
    this.title = '历史记录';
    this.open();
  }

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
  }

  _onSelect(item) {
    if (item && item.url) {
      window.location.href = item.url;
    }
    this.close();
  }

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
  }

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
}

const VimBookmarks = new VimBookmarksImpl();
window.VimBookmarks = VimBookmarks;
