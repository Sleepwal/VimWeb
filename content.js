(() => {
  console.log("[Vim Web] Loaded");

  let keyBuffer = "";
  const BUFFER_TIMEOUT = 400;
  let bufferTimer = null;

  function isEditable(el) {
    if (!el) return false;
    return el.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
  }

  function scrollByRatio(ratioY = 0, ratioX = 0) {
    const h = window.innerHeight;
    const w = window.innerWidth;
    window.scrollBy({
      top: h * ratioY,
      left: w * ratioX,
      behavior: "smooth"
    });
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  function resetBuffer() {
    keyBuffer = "";
    if (bufferTimer) {
      clearTimeout(bufferTimer);
      bufferTimer = null;
    }
  }

  function pushKey(key) {
    keyBuffer += key;
    if (bufferTimer) clearTimeout(bufferTimer);
    bufferTimer = setTimeout(resetBuffer, BUFFER_TIMEOUT);
  }

  function handleVimKey(e) {
    const key = e.key;

    // 单键操作
    if (key === "j") {
      e.preventDefault();
      scrollByRatio(0.15);
      return;
    }

    if (key === "k") {
      e.preventDefault();
      scrollByRatio(-0.15);
      return;
    }

    if (key === "h") {
      e.preventDefault();
      scrollByRatio(0, -0.15);
      return;
    }

    if (key === "l") {
      e.preventDefault();
      scrollByRatio(0, 0.15);
      return;
    }

    // 组合键：gg / G
    pushKey(key);

    if (keyBuffer === "gg") {
      e.preventDefault();
      scrollToTop();
      resetBuffer();
      return;
    }

    if (key === "G") {
      e.preventDefault();
      scrollToBottom();
      resetBuffer();
      return;
    }
  }

  document.addEventListener("keydown", (e) => {
    if (isEditable(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    handleVimKey(e);
  }, true);

})();
