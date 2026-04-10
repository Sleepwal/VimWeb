/**
 * Vim Web Background Script (Service Worker)
 *
 * 作为 Chrome 扩展的后台服务运行，负责：
 * 1. 处理来自 content script 的标签页操作请求
 * 2. 主动追踪标签页信息（URL、标题），用于关闭后恢复
 * 3. 维护最近关闭标签页的栈，支持 X 键恢复
 *
 * 消息协议：
 * content script 发送 { type: 'tabAction', action: string }
 * background script 返回 { success: boolean, error?: string }
 *
 * 支持的操作：
 * - nextTab：切换到下一个标签页
 * - prevTab：切换到上一个标签页
 * - closeCurrentTab：关闭当前标签页
 * - restoreLastTab：恢复最近关闭的标签页
 */

/** @type {number} 最近关闭标签页栈的最大容量 */
const MAX_CLOSED_TABS = 10;

/** @type {Array<{url: string, title: string, tabId: number}>} 最近关闭的标签页栈（最新在前） */
let closedTabStack = [];

/**
 * 标签页信息缓存
 *
 * 主动追踪所有标签页的 URL 和标题，
 * 因为 chrome.tabs.onRemoved 触发时已无法获取标签页信息。
 *
 * @type {Map<number, {url: string, title: string}>}
 * @key tabId - 标签页 ID
 * @value tabInfo - 标签页的 URL 和标题
 */
let tabInfoMap = new Map();

/**
 * 标签页创建事件监听
 *
 * 当新标签页创建时，记录其 URL 和标题。
 * @note 创建时 URL 可能是 about:blank，后续 onUpdated 会更新
 */
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) {
    tabInfoMap.set(tab.id, { url: tab.url, title: tab.title });
  }
});

/**
 * 标签页更新事件监听
 *
 * 当标签页的 URL 或标题发生变化时，更新缓存。
 * 这确保了标签页关闭时能获取到最新的 URL。
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.title) {
    tabInfoMap.set(tabId, { url: tab.url, title: tab.title });
  }
});

/**
 * 标签页关闭事件监听
 *
 * 当标签页关闭时：
 * 1. 从 tabInfoMap 获取标签页信息
 * 2. 如果信息存在且有 URL，推入 closedTabStack
 * 3. 从 tabInfoMap 中删除该标签页
 *
 * @note 如果 isWindowClosing 为 true（整个窗口关闭），跳过处理
 * @note 如果 tabInfoMap 中没有该标签页（扩展更新后加载），直接跳过
 */
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) return;

  const tabInfo = tabInfoMap.get(tabId);
  if (!tabInfo) return;

  if (tabInfo.url) {
    closedTabStack.unshift({ url: tabInfo.url, title: tabInfo.title, tabId });
    if (closedTabStack.length > MAX_CLOSED_TABS) {
      closedTabStack.pop();
    }
  }
  tabInfoMap.delete(tabId);
});

/**
 * 消息监听器
 *
 * 接收来自 content script 的 tabAction 消息，
 * 调用对应的处理函数并返回结果。
 *
 * 返回 true 表示异步发送响应（sendResponse 在 Promise resolve 后调用）。
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'tabAction') return false;

  handleTabAction(message.action, sender)
    .then(sendResponse)
    .catch(error => {
      console.error('[Vim Web BG] Tab action error:', error);
      sendResponse({ success: false, error: error.message });
    });

  return true;
});

/**
 * 分发标签页操作到对应的处理函数
 *
 * @param {string} action - 操作类型
 * @param {chrome.runtime.MessageSender} sender - 消息发送者信息
 * @returns {Promise<{success: boolean, error?: string}>} 操作结果
 */
async function handleTabAction(action, sender) {
  switch (action) {
    case 'nextTab':
      return switchTab('next', sender);
    case 'prevTab':
      return switchTab('prev', sender);
    case 'closeCurrentTab':
      return closeCurrentTab(sender);
    case 'restoreLastTab':
      return restoreLastTab();
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

/**
 * 切换到相邻标签页
 *
 * 在当前窗口内循环切换，到达末尾后回到开头，反之亦然。
 *
 * @param {'next'|'prev'} direction - 切换方向
 * @param {chrome.runtime.MessageSender} sender - 消息发送者（含当前标签页信息）
 * @returns {Promise<{success: boolean}>} 操作结果
 */
async function switchTab(direction, sender) {
  try {
    const currentTab = sender.tab;
    if (!currentTab) return { success: false, error: 'No sender tab' };

    const tabs = await chrome.tabs.query({ currentWindow: true });
    if (tabs.length <= 1) return { success: true, message: 'Only one tab' };

    const currentIndex = tabs.findIndex(t => t.id === currentTab.id);
    let nextIndex;

    if (direction === 'next') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    }

    await chrome.tabs.update(tabs[nextIndex].id, { active: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 关闭当前标签页
 *
 * 关闭前先激活相邻标签页，避免关闭后焦点跳到不可预测的标签页。
 * 激活策略：优先激活右侧标签页，否则激活左侧。
 *
 * @param {chrome.runtime.MessageSender} sender - 消息发送者
 * @returns {Promise<{success: boolean}>} 操作结果
 */
async function closeCurrentTab(sender) {
  try {
    const currentTab = sender.tab;
    if (!currentTab) return { success: false, error: 'No sender tab' };

    const tabs = await chrome.tabs.query({ currentWindow: true });

    // 先激活相邻标签页，再关闭当前标签页
    if (tabs.length > 1) {
      const currentIndex = tabs.findIndex(t => t.id === currentTab.id);
      if (currentIndex < tabs.length - 1) {
        await chrome.tabs.update(tabs[currentIndex + 1].id, { active: true });
      } else {
        await chrome.tabs.update(tabs[currentIndex - 1].id, { active: true });
      }
    }

    await chrome.tabs.remove(currentTab.id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 恢复最近关闭的标签页
 *
 * 从 closedTabStack 取出最近关闭的标签页 URL，
 * 创建新标签页并激活。
 *
 * @returns {Promise<{success: boolean, tabId?: number}>} 操作结果
 */
async function restoreLastTab() {
  try {
    if (closedTabStack.length === 0) {
      return { success: false, error: 'No closed tabs' };
    }

    const lastClosed = closedTabStack.shift();
    if (lastClosed.url) {
      const tab = await chrome.tabs.create({ url: lastClosed.url, active: true });
      return { success: true, tabId: tab.id };
    }

    return { success: false, error: 'No URL for closed tab' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
