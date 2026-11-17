/**
 * One look for every on-screen surface: warm, soft, storybook. Fonts load from
 * Google Fonts when online and fall back to rounded system fonts offline.
 */
let installed = false;

export const THEME_CSS = `
:root{
  --cj-font:'Nunito',ui-rounded,'SF Pro Rounded',system-ui,-apple-system,'Segoe UI',sans-serif;
  --cj-serif:'Fraunces',Georgia,'Times New Roman',serif;
  --cj-ink:#fff8ef; --cj-dim:rgba(255,248,239,.68);
  --cj-glass:rgba(26,20,38,.66); --cj-glass-strong:rgba(28,22,40,.9); --cj-line:rgba(255,236,210,.14);
  --cj-gold:#ffd98a; --cj-mint:#b9f3e4; --cj-rose:#ff8fa3;
  --cj-grad:linear-gradient(135deg,#ffc36b 0%,#ff8f8f 55%,#c48bff 100%);
  --cj-shadow:0 18px 50px rgba(8,4,20,.45),0 2px 0 rgba(255,255,255,.04) inset;
}
@keyframes cj-orb{0%{transform:rotate(0) scale(1)}50%{transform:rotate(180deg) scale(1.08)}100%{transform:rotate(360deg) scale(1)}}
@keyframes cj-rise{from{opacity:0}to{opacity:1}}
`;

export function installTheme() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const pre = document.createElement('link');
  pre.rel = 'preconnect'; pre.href = 'https://fonts.gstatic.com'; pre.crossOrigin = '';
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Nunito:wght@400;600;700;800&display=swap';
  document.head.append(pre, fonts);
  const style = document.createElement('style');
  style.textContent = THEME_CSS;
  document.head.appendChild(style);
}
