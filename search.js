/**
 * Search System for Vim Web
 * 页面内文本搜索与导航
 * 
 * 快捷键：
 * / - 打开搜索框
 * n - 下一个匹配项
 * N - 上一个匹配项
 * * - 搜索光标下的单词
 * Esc - 关闭搜索
 */
const VimSearch = {
  searchBox: null,
  searchContainer: null,
  overlay: null,
  matches: [],
  currentMatchIndex: -1,
  keyword: '',
  isActive: false,

  open() {
    if (this.isActive) {
      if (this.searchBox) this.searchBox.focus();
      return;
    }
    this.isActive = true;
    this._createSearchUI();
  },

  close() {
    this.isActive = false;
    this._clearHighlights();
    this._removeSearchUI();
    this.matches = [];
    this.currentMatchIndex = -1;
    this.keyword = '';
  },

  search(keyword) {
    this._clearHighlights();
    this.keyword = keyword;

    if (!keyword || keyword.length === 0) {
      this.matches = [];
      this.currentMatchIndex = -1;
      this._updateCountDisplay();
      return;
    }

    this._findMatches(keyword);
    this._highlightMatches(keyword);

    if (this.matches.length > 0) {
      this.currentMatchIndex = 0;
      this._scrollToMatch(0);
    } else {
      this.currentMatchIndex = -1;
    }

    this._updateCountDisplay();
  },

  next() {
    if (this.matches.length === 0) return;

    this.currentMatchIndex = (this.currentMatchIndex + 1) % this.matches.length;
    this._scrollToMatch(this.currentMatchIndex);
    this._updateCountDisplay();
  },

  prev() {
    if (this.matches.length === 0) return;

    this.currentMatchIndex = (this.currentMatchIndex - 1 + this.matches.length) % this.matches.length;
    this._scrollToMatch(this.currentMatchIndex);
    this._updateCountDisplay();
  },

  searchWordUnderCursor() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const word = selection.toString().trim();
    if (word) {
      this.open();
      this.searchBox.value = word;
      this.search(word);
    }
  },

  _createSearchUI() {
    const Utils = window.VimWebUtils;

    this.overlay = Utils.DOMSafe.createElement('div', 'vim-web-search-overlay');
    this.searchContainer = Utils.DOMSafe.createElement('div', 'vim-web-search-container');

    this.searchBox = document.createElement('input');
    this.searchBox.className = 'vim-web-search-input';
    this.searchBox.type = 'text';
    this.searchBox.placeholder = '搜索...';
    this.searchBox.setAttribute('autocomplete', 'off');
    this.searchBox.setAttribute('spellcheck', 'false');

    const countDisplay = Utils.DOMSafe.createElement('span', 'vim-web-search-count', '');
    countDisplay.id = 'vim-web-search-count';

    const prevBtn = Utils.DOMSafe.createElement('button', 'vim-web-search-btn', '▲');
    prevBtn.title = '上一个 (N)';
    prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.prev();
    });

    const nextBtn = Utils.DOMSafe.createElement('button', 'vim-web-search-btn', '▼');
    nextBtn.title = '下一个 (n)';
    nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.next();
    });

    const closeBtn = Utils.DOMSafe.createElement('button', 'vim-web-search-btn vim-web-search-close', '✕');
    closeBtn.title = '关闭 (Esc)';
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.close();
    });

    this.searchContainer.appendChild(this.searchBox);
    this.searchContainer.appendChild(countDisplay);
    this.searchContainer.appendChild(prevBtn);
    this.searchContainer.appendChild(nextBtn);
    this.searchContainer.appendChild(closeBtn);

    document.body.appendChild(this.overlay);
    document.body.appendChild(this.searchContainer);

    this.searchBox.addEventListener('input', Utils.debounce(() => {
      this.search(this.searchBox.value);
    }, 200));

    this.searchBox.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this.prev();
        } else {
          this.next();
        }
      }
    });

    this.searchBox.focus();
  },

  _removeSearchUI() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    if (this.searchContainer) {
      this.searchContainer.remove();
      this.searchContainer = null;
    }
    this.searchBox = null;
  },

  _findMatches(keyword) {
    this.matches = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node.parentElement) return NodeFilter.FILTER_REJECT;
          const className = node.parentElement.className || '';
          if (className.startsWith('vim-web-')) return NodeFilter.FILTER_REJECT;
          if (node.parentElement.closest('.vim-web-search-container')) return NodeFilter.FILTER_REJECT;
          if (node.parentElement.tagName === 'SCRIPT' || node.parentElement.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
          if (node.textContent.trim().length === 0) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const keywordLower = keyword.toLowerCase();

    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const text = textNode.textContent.toLowerCase();
      let pos = 0;

      while ((pos = text.indexOf(keywordLower, pos)) !== -1) {
        this.matches.push({
          textNode,
          offset: pos,
          length: keyword.length
        });
        pos += keyword.length;
      }
    }
  },

  _highlightMatches(keyword) {
    if (this.matches.length === 0) return;
    if (this.matches.length > 500) return;

    const ranges = [];

    for (const match of this.matches) {
      try {
        const range = document.createRange();
        range.setStart(match.textNode, match.offset);
        range.setEnd(match.textNode, match.offset + match.length);
        ranges.push(range);
      } catch (e) {
        continue;
      }
    }

    ranges.sort((a, b) => {
      const posA = a.startContainer.compareDocumentPosition(b.startContainer);
      if (posA & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (posA & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return a.startOffset - b.startOffset;
    });

    for (const range of ranges) {
      try {
        const mark = document.createElement('mark');
        mark.className = 'vim-web-search-highlight';
        range.surroundContents(mark);
      } catch (e) {
        continue;
      }
    }

    this._highlightElements = document.querySelectorAll('.vim-web-search-highlight');
  },

  _clearHighlights() {
    const highlights = document.querySelectorAll('.vim-web-search-highlight');
    highlights.forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
        parent.normalize();
      }
    });
    this._highlightElements = null;
  },

  _scrollToMatch(index) {
    const highlights = this._highlightElements || document.querySelectorAll('.vim-web-search-highlight');
    if (!highlights || highlights.length === 0 || index < 0 || index >= highlights.length) return;

    highlights.forEach(h => h.classList.remove('current'));
    highlights[index].classList.add('current');
    highlights[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  _updateCountDisplay() {
    const countEl = document.getElementById('vim-web-search-count');
    if (!countEl) return;

    if (this.matches.length === 0) {
      countEl.textContent = this.keyword ? '无匹配' : '';
    } else {
      countEl.textContent = `${this.currentMatchIndex + 1}/${this.matches.length}`;
    }
  }
};

window.VimSearch = VimSearch;
