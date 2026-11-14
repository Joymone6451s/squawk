// Polly herself: one inline SVG. Her mood is a data attribute, and the stylesheet does the rest.

const BIRD = `
<svg viewBox="0 0 360 344" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g class="tail">
    <path d="M120 230C96 256 76 282 60 312l20 0c14-26 32-50 56-72z" fill="#ffd447"/>
    <path d="M132 236c-20 32-36 64-48 96l20-4c12-28 28-56 46-84z" fill="#e63946"/>
    <path d="M146 240c-12 32-22 62-28 94l18-6c6-26 16-54 28-80z" fill="#1d7cf2"/>
  </g>
  <rect x="36" y="286" width="250" height="16" rx="8" fill="#8a5a2b"/>
  <rect x="36" y="295" width="250" height="7" rx="3.5" fill="#6e4520"/>
  <g class="bird">
    <ellipse cx="180" cy="192" rx="62" ry="84" transform="rotate(-10 180 192)" fill="#12a36d"/>
    <ellipse cx="197" cy="206" rx="37" ry="57" transform="rotate(-10 197 206)" fill="#43c88f"/>
    <g class="wing">
      <path d="M150 150c-32 18-42 64-28 106 18-6 44-30 54-66 4-18-6-36-26-40z" fill="#0b7a52"/>
      <path d="M122 256c6-20 18-34 34-42-6 22-18 36-34 42z" fill="#1d7cf2"/>
      <path d="M128 232c6-16 16-28 30-36-4 18-14 30-30 36z" fill="#ffd447"/>
    </g>
    <g class="feet" stroke="#ff6b35" stroke-width="7" stroke-linecap="round" fill="none">
      <path d="M166 268l-7 20M166 268l7 20M166 268v22"/>
      <path d="M204 266l-7 22M204 266l7 22M204 266v24"/>
    </g>
    <g class="head">
      <path d="M176 68c-12-14-14-30-6-42 6 14 14 26 20 36z" fill="#1d7cf2"/>
      <path d="M190 60c-8-20-4-36 8-46 2 16 4 30 6 44z" fill="#e63946"/>
      <path d="M204 56c-2-20 6-36 20-44-2 16-4 30-8 44z" fill="#ffd447"/>
      <circle cx="206" cy="104" r="50" fill="#12a36d"/>
      <path d="M214 70c26 2 42 22 40 46-4 20-22 30-40 26-16-4-24-24-20-44 2-14 10-26 20-28z" fill="#ffe27a"/>
      <g class="eye-open">
        <circle cx="226" cy="100" r="13" fill="#fff"/>
        <circle class="pupil" cx="229" cy="101" r="6.5" fill="#1b1b1f"/>
        <circle cx="231.5" cy="98.5" r="2" fill="#fff"/>
      </g>
      <path class="eye-closed" d="M214 101c6 7 18 7 24 0" stroke="#1b1b1f" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path class="eye-happy" d="M214 104c6-9 18-9 24 0" stroke="#1b1b1f" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path class="beak-low" d="M246 126c10 2 18 8 22 18-10 6-20 2-26-6z" fill="#d94f1e"/>
      <path class="beak-top" d="M244 92c28-4 48 12 46 34-2 14-10 24-20 28 2-14-4-26-18-30-6-2-10-8-10-16z" fill="#ff6b35"/>
    </g>
  </g>
  <g class="zzz" fill="#6b7a90" font-family="Baloo 2, sans-serif" font-weight="800">
    <text x="262" y="62" font-size="20">z</text>
    <text x="282" y="42" font-size="28">z</text>
    <text x="306" y="20" font-size="36">Z</text>
  </g>
  <g class="waves" stroke="#ff6b35" stroke-width="6" stroke-linecap="round" fill="none">
    <path d="M304 100c12 12 12 32 0 44"/>
    <path d="M320 86c22 20 22 52 0 72"/>
    <path d="M336 72c32 28 32 72 0 100"/>
  </g>
</svg>`;

/** Draws Polly into `element`. */
export function draw(element) {
  element.innerHTML = BIRD;
}

/** Sets her mood: asleep, hungry, fed or squawk. */
export function setMood(element, mood) {
  if (element.dataset.mood !== mood) element.dataset.mood = mood;
}
