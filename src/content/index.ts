import browser from 'webextension-polyfill';
import { getShortcuts } from '../lib/storage';
import { replaceWithMap } from '../lib/parser';
import type { Shortcut } from '../lib/types';
import { PSLauncherButton } from '../ui/LauncherButton';
import { PSManagerModal } from '../ui/ManagerModal';
import { TokenHighlighter } from './highlighter';

const manager = new PSManagerModal();
const launcher = new PSLauncherButton();
let bound = false;
let highlighter: TokenHighlighter | null = null;
let aliasMap: Map<string, Shortcut> = new Map();
let rescanPending = false;
let rescanTimer: number | null = null;
const RESCAN_MIN_INTERVAL = 150; // ms
let lastRescan = 0;

async function ensureUI() {
  await manager.mount();
  await launcher.mount();
}

function isEditable(el: Element | null): el is HTMLTextAreaElement | HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'search')) return true;
  if (el instanceof HTMLElement) {
    const ce = el.getAttribute('contenteditable');
    if (ce === '' || ce === 'true') return true;
    if (el.isContentEditable) return true;
  }
  return false;
}

function findPrimaryEditable(root: Document | HTMLElement = document): HTMLElement | null {
  // Prefer ChatGPT composer-scoped elements
  const scoped = root.querySelector('[data-testid="composer"] [contenteditable="true"], [data-testid="composer"] textarea');
  if (scoped && isEditable(scoped)) return scoped as HTMLElement;
  // Generic contenteditable and common textareas
  const ce = root.querySelector('[contenteditable][role="textbox"], [contenteditable="true"]');
  if (ce && isEditable(ce)) return ce as HTMLElement;
  const ta = root.querySelector('textarea, textarea[role="textbox"], textarea[aria-label]');
  if (ta && isEditable(ta)) return ta as HTMLElement;
  return null;
}

function currentEditable(): HTMLElement | null {
  const active = document.activeElement;
  if (isEditable(active)) return active as HTMLElement;
  return findPrimaryEditable();
}

async function expandIn(el: HTMLElement): Promise<boolean> {
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'search'))) {
    const before = el.value;
    const after = replaceWithMap(before, aliasMap);
    if (after !== before) {
      el.value = after;
      // Place caret at end
      el.selectionStart = el.selectionEnd = after.length;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }
  // contenteditable
  if (el instanceof HTMLElement && el.isContentEditable) {
    const before = (el as HTMLElement).innerText;
    const after = replaceWithMap(before, aliasMap);
    if (after !== before) {
      (el as HTMLElement).innerText = after;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
  }
  return false;
}

function attachInterceptors(target: HTMLElement) {
  if (bound) return;
  bound = true;
  // Keydown capture: on Enter without modifiers, pre-expand
  window.addEventListener(
    'keydown',
    async (ev) => {
      if (ev.key !== 'Enter') return;
      if (ev.isComposing || ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      const ed = currentEditable();
      if (!ed) return;
      // Synchronous expansion before site handlers run
      expandInSync(ed);
    },
    true
  );

  // Send-button clicks (capture phase): attempt pre-expand before site handles
  window.addEventListener(
    'click',
    async (ev) => {
      const el = (ev.target as HTMLElement | null)?.closest('button, [role="button"]');
      if (!el) return;
      // Heuristic: buttons with aria-label or data-testid/text containing send
      const label = (
        el.getAttribute('aria-label') ||
        el.getAttribute('data-testid') ||
        el.textContent ||
        ''
      ).toLowerCase();
      if (!label.includes('send')) return;
      const ed = currentEditable();
      if (!ed) return;
      expandInSync(ed);
    },
    true
  );
}

function init() {
  ensureUI().then(async () => {
    // Prime alias map and keep it in sync
    const shortcuts = await getShortcuts();
    aliasMap = new Map(shortcuts.filter((s) => s.enabled).map((s) => [s.alias.toLowerCase(), s]));
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.shortcuts) {
        const next = (changes.shortcuts.newValue as Shortcut[]) || [];
        aliasMap = new Map(next.filter((s) => s.enabled).map((s) => [s.alias.toLowerCase(), s]));
      }
    });
    const editable = findPrimaryEditable();
    if (editable) {
      attachInterceptors(editable);
      highlighter = new TokenHighlighter(editable);
      highlighter.mount();
    }

    // Toggle Manager via messages or launcher
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'ps:toggle-manager') manager.toggle();
    });
    window.addEventListener('ps:toggle-manager', () => manager.toggle());
  });

  // Re-scan when DOM changes
  const doRescan = () => {
    lastRescan = performance.now();
    const editable = findPrimaryEditable();
    if (editable) {
      attachInterceptors(editable);
      if (!highlighter || highlighter.getTarget() !== editable) {
        highlighter?.unmount?.();
        highlighter = new TokenHighlighter(editable);
        highlighter.mount();
      }
    }
  };

  const scheduleRescan = () => {
    if (rescanPending) return;
    rescanPending = true;
    const run = () => {
      rescanPending = false;
      const now = performance.now();
      if (now - lastRescan < RESCAN_MIN_INTERVAL) {
        // Defer to respect min interval
        rescanTimer = window.setTimeout(doRescan, RESCAN_MIN_INTERVAL - (now - lastRescan));
      } else {
        doRescan();
      }
    };
    const ric = (window as any).requestIdleCallback as undefined | ((cb: Function, opts?: any) => number);
    if (typeof ric === 'function') {
      ric(run, { timeout: 200 });
    } else {
      rescanTimer = window.setTimeout(run, 50);
    }
  };

  const mo = new MutationObserver(() => {
    scheduleRescan();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
}

init();

// Synchronous expansion that does not await storage, using cached aliasMap
function expandInSync(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'search'))) {
    const before = el.value;
    const after = replaceWithMap(before, aliasMap);
    if (after !== before) {
      el.value = after;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    return false;
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    const before = (el as HTMLElement).innerText;
    const after = replaceWithMap(before, aliasMap);
    if (after !== before) {
      (el as HTMLElement).innerText = after;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
  }
  return false;
}
