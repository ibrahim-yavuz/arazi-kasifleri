import { LOGO_SVG } from './logoSvg';

export type Nav = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';

export interface Screen {
  readonly root: HTMLElement;
  show(): void;
  hide(): void;
  onNav?(nav: Nav): void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  text?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/** Game logo ("Arazi Kaşifleri" compass badge). */
export function createLogo(parent: HTMLElement): HTMLElement {
  const logo = el('div', 'logo', undefined, parent);
  logo.innerHTML = LOGO_SVG;
  return logo;
}

/** Keyboard + mouse navigation over a vertical list of buttons. */
export class MenuNav {
  index = 0;

  constructor(
    private readonly items: HTMLElement[],
    private readonly onSelect: (i: number) => void,
    private readonly onMove?: () => void,
  ) {
    items.forEach((it, i) => {
      it.addEventListener('mouseenter', () => this.focus(i));
      it.addEventListener('click', () => {
        this.focus(i);
        this.onSelect(i);
      });
    });
    this.focus(0);
  }

  focus(i: number): void {
    this.index = (i + this.items.length) % this.items.length;
    this.items.forEach((it, k) => it.classList.toggle('focus', k === this.index));
  }

  nav(n: Nav): boolean {
    if (n === 'up' || n === 'left') {
      this.focus(this.index - 1);
      this.onMove?.();
      return true;
    }
    if (n === 'down' || n === 'right') {
      this.focus(this.index + 1);
      this.onMove?.();
      return true;
    }
    if (n === 'confirm') {
      this.onSelect(this.index);
      return true;
    }
    return false;
  }
}

export function keyCap(text: string): string {
  return `<span class="key">${text}</span>`;
}
