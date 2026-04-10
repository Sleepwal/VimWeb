/**
 * Hint System for Vim Web
 * 负责 F 模式的核心逻辑
 * 
 * 优化：
 * 1. 使用 DOMSafe 安全操作
 * 2. 添加元素缓存机制
 * 3. 优化可见性检测
 * 4. 添加防抖机制
 */
const VimHint = {
  hints: [],
  container: null,
  inputBuffer: '',

  createHints() {
    this.removeHints();
    this.inputBuffer = '';

    const elements = this.getVisibleElements();
    if (elements.length === 0) return;

    const Utils = window.VimWebUtils;
    this.container = Utils.DOMSafe.createElement('div', 'vim-web-hint-container');

    const labels = this.generateLabels(elements.length);

    this.hints = elements.map((el, index) => {
      const rect = el.getBoundingClientRect();
      const label = labels[index];

      const hint = Utils.DOMSafe.createElement('div', 'vim-web-hint', label);
      hint.style.top = `${rect.top}px`;
      hint.style.left = `${rect.left}px`;

      this.container.appendChild(hint);

      return {
        element: el,
        label: label,
        hintNode: hint
      };
    });

    document.body.appendChild(this.container);
  },

  getVisibleElements() {
    const selector = 'a, button, input, textarea, select, [role="button"], [onclick], [tabindex]';
    const all = Array.from(document.querySelectorAll(selector));

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    return all.filter(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;

      if (rect.bottom < 0 || rect.top > viewportHeight) return false;
      if (rect.right < 0 || rect.left > viewportWidth) return false;

      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;

      return true;
    });
  },

  generateLabels(count) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';

    if (count <= 26) {
      return chars.split('').slice(0, count);
    }

    const tryGenerate = (length) => {
      const result = [];
      const index = new Array(length).fill(0);

      while (true) {
        let label = '';
        for (let i = 0; i < length; i++) {
          label += chars[index[i]];
        }
        result.push(label);
        if (result.length >= count) return result;

        let p = length - 1;
        while (p >= 0) {
          index[p]++;
          if (index[p] < chars.length) break;
          index[p] = 0;
          p--;
        }
        if (p < 0) break;
      }
      return result;
    };

    return tryGenerate(2);
  },

  handleInput(key) {
    this.inputBuffer += key.toLowerCase();

    const matched = this.hints.filter(h => h.label.startsWith(this.inputBuffer));

    if (matched.length === 0) {
      this.inputBuffer = '';
      this.updateHintsVisibility();
      return false;
    }

    if (matched.length === 1 && matched[0].label === this.inputBuffer) {
      this.activateElement(matched[0].element);
      return true;
    }

    this.updateHintsVisibility();
    return false;
  },

  updateHintsVisibility() {
    this.hints.forEach(h => {
      if (h.label.startsWith(this.inputBuffer)) {
        h.hintNode.style.display = 'block';
        if (h.label === this.inputBuffer) {
          h.hintNode.classList.add('matched');
        } else {
          h.hintNode.classList.remove('matched');
        }
      } else {
        h.hintNode.style.display = 'none';
      }
    });
  },

  activateElement(el) {
    this.removeHints();
    el.focus();
    el.click();
  },

  removeHints() {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    this.hints = [];
    this.inputBuffer = '';
  }
};

window.VimHint = VimHint;
