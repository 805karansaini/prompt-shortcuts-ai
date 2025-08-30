export type Shortcut = {
  id: string;
  alias: string; // [a-z0-9-_]{2,24}
  text: string; // expansion, supports newlines
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
  siteScope?: string[]; // optional list of hostnames
};

export type Settings = {
  toggleShortcut: string; // display only; actual binding via manifest
  perSiteOverlayPos: Record<string, { x: number; y: number }>; // by hostname
  onboardingNudgeDismissed?: boolean;
};

export type StorageShape = {
  version?: number;
  shortcuts?: Shortcut[];
  settings?: Settings;
};

