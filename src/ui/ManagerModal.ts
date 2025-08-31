import { getShortcuts, setShortcuts, cryptoRandomId } from '../lib/storage';
import { filterAndSortShortcuts } from '../lib/fuzzy';
import type { Shortcut } from '../lib/types';

export class PSManagerModal {
  private host: HTMLDivElement | null = null;
  private root: ShadowRoot | null = null;
  private open = false;
  private shortcuts: Shortcut[] = [];
  private layerEl: HTMLDivElement | null = null;
  private lastFocus: Element | null = null;
  private filterQuery = '';

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
    // Prefer bundled Inter var font when available; fall back to remote CSS; finally to system fonts.
    const getURL = ((globalThis as any)?.chrome?.runtime?.getURL ?? (globalThis as any)?.browser?.runtime?.getURL) as
      | undefined
      | ((path: string) => string);
    const interUrl = typeof getURL === 'function' ? getURL('fonts/InterVariable.woff2') : '';
    const fontPrelude = interUrl
      ? `@font-face{font-family:"Inter var";font-style:normal;font-weight:100 900;font-display:swap;src:url("${interUrl}") format("woff2");}`
      : `@import url('https://rsms.me/inter/inter.css');`;
    style.textContent = `
      ${fontPrelude}
      :host { all: initial; }
      :host-context(html) {
        /* Typography */
        --font-sans: "Inter var", Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        --font-mono: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;

        /* Text colors */
        --fg: #F1F5F9;                 /* Body text */
        --heading: #FFFFFF;            /* Headings */
        --fg-secondary: #B8C0CC;       /* Secondary */
        --fg-muted: #8AA0B2;           /* Placeholder/Muted */
        --fg-disabled: #64748B;        /* Disabled */

        /* Accents and state */
        --accent: #1D4ED8;             /* Primary actions / Toggles on */
        --accent-hover: #2563EB;       /* Primary hover */
        --danger: #B91C1C;             /* Destructive */
        --danger-hover: #DC2626;       /* Destructive hover */
        --link: #60A5FA;               /* Links/interactive */
        --link-hover: #93C5FD;         /* Link hover */
        --focus: #93C5FD;              /* Focus ring */
        --knob: #F1F5F9;               /* Toggle knob */

        /* Surfaces */
        --bg-app: #0B0F14;             /* Base app */
        --panel: #0F172A;              /* Modal surface */
        --row: #111827;                /* Cards/rows */
        --input: #0B1220;              /* Inputs */
        --backdrop: rgba(0,0,0,.6);    /* Modal backdrop */

        /* Lines */
        --border: #334155;             /* Subtle borders */
        --divider: #1F2937;            /* Dividers */

        /* Effects */
        --shadow: 0 12px 40px rgba(0,0,0,.45);
      }

      /* Layer and animations */
      .layer { position: fixed; inset: 0; pointer-events: auto; }
      .backdrop { position: absolute; inset: 0; background: var(--backdrop); display: none; opacity: 0; transition: opacity .18s ease-out; }
      .panel {
        position: absolute; top: 7vh; left: 50%; transform: translate(-50%, -8px);
        width: min(860px, 96vw); max-height: 86vh; overflow: hidden;
        color: var(--fg); border-radius: 14px; box-shadow: var(--shadow);
        border: 1px solid var(--border); background: var(--panel);
        display: grid; grid-template-rows: auto auto 1fr; gap: 0;
        opacity: 0; transition: opacity .2s ease, transform .2s ease;
      }
      .panel, .panel * { font-family: var(--font-sans); line-height: 1.5; letter-spacing: normal; font-weight: 400; }
      .panel.visible { opacity: 1; transform: translate(-50%, 0); }
      .backdrop.visible { display: block; opacity: 1; }

      /* Header */
      .header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; gap: 12px; border-bottom: 1px solid var(--divider); background: var(--panel); position: sticky; top: 0; z-index: 2; }
      .title { font-weight: 600; font-size: 18px; letter-spacing: 0; color: var(--heading); }
      .actions { display: flex; align-items: center; gap: 8px; }

      /* Controls */
      .row { display: flex; gap: 8px; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--divider); position: sticky; top: 54px; background: var(--row); z-index: 1; }
      input, textarea { box-sizing: border-box; width: 100%; font: 400 14px var(--font-sans); color: var(--fg); background: var(--input); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; outline: none; }
      input::placeholder, textarea::placeholder { color: var(--fg-muted); }
      input:disabled, textarea:disabled { color: var(--fg-disabled); }
      input:focus, textarea:focus { border-color: var(--focus); box-shadow: 0 0 0 2px var(--focus); }
      textarea { min-height: 120px; resize: vertical; font-family: var(--font-mono); }
      #ps-alias { font-family: var(--font-mono); }
      .pill { padding: 2px 8px; background: #1E293B; color: #EAF2FF; border: 1px solid #1E293B; border-radius: 999px; font-size: 12px; font-weight: 600; transition: background .15s ease; }
      .pill:hover { background: #243447; border-color: #243447; }
      .kbd { display: inline-flex; align-items: center; gap: 2px; padding: 2px 6px; border-radius: 6px; border: 1px solid var(--divider); background: var(--panel); font-weight: 600; font-size: 11px; line-height: 1; color: var(--fg-secondary); }

      /* Buttons */
      button { font: 500 14px var(--font-sans); padding: 8px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--row); color: var(--fg); cursor: pointer; transition: transform .06s ease, background .15s ease, filter .15s ease; }
      button:hover { filter: brightness(1.05); }
      button:active { transform: translateY(1px); }
      .btn-primary { background: var(--accent); border: 1px solid var(--accent); color: #FFFFFF; display: inline-flex; align-items: center; gap: 8px; border-radius: 9999px; }
      .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
      .btn-primary .shortcut { display: inline-flex; align-items: center; gap: 6px; margin-left: 6px; }
      .btn-primary .sym { font-weight: 700; font-size: 14px; line-height: 1; }
      .btn-ghost { background: transparent; color: var(--fg); }
      .btn-danger { color: #FFFFFF; background: var(--danger); border: 1px solid var(--danger); }
      .btn-danger:hover { background: var(--danger-hover); border-color: var(--danger-hover); }
      button:disabled, .btn-primary:disabled, .btn-danger:disabled { color: var(--fg-disabled); border-color: var(--divider); background: var(--row); cursor: not-allowed; filter: none; }
      button:focus-visible, .switch:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--focus); }

      /* Links */
      .panel a, .panel .link { color: var(--link); text-decoration: none; }
      .panel a:hover, .panel .link:hover { color: var(--link-hover); }

      /* List */
      .list { overflow: auto; padding: 8px 0; background: var(--panel); }
      .item { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--divider); align-items: center; background: var(--row); transition: background .12s ease, box-shadow .12s ease; }
      .item:hover { background: #162235; }
      .item:focus-within, .item[aria-selected="true"], .item.selected { box-shadow: inset 0 0 0 2px var(--focus); }
      .alias { font-weight: 600; font-size: 16px; display: flex; align-items: center; gap: 8px; }
      .alias small { font-weight: 600; color: var(--fg-disabled); }
      .muted { color: var(--fg-secondary); font-size: 14px; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .empty { padding: 24px 16px; text-align: center; color: var(--fg-secondary); }
      .hidden { display: none; }

      .switch { position: relative; display: inline-flex; align-items: center; width: 40px; height: 22px; border-radius: 9999px; background: #475569; border: 1px solid var(--border); transition: background .15s ease; vertical-align: middle; }
      .switch[data-on="true"] { background: var(--accent); }
      .switch .dot { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; background: var(--knob); border-radius: 9999px; transition: left .14s ease; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
      .switch[data-on="true"] .dot { left: 20px; }

      /* Muted danger label (non-button) */
      .danger-text { color: #FCA5A5; }
    `;
    const wrap = document.createElement('div');
    wrap.className = 'layer';
    const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);
    const modKey = isApple ? '⌘' : 'Ctrl';
    wrap.innerHTML = `
      <div class="backdrop"></div>
      <div class="panel" role="dialog" aria-modal="true" aria-label="Shortcuts Manager">
        <div class="header">
          <div class="title">PromptShortcuts AI</div>
          <div class="actions">
            <input id="ps-search" placeholder="Search shortcuts (fuzzy)" aria-label="Search shortcuts" style="width: 220px;"/>
            <button id="ps-close" class="btn-ghost" aria-label="Close"><span class="kbd">Esc</span></button>
          </div>
        </div>
        <form id="ps-form" class="row" autocomplete="off">
          <input id="ps-alias" name="alias" placeholder="alias (a-z0-9-_)" minlength="2" maxlength="24" pattern="[a-z0-9-_]{2,24}" required />
          <button id="ps-save" type="submit" class="btn-primary" disabled aria-label="Save (${modKey} + Enter)">
            <span class="btn-label">Save</span>
            <span class="shortcut"><span class="sym">${modKey}</span><span class="sym">↵</span></span>
          </button>
        </form>
        <div style="padding: 10px 16px; border-bottom: 1px solid var(--border);">
          <textarea id="ps-text" placeholder="Expansion text (multi-line supported)"></textarea>
          <div class="muted" style="margin-top: 6px;">Tip: type !alias in chat; use !!alias to escape.</div>
        </div>
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
    const search = shadow.getElementById('ps-search') as HTMLInputElement;
    const list = shadow.getElementById('ps-list') as HTMLDivElement;
    const saveBtn = shadow.getElementById('ps-save') as HTMLButtonElement;

    const close = () => this.hide();
    shadow.getElementById('ps-close')!.addEventListener('click', close);
    backdrop.addEventListener('click', close);

    const updateSaveEnabled = () => {
      const alias = aliasInput.value.trim();
      const valid = /^([a-z0-9-_]{2,24})$/.test(alias) && textArea.value.trim().length > 0;
      if (saveBtn) {
        saveBtn.disabled = !valid;
      }
    };
    aliasInput.addEventListener('input', updateSaveEnabled);
    textArea.addEventListener('input', updateSaveEnabled);

    // Search filter
    if (search) {
      search.addEventListener('input', () => {
        this.filterQuery = search.value;
        this.renderList(list);
      });
    }

    // Global key handlers (Esc to close, Cmd/Ctrl+Enter to save)
    window.addEventListener('keydown', this.keydownHandler, true);

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
      updateSaveEnabled();
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
    const q = this.filterQuery.trim();
    const items = q ? filterAndSortShortcuts(this.shortcuts, q) : this.shortcuts;

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = q ? 'No matches.' : 'No shortcuts yet. Add one above.';
      listEl.append(empty);
      return;
    }

    for (const s of items) {
      const row = document.createElement('div');
      row.className = 'item';
      const info = document.createElement('div');
      const status = s.enabled ? '' : '<small>(disabled)</small>';
      info.innerHTML = `<div class="alias"><span class="pill">!${s.alias}</span> ${status}</div><div class="muted">${escapeHtml(s.text)}</div>`;
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.alignItems = 'center';
      actions.style.gap = '6px';

      const toggle = document.createElement('button');
      toggle.setAttribute('aria-label', s.enabled ? 'Disable' : 'Enable');
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-checked', String(!!s.enabled));
      toggle.className = 'switch';
      toggle.setAttribute('data-on', String(!!s.enabled));
      toggle.innerHTML = '<span class="dot"></span>';
      toggle.addEventListener('click', async () => {
        s.enabled = !s.enabled; s.updatedAt = Date.now();
        toggle.setAttribute('data-on', String(!!s.enabled));
        toggle.setAttribute('aria-checked', String(!!s.enabled));
        toggle.setAttribute('aria-label', s.enabled ? 'Disable' : 'Enable');
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
        const save = shadow.getElementById('ps-save') as HTMLButtonElement;
        if (save) { save.disabled = false; }
      });

      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.className = 'btn-danger';
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
    this.lastFocus = document.activeElement;
    this.layerEl!.style.display = 'block';
    backdrop.style.display = '';
    panel.style.display = '';
    requestAnimationFrame(() => {
      backdrop.classList.add('visible');
      panel.classList.add('visible');
    });
    this.open = true;
    const aliasInput = this.root.getElementById('ps-alias') as HTMLInputElement;
    try { aliasInput?.focus(); } catch { }
  }

  hide() {
    if (!this.root) return;
    const backdrop = this.root.querySelector('.backdrop') as HTMLDivElement;
    const panel = this.root.querySelector('.panel') as HTMLDivElement;
    backdrop.classList.remove('visible');
    panel.classList.remove('visible');
    const after = () => {
      backdrop.style.display = 'none';
      panel.style.display = 'none';
      this.layerEl!.style.display = 'none';
      backdrop.removeEventListener('transitionend', after);
    };
    backdrop.addEventListener('transitionend', after);
    setTimeout(after, 220);
    this.open = false;
    if (this.lastFocus instanceof HTMLElement) {
      try { this.lastFocus.focus(); } catch { }
    }
  }

  toggle() {
    this.open ? this.hide() : this.show();
  }

  // Global key handling for modal accessibility
  private keydownHandler = (ev: KeyboardEvent) => {
    if (!this.open) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.hide();
      return;
    }
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      const form = this.root?.getElementById('ps-form') as HTMLFormElement | null;
      if (form) {
        ev.preventDefault();
        try { form.requestSubmit(); } catch { form.submit(); }
      }
    }
  };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
