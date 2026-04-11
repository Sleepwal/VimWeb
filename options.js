/**
 * Vim Web 设置页面脚本
 *
 * 管理扩展的所有用户可配置项：
 * 1. 滚动步长：支持百分比和像素两种单位，带实时预览
 * 2. 快捷键映射：可视化编辑、录制、导入/导出
 * 3. 黑名单：域名列表，支持通配符
 *
 * 所有配置通过 StorageManager 异步读写，
 * 保存前使用 Validators 验证数据完整性。
 *
 * 依赖：window.VimWebUtils（StorageManager、Validators、DOMSafe、debounce）
 */
const Utils = window.VimWebUtils;

/** @type {Object} 存储默认值引用，用于初始化和重置 */
const DEFAULT_SETTINGS = Utils.StorageManager.DEFAULTS;

// ==========================================
// DOM 元素引用
// ==========================================

/** @type {HTMLSelectElement} 预设方案下拉框 */
const presetSelect = document.getElementById('preset-select');
/** @type {HTMLInputElement} 滚动步长数值输入框 */
const scrollValueInput = document.getElementById('scroll-value');
/** @type {HTMLSelectElement} 滚动步长单位选择框 */
const scrollUnitSelect = document.getElementById('scroll-unit');
/** @type {HTMLButtonElement} 恢复默认按钮 */
const resetBtn = document.getElementById('reset-btn');
/** @type {HTMLElement} 保存状态提示 */
const saveStatus = document.getElementById('save-status');
/** @type {HTMLElement} 验证消息提示 */
const validationMsg = document.getElementById('validation-msg');
/** @type {HTMLElement} 滚动预览容器 */
const previewContainer = document.getElementById('preview-container');
/** @type {HTMLTextAreaElement} 黑名单文本域 */
const blacklistInput = document.getElementById('blacklist');
/** @type {HTMLElement} 黑名单保存状态提示 */
const blacklistStatus = document.getElementById('blacklist-status');
/** @type {HTMLElement} 快捷键映射列表容器 */
const keyMappingsList = document.getElementById('key-mappings-list');
/** @type {HTMLButtonElement} 重置映射按钮 */
const resetMappingsBtn = document.getElementById('reset-mappings-btn');
/** @type {HTMLButtonElement} 导出映射按钮 */
const exportMappingsBtn = document.getElementById('export-mappings-btn');
/** @type {HTMLButtonElement} 导入映射按钮 */
const importMappingsBtn = document.getElementById('import-mappings-btn');
/** @type {HTMLInputElement} 导入文件选择器（隐藏） */
const importFile = document.getElementById('import-file');
/** @type {HTMLElement} 映射操作状态提示 */
const mappingsStatus = document.getElementById('mappings-status');

/**
 * 命令名到中文显示名的映射
 * 用于快捷键映射列表中显示可读的命令名称
 * @type {Object<string, string>}
 */
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
  searchWordUnderCursor: '搜索光标下单词',
  openBookmarks: '打开书签',
  openHistory: '打开历史记录',
  showTabList: '标签页列表',
  jumpToLastInput: '上一个输入框',
  jumpToFirstInput: '第一个输入框',
  jumpToNextLink: '下一页链接',
  jumpToPrevLink: '上一页链接'
};

/**
 * 默认快捷键映射表
 * 与 content.js 中 KeyMapper.defaultMappings 保持一致
 * @type {Object<string, string>}
 */
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
  '*': 'searchWordUnderCursor',
  'B': 'openBookmarks',
  'H': 'openHistory',
  'b': 'showTabList',
  'gi': 'jumpToLastInput',
  'gI': 'jumpToFirstInput',
  ']]': 'jumpToNextLink',
  '[[': 'jumpToPrevLink'
};

/** @type {Object<string, string>} 用户自定义映射（从存储加载） */
let userMappings = {};

// ==========================================
// 初始化
// ==========================================

/**
 * 页面加载完成后初始化所有设置
 */
document.addEventListener('DOMContentLoaded', async () => {
  await restoreOptions();
  await loadKeyMappings();
});

// ==========================================
// 滚动步长设置
// ==========================================

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

/**
 * 滚动预览区域的键盘事件处理
 *
 * 在预览区域内按 j/k 测试滚动效果，
 * 根据当前配置的步长和单位计算滚动距离。
 */
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

/**
 * 获取当前滚动步长设置
 * @returns {{scrollStep: {value: number, unit: string}}} 当前设置
 */
function getCurrentSettings() {
  return {
    scrollStep: {
      value: parseFloat(scrollValueInput.value) || 0,
      unit: scrollUnitSelect.value
    }
  };
}

/**
 * 从存储恢复所有设置
 *
 * 异步读取 chrome.storage.sync 中的配置，
 * 更新 UI 控件的显示值。
 */
async function restoreOptions() {
  const items = await Utils.StorageManager.get(DEFAULT_SETTINGS);
  updateUI(items.scrollStep);
  if (blacklistInput) {
    blacklistInput.value = items.blacklist || '';
  }
}

/**
 * 更新滚动步长 UI 控件
 *
 * 同步数值输入框、单位选择框和预设下拉框的状态。
 * 如果当前值匹配某个预设，自动选中该预设；否则显示"自定义"。
 *
 * @param {{value: number, unit: string}} scrollStep - 滚动步长配置
 */
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

/**
 * 处理预设方案变更
 *
 * 将预设值填入数值和单位输入框，然后验证保存。
 */
function handlePresetChange() {
  const value = presetSelect.value;
  if (value === 'custom') return;

  const setting = JSON.parse(value);
  scrollValueInput.value = setting.value;
  scrollUnitSelect.value = setting.unit;
  validateAndSave();
}

/**
 * 处理输入值变更
 *
 * 用户手动修改数值或单位时，切换预设为"自定义"。
 */
function handleInputChange() {
  presetSelect.value = 'custom';
  validateAndSave();
}

/**
 * 验证并保存滚动步长设置
 *
 * 验证规则：
 * - 数值必须为正数
 * - 百分比模式下 < 5% 或 > 200% 显示警告
 * - 像素模式下 > 5000px 显示警告
 *
 * 验证通过后自动保存到 chrome.storage.sync。
 */
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

/**
 * 保存滚动步长设置到存储
 */
async function saveOptions() {
  const settings = getCurrentSettings();
  await Utils.StorageManager.set(settings);
  showStatus('已保存', saveStatus);
}

/**
 * 重置滚动步长为默认值
 */
function resetOptions() {
  updateUI(DEFAULT_SETTINGS.scrollStep);
  showStatus('已恢复默认设置', saveStatus);
}

/**
 * 显示状态提示（2秒后自动消失）
 *
 * @param {string} text - 提示文本
 * @param {HTMLElement} el - 提示元素
 */
function showStatus(text, el) {
  if (!el) el = saveStatus;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.remove('show');
  }, 2000);
}

// ==========================================
// 黑名单设置
// ==========================================

/**
 * 保存黑名单到存储
 *
 * 保存前验证格式，无效时显示红色错误提示。
 * 使用 500ms 防抖，避免频繁保存。
 */
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

/**
 * 从存储加载用户自定义映射并渲染列表
 */
async function loadKeyMappings() {
  if (!keyMappingsList) return;

  const items = await Utils.StorageManager.get(['keyMappings']);
  userMappings = items.keyMappings || {};

  renderKeyMappings();
}

/**
 * 渲染快捷键映射列表
 *
 * 合并默认映射和用户映射，为每个映射创建一行：
 * - 按键标签（kbd 样式）
 * - 命令名称（中文）
 * - 自定义标记（紫色徽章）
 * - 录制按钮（重新绑定按键）
 * - 重置按钮（恢复默认绑定）
 */
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

    // 用户自定义映射显示紫色徽章
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

/**
 * 将按键字符转换为可读的显示文本
 *
 * @param {string} key - 按键字符
 * @returns {string} 可读的按键名称
 */
function displayKey(key) {
  if (key === ' ') return 'Space';
  if (key === '/') return '/';
  return key;
}

/** @type {HTMLElement|null} 当前正在录制的按钮 */
let recordingBtn = null;

/**
 * 开始录制新的快捷键
 *
 * 点击"录制"按钮后，按钮变为红色闪烁状态，
 * 等待用户按下新按键。按 Esc 取消录制。
 *
 * 录制完成后：
 * 1. 将新按键绑定到原命令
 * 2. 如果原按键与新按键不同，删除原按键的用户映射
 * 3. 保存并重新渲染列表
 */
function startRecording(e) {
  // 如果有其他按钮正在录制，先取消
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

    // Esc 取消录制
    if (ke.key === 'Escape') {
      recordingBtn.textContent = '录制';
      recordingBtn.classList.remove('recording');
      recordingBtn = null;
      document.removeEventListener('keydown', handler, true);
      return;
    }

    // 绑定新按键到命令
    const newKey = ke.key;
    userMappings[newKey] = action;

    // 如果原按键与新按键不同，删除原按键的用户映射
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

/**
 * 删除单个用户快捷键映射
 *
 * 删除后该按键回退到默认映射。
 *
 * @param {Event} e - 点击事件
 */
async function removeMapping(e) {
  const key = e.target.dataset.key;
  delete userMappings[key];
  await saveKeyMappings();
  renderKeyMappings();
}

/**
 * 重置所有用户映射为空（恢复全部默认）
 */
async function resetKeyMappings() {
  userMappings = {};
  await Utils.StorageManager.set({ keyMappings: {} });
  renderKeyMappings();
  showStatus('已恢复默认映射', mappingsStatus);
}

/**
 * 保存用户映射到存储
 */
async function saveKeyMappings() {
  await Utils.StorageManager.set({ keyMappings: userMappings });
  showStatus('已保存', mappingsStatus);
}

/**
 * 导出用户映射为 JSON 文件
 *
 * 创建 Blob 并触发下载，文件名为 vim-web-key-mappings.json。
 */
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

/**
 * 从 JSON 文件导入用户映射
 *
 * 读取文件内容，验证格式后保存。
 * 格式无效时显示错误提示。
 *
 * @param {Event} e - 文件选择事件
 */
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
