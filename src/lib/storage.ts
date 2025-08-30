import browser from 'webextension-polyfill';
import type { Shortcut, Settings, StorageShape } from './types';

const DEFAULT_SETTINGS: Settings = {
  toggleShortcut: 'CmdOrCtrl+Shift+S',
  perSiteOverlayPos: {},
  onboardingNudgeDismissed: false,
};

export async function getAll(): Promise<StorageShape> {
  const data = (await browser.storage.local.get()) as StorageShape;
  return data;
}

export async function getShortcuts(): Promise<Shortcut[]> {
  const data = await getAll();
  return data.shortcuts ?? [];
}

export async function setShortcuts(shortcuts: Shortcut[]): Promise<void> {
  await browser.storage.local.set({ shortcuts });
}

export async function getSettings(): Promise<Settings> {
  const data = await getAll();
  return { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
}

export async function setSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ settings });
}

export async function seedIfNeeded(): Promise<void> {
  const data = await getAll();
  if (!data.version) {
    const now = Date.now();
    const shortcuts: Shortcut[] = [
      {
        id: cryptoRandomId(),
        alias: 'intro',
        text: 'Who is Karan Saini. Github: 805karansaini',
        enabled: true,
        createdAt: now,
        updatedAt: now,
        usageCount: 0,
      },
    ];
    await browser.storage.local.set({
      version: 2,
      shortcuts,
      settings: DEFAULT_SETTINGS,
    });
  }
}

export async function migrate(): Promise<void> {
  const data = await getAll();
  const now = Date.now();
  if (!data.version) {
    // Fresh seed handled in seedIfNeeded
    return;
  }
  // v1 -> v2: update default !intro text or add if missing
  if (data.version === 1) {
    const shortcuts = data.shortcuts ?? [];
    const idx = shortcuts.findIndex((s) => s.alias === 'intro');
    const newText = 'Who is Karan Saini. Github: 805karansaini';
    const oldText = 'When and how was the Taj Mahal built?';
    if (idx >= 0) {
      if (shortcuts[idx].text === oldText) {
        shortcuts[idx] = { ...shortcuts[idx], text: newText, updatedAt: now };
      }
    } else {
      shortcuts.unshift({
        id: cryptoRandomId(),
        alias: 'intro',
        text: newText,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        usageCount: 0,
      });
    }
    await browser.storage.local.set({ version: 2, shortcuts, settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) } });
  }
}

export function cryptoRandomId(): string {
  // Prefer native UUID when available; fallback to random hex
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().replace(/-/g, '');
  }
  const arr = new Uint8Array(16);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
