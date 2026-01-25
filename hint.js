/**
 * Hint System for Vim Web
 * 负责 F 模式的核心逻辑
 */
const VimHint = {
  hints: [],
  container: null,
  inputBuffer: '',
  
  /**
   * 创建并显示提示标签
   */
  createHints() {
    this.removeHints(); // 清理旧的
    this.inputBuffer = '';
    
    const elements = this.getVisibleElements();
    if (elements.length === 0) return;

    this.container = document.createElement('div');
    this.container.className = 'vim-web-hint-container';
    
    // 生成标签字符
    const labels = this.generateLabels(elements.length);
    
    this.hints = elements.map((el, index) => {
      const rect = el.getBoundingClientRect();
      const label = labels[index];
      
      const hint = document.createElement('div');
      hint.className = 'vim-web-hint';
      hint.textContent = label;
      
      // 计算位置 (相对于视口)
      // 使用 window.scrollY/X 来处理 absolute 定位，但我们的 container 是 fixed
      // 所以直接用 rect.top/left 即可
      const top = rect.top;
      const left = rect.left;
      
      hint.style.top = `${top}px`;
      hint.style.left = `${left}px`;

      this.container.appendChild(hint);
      
      return {
        element: el,
        label: label,
        hintNode: hint
      };
    });
    
    document.body.appendChild(this.container);
  },

  /**
   * 获取视口内所有可见的可点击元素
   */
  getVisibleElements() {
    const selector = 'a, button, input, textarea, select, [role="button"], [onclick], [tabindex]';
    const all = Array.from(document.querySelectorAll(selector));
    
    return all.filter(el => {
      // 必须有具体的尺寸
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      
      // 必须在视口内
      if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
      if (rect.right < 0 || rect.left > window.innerWidth) return false;
      
      // 简单的可见性样式检查
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
      
      return true;
    });
  },

  /**
   * 生成标签序列 (a, b, ... aa, ab ...)
   * @param {number} count 
   */
  generateLabels(count) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const labels = [];
    
    // 单字母
    if (count <= 26) {
      return chars.split('').slice(0, count);
    }
    
    // 双字母优先 (为了统一体验，或者混合？)
    // 这里采用混合：先用单字母，不够用双字母
    // 实际上 Vimium 常用双字母以避免歧义，但为了简单 MVP，先混合
    
    // 策略：如果总数 > 26，全部使用双字母？
    // 为了简单，我们直接生成双字母序列，如果不够再三字母
    // 或者：a-z (26), aa-az, ba-bz...
    
    // 简单实现：全部用双字母，这样输入体验一致（都是按两下）
    // 除非元素很少。
    // 让我们用一个更智能的生成器：
    
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
        
        // 进位逻辑
        let p = length - 1;
        while (p >= 0) {
          index[p]++;
          if (index[p] < chars.length) break;
          index[p] = 0;
          p--;
        }
        if (p < 0) break; // 溢出
      }
      return result;
    };

    if (count <= 26) return chars.split('').slice(0, count);
    return tryGenerate(2);
  },

  /**
   * 处理键盘输入
   * @param {string} key 
   * @returns {boolean} 是否结束 Hint 模式
   */
  handleInput(key) {
    this.inputBuffer += key.toLowerCase();
    
    // 过滤匹配的标签
    const matched = this.hints.filter(h => h.label.startsWith(this.inputBuffer));
    
    if (matched.length === 0) {
      // 输入错误，重置缓冲区
      this.inputBuffer = '';
      this.updateHintsVisibility();
      return false; 
    }
    
    if (matched.length === 1 && matched[0].label === this.inputBuffer) {
      // 找到唯一完全匹配
      this.activateElement(matched[0].element);
      return true; // 结束 Hint 模式
    }
    
    // 还有多个匹配或部分匹配，更新显示
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
    console.log("[Vim Web] Activated:", el);
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

// 导出到全局
window.VimHint = VimHint;
