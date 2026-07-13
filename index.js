const MODULE_NAME = 'quikinput';
const FIELD_NAME = 'quikinput';

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
});

let editorCharacterId = null;
let barElement = null;
let settingsElement = null;

function context() {
    return SillyTavern.getContext();
}

function getSettings() {
    const { extensionSettings } = context();
    extensionSettings[MODULE_NAME] ??= structuredClone(DEFAULT_SETTINGS);
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        extensionSettings[MODULE_NAME][key] ??= value;
    }
    return extensionSettings[MODULE_NAME];
}

function emptyCharacterConfig() {
    return { enabled: true, buttons: [] };
}

function getCharacterConfig(characterId) {
    const character = context().characters?.[characterId];
    const stored = character?.data?.extensions?.[FIELD_NAME];
    if (!stored || typeof stored !== 'object') return emptyCharacterConfig();

    return {
        enabled: stored.enabled !== false,
        buttons: Array.isArray(stored.buttons)
            ? stored.buttons.map((button) => ({
                id: String(button.id || crypto.randomUUID()),
                label: String(button.label || ''),
                value: String(button.value ?? button.label ?? ''),
                mode: ['replace', 'append', 'cursor'].includes(button.mode) ? button.mode : 'cursor',
            }))
            : [],
    };
}

async function saveCharacterConfig(characterId, config) {
    if (!Number.isInteger(characterId) || !context().characters?.[characterId]) return;
    await context().writeExtensionField(characterId, FIELD_NAME, config);
    renderBar();
}

function placeText(value, mode) {
    const input = document.querySelector('#send_textarea');
    if (!(input instanceof HTMLTextAreaElement)) return;

    if (mode === 'replace') {
        input.value = value;
        input.setSelectionRange(value.length, value.length);
    } else if (mode === 'append') {
        input.value += value;
        input.setSelectionRange(input.value.length, input.value.length);
    } else {
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        input.setRangeText(value, start, end, 'end');
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
}

function ensureBar() {
    if (barElement?.isConnected) return barElement;
    const sendForm = document.querySelector('#send_form');
    if (!sendForm?.parentElement) return null;

    barElement = document.createElement('div');
    barElement.id = 'quikinput-bar';
    barElement.setAttribute('aria-label', 'Character Quick Input');
    sendForm.parentElement.insertBefore(barElement, sendForm);
    return barElement;
}

function renderBar() {
    const bar = ensureBar();
    if (!bar) return;
    bar.replaceChildren();

    const { characterId } = context();
    const settings = getSettings();
    if (!settings.enabled || !Number.isInteger(characterId)) {
        bar.hidden = true;
        return;
    }

    const config = getCharacterConfig(characterId);
    if (!config.enabled || config.buttons.length === 0) {
        bar.hidden = true;
        return;
    }

    for (const item of config.buttons) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu_button quikinput-button';
        button.textContent = item.label || item.value || '未命名';
        button.title = item.value;
        button.addEventListener('click', () => placeText(item.value, item.mode));
        bar.append(button);
    }
    bar.hidden = false;
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

    const currentId = Number.isInteger(context().characterId) ? context().characterId : null;
    editorCharacterId = Number.isInteger(previous) && context().characters?.[previous]
        ? previous
        : currentId;
    select.value = editorCharacterId === null ? '' : String(editorCharacterId);
}

function renderEditor() {
    const container = settingsElement?.querySelector('#quikinput-editor');
    const enabled = settingsElement?.querySelector('#quikinput-character-enabled');
    if (!container || !(enabled instanceof HTMLInputElement)) return;
    container.replaceChildren();

    if (!Number.isInteger(editorCharacterId) || !context().characters?.[editorCharacterId]) {
        enabled.checked = false;
        enabled.disabled = true;
        container.textContent = '选择一张角色卡后即可添加按钮。';
        return;
    }

    const config = getCharacterConfig(editorCharacterId);
    enabled.disabled = false;
    enabled.checked = config.enabled;

    config.buttons.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'quikinput-editor-row';
        row.dataset.index = String(index);

        const label = document.createElement('input');
        label.className = 'text_pole quikinput-label';
        label.placeholder = '按钮文字';
        label.value = item.label;

        const value = document.createElement('input');
        value.className = 'text_pole quikinput-value';
        value.placeholder = '填入输入框的内容';
        value.value = item.value;

        const mode = document.createElement('select');
        mode.className = 'text_pole quikinput-mode';
        mode.append(
            makeOption('cursor', '光标处插入'),
            makeOption('append', '末尾追加'),
            makeOption('replace', '替换全部'),
        );
        mode.value = item.mode;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'menu_button quikinput-remove';
        remove.title = '删除';
        remove.textContent = '×';

        row.append(label, value, mode, remove);
        container.append(row);
    });
}

async function saveEditorRows() {
    if (!Number.isInteger(editorCharacterId)) return;
    const oldConfig = getCharacterConfig(editorCharacterId);
    const rows = [...settingsElement.querySelectorAll('.quikinput-editor-row')];
    const buttons = rows.map((row, index) => ({
        id: oldConfig.buttons[index]?.id || crypto.randomUUID(),
        label: row.querySelector('.quikinput-label').value.trim(),
        value: row.querySelector('.quikinput-value').value,
        mode: row.querySelector('.quikinput-mode').value,
    }));
    await saveCharacterConfig(editorCharacterId, { ...oldConfig, buttons });
}

function createSettings() {
    if (document.querySelector('#quikinput-settings')) {
        settingsElement = document.querySelector('#quikinput-settings');
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
                <label class="checkbox_label"><input id="quikinput-master-enabled" type="checkbox"><span>启用扩展</span></label>
                <label for="quikinput-character">编辑角色卡</label>
                <select id="quikinput-character" class="text_pole"></select>
                <label class="checkbox_label"><input id="quikinput-character-enabled" type="checkbox"><span>为该角色显示快捷输入按钮</span></label>
                <div id="quikinput-editor"></div>
                <button id="quikinput-add" type="button" class="menu_button">＋ 添加按钮</button>
                <small>配置保存在角色卡的 extensions.quikinput 字段中。群聊暂不显示。</small>
            </div>
        </div>`;
    host.append(wrapper);
    settingsElement = wrapper;

    const master = wrapper.querySelector('#quikinput-master-enabled');
    master.checked = getSettings().enabled;
    master.addEventListener('change', () => {
        getSettings().enabled = master.checked;
        context().saveSettingsDebounced();
        renderBar();
    });

    wrapper.querySelector('#quikinput-character').addEventListener('change', (event) => {
        editorCharacterId = event.target.value === '' ? null : Number(event.target.value);
        renderEditor();
    });

    wrapper.querySelector('#quikinput-character-enabled').addEventListener('change', async (event) => {
        if (!Number.isInteger(editorCharacterId)) return;
        const config = getCharacterConfig(editorCharacterId);
        config.enabled = event.target.checked;
        await saveCharacterConfig(editorCharacterId, config);
    });

    wrapper.querySelector('#quikinput-add').addEventListener('click', async () => {
        if (!Number.isInteger(editorCharacterId)) return;
        const config = getCharacterConfig(editorCharacterId);
        config.buttons.push({ id: crypto.randomUUID(), label: '新按钮', value: '', mode: 'cursor' });
        await saveCharacterConfig(editorCharacterId, config);
        renderEditor();
    });

    wrapper.querySelector('#quikinput-editor').addEventListener('change', saveEditorRows);
    wrapper.querySelector('#quikinput-editor').addEventListener('click', async (event) => {
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
    renderBar();
}

function initialize() {
    getSettings();
    createSettings();
    refreshAll();

    const { eventSource, event_types } = context();
    eventSource.on(event_types.CHAT_CHANGED, refreshAll);
    eventSource.on(event_types.CHARACTER_EDITED, refreshAll);
    eventSource.on(event_types.CHARACTER_DELETED, refreshAll);
    eventSource.on(event_types.CHARACTER_DUPLICATED, refreshAll);
}

const { eventSource, event_types } = context();
eventSource.on(event_types.APP_READY, initialize);
