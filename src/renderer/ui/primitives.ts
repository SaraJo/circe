/** The §5.6 primitive set. One visual language, built once, used everywhere. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(
  label: string,
  onClick: () => void,
  variant: 'primary' | 'default' | 'quiet' = 'default',
): HTMLButtonElement {
  const b = el('button', variant === 'default' ? 'btn' : `btn btn--${variant}`, label);
  b.addEventListener('click', onClick);
  return b;
}

export function segmented(
  items: { id: string; label: string }[],
  selectedId: string,
  onSelect: (id: string) => void,
): HTMLDivElement {
  const wrap = el('div', 'segmented');
  for (const item of items) {
    const b = el('button', 'segmented__item', item.label);
    b.setAttribute('aria-selected', String(item.id === selectedId));
    b.addEventListener('click', () => onSelect(item.id));
    wrap.append(b);
  }
  return wrap;
}

export function loader(): HTMLDivElement {
  return el('div', 'loader');
}

export function emptyState(message: string): HTMLDivElement {
  return el('div', 'state', message);
}

export function errorState(message: string): HTMLDivElement {
  return el('div', 'state state--error', message);
}

export function avatar(initial: string): HTMLDivElement {
  return el('div', 'avatar', initial);
}
