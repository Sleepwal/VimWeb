# Vim Web 架构设计文档

## 1. 整体架构

Vim Web 采用 Chrome Extension Manifest V3 架构，由以下核心模块组成：

```
┌─────────────────────────────────────────────────┐
│                  Chrome Extension                │
├─────────────────┬───────────────────────────────┤
│  Background SW  │         Content Scripts        │
│  background.js  │  utils.js → hint.js → search.js│
│                 │  bookmarks.js → tabs.js        │
│                 │  jumper.js → content.js         │
├─────────────────┼───────────────────────────────┤
│   Popup UI      │         Options UI             │
│   popup.html    │  options.html + options.js     │
└─────────────────┴───────────────────────────────┘
```

## 2. 模块职责

### 2.1 共享工具模块 (utils.js)

全局命名空间 `window.VimWebUtils`，所有 content script 共享。

| 子模块 | 职责 |
|--------|------|
| Validators | 数据验证器（scrollStep, blacklist, keyMappings） |
| DOMSafe | DOM 安全操作（createElement, setText, setAttribute） |
| ErrorHandler | 错误处理（handle, wrap, wrapAsync, showUserError, getLog） |
| StorageManager | 存储管理（get, set, migrate, onChange, cache） |
| EventManager | 事件管理（register, delegate, removeAll, debug） |

工具函数：`matchBlacklist`, `isBlacklisted`, `debounce`

### 2.2 核心入口 (content.js)

IIFE 封装，包含以下类：

| 类 | 职责 |
|----|------|
| KeyBuffer | 按键缓冲区，支持多键命令（gg, gt, gi 等） |
| ScrollHandler | 滚动处理，RAF 优化 + 视口缓存 |
| Indicator | 模式指示器，右下角 3 秒淡出 |
| ModeManager | 模式管理（NORMAL/INSERT/HINT/SEARCH） |
| TabMessenger | 标签页消息发送器 |
| KeyMapper | 快捷键映射管理器 |

核心流程：
1. 黑名单检查 → 2. 初始化类实例 → 3. 注册事件监听 → 4. 按键分发

### 2.3 Hint 系统 (hint.js)

`VimHint` 对象，提供 F 模式点击功能。

性能优化：
- TreeWalker 替代 querySelectorAll
- IntersectionObserver 视口追踪
- 300ms 元素缓存
- 50ms 防抖

### 2.4 搜索系统 (search.js)

`VimSearch` 对象，提供 `/` 搜索功能。

- TreeWalker 文本匹配
- `<mark>` 高亮
- 500 匹配上限

### 2.5 书签/历史 (bookmarks.js)

`VimBookmarks` 对象，共享 UI 组件。

- B：书签列表
- H：历史记录列表
- 搜索过滤 + 键盘导航

### 2.6 标签页列表 (tabs.js)

`VimTabs` 对象，标签页快速切换。

- b：显示标签页列表
- 通过 background.js 获取标签页数据
- 当前标签页高亮标记

### 2.7 元素跳转 (jumper.js)

`VimJumper` 对象，页面元素快速跳转。

- gi：上一个输入框
- gI：第一个输入框
- ]] / [[：语义链接跳转
- 支持自定义 CSS 选择器

### 2.8 后台服务 (background.js)

Service Worker，处理标签页操作。

| 操作 | 说明 |
|------|------|
| nextTab | 切换到下一个标签页 |
| prevTab | 切换到上一个标签页 |
| closeCurrentTab | 关闭当前标签页 |
| restoreLastTab | 恢复最近关闭的标签页 |
| getTabList | 获取当前窗口标签页列表 |
| switchToTab | 切换到指定标签页 |

## 3. 数据流

### 3.1 按键处理流程

```
keydown 事件（捕获阶段）
  → EventManager 分发
    → handleVimKey()
      → ModeManager 检查当前模式
        → NORMAL: KeyMapper 查找命令 → commandActions 执行
        → HINT: VimHint.handleInput()
        → SEARCH: 不拦截
        → INSERT: 不拦截（仅 Escape）
```

### 3.2 存储数据流

```
options.js → StorageManager.set() → chrome.storage.sync
                                        ↓ (onChange)
content.js ← StorageManager.get() ← chrome.storage.sync
```

### 3.3 标签页操作数据流

```
content.js → TabMessenger.send() → chrome.runtime.sendMessage
                                        ↓
background.js → handleTabAction() → chrome.tabs API
                                        ↓
content.js ← sendResponse ← 操作结果
```

## 4. 模式系统

| 模式 | 触发 | 行为 |
|------|------|------|
| NORMAL | 默认/Escape | 所有快捷键生效 |
| INSERT | 焦点进入输入框 | 仅响应 Escape |
| HINT | 按 f | 按键用于选择 Hint 标签 |
| SEARCH | 按 / | 按键由搜索框处理 |

## 5. 配置管理

### 5.1 存储结构

| 键 | 类型 | 默认值 | 说明 |
|----|------|--------|------|
| scrollStep | Object | {value: 15, unit: '%'} | 滚动步长 |
| blacklist | String | '' | 黑名单 |
| keyMappings | Object | {} | 自定义快捷键映射 |
| inputSelectors | String | '' | 自定义输入框选择器 |
| linkSelectors | String | '' | 自定义链接选择器 |
| configVersion | Number | 4 | 配置版本号 |

### 5.2 配置迁移

通过 `_migrations` 表按版本号顺序执行迁移，确保从任意旧版本升级到最新版本。

## 6. 安全设计

- DOMSafe：使用 textContent 替代 innerHTML
- Validators：所有存储数据读取时验证完整性
- 黑名单正则：`/^[a-zA-Z0-9._\-*]+$/` 防止注入
- setAttribute 白名单：仅允许 class, id, style, tabindex, role, aria-label
