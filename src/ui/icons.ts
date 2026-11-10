/** Inline SVG icons (no image files). */
const svg = (body: string, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  play: svg('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>'),
  pause: svg('<rect x="6" y="5" width="4.2" height="14" rx="1.4" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.4" fill="currentColor"/>'),
  map: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>'),
  users: svg('<circle cx="8.5" cy="8" r="3.4" fill="currentColor"/><circle cx="16.5" cy="9" r="2.8" fill="currentColor"/><path d="M2 20c0-4 3-6 6.5-6S15 16 15 20zM14 20c0-2 .8-4 2.5-5 3 0 5.5 1.6 5.5 5z" fill="currentColor"/>'),
  infinity: svg('<path d="M7 8.5a3.5 3.5 0 100 7c2.5 0 7.5-7 10-7a3.5 3.5 0 110 7c-2.5 0-7.5-7-10-7z" fill="none" stroke="currentColor" stroke-width="2.6"/>'),
  gear: svg('<path d="M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zm8 3.5l2-1.5-2-3.5-2.4.8a7 7 0 00-1.8-1L15.3 4h-4l-.5 2.8a7 7 0 00-1.8 1L6.6 7 4.6 10.5l2 1.5a7 7 0 000 2l-2 1.5 2 3.5L9 18.2a7 7 0 001.8 1l.5 2.8h4l.5-2.8a7 7 0 001.8-1l2.4.8 2-3.5-2-1.5a7 7 0 000-2z" fill="currentColor" fill-rule="evenodd"/>'),
  back: svg('<path d="M14.5 5L7.5 12l7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'),
  home: svg('<path d="M3.5 11L12 4l8.5 7v9h-6v-6h-5v6h-6z" fill="currentColor"/>'),
  retry: svg('<path d="M19 12a7 7 0 11-2.1-5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><path d="M18.5 2.5v5h-5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  star: svg('<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor" stroke="#3b2a1a" stroke-width="1.3" stroke-linejoin="round"/>'),
  trash: svg('<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>'),
  tv: svg('<rect x="2.5" y="6" width="19" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M8 2.5l4 3.5 4-3.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M10 9.5v6l5-3z" fill="currentColor"/>'),
  hand: svg('<path d="M20 34V12a4 4 0 018 0v14l2-.6a4 4 0 014.6 2.2l.4 1 1.4-.2a4 4 0 014.4 3l.3 1.2 1.2-.1a4 4 0 014.3 4l-.3 9.5A12 12 0 0134.4 58H29a12 12 0 01-9.6-4.8L13 44.6a4 4 0 016-5.2z" fill="#fff" stroke="#2b2235" stroke-width="3" stroke-linejoin="round"/>', '0 0 64 64'),
  ammo_arrow: svg('<path d="M3 21L19 5" stroke="#e7c48e" stroke-width="2.6" stroke-linecap="round"/><path d="M21 3l-6.5 1.5 5 5z" fill="#9aa2b2"/><path d="M3 21l1-4.5 2.2 2.2zM3 21l4.5-1-2.2-2.2z" fill="#ff5a4f"/>'),
  ammo_fire: svg('<path d="M3 21L17 7" stroke="#e7c48e" stroke-width="2.6" stroke-linecap="round"/><path d="M19 1.5c2.5 3 3 5.5.8 8-1.4 1.5-4.2 1.4-5.3-.6-1-1.8.3-3.5 1.6-4 0 1.4.8 2 1.6 1.6 1-.6 1.6-2.6 1.3-5z" fill="#ff8a3d"/><path d="M3 21l1-4.5 2.2 2.2zM3 21l4.5-1-2.2-2.2z" fill="#ffd23f"/>'),
  ammo_heavy: svg('<path d="M3 21L18 6" stroke="#5a5f6e" stroke-width="3.6" stroke-linecap="round"/><path d="M22 2l-8 2 6 6z" fill="#3b3f4c"/>'),
  ammo_ice: svg('<path d="M3 21L17 7" stroke="#e7c48e" stroke-width="2.6" stroke-linecap="round"/><path d="M21 3l-7 2 5 5z" fill="#8fdcff"/><path d="M12 2v6M9 5h6" stroke="#bfe8ff" stroke-width="1.6" stroke-linecap="round"/>'),
  ammo_bomb: svg('<circle cx="11" cy="14" r="7" fill="#2b2d36"/><path d="M15 8.5l2.5-2.5" stroke="#c9a46a" stroke-width="2" stroke-linecap="round"/><circle cx="19" cy="4.5" r="2" fill="#ffd23f"/><circle cx="8.5" cy="11.5" r="1.6" fill="#fff" opacity=".5"/>'),
};
