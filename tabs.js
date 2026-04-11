/**
 * Tab List System for Vim Web
 *
 * 提供标签页快速切换功能，类似 Vimium 的 b 命令。
 *
 * 快捷键：
 * - b：打开当前窗口的标签页列表
 *
 * 基于 SelectableList 组合实现，共享列表 UI 逻辑。
 * 使用组合模式替代继承，避免 class extends 的解析时依赖问题。
 * 自定义渲染：当前标签页显示 ● 前缀和绿色高亮。
 *
 * 依赖：window.VimWebUtils（DOMSafe、debounce、SelectableList）
 * 权限：chrome.tabs（通过 background.js 中转）
 */
const VimTabs = {
  /** @type {Utils.SelectableList|null} 内部列表实例 */
  _list: null,

  open() {
    if (this._list && this._list.isActive) {
      this._list.close();
      this._list = null;
      return;
    }

    const Utils = window.VimWebUtils;
    this._list = new Utils.SelectableList({
      title: '标签页',
      placeholder: '搜索标签页...',
      maxItems: Infinity,
      emptyText: '无匹配标签页'
    });

    this._list._updateSelectedIndex = () => {
      if (this._list.filteredItems.length > 0) {
        const activeIdx = this._list.filteredItems.findIndex(t => t.active);
        this._list.selectedIndex = activeIdx >= 0 ? activeIdx : 0;
      } else {
        this._list.selectedIndex = 0;
      }
    };

    this._list._renderItem = (item, index, row) => {
      if (item.active) {
        row.classList.add('vim-web-tabs-active');
      }

      const title = document.createElement('span');
      title.className = 'vim-web-list-item-title';
      title.textContent = (item.active ? '● ' : '') + (item.title || '');

      const url = document.createElement('span');
      url.className = 'vim-web-list-item-url';
      url.textContent = item.url || '';

      row.appendChild(title);
      row.appendChild(url);
    };

    this._list._loadData = async () => {
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
          this._list.items = response.tabs;
        } else {
          this._list.items = [];
        }
        this._list._filter('');
      } catch (error) {
        console.warn('[Vim Web] Failed to load tabs:', error.message);
        this._list.items = [];
        this._list._filter('');
      }
    };

    this._list._onSelect = async (item) => {
      if (!item || !item.id) return;

      this._list.close();

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
    };

    this._list.open();
  },

  close() {
    if (this._list) {
      this._list.close();
      this._list = null;
    }
  },

  get isActive() {
    return this._list ? this._list.isActive : false;
  }
};

window.VimTabs = VimTabs;
