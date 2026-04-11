/**
 * Tab List System for Vim Web
 *
 * 提供标签页快速切换功能，类似 Vimium 的 b 命令。
 *
 * 快捷键：
 * - b：打开当前窗口的标签页列表
 *
 * 基于 SelectableList 基类实现，共享列表 UI 逻辑。
 * 自定义渲染：当前标签页显示 ● 前缀和绿色高亮。
 *
 * 依赖：window.VimWebUtils（DOMSafe、debounce、SelectableList）
 * 权限：chrome.tabs（通过 background.js 中转）
 */
class VimTabsImpl extends Utils.SelectableList {
  constructor() {
    super({ title: '标签页', placeholder: '搜索标签页...', maxItems: Infinity, emptyText: '无匹配标签页' });
  }

  _updateSelectedIndex() {
    if (this.filteredItems.length > 0) {
      const activeIdx = this.filteredItems.findIndex(t => t.active);
      this.selectedIndex = activeIdx >= 0 ? activeIdx : 0;
    } else {
      this.selectedIndex = 0;
    }
  }

  _renderItem(item, index, row) {
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
  }

  async _loadData() {
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
      } else {
        this.items = [];
      }
      this._filter('');
    } catch (error) {
      console.warn('[Vim Web] Failed to load tabs:', error.message);
      this.items = [];
      this._filter('');
    }
  }

  async _onSelect(item) {
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
}

const VimTabs = new VimTabsImpl();
window.VimTabs = VimTabs;
