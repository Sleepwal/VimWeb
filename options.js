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
const keyMappingsList = document.getElementById('key-mappings-list');
const resetMappingsBtn = document.getElementById('reset-mappings-btn');
const exportMappingsBtn = document.getElementById('export-mappings-btn');
const importMappingsBtn = document.getElementById('import-mappings-btn');
const importFile = document.getElementById('import-file');
const mappingsStatus = document.getElementById('mappings-status');

const ACTION_NAMES = {
  scrollDown: '向下滚动',
  scrollUp: '向上滚动',
  scrollLeft: '向左滚动',
  scrollRight: '向右滚动',
  scrollToTop: '回到顶部',
  scrollToBottom: '直达底部',
  enterHintMode: 'Hint 模式',
  clickAtCursor: '点击光标处',
  goBack: '返回上一页',
  closeTab: '关闭标签页',
  restoreTab: '恢复标签页',
  nextTab: '下一个标签页',
  prevTab: '上一个标签页',
  openSearch: '打开搜索',
  searchNext: '下一个匹配',
  searchPrev: '上一个匹配',
  searchWordUnderCursor: '搜索光标下单词'
};

const DEFAULT_KEY_MAPPINGS = {
  'j': 'scrollDown',
  'k': 'scrollUp',
  'h': 'scrollLeft',
  'l': 'scrollRight',
  'gg': 'scrollToTop',
  'G': 'scrollToBottom',
  'f': 'enterHintMode',
  ' ': 'clickAtCursor',
  'q': 'goBack',
  'Q': 'goBack',
  'x': 'closeTab',
  'X': 'restoreTab',
  'gt': 'nextTab',
  'gT': 'prevTab',
  '/': 'openSearch',
  'n': 'searchNext',
  'N': 'searchPrev',
  '*': 'searchWordUnderCursor'
};

let userMappings = {};

document.addEventListener('DOMContentLoaded', async () => {
  await restoreOptions();
  await loadKeyMappings();
});

presetSelect.addEventListener('change', handlePresetChange);
scrollValueInput.addEventListener('input', handleInputChange);
scrollUnitSelect.addEventListener('change', handleInputChange);
resetBtn.addEventListener('click', resetOptions);

if (blacklistInput) {
  blacklistInput.addEventListener('input', Utils.debounce(saveBlacklist, 500));
}

if (resetMappingsBtn) {
  resetMappingsBtn.addEventListener('click', resetKeyMappings);
}
if (exportMappingsBtn) {
  exportMappingsBtn.addEventListener('click', exportKeyMappings);
}
if (importMappingsBtn) {
  importMappingsBtn.addEventListener('click', () => importFile.click());
}
if (importFile) {
  importFile.addEventListener('change', importKeyMappings);
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
  showStatus('已保存', saveStatus);
}

function resetOptions() {
  updateUI(DEFAULT_SETTINGS.scrollStep);
  showStatus('已恢复默认设置', saveStatus);
}

function showStatus(text, el) {
  if (!el) el = saveStatus;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.remove('show');
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

// ==========================================
// 快捷键映射管理
// ==========================================

async function loadKeyMappings() {
  if (!keyMappingsList) return;

  const items = await Utils.StorageManager.get(['keyMappings']);
  userMappings = items.keyMappings || {};

  renderKeyMappings();
}

function renderKeyMappings() {
  if (!keyMappingsList) return;
  keyMappingsList.innerHTML = '';

  const allMappings = { ...DEFAULT_KEY_MAPPINGS, ...userMappings };

  for (const [key, action] of Object.entries(allMappings)) {
    const row = document.createElement('div');
    row.className = 'key-mapping-row';

    const keyLabel = document.createElement('span');
    keyLabel.className = 'key-mapping-key';
    keyLabel.textContent = displayKey(key);

    const actionLabel = document.createElement('span');
    actionLabel.className = 'key-mapping-action';
    actionLabel.textContent = ACTION_NAMES[action] || action;

    const isCustom = userMappings[key] !== undefined;
    if (isCustom) {
      const customBadge = document.createElement('span');
      customBadge.className = 'key-mapping-badge';
      customBadge.textContent = '自定义';
      actionLabel.appendChild(customBadge);
    }

    const recordBtn = document.createElement('button');
    recordBtn.className = 'btn secondary key-mapping-btn';
    recordBtn.textContent = '录制';
    recordBtn.dataset.action = action;
    recordBtn.dataset.originalKey = key;
    recordBtn.addEventListener('click', startRecording);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn secondary key-mapping-btn';
    removeBtn.textContent = '重置';
    removeBtn.dataset.key = key;
    removeBtn.addEventListener('click', removeMapping);

    row.appendChild(keyLabel);
    row.appendChild(actionLabel);
    row.appendChild(recordBtn);
    row.appendChild(removeBtn);

    keyMappingsList.appendChild(row);
  }
}

function displayKey(key) {
  if (key === ' ') return 'Space';
  if (key === '/') return '/';
  return key;
}

let recordingBtn = null;

function startRecording(e) {
  if (recordingBtn) {
    recordingBtn.textContent = '录制';
    recordingBtn.classList.remove('recording');
  }

  recordingBtn = e.target;
  recordingBtn.textContent = '按下新键...';
  recordingBtn.classList.add('recording');

  const action = recordingBtn.dataset.action;

  const handler = (ke) => {
    ke.preventDefault();
    ke.stopPropagation();

    if (ke.key === 'Escape') {
      recordingBtn.textContent = '录制';
      recordingBtn.classList.remove('recording');
      recordingBtn = null;
      document.removeEventListener('keydown', handler, true);
      return;
    }

    const newKey = ke.key;
    userMappings[newKey] = action;

    const originalKey = recordingBtn.dataset.originalKey;
    if (originalKey !== newKey && userMappings[originalKey] === action) {
      delete userMappings[originalKey];
    }

    saveKeyMappings();
    renderKeyMappings();

    recordingBtn = null;
    document.removeEventListener('keydown', handler, true);
  };

  document.addEventListener('keydown', handler, true);
}

async function removeMapping(e) {
  const key = e.target.dataset.key;
  delete userMappings[key];
  await saveKeyMappings();
  renderKeyMappings();
}

async function resetKeyMappings() {
  userMappings = {};
  await Utils.StorageManager.set({ keyMappings: {} });
  renderKeyMappings();
  showStatus('已恢复默认映射', mappingsStatus);
}

async function saveKeyMappings() {
  await Utils.StorageManager.set({ keyMappings: userMappings });
  showStatus('已保存', mappingsStatus);
}

function exportKeyMappings() {
  const data = JSON.stringify(userMappings, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vim-web-key-mappings.json';
  a.click();
  URL.revokeObjectURL(url);
  showStatus('映射已导出', mappingsStatus);
}

function importKeyMappings(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const mappings = JSON.parse(event.target.result);
      if (!Utils.Validators.keyMappings(mappings)) {
        showStatus('导入失败：格式无效', mappingsStatus);
        return;
      }
      userMappings = mappings;
      await saveKeyMappings();
      renderKeyMappings();
      showStatus('映射已导入', mappingsStatus);
    } catch (err) {
      showStatus('导入失败：文件解析错误', mappingsStatus);
    }
  };
  reader.readAsText(file);
  importFile.value = '';
}
