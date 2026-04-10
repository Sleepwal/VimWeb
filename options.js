const Utils = window.VimWebUtils;

const DEFAULT_SETTINGS = Utils.StorageManager.DEFAULTS;

const presetSelect = document.getElementById('preset-select');
const scrollValueInput = document.getElementById('scroll-value');
const scrollUnitSelect = document.getElementById('scroll-unit');
const resetBtn = document.getElementById('reset-btn');
const saveStatus = document.getElementById('save-status');
const validationMsg = document.getElementById('validation-msg');
const previewContainer = document.getElementById('preview-container');
const blacklistInput = document.getElementById('blacklist');
const blacklistStatus = document.getElementById('blacklist-status');

document.addEventListener('DOMContentLoaded', restoreOptions);

presetSelect.addEventListener('change', handlePresetChange);
scrollValueInput.addEventListener('input', handleInputChange);
scrollUnitSelect.addEventListener('change', handleInputChange);
resetBtn.addEventListener('click', resetOptions);

if (blacklistInput) {
  blacklistInput.addEventListener('input', Utils.debounce(saveBlacklist, 500));
}

previewContainer.addEventListener('keydown', (e) => {
  if (e.key === 'j' || e.key === 'k') {
    e.preventDefault();
    const settings = getCurrentSettings();

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

async function restoreOptions() {
  const items = await Utils.StorageManager.get(DEFAULT_SETTINGS);
  updateUI(items.scrollStep);
  if (blacklistInput) {
    blacklistInput.value = items.blacklist || '';
  }
}

function updateUI(scrollStep) {
  scrollValueInput.value = scrollStep.value;
  scrollUnitSelect.value = scrollStep.unit;

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

  let isValid = true;
  let msg = '';

  if (isNaN(value) || value <= 0) {
    isValid = false;
    msg = '请输入有效的正数';
  } else if (unit === '%' && (value < 5 || value > 100)) {
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

async function saveOptions() {
  const settings = getCurrentSettings();
  await Utils.StorageManager.set(settings);
  showStatus('已保存');
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

async function saveBlacklist() {
  const blacklist = blacklistInput.value;

  if (!Utils.Validators.blacklist(blacklist)) {
    blacklistStatus.textContent = '黑名单格式无效，仅允许字母、数字、点号、连字符和通配符 *';
    blacklistStatus.classList.add('show');
    blacklistStatus.style.color = '#f48771';
    setTimeout(() => {
      blacklistStatus.classList.remove('show');
      blacklistStatus.style.color = '';
    }, 3000);
    return;
  }

  await Utils.StorageManager.set({ blacklist });
  blacklistStatus.textContent = '已保存';
  blacklistStatus.classList.add('show');
  setTimeout(() => {
    blacklistStatus.classList.remove('show');
  }, 2000);
}
