import { getSettings, setSettings } from '../lib/storage';

export class PSLauncherButton {
  private root: ShadowRoot | null = null;
  private host: HTMLDivElement | null = null;
  private button!: HTMLButtonElement;
  private dragging = false;
  private offsetX = 0;
  private offsetY = 0;
  private startX = 0;
  private startY = 0;
  private activePointerId: number | null = null;
  private readonly dragThreshold = 4; // px before treating as drag
  private desiredLeft = 0;
  private desiredTop = 0;
  private currentLeft = 0;
  private currentTop = 0;
  private originLeft = 0;
  private originTop = 0;
  private raf = 0;
  private downAt = 0;
  private holdTimer: number | null = null;
  private readonly holdDelay = 140; // ms long-press to force drag
  private justDraggedUntil = 0;
  private vx = 0;
  private vy = 0;

  async mount() {
    if (this.host) return;
    const container = document.createElement('div');
    container.id = 'ps-launcher-host';
    container.style.position = 'fixed';
    container.style.zIndex = '2147483646';
    container.style.top = '16px';
    container.style.right = '16px';
    container.style.width = '36px';
    container.style.height = '36px';
    container.style.pointerEvents = 'none';

    const shadow = container.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
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
      .wrap { pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; }
      .wrap[data-dragging="1"] button { cursor: grabbing; filter: brightness(1.05); }
      button {
        all: unset;
        position: relative;
        width: 36px; height: 36px; border-radius: 18px;
        background: radial-gradient(120% 120% at 0% 0%, #6a11cb 0%, #2575fc 50%, #00c2ff 100%);
        color: #fff; display: grid; place-items: center;
        box-shadow: 0 4px 14px rgba(37,117,252,0.35);
        font-weight: 800; font-family: "Inter var", Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        cursor: grab; touch-action: none; -webkit-tap-highlight-color: transparent;
        transition: transform 0.12s ease, box-shadow 0.2s ease, filter 0.2s ease;
        will-change: transform;
      }
      button::before {
        content: '';
        position: absolute; inset: -2px; border-radius: 20px; pointer-events: none;
        background: conic-gradient(from 180deg at 50% 50%, rgba(255,255,255,0.16), rgba(255,255,255,0) 30%, rgba(255,255,255,0.16) 60%, rgba(255,255,255,0) 90%, rgba(255,255,255,0.16));
        filter: blur(8px); opacity: 0; transition: opacity 0.25s ease;
      }
      button:hover { transform: translateY(-1px) scale(1.02); box-shadow: 0 8px 22px rgba(37,117,252,0.45); }
      button:hover::before { opacity: 0.5; }
      button:active { transform: translateY(0) scale(0.98); }
      .bang { font-size: 18px; line-height: 1; }
      @media (prefers-color-scheme: light) { button { filter: saturate(1.05) brightness(1.02); } }
    `;
    shadow.append(style);
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    const btn = document.createElement('button');
    const icon = document.createElement('span');
    icon.className = 'bang';
    icon.textContent = '!';
    btn.append(icon);
    btn.title = 'PromptShortcuts AI — Open Manager';
    btn.setAttribute('aria-label', 'Open Shortcuts Manager');
    wrap.append(btn);
    shadow.append(wrap);

    this.root = shadow;
    this.host = container;
    this.button = btn;
    document.documentElement.append(container);

    // Restore position
    const hostname = location.hostname;
    const settings = await getSettings();
    const pos = settings.perSiteOverlayPos?.[hostname];
    if (pos) {
      // Clamp restored position to viewport in case it was dragged off-screen
      const margin = 8;
      const btnSize = 36 + 8; // size + a bit of breathing room
      const maxLeft = Math.max(margin, window.innerWidth - btnSize);
      const maxTop = Math.max(margin, window.innerHeight - btnSize);
      const left = Math.min(Math.max(Math.round(pos.x), margin), maxLeft);
      const top = Math.min(Math.max(Math.round(pos.y), margin), maxTop);
      container.style.top = `${top}px`;
      container.style.left = `${left}px`;
      container.style.right = 'auto';
      // If clamped (adjusted), persist the corrected position to avoid future off-screen restores
      if (left !== Math.round(pos.x) || top !== Math.round(pos.y)) {
        settings.perSiteOverlayPos[hostname] = { x: left, y: top };
        await setSettings(settings);
      }
    }

    // Drag (with threshold + long-press + smooth RAF positioning)
    wrap.addEventListener('pointerdown', (ev) => {
      // Only start tracking on primary pointer
      if (this.activePointerId !== null) return;
      if (ev.button !== 0 && ev.button !== -1) return; // left/touch only
      this.activePointerId = ev.pointerId;
      const rect = container.getBoundingClientRect();
      // Convert any right-based position to explicit left/top for dragging (viewport units for fixed position)
      this.originLeft = Math.round(rect.left);
      this.originTop = Math.round(rect.top);
      container.style.left = `${this.originLeft}px`;
      container.style.top = `${this.originTop}px`;
      container.style.right = 'auto';

      this.offsetX = ev.clientX - rect.left;
      this.offsetY = ev.clientY - rect.top;
      this.startX = ev.clientX;
      this.startY = ev.clientY;
      this.downAt = performance.now();
      this.dragging = false; // will become true after threshold
      // Long-press fallback to initiate drag even without movement
      this.clearHoldTimer();
      this.holdTimer = window.setTimeout(() => {
        if (this.activePointerId !== ev.pointerId || this.dragging) return;
        this.beginDrag(ev, container, wrap);
      }, this.holdDelay);
    });
    wrap.addEventListener('pointermove', (ev) => {
      if (this.activePointerId !== ev.pointerId) return;
      const dx = ev.clientX - this.startX;
      const dy = ev.clientY - this.startY;
      if (!this.dragging) {
        const held = performance.now() - this.downAt;
        if (Math.hypot(dx, dy) >= this.dragThreshold || held >= this.holdDelay) {
          this.beginDrag(ev, container, wrap);
        } else {
          return;
        }
      }
      // Update desired position (will be applied in RAF loop)
      const x = Math.max(8, Math.min(window.innerWidth - 44, ev.clientX - this.offsetX));
      const y = Math.max(8, Math.min(window.innerHeight - 44, ev.clientY - this.offsetY));
      this.desiredLeft = Math.round(x);
      this.desiredTop = Math.round(y);
    });
    wrap.addEventListener('pointerup', async (ev) => {
      if (this.activePointerId !== ev.pointerId) return;
      const wasDragging = this.dragging;
      this.dragging = false;
      try { wrap.releasePointerCapture(ev.pointerId); } catch {}
      this.activePointerId = null;
      wrap.removeAttribute('data-dragging');
      this.clearHoldTimer();
      // Commit final position
      if (this.raf) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      }
      container.style.transform = '';
      if (wasDragging) {
        container.style.left = `${this.desiredLeft}px`;
        container.style.top = `${this.desiredTop}px`;
        container.style.right = 'auto';
        this.justDraggedUntil = performance.now() + 250;
      }
      if (!wasDragging) {
        // Let the native click on the button fire
        return;
      }
      const rect = container.getBoundingClientRect();
      const settings = await getSettings();
      settings.perSiteOverlayPos[location.hostname] = { x: rect.left, y: rect.top };
      await setSettings(settings);
    });
    wrap.addEventListener('pointercancel', () => this.cancelDrag(container, wrap));

    // Toggle manager (dispatch an intra-page custom event)
    btn.addEventListener('click', () => {
      // Ignore clicks that immediately follow a drag
      if (performance.now() < this.justDraggedUntil) return;
      try { window.dispatchEvent(new CustomEvent('ps:toggle-manager')); } catch {}
    });
  }

  private startSmoothLoop(container: HTMLDivElement, wrap: HTMLDivElement) {
    if (this.raf) return;
    const step = () => {
      // Spring smoothing: velocity + damping
      const springConstant = 0.20; // spring
      const dampingFactor = 0.75; // damping
      this.vx += (this.desiredLeft - this.currentLeft) * springConstant;
      this.vx *= dampingFactor;
      this.vy += (this.desiredTop - this.currentTop) * springConstant;
      this.vy *= dampingFactor;
      this.currentLeft += this.vx;
      this.currentTop += this.vy;
      const tx = Math.round(this.currentLeft - this.originLeft);
      const ty = Math.round(this.currentTop - this.originTop);
      container.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      if (this.dragging) {
        this.raf = requestAnimationFrame(step);
      } else {
        this.raf = 0;
        // Reset velocities
        this.vx = 0;
        this.vy = 0;
      }
    };
    this.raf = requestAnimationFrame(step);
  }

  private beginDrag(ev: PointerEvent, container: HTMLDivElement, wrap: HTMLDivElement) {
    if (this.dragging) return;
    this.dragging = true;
    try { wrap.setPointerCapture(ev.pointerId); } catch {}
    wrap.setAttribute('data-dragging', '1');
    // Initialize smooth loop from current position
    this.currentLeft = this.originLeft;
    this.currentTop = this.originTop;
    this.desiredLeft = this.originLeft;
    this.desiredTop = this.originTop;
    this.startSmoothLoop(container, wrap);
  }

  private cancelDrag(container: HTMLDivElement, wrap: HTMLDivElement) {
    this.dragging = false;
    this.activePointerId = null;
    wrap.removeAttribute('data-dragging');
    this.clearHoldTimer();
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    container.style.transform = '';
  }

  private clearHoldTimer() {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }
}
