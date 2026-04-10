/**
 * Element Jumper for Vim Web
 *
 * 提供页面元素快速跳转功能，扩展 NORMAL 模式下的导航能力。
 *
 * 快捷键：
 * - gi：跳转到上一个聚焦的输入框
 * - gI：跳转到页面第一个输入框
 * - ]]：跳转到下一个链接（"next"语义）
 * - [[：跳转到上一个链接（"prev"语义）
 *
 * ]] 和 [[ 的链接匹配策略：
 * 优先匹配包含 next/next/下一页/后页 等语义文本的链接，
 * 其次匹配 rel="next"/rel="prev" 的链接，
 * 最后按 DOM 顺序跳转。
 *
 * 依赖：window.VimWebUtils（DOMSafe）
 */
const VimJumper = {
  /** @type {HTMLElement|null} 上一个聚焦的输入框 */
  lastInput: null,

  /**
   * 跳转到上一个聚焦的输入框
   *
   * 如果没有记录过上次聚焦的输入框，则跳转到页面第一个输入框。
   */
  jumpToLastInput() {
    if (this.lastInput && document.contains(this.lastInput)) {
      this.lastInput.focus();
      this._scrollToElement(this.lastInput);
    } else {
      this.jumpToFirstInput();
    }
  },

  /**
   * 跳转到页面第一个可见的输入框
   */
  jumpToFirstInput() {
    const input = this._findFirstVisibleInput();
    if (input) {
      this.lastInput = input;
      input.focus();
      this._scrollToElement(input);
    }
  },

  /**
   * 跳转到下一个语义链接
   *
   * 查找包含"下一页"语义的链接，或按 DOM 顺序查找下一个链接。
   */
  jumpToNextLink() {
    const link = this._findSemanticLink('next');
    if (link) {
      link.click();
    }
  },

  /**
   * 跳转到上一个语义链接
   *
   * 查找包含"上一页"语义的链接，或按 DOM 顺序查找上一个链接。
   */
  jumpToPrevLink() {
    const link = this._findSemanticLink('prev');
    if (link) {
      link.click();
    }
  },

  /**
   * 查找第一个可见的输入框
   * @returns {HTMLElement|null}
   * @private
   */
  _findFirstVisibleInput() {
    const inputs = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select, [contenteditable="true"]'
    );

    for (const input of inputs) {
      if (this._isVisible(input)) {
        return input;
      }
    }
    return null;
  },

  /**
   * 查找语义链接
   *
   * 匹配策略（按优先级）：
   * 1. rel="next" 或 rel="prev" 属性
   * 2. 链接文本包含语义关键词
   * 3. 链接 class 包含语义关键词
   *
   * @param {'next'|'prev'} direction - 方向
   * @returns {HTMLAnchorElement|null} 匹配的链接
   * @private
   */
  _findSemanticLink(direction) {
    const nextKeywords = ['next', '下一页', '后页', '下页', '›', '»', '>', 'next ›', 'next »'];
    const prevKeywords = ['prev', 'previous', '上一页', '前页', '上页', '‹', '«', '<', '‹ prev', '« prev'];
    const keywords = direction === 'next' ? nextKeywords : prevKeywords;
    const relValue = direction;

    // 策略1：rel 属性
    const relLinks = document.querySelectorAll(`a[rel~="${relValue}"]`);
    for (const link of relLinks) {
      if (this._isVisible(link)) return link;
    }

    // 策略2：链接文本
    const allLinks = document.querySelectorAll('a[href]');
    for (const link of allLinks) {
      if (!this._isVisible(link)) continue;

      const text = (link.textContent || '').trim().toLowerCase();
      const href = (link.getAttribute('href') || '').toLowerCase();
      const className = (link.className || '').toLowerCase();

      for (const keyword of keywords) {
        if (text.includes(keyword) || href.includes(keyword) || className.includes(keyword)) {
          return link;
        }
      }
    }

    return null;
  },

  /**
   * 检查元素是否可见
   * @param {HTMLElement} el
   * @returns {boolean}
   * @private
   */
  _isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;

    return true;
  },

  /**
   * 滚动到元素可见区域
   * @param {HTMLElement} el
   * @private
   */
  _scrollToElement(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  /**
   * 记录最后聚焦的输入框
   * @param {HTMLElement} el
   */
  recordLastInput(el) {
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
      this.lastInput = el;
    }
  }
};

window.VimJumper = VimJumper;
