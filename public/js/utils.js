import { translations } from './translations.js';

let currentLang = 'lt';

export function setLang(lang) {
    if (translations[lang]) currentLang = lang;
}

export function t(key, params = {}) {
    const dict = translations[currentLang] || translations.lt;
    let text = dict[key] || key;
    for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
    return text;
}

export function applyTranslations() {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        const text = t(key);
        if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'password' || el.type === 'search')) {
            el.placeholder = text;
        } else if (el.tagName === 'INPUT' && el.type === 'button') {
            el.value = text;
        } else {
            el.innerHTML = text;
        }
    });
}

export function toast(msg, type = 'ok') {
    const wrap = document.getElementById('toastWrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = '<i class="ti ti-' + (type === 'ok' ? 'check' : 'alert-circle') + '"></i> ' + msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

export function setStatus(msg) {
    const el = document.getElementById('statusMsg');
    if (el) el.textContent = msg;
}

export function setProgress(pct) {
    const bar = document.getElementById('progBar');
    const fill = document.getElementById('progFill');
    if (!bar || !fill) return;
    bar.style.display = pct > 0 ? 'block' : 'none';
    fill.style.width = pct + '%';
}

export function guessWl(name) {
    const m = name.match(/1[0-9]{3}/g) || [];
    for (const v of m) {
        const n = parseInt(v);
        if ([1310, 1383, 1490, 1550, 1625].includes(n)) return String(n);
    }
    return '';
}

export function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}