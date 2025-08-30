import browser from 'webextension-polyfill';
import { seedIfNeeded, migrate } from '../lib/storage';

// Seed on install/update
browser.runtime.onInstalled.addListener(async () => {
  await seedIfNeeded();
  await migrate();
});

browser.runtime.onStartup.addListener(async () => {
  await migrate();
});

// Toggle Manager via command
browser.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-manager') return;
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) {
    try {
      await browser.tabs.sendMessage(tab.id, { type: 'ps:toggle-manager' });
    } catch (e) {
      // No content script on this page or not ready; ignore for POC
    }
  }
});

// Bridge messages from content scripts to the active tab (for reliable toggling)
browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg?.type !== 'ps:toggle-manager') return;
  const tabId = sender?.tab?.id;
  if (!tabId) return;
  try {
    await browser.tabs.sendMessage(tabId, { type: 'ps:toggle-manager' });
  } catch (e) {
    // Content script might not be ready yet; ignore
  }
});
