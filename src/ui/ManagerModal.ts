import { getShortcuts, setShortcuts, cryptoRandomId } from '../lib/storage';
import type { Shortcut } from '../lib/types';

export class PSManagerModal {
  private host: HTMLDivElement | null = null;
  private root: ShadowRoot | null = null;
  private open = false;
  private shortcuts: Shortcut[] = [];
  private layerEl: HTMLDivElement | null = null;

  async mount() {
    if (this.host) return;
    const host = document.createElement('div');
    host.id = 'ps-manager-host';
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'none';
    this.host = host;
    const shadow = host.attachShadow({ mode: 'open' });
    this.root = shadow;
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .layer { position: fixed; inset: 0; pointer-events: auto; }
      .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.4); display: none; }
      .panel { position: absolute; top: 10vh; left: 50%; transform: translateX(-50%);
        width: min(720px, 96vw); max-height: 80vh; overflow: auto; background: var(--bg);
        color: var(--fg); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.28); padding: 16px; }
      :host-context(html) { --bg: #111; --fg: #fff; --muted: #aaa; --border: #333; }
      @media (prefers-color-scheme: light) {
        :host-context(html) { --bg: #fff; --fg: #111; --muted: #555; --border: #ddd; }
      }
      .row { display: flex; gap: 8px; align-items: center; }
      input, textarea { box-sizing: border-box; width: 100%; font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
      textarea { min-height: 120px; }
      button { font: inherit; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); cursor: pointer; }
      button:hover { filter: brightness(1.1); }
      .list { margin-top: 12px; border-top: 1px solid var(--border); }
      .item { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); align-items: center; }
      .alias { font-weight: 700; }
      .muted { color: var(--muted); }
      .hidden { display: none; }
    `;
    const wrap = document.createElement('div');
    wrap.className = 'layer';
    wrap.innerHTML = `
      <div class="backdrop"></div>
      <div class="panel" role="dialog" aria-modal="true" aria-label="Shortcuts Manager">
        <div class="row" style="justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="font-weight: 800; font-size: 16px;">PromptShortcuts AI</div>
          <div>
            <button id="ps-close">Close</button>
          </div>
        </div>
        <form id="ps-form" class="row" style="margin-bottom: 8px;">
          <input id="ps-alias" name="alias" placeholder="alias (2–24 chars, a-z0-9-_)" minlength="2" maxlength="24" pattern="[a-z0-9-_]{2,24}" required />
          <button id="ps-save" type="submit">Save</button>
        </form>
        <textarea id="ps-text" placeholder="Expansion text (supports newlines)"></textarea>
        <div class="muted" style="margin-top: 4px;">Tip: type !alias in chat; use !!alias to escape.</div>
        <div class="list" id="ps-list"></div>
      </div>
    `;
    shadow.append(style, wrap);
    document.documentElement.append(host);
    this.layerEl = wrap as HTMLDivElement;

    const backdrop = shadow.querySelector('.backdrop') as HTMLDivElement;
    const panel = shadow.querySelector('.panel') as HTMLDivElement;
    const form = shadow.getElementById('ps-form') as HTMLFormElement;
    const aliasInput = shadow.getElementById('ps-alias') as HTMLInputElement;
    const textArea = shadow.getElementById('ps-text') as HTMLTextAreaElement;
    const list = shadow.getElementById('ps-list') as HTMLDivElement;

    const close = () => this.hide();
    shadow.getElementById('ps-close')!.addEventListener('click', close);
    backdrop.addEventListener('click', close);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const alias = aliasInput.value.trim();
      const text = textArea.value;
      if (!/^([a-z0-9-_]{2,24})$/.test(alias)) return;
      const now = Date.now();
      const listData = [...this.shortcuts];
      const existingIdx = listData.findIndex((s) => s.alias === alias);
      if (existingIdx >= 0) {
        listData[existingIdx] = { ...listData[existingIdx], text, updatedAt: now };
      } else {
        listData.unshift({ id: cryptoRandomId(), alias, text, enabled: true, createdAt: now, updatedAt: now, usageCount: 0 });
      }
      await setShortcuts(listData);
      this.shortcuts = listData;
      this.renderList(list);
      aliasInput.value = '';
      textArea.value = '';
    });

    this.renderList = this.renderList.bind(this);
    await this.refresh();
    this.renderList(list);

    // initial hidden
    // initial hidden
    this.layerEl.style.display = 'none';
    backdrop.style.display = 'none';
    panel.style.display = 'none';
  }

  async refresh() {
    this.shortcuts = await getShortcuts();
  }

  private renderList(listEl: HTMLDivElement) {
    listEl.innerHTML = '';
    for (const s of this.shortcuts) {
      const row = document.createElement('div');
      row.className = 'item';
      const info = document.createElement('div');
      info.innerHTML = `<div class="alias">!${s.alias} ${!s.enabled ? '<span class="muted">(disabled)</span>' : ''}</div><div class="muted">${escapeHtml(s.text).slice(0, 180)}</div>`;
      const actions = document.createElement('div');
      const toggle = document.createElement('button');
      toggle.textContent = s.enabled ? 'Disable' : 'Enable';
      toggle.addEventListener('click', async () => {
        s.enabled = !s.enabled; s.updatedAt = Date.now();
        await setShortcuts(this.shortcuts);
        this.renderList(listEl);
      });
      const edit = document.createElement('button');
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => {
        const shadow = this.root!;
        const aliasInput = shadow.getElementById('ps-alias') as HTMLInputElement;
        const textArea = shadow.getElementById('ps-text') as HTMLTextAreaElement;
        aliasInput.value = s.alias;
        textArea.value = s.text;
        aliasInput.focus();
      });
      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        if (!confirm(`Delete !${s.alias}?`)) return;
        this.shortcuts = this.shortcuts.filter((x) => x.id !== s.id);
        await setShortcuts(this.shortcuts);
        this.renderList(listEl);
      });
      actions.append(toggle, edit, del);
      row.append(info, actions);
      listEl.append(row);
    }
  }

  show() {
    if (!this.root) return;
    const backdrop = this.root.querySelector('.backdrop') as HTMLDivElement;
    const panel = this.root.querySelector('.panel') as HTMLDivElement;
    this.layerEl!.style.display = 'block';
    backdrop.style.display = '';
    panel.style.display = '';
    this.open = true;
  }

  hide() {
    if (!this.root) return;
    const backdrop = this.root.querySelector('.backdrop') as HTMLDivElement;
    const panel = this.root.querySelector('.panel') as HTMLDivElement;
    backdrop.style.display = 'none';
    panel.style.display = 'none';
    this.layerEl!.style.display = 'none';
    this.open = false;
  }

  toggle() {
    this.open ? this.hide() : this.show();
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
