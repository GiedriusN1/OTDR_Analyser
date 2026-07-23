import { state } from './state.js';
import { translations } from './translations.js';
import { RULES } from './rules.js';

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

export function escapeHtml(str) {
    if (!str) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(str).replace(/[&<>"']/g, function(m) { return map[m]; });
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

// ── 1 km dirbtinė linija ── // ── Ar eventas yra dirbtinis (Launch Level) ──

/* Įjungus vatnelę "1 km dirbtinė linija" funkcija klaidingai nusprendžia, kad tai dirbtinis 1km linijos movos artefaktas, ir jį atfiltruoja, nebelieka Event #1.
export function isArtificial1kmEvent(ev) {
    if (!state.has1kmLine) return false;
    // Tikriname, ar originalDistance ≈ sveikas km skaičius (buvo 1 km launch fiber riba)
    const remainder = ev.originalDistance % 1;
    const nearBoundary = remainder < 0.05 || remainder > 0.95;
    if (!nearBoundary) return false;

    // Jei eventas turi reikšmingą nuostolį arba atspindį – tai realus įrenginys
    // (pvz. WDM/PON, prijungtas per 1 km liniją), o NE vien paleidimo kabelio
    // movos artefaktas. Tokio nefiltruojame, net jei jis arti km ribos.
    const loss = Math.abs(ev.loss || 0);
    const refl = ev.refl || 0;
    const isRealDevice = loss > RULES.splice.typical || (refl !== 0 && refl > -55);
    return !isRealDevice;
}
*/

// pataisyta
export function isArtificial1kmEvent(ev) {
    if (!state.has1kmLine) return false;
    // Tikrasis OTDR prijungimo taškas (km 0) niekada nėra dirbtinis 1km artefaktas —
    // jis natūraliai turi originalDistance≈0, kas trivialiai "arti" bet kurios km ribos.
    if (typeof ev.originalDistance === 'number' && ev.originalDistance < 0.01) return false;
    const remainder = ev.originalDistance % 1;
    const nearBoundary = remainder < 0.05 || remainder > 0.95;
    if (!nearBoundary) return false;

    const loss = Math.abs(ev.loss || 0);
    const refl = ev.refl || 0;
    const isRealDevice = loss > RULES.splice.typical || (refl !== 0 && refl > -55);
    return !isRealDevice;
}





export function filterEvents(events) {
    // if (!state.has1kmLine) return events;
    // return events.filter(e => !isArtificial1kmEvent(e));
	return events; // grąžiname visus eventus
}

export function isLaunchLevel(ev) {
    if (!state.has1kmLine) return false;
    return ev.distance < 0.01; // bandyti mažinti ? ****************
}

// Jei uždėta varnelė ant WDM, paliekame 2 ženklus po kablelio
export function formatWavelength(wl) {
    const num = parseFloat(wl);
    if (isNaN(num)) return String(wl);

    // Jei WDM įjungta – rodyti tiksliai su dviem dešimtainiais
    if (state.hasWdm) {
        return num.toFixed(2);
    }

    // Jei ne WDM – apvaliname iki artimiausio standartinio bangos ilgio
    const standards = [1310, 1383, 1490, 1550, 1625, 1650];
    
    // Saugus artimiausio radimas
    let closest = standards[0];
    for (const s of standards) {
        if (Math.abs(s - num) < Math.abs(closest - num)) {
            closest = s;
        }
    }
    
    // Apsauga nuo undefined
    if (closest === undefined) {
        return Math.round(num).toString();
    }
    return closest.toString();
}



// ── PRITAIKYTI 1 km KOREKCIJĄ ──

/* Funkcija kalidingai  neigiamą rezultatą apkarpo (clamp) iki 0
export function apply1kmCorrection(sors) {
    if (!state.has1kmLine) return sors;
    return sors.map(sor => {
        // Koreguojame tik distance, bet originalDistance lieka nepaliestas
        const correctedEvents = sor.events.map(ev => ({
            ...ev,
            distance: Math.max(0, parseFloat((ev.originalDistance - 1.0).toFixed(4)))
        }));
        const correctedTrace = sor.trace.map(pt => ({
            ...pt,
            x: Math.max(0, parseFloat((pt.x - 1.0).toFixed(4)))
        }));
        const correctedRange = Math.max(0, sor.range_km - 1.0);
        return {
            ...sor,
            events: correctedEvents,
            trace: correctedTrace,
            range_km: correctedRange
        };
    });
}
*/

// pataisyta
export function apply1kmCorrection(sors) {
    if (!state.has1kmLine) return sors;
    return sors.map(sor => {
        // Pašaliname eventus IR trasos taškus, kurie fiziškai yra pačioje
        // dirbtinėje 1km linijoje (originalDistance < 1.0) - jie nepriklauso
        // tikrai matuojamai linijai. Anksčiau tokie buvo tik apkarpomi iki
        // distance=0, todėl keli skirtingi įvykiai susigrūsdavo tame
        // pačiame taške ir sugadindavo bangų palyginimą bei segmentų ribas.
        const correctedEvents = sor.events
            .filter(ev => ev.originalDistance >= 1.0 - 1e-6)
            .map(ev => ({
                ...ev,
                distance: parseFloat((ev.originalDistance - 1.0).toFixed(4))
            }));
        const correctedTrace = sor.trace
            .filter(pt => pt.x >= 1.0 - 1e-6)
            .map(pt => ({
                ...pt,
                x: parseFloat((pt.x - 1.0).toFixed(4))
            }));
        const correctedRange = Math.max(0, sor.range_km - 1.0);
        return {
            ...sor,
            events: correctedEvents,
            trace: correctedTrace,
            range_km: correctedRange
        };
    });
}



export function getClosestStandardWavelength(wl) {
	const standards = [1310, 1383, 1490, 1550, 1625, 1650];
	let closest = standards[0];
	let minDiff = Infinity;
	for (const s of standards) {
		const diff = Math.abs(s - wl);
		if (diff < minDiff) {
			minDiff = diff;
			closest = s;
		}
	}
	return closest;
}

// ── OTDR PRIJUNGIMO (LAUNCH) ARTEFAKTO APTIKIMAS ──
// Po paleidimo jungties dažnai įvyksta stipri Frenelio atspindžio soties
// (saturation) atsigavimo "uodega" - trasa RODO padidėjusi slopinimą, nors
// tai tik matavimo artefaktas, ne reali skaidula. Vien impulso pločio
// formulė (Event Dead Zone) šio šleifo dažnai nepakankamai įvertina, nes
// atsigavimas vyksta laipsniškai ir netolygiai (priklauso nuo atspindžio
// stiprumo, ne vien impulso). Šis algoritmas ieško realaus taško trasoje,
// kur slopinimo greitis (regresija per 40m langą) nusistovi žemiau ribos.
function _regressionAttenuation(pts) {
    const n = pts.length;
    if (n < 2) return null;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n;
    const my = pts.reduce((s, p) => s + p.y, 0) / n;
    const ss = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    if (ss < 1e-10) return null;
    const sp = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
    return Math.abs(sp / ss);
}

/**
 * Randa OTDR prijungimo artefakto (launch saturation recovery) pabaigos
 * atstumą (km). Naudojama IR vidutinio slopinimo skaičiavime (parser.js),
 * IR segmentų diagnostikoje (diagnostics.js) - abu naudoja TĄ PATĮ rezultatą,
 * kad pranešimas ir skaičiavimas visada sutaptų.
 *
 * Grąžina: { endKm, endM, formulaFloorKm }
 */
export function detectLaunchArtifactEnd(trace, pulseWidthNs, ior) {
    const iorVal = ior || 1.4676;
    const c_over_2n_km_per_ns = (299792.458 / (2 * iorVal)) * 1e-9; // ≈ 0.0001021 km/ns
    const edz_km = (pulseWidthNs || 0) * c_over_2n_km_per_ns;
    const formulaFloorKm = Math.max(0.01, edz_km * 8) * 0.8; // apatinės saugos riba pagal impulso plotį

    if (!trace || trace.length < 5) {
        return { endKm: formulaFloorKm, endM: Math.round(formulaFloorKm * 1000), formulaFloorKm };
    }

    const WINDOW_KM = 0.025;   // 25 m regresijos langas 
    const STABLE_ATT = 0.4;    // dB/km - griežta riba; kalibruota su realiais matavimais taip, kad
                                // pirmas po-artefaktinis segmentas jau būtų tikrai "normal", ne "elevated"
    const NEED_STABLE = 2;     // kiek iš eilės langų turi būti stabilūs
    const MAX_SEARCH_KM = 0.50; // 500 m viršutinė paieškos riba (apsauga nuo begalinės paieškos)

    let stableCount = 0;
    let lastStableX = null;

    for (let i = 0; i < trace.length; i++) {
        const p1 = trace[i];
        if (p1.x > MAX_SEARCH_KM) break;

        const windowPts = [];
        for (let j = i; j < trace.length; j++) {
            if (trace[j].x > p1.x + WINDOW_KM) break;
            windowPts.push(trace[j]);
        }
        if (windowPts.length < 4) continue;

        const att = _regressionAttenuation(windowPts);
        if (att !== null && att < STABLE_ATT) {
            stableCount++;
            if (stableCount === 1) lastStableX = p1.x;
            if (stableCount >= NEED_STABLE) {
                const endKm = Math.max(formulaFloorKm, lastStableX);
                return { endKm, endM: Math.round(endKm * 1000), formulaFloorKm };
            }
        } else {
            stableCount = 0;
        }
    }

    // Nepavyko rasti stabilaus taško per MAX_SEARCH_KM - naudojame konservatyvią numatytąją reikšmę
    const endKm = Math.min(MAX_SEARCH_KM, Math.max(formulaFloorKm, MAX_SEARCH_KM * 0.5));
    return { endKm, endM: Math.round(endKm * 1000), formulaFloorKm };
}