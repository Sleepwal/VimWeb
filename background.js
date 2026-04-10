/**
 * Vim Web Background Script
 * 
 * 职责：
 * 1. 处理标签页操作请求
 * 2. 管理最近关闭的标签页历史
 * 3. 响应来自 content script 的消息
 */

const MAX_CLOSED_TABS = 10;
let closedTabStack = [];
let tabInfoMap = new Map();

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) {
    tabInfoMap.set(tab.id, { url: tab.url, title: tab.title });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.title) {
    tabInfoMap.set(tabId, { url: tab.url, title: tab.title });
  }
});

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

async function closeCurrentTab(sender) {
  try {
    const currentTab = sender.tab;
    if (!currentTab) return { success: false, error: 'No sender tab' };

    const tabs = await chrome.tabs.query({ currentWindow: true });

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
