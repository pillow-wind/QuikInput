const MODULE_NAME = 'quikinput';
const FIELD_NAME = 'quikinput';
const QR_SET_NAME = '角色名快捷输入';
const LEGACY_QR_SET_NAME = '角色名快捷输入（QuikInput）';

const DEFAULT_SETTINGS = Object.freeze({ enabled: true });

let editorCharacterId = null;
let settingsElement = null;
let quickReplyApi = null;
let lastQrSignature = null;
let qrSyncQueue = Promise.resolve();

function context() {
    return SillyTavern.getContext();
}

function getCurrentCharacterId() {
    const { characterId } = context();
    if (typeof characterId !== 'number' && typeof characterId !== 'string') return null;
    const id = Number(characterId);
    return Number.isInteger(id) ? id : null;
}

function getSettings() {
    const { extensionSettings } = context();
    extensionSettings[MODULE_NAME] ??= structuredClone(DEFAULT_SETTINGS);
    extensionSettings[MODULE_NAME].enabled ??= DEFAULT_SETTINGS.enabled;
    return extensionSettings[MODULE_NAME];
}

function getCharacterConfig(characterId) {
    const stored = context().characters?.[characterId]?.data?.extensions?.[FIELD_NAME];
    return {
        buttons: Array.isArray(stored?.buttons)
            ? stored.buttons.map(button => ({
                id: String(button.id || crypto.randomUUID()),
                label: String(button.label || ''),
                value: String(button.value ?? button.label ?? ''),
            }))
            : [],
    };
}

async function saveCharacterConfig(characterId, config) {
    if (!Number.isInteger(characterId) || !context().characters?.[characterId]) return;
    await context().writeExtensionField(characterId, FIELD_NAME, config);
    if (characterId === getCurrentCharacterId()) queueQuickReplySync(true);
}

function insertAtCursor(value) {
    const input = document.querySelector('#send_textarea');
    if (!(input instanceof HTMLTextAreaElement)) return;

    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText(value, start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
}

function preserveInputFocus(event) {
    if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;

    const button = event.target.closest('.qr--button');
    if (!(button instanceof HTMLElement)) return;

    const set = quickReplyApi?.getSetByName(QR_SET_NAME);
    const isManagedButton = set?.qrList?.some(qr => qr.dom === button);
    if (isManagedButton) event.preventDefault();
}

async function waitForQuickReplyApi() {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (globalThis.quickReplyApi) return globalThis.quickReplyApi;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.error('[QuikInput] Quick Reply API 未初始化，请确认内置 Quick Reply 扩展已启用。');
    return null;
}

function queueQuickReplySync(force = false) {
    qrSyncQueue = qrSyncQueue
        .then(() => syncQuickReplySet(force))
        .catch(error => console.error('[QuikInput] 同步 Quick Reply Set 失败：', error));
    return qrSyncQueue;
}

async function syncQuickReplySet(force = false) {
    quickReplyApi ??= await waitForQuickReplyApi();
    if (!quickReplyApi) return;

    const legacySet = quickReplyApi.getSetByName(LEGACY_QR_SET_NAME);
    if (legacySet) {
        if (quickReplyApi.listGlobalSets().includes(LEGACY_QR_SET_NAME)) {
            quickReplyApi.removeGlobalSet(LEGACY_QR_SET_NAME);
        }
        await quickReplyApi.deleteSet(LEGACY_QR_SET_NAME);
    }

    const characterId = getCurrentCharacterId();
    const enabled = getSettings().enabled;
    const buttons = enabled && characterId !== null
        ? getCharacterConfig(characterId).buttons
        : [];
    const signature = JSON.stringify({ enabled, characterId, buttons });
    if (!force && signature === lastQrSignature) return;

    let set = quickReplyApi.getSetByName(QR_SET_NAME);
    if (!set) {
        set = await quickReplyApi.createSet(QR_SET_NAME, {
            disableSend: true,
            placeBeforeInput: false,
            injectInput: false,
        });
    } else if (!set.disableSend || set.placeBeforeInput || set.injectInput) {
        set = await quickReplyApi.updateSet(QR_SET_NAME, {
            disableSend: true,
            placeBeforeInput: false,
            injectInput: false,
        });
    }

    for (const qr of [...set.qrList]) {
        quickReplyApi.deleteQuickReply(QR_SET_NAME, qr.id);
    }

    for (const item of buttons) {
        const qr = quickReplyApi.createQuickReply(QR_SET_NAME, item.label || item.value || '未命名', {
            message: `quikinput:${item.id}`,
            title: item.value,
            showLabel: true,
        });
        qr.onExecute = async () => {
            insertAtCursor(item.value);
            return '';
        };
    }

    await set.save();
    const isActive = quickReplyApi.listGlobalSets().includes(QR_SET_NAME);
    if (enabled && buttons.length > 0 && !isActive) {
        quickReplyApi.addGlobalSet(QR_SET_NAME, true);
    } else if ((!enabled || buttons.length === 0) && isActive) {
        quickReplyApi.removeGlobalSet(QR_SET_NAME);
    }

    lastQrSignature = signature;
}

function makeOption(value, text) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = text;
    return option;
}

function refreshCharacterSelect() {
    const select = settingsElement?.querySelector('#quikinput-character');
    if (!(select instanceof HTMLSelectElement)) return;
    const previous = editorCharacterId;
    select.replaceChildren(makeOption('', '请选择角色卡'));

    context().characters?.forEach((character, index) => {
        const name = character?.name || character?.data?.name || `角色 ${index + 1}`;
        select.append(makeOption(index, name));
    });

    const currentId = getCurrentCharacterId();
    editorCharacterId = Number.isInteger(previous) && context().characters?.[previous]
        ? previous
        : currentId;
    select.value = editorCharacterId === null ? '' : String(editorCharacterId);
}

function renderEditor() {
    const container = settingsElement?.querySelector('#quikinput-editor');
    if (!container) return;
    container.replaceChildren();

    if (!Number.isInteger(editorCharacterId) || !context().characters?.[editorCharacterId]) {
        container.textContent = '选择一张角色卡后即可添加名称。';
        return;
    }

    const config = getCharacterConfig(editorCharacterId);
    config.buttons.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'quikinput-editor-row';
        row.dataset.index = String(index);
        row.dataset.id = item.id;

        const drag = document.createElement('div');
        drag.className = 'drag-handle ui-sortable-handle quikinput-drag';
        drag.title = '拖拽排序';
        drag.textContent = '☰';

        const label = document.createElement('input');
        label.className = 'text_pole quikinput-label';
        label.placeholder = '按钮文字';
        label.value = item.label;

        const value = document.createElement('input');
        value.className = 'text_pole quikinput-value';
        value.placeholder = '填入输入框的内容';
        value.value = item.value;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'menu_button fa-solid fa-trash-can fa-fw quikinput-remove';
        remove.title = '删除';

        row.append(drag, label, value, remove);
        container.append(row);
    });

    enableEditorSorting();
}

function readEditorRows() {
    return [...settingsElement.querySelectorAll('.quikinput-editor-row')].map(row => ({
        id: row.dataset.id || crypto.randomUUID(),
        label: row.querySelector('.quikinput-label').value.trim(),
        value: row.querySelector('.quikinput-value').value,
    }));
}

async function saveEditorRows() {
    if (!Number.isInteger(editorCharacterId)) return;
    await saveCharacterConfig(editorCharacterId, { buttons: readEditorRows() });
}

function enableEditorSorting() {
    const container = settingsElement?.querySelector('#quikinput-editor');
    if (!container || typeof globalThis.jQuery?.fn?.sortable !== 'function') return;

    const $container = globalThis.jQuery(container);
    if ($container.sortable('instance')) $container.sortable('destroy');
    $container.sortable({
        axis: 'y',
        delay: globalThis.matchMedia?.('(pointer: coarse)')?.matches ? 750 : 50,
        handle: '.drag-handle',
        items: '.quikinput-editor-row',
        placeholder: 'quikinput-sort-placeholder',
        stop: async () => {
            await saveEditorRows();
            renderEditor();
        },
    });
}

function createSettings() {
    const existing = document.querySelector('#quikinput-settings');
    if (existing) {
        settingsElement = existing;
        return;
    }
    const host = document.querySelector('#extensions_settings2');
    if (!host) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'quikinput-settings';
    wrapper.className = 'extension_container';
    wrapper.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>角色名快捷输入</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="quikinput-toolbar">
                    <label class="checkbox_label"><input id="quikinput-master-enabled" type="checkbox"><span>启用扩展</span></label>
                    <button id="quikinput-add" type="button" class="menu_button">＋ 添加名称</button>
                </div>
                <div class="quikinput-character-row">
                    <label for="quikinput-character">选择角色</label>
                    <select id="quikinput-character" class="text_pole"></select>
                </div>
                <div id="quikinput-editor"></div>
            </div>
        </div>`;
    host.append(wrapper);
    settingsElement = wrapper;

    const master = wrapper.querySelector('#quikinput-master-enabled');
    master.checked = getSettings().enabled;
    master.addEventListener('change', () => {
        getSettings().enabled = master.checked;
        context().saveSettingsDebounced();
        queueQuickReplySync(true);
    });

    wrapper.querySelector('#quikinput-character').addEventListener('change', event => {
        editorCharacterId = event.target.value === '' ? null : Number(event.target.value);
        renderEditor();
    });

    wrapper.querySelector('#quikinput-add').addEventListener('click', async () => {
        if (!Number.isInteger(editorCharacterId)) return;
        const config = getCharacterConfig(editorCharacterId);
        config.buttons.push({ id: crypto.randomUUID(), label: '角色名', value: '' });
        await saveCharacterConfig(editorCharacterId, config);
        renderEditor();
    });

    wrapper.querySelector('#quikinput-editor').addEventListener('change', saveEditorRows);
    wrapper.querySelector('#quikinput-editor').addEventListener('click', async event => {
        const remove = event.target.closest('.quikinput-remove');
        if (!remove || !Number.isInteger(editorCharacterId)) return;
        const index = Number(remove.closest('.quikinput-editor-row').dataset.index);
        const config = getCharacterConfig(editorCharacterId);
        config.buttons.splice(index, 1);
        await saveCharacterConfig(editorCharacterId, config);
        renderEditor();
    });
}

function refreshAll() {
    refreshCharacterSelect();
    renderEditor();
    queueQuickReplySync(true);
}

async function initialize() {
    getSettings();
    createSettings();
    quickReplyApi = await waitForQuickReplyApi();
    document.addEventListener('pointerdown', preserveInputFocus, { capture: true });
    refreshAll();

    const { eventSource, event_types } = context();
    eventSource.on(event_types.CHAT_CHANGED, refreshAll);
    eventSource.on(event_types.CHARACTER_EDITED, refreshAll);
    eventSource.on(event_types.CHARACTER_DELETED, refreshAll);
    eventSource.on(event_types.CHARACTER_DUPLICATED, refreshAll);
}

const { eventSource, event_types } = context();
eventSource.on(event_types.APP_READY, initialize);
