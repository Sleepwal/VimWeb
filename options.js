const DEFAULT_SETTINGS = {
  scrollStep: { value: 15, unit: '%' }
};

const presetSelect = document.getElementById('preset-select');
const scrollValueInput = document.getElementById('scroll-value');
const scrollUnitSelect = document.getElementById('scroll-unit');
const resetBtn = document.getElementById('reset-btn');
const saveStatus = document.getElementById('save-status');
const validationMsg = document.getElementById('validation-msg');
const previewContainer = document.getElementById('preview-container');

// 初始化
document.addEventListener('DOMContentLoaded', restoreOptions);

// 事件监听
presetSelect.addEventListener('change', handlePresetChange);
scrollValueInput.addEventListener('input', handleInputChange);
scrollUnitSelect.addEventListener('change', handleInputChange);
resetBtn.addEventListener('click', resetOptions);

// 预览区域的简单键盘监听 (模拟 content.js 的行为)
previewContainer.addEventListener('keydown', (e) => {
  if (e.key === 'j' || e.key === 'k') {
    e.preventDefault();
    const settings = getCurrentSettings();
    
    // 计算滚动距离
    let pixelY = 0;
    if (settings.scrollStep.unit === '%') {
      pixelY = previewContainer.clientHeight * (settings.scrollStep.value / 100);
    } else {
      pixelY = settings.scrollStep.value;
    }

    if (e.key === 'j') {
      previewContainer.scrollBy({ top: pixelY, behavior: 'smooth' });
    } else {
      previewContainer.scrollBy({ top: -pixelY, behavior: 'smooth' });
    }
  }
});

function getCurrentSettings() {
  return {
    scrollStep: {
      value: parseFloat(scrollValueInput.value) || 0,
      unit: scrollUnitSelect.value
    }
  };
}

function restoreOptions() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
    updateUI(items.scrollStep);
  });
}

function updateUI(scrollStep) {
  scrollValueInput.value = scrollStep.value;
  scrollUnitSelect.value = scrollStep.unit;
  
  // 尝试匹配预设
  const currentJson = JSON.stringify(scrollStep);
  let matched = false;
  for (let option of presetSelect.options) {
    if (option.value === currentJson) {
      presetSelect.value = currentJson;
      matched = true;
      break;
    }
  }
  if (!matched) {
    presetSelect.value = 'custom';
  }
  
  validateAndSave();
}

function handlePresetChange() {
  const value = presetSelect.value;
  if (value === 'custom') return;

  const setting = JSON.parse(value);
  scrollValueInput.value = setting.value;
  scrollUnitSelect.value = setting.unit;
  validateAndSave();
}

function handleInputChange() {
  presetSelect.value = 'custom';
  validateAndSave();
}

function validateAndSave() {
  const value = parseFloat(scrollValueInput.value);
  const unit = scrollUnitSelect.value;

  // 验证
  let isValid = true;
  let msg = '';

  if (isNaN(value) || value <= 0) {
    isValid = false;
    msg = '请输入有效的正数';
  } else if (unit === '%' && (value < 5 || value > 100)) {
    // 警告但允许保存 (或者严格限制)
    // 这里根据需求：10%-200%
    if (value < 5) msg = '警告：滚动幅度过小';
    if (value > 200) msg = '警告：滚动幅度过大';
  } else if (unit === 'px' && value > 5000) {
      msg = '警告：像素值可能过大';
  }

  validationMsg.textContent = msg;

  if (isValid) {
    saveOptions();
  }
}

function saveOptions() {
  const settings = getCurrentSettings();
  chrome.storage.sync.set(settings, () => {
    showStatus('已保存');
  });
}

function resetOptions() {
  updateUI(DEFAULT_SETTINGS.scrollStep);
  showStatus('已恢复默认设置');
}

let statusTimer;
function showStatus(text) {
  saveStatus.textContent = text;
  saveStatus.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    saveStatus.classList.remove('show');
  }, 2000);
}
