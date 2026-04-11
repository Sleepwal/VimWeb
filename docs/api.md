# Vim Web API 使用文档

## 1. 全局命名空间

### window.VimWebUtils

共享工具模块，所有 content script 和 options page 均可访问。

---

## 2. Validators

数据验证器集合。

### Validators.scrollStep(value)

验证滚动步长配置。

| 参数 | 类型 | 说明 |
|------|------|------|
| value | Object | {value: number, unit: string} |
| 返回 | boolean | 配置是否合法 |

规则：value 为 1-10000 的数字，unit 为 '%' 或 'px'。

```javascript
Utils.Validators.scrollStep({ value: 15, unit: '%' }); // true
Utils.Validators.scrollStep({ value: -1, unit: '%' });  // false
```

### Validators.blacklist(value)

验证完整黑名单字符串。

| 参数 | 类型 | 说明 |
|------|------|------|
| value | string | 换行符分隔的黑名单 |
| 返回 | boolean | 所有行是否合法 |

### Validators.blacklistPattern(pattern)

验证单条黑名单模式。

| 参数 | 类型 | 说明 |
|------|------|------|
| pattern | string | 单条模式 |
| 返回 | boolean | 模式是否合法 |

### Validators.keyMappings(value)

验证快捷键映射对象。

| 参数 | 类型 | 说明 |
|------|------|------|
| value | Object | {key: action} 映射 |
| 返回 | boolean | 映射是否合法 |

规则：key 为 1-3 字符的字符串，action 为字符串。

---

## 3. DOMSafe

DOM 安全操作工具，防止 XSS 攻击。

### DOMSafe.createElement(tag, className?, textContent?)

安全创建 DOM 元素。

| 参数 | 类型 | 说明 |
|------|------|------|
| tag | string | HTML 标签名 |
| className | string | CSS 类名（可选） |
| textContent | string | 文本内容（可选） |
| 返回 | HTMLElement | 新创建的元素 |

```javascript
const el = Utils.DOMSafe.createElement('div', 'my-class', 'Hello');
// <div class="my-class">Hello</div>
```

### DOMSafe.setText(element, text)

安全设置元素文本，使用 textContent 而非 innerHTML。

| 参数 | 类型 | 说明 |
|------|------|------|
| element | HTMLElement | 目标元素 |
| text | string | 文本内容 |

### DOMSafe.setAttribute(element, name, value)

安全设置元素属性，仅允许白名单中的属性名。

| 参数 | 类型 | 说明 |
|------|------|------|
| element | HTMLElement | 目标元素 |
| name | string | 属性名（class, id, style, tabindex, role, aria-label） |
| value | string | 属性值 |

---

## 4. ErrorHandler

集中式错误处理器。

### ErrorHandler.handle(error, context?)

处理并记录错误。

| 参数 | 类型 | 说明 |
|------|------|------|
| error | Error \| string | 错误对象或消息 |
| context | Object | 错误上下文（可选） |

```javascript
Utils.ErrorHandler.handle(new Error('test'), { phase: 'init' });
```

### ErrorHandler.wrap(fn, context?)

包装同步函数，自动捕获异常。

| 参数 | 类型 | 说明 |
|------|------|------|
| fn | Function | 要包装的函数 |
| context | Object | 额外上下文（可选） |
| 返回 | Function | 包装后的函数 |

```javascript
const safeFn = Utils.ErrorHandler.wrap(riskyFunction, { module: 'hint' });
safeFn(); // 异常不会传播，而是被记录
```

### ErrorHandler.wrapAsync(fn, context?)

包装异步函数，自动捕获 Promise 异常。

| 参数 | 类型 | 说明 |
|------|------|------|
| fn | AsyncFunction | 要包装的异步函数 |
| context | Object | 额外上下文（可选） |
| 返回 | AsyncFunction | 包装后的异步函数 |

### ErrorHandler.showUserError(message)

显示用户友好的错误提示（Toast 样式，3 秒消失）。

| 参数 | 类型 | 说明 |
|------|------|------|
| message | string | 错误消息 |

### ErrorHandler.getLog()

获取错误日志副本。

| 返回 | Array | 错误日志数组 |

### ErrorHandler.clearLog()

清空错误日志。

---

## 5. StorageManager

异步存储管理器，封装 chrome.storage.sync。

### StorageManager.get(keys)

异步读取配置，支持缓存。

| 参数 | 类型 | 说明 |
|------|------|------|
| keys | string[] \| Object | 键列表或默认值对象 |
| 返回 | Promise<Object> | 配置对象 |

```javascript
const items = await Utils.StorageManager.get(['scrollStep', 'blacklist']);
```

### StorageManager.set(items)

异步保存配置，同时更新缓存。

| 参数 | 类型 | 说明 |
|------|------|------|
| items | Object | 要保存的键值对 |
| 返回 | Promise<void> | |

```javascript
await Utils.StorageManager.set({ scrollStep: { value: 20, unit: '%' } });
```

### StorageManager.migrate()

执行配置迁移，从旧版本升级到最新版本。应在扩展初始化时调用。

### StorageManager.onChange(callback)

监听配置变更。

| 参数 | 类型 | 说明 |
|------|------|------|
| callback | Function | 变更回调，接收 validated 对象 |

```javascript
Utils.StorageManager.onChange((changes) => {
  if (changes.scrollStep) {
    console.log('scrollStep changed:', changes.scrollStep);
  }
});
```

### StorageManager.clearCache()

清空内存缓存。

---

## 6. EventManager

事件管理器，统一管理事件监听器。

### new EventManager()

创建事件管理器实例。

```javascript
const em = new Utils.EventManager();
```

### em.register(target, type, handler, options?)

注册事件监听器。

| 参数 | 类型 | 说明 |
|------|------|------|
| target | EventTarget | 事件目标 |
| type | string | 事件类型 |
| handler | Function | 处理函数 |
| options | Object | addEventListener 选项 |
| 返回 | Function | 注销函数 |

```javascript
const unregister = em.register(document, 'keydown', handler, { capture: true });
// 注销
unregister();
```

### em.delegate(root, type, selector, handler)

注册事件委托监听器。

| 参数 | 类型 | 说明 |
|------|------|------|
| root | EventTarget | 委托根元素 |
| type | string | 事件类型 |
| selector | string | CSS 选择器 |
| handler | Function | 处理函数 (event, matchedElement) |
| 返回 | Function | 注销函数 |

```javascript
em.delegate(document.body, 'click', '.my-button', (e, el) => {
  console.log('Clicked:', el);
});
```

### em.removeAll()

移除所有已注册的监听器。

### em.getStats()

获取监听器数量统计。

| 返回 | Object | {direct: number, delegated: number} |

### em.debug()

获取监听器描述信息（调试用）。

| 返回 | Array<string> | 监听器描述列表 |

---

## 7. Content Script 模块 API

### VimHint

Hint 系统，F 模式点击。

| 方法 | 说明 |
|------|------|
| createHints() | 创建 Hint 标签 |
| handleInput(key) | 处理 Hint 选择键，返回是否完成 |
| removeHints() | 移除所有 Hint |
| updateHintsVisibility() | 更新 Hint 可见性 |
| activateElement(el) | 激活目标元素 |

### VimSearch

搜索系统。

| 方法 | 说明 |
|------|------|
| open() | 打开搜索框 |
| close() | 关闭搜索框 |
| search(keyword) | 执行搜索 |
| next() | 下一个匹配 |
| prev() | 上一个匹配 |
| searchWordUnderCursor() | 搜索光标下单词 |

### VimBookmarks

书签/历史系统。

| 方法 | 说明 |
|------|------|
| openBookmarks() | 打开书签列表 |
| openHistory() | 打开历史记录列表 |
| close() | 关闭列表 |

### VimTabs

标签页列表系统。

| 方法 | 说明 |
|------|------|
| open() | 打开标签页列表 |
| close() | 关闭列表 |

### VimJumper

元素跳转系统。

| 方法 | 说明 |
|------|------|
| jumpToLastInput() | 跳转到上一个输入框 |
| jumpToFirstInput() | 跳转到第一个输入框 |
| jumpToNextLink() | 跳转到下一个语义链接 |
| jumpToPrevLink() | 跳转到上一个语义链接 |
| recordLastInput(el) | 记录最后聚焦的输入框 |

---

## 8. Background Script 消息协议

### 请求格式

```javascript
{
  type: 'tabAction',
  action: string,     // 操作类型
  tabId?: number      // switchToTab 需要的标签页 ID
}
```

### 响应格式

```javascript
{
  success: boolean,
  error?: string,
  tabs?: Array,        // getTabList 返回的标签页列表
  tabId?: number       // restoreLastTab 返回的新标签页 ID
}
```

### 支持的操作

| action | 说明 | 参数 |
|--------|------|------|
| nextTab | 切换到下一个标签页 | - |
| prevTab | 切换到上一个标签页 | - |
| closeCurrentTab | 关闭当前标签页 | - |
| restoreLastTab | 恢复最近关闭的标签页 | - |
| getTabList | 获取标签页列表 | - |
| switchToTab | 切换到指定标签页 | tabId: number |

---

## 9. 快捷键命令列表

| 命令名 | 默认键 | 说明 |
|--------|--------|------|
| scrollDown | j | 向下滚动 |
| scrollUp | k | 向上滚动 |
| scrollLeft | h | 向左滚动 |
| scrollRight | l | 向右滚动 |
| scrollToTop | gg | 回到顶部 |
| scrollToBottom | G | 直达底部 |
| enterHintMode | f | 进入 Hint 模式 |
| clickAtCursor | Space | 点击光标处 |
| goBack | q/Q | 返回上一页 |
| closeTab | x | 关闭标签页 |
| restoreTab | X | 恢复标签页 |
| nextTab | gt | 下一个标签页 |
| prevTab | gT | 上一个标签页 |
| showTabList | b | 标签页列表 |
| openSearch | / | 打开搜索 |
| searchNext | n | 下一个匹配 |
| searchPrev | N | 上一个匹配 |
| searchWordUnderCursor | * | 搜索光标下单词 |
| openBookmarks | B | 打开书签 |
| openHistory | H | 打开历史记录 |
| jumpToLastInput | gi | 上一个输入框 |
| jumpToFirstInput | gI | 第一个输入框 |
| jumpToNextLink | ]] | 下一页链接 |
| jumpToPrevLink | [[ | 上一页链接 |
