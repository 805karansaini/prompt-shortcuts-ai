import { extractAliases } from '../lib/parser';

export class TokenHighlighter {
  private target: HTMLElement;
  private overlay: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private raf = 0;
  private obs: MutationObserver | null = null;
  private onResize = () => this.schedule();
  private onScroll = () => this.schedule();
  private onInput = () => this.schedule();
  private onKeyup = () => this.schedule();
  private lastText = '';
  private lastRect: { l: number; t: number; w: number; h: number } | null = null;
  private cachedFont = '';
  private cachedLineHeight = '';
  private cachedPadding = '';

  constructor(target: HTMLElement) {
    this.target = target;
  }

  mount() {
    if (this.overlay) return;
    const o = document.createElement('div');
    o.style.position = 'absolute';
    o.style.pointerEvents = 'none';
    o.style.zIndex = '2147483645';
    const shadowHost = document.createElement('div');
    o.appendChild(shadowHost);
    const shadow = shadowHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial }
      .wrap { white-space: pre-wrap; word-break: break-word; color: transparent; }
      .chip { background: rgba(60, 132, 244, 0.20); border: 1px solid rgba(60,132,244,0.6);
        color: transparent; border-radius: 6px; padding: 0 2px; }
      .chip.gray { background: rgba(128,128,128,0.18); border-color: rgba(128,128,128,0.5) }
    `;
    shadow.appendChild(style);
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    shadow.appendChild(wrap);
    this.shadow = shadow;
    this.overlay = o;
    document.body.appendChild(o);

    this.obs = new MutationObserver(() => this.schedule());
    this.obs.observe(this.target, { attributes: true, attributeFilter: ['style', 'class'] });

    window.addEventListener('resize', this.onResize);
    this.target.addEventListener('scroll', this.onScroll as EventListener, { passive: true } as AddEventListenerOptions);
    this.target.addEventListener('input', this.onInput);
    this.target.addEventListener('keyup', this.onKeyup);
    this.schedule();
  }

  unmount() {
    if (this.overlay?.parentElement) this.overlay.parentElement.removeChild(this.overlay);
    this.overlay = null;
    this.shadow = null;
    if (this.obs) {
      this.obs.disconnect();
      this.obs = null;
    }
    window.removeEventListener('resize', this.onResize);
    this.target.removeEventListener('scroll', this.onScroll as EventListener);
    this.target.removeEventListener('input', this.onInput);
    this.target.removeEventListener('keyup', this.onKeyup);
    cancelAnimationFrame(this.raf);
  }

  getTarget(): HTMLElement {
    return this.target;
  }

  private schedule() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.render());
  }

  private readText(): string {
    if (this.target instanceof HTMLTextAreaElement) return this.target.value;
    if (this.target instanceof HTMLInputElement) return this.target.value;
    // Prefer textContent over innerText to avoid layout thrash
    return (this.target as HTMLElement).textContent || '';
  }

  private render() {
    if (!this.overlay || !this.shadow) return;
    const rect = this.target.getBoundingClientRect();
    const l = Math.round(window.scrollX + rect.left);
    const t = Math.round(window.scrollY + rect.top);
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (!this.lastRect || this.lastRect.l !== l || this.lastRect.t !== t || this.lastRect.w !== w || this.lastRect.h !== h) {
      Object.assign(this.overlay.style, {
        left: `${l}px`,
        top: `${t}px`,
        width: `${w}px`,
        height: `${h}px`,
      });
      this.lastRect = { l, t, w, h };
    }

    const cs = getComputedStyle(this.target);
    const wrap = this.shadow.querySelector('.wrap') as HTMLDivElement;
    const font = cs.font;
    const lh = cs.lineHeight;
    const pad = cs.padding;
    if (this.cachedFont !== font) { wrap.style.font = font; this.cachedFont = font; }
    if (this.cachedLineHeight !== lh) { wrap.style.lineHeight = lh; this.cachedLineHeight = lh; }
    if (this.cachedPadding !== pad) { wrap.style.padding = pad; this.cachedPadding = pad; }
    wrap.style.margin = '0';
    // Only show chip backgrounds; let the underlying input render the text
    wrap.style.color = 'transparent';
    // no text-shadow to avoid doubled text
    wrap.style.whiteSpace = cs.whiteSpace || 'pre-wrap';
    wrap.style.overflow = 'hidden';

    // Build highlighted HTML
    const raw = this.readText();
    if (raw !== this.lastText) {
      this.lastText = raw;
      const html = this.highlightHtml(raw);
      // Avoid layout trash by only touching innerHTML when changed
      wrap.innerHTML = html;
    }
  }

  private highlightHtml(text: string): string {
    // Escape HTML first
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Split on whitespace to keep it simple for POC
    // Use extractAliases to know which aliases are valid pattern-wise; we do not validate existence here
    const tokens = extractAliases(text);
    if (tokens.length === 0 && !/!![a-z0-9-_]{2,24}/.test(text)) return esc(text);
    // Temporarily protect escaped tokens so they are not highlighted
    let out = esc(text).replace(/(^|\s)!!([a-z0-9-_]{2,24})\b/g, (_m, p1, a) => `${p1}§§ESC${a}§`);
    // Wrap !alias in chip spans
    out = out.replace(/(^|\s)!([a-z0-9-_]{2,24})\b/g, (_m, p1, a) => `${p1}<span class="chip">!${a}</span>`);
    // Restore escaped tokens as plain !alias
    out = out.replace(/§§ESC([a-z0-9-_]{2,24})§/g, (_m, a) => `!${a}`);
    return out;
  }
}
