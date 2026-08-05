import { t } from './utils.js';
import { state } from './state.js';

// ── Skaidulos identifikatoriaus ištraukimas iš failo vardo ──
export function extractFiberId(filename) {
    if (!filename) return null;
    const base = String(filename).replace(/\.[a-zA-Z0-9]+$/, '');
    let m = base.match(/sk[\s_.-]*?(\d+)/i);
    if (m) return 'sk.' + m[1];
    m = base.match(/(\d+)[\s_.-]*?sk\b/i);
    if (m) return 'sk.' + m[1];
    return null;
}

function _parseSegmentRange(category) {
    if (!category) return null;
    const m = category.match(/@\s*([\d.]+)\s*[-–]\s*([\d.]+)\s*km/);
    if (!m) return null;
    return { start: parseFloat(m[1]), end: parseFloat(m[2]) };
}

// ── Kabelio lygmens analizė ──
export function analyzeCableWide(groups, RULES, formatWavelength, lang = 'lt') {
    const diags = [];
    if (!groups || groups.length < 2) return diags;

    const labelOf = g => extractFiberId(g.group) || g.group;

    // a) ORL palyginimas tarp skaidulų (praleista, jei vartotojas ignoruoja ORL).
    // SVARBU: reikšmės imamos TIESIOGIAI iš g.stats[wl].orl (žalia, kiekvienai
    // skaidulai visada yra), o NE iš jau esančios per-failo ORL diagnozės teksto -
    // ta diagnozė sukuriama TIK kai orl < RULES.orl.warn (žr. diagnostics.js
    // diagnoseSingle), todėl geros ORL skaidulos joje neatsirastų ir liktų
    // nematomos min/max/delta skaičiavimui, o disbalansas tarp geros ir blogos
    // skaidulos niekada nebūtų aptiktas.
    const wlSet = new Set();
    if (!state.ignoreOrl) groups.forEach(g => (g.wavelengths || []).forEach(wl => wlSet.add(wl)));
    wlSet.forEach(wl => {
        const vals = [];
        groups.forEach(g => {
            const s = g.stats && (g.stats[wl] || g.stats[String(wl)]);
            if (!s || !(s.orl > 0)) return;
            vals.push({ label: labelOf(g), orl: s.orl });
        });
        if (vals.length >= Math.max(2, groups.length - 1)) {
            const nums = vals.map(v => v.orl);
            const min = Math.min(...nums), max = Math.max(...nums);
            const delta = max - min;
            // Visos (net geriausia) žemiau normos - tikėtina bendra priežastis
            const isCommonLow = max < RULES.orl.warn;
            // Didelis atotrūkis tarp geriausios ir prasčiausios - tikėtina
            // KONKREČIOS skaidulos jungties problema, ne bendra
            const isUnbalanced = delta >= 3;
            if (isCommonLow || isUnbalanced) {
                const labels = vals.map(v => v.label).join(', ');
                const worst = vals.reduce((a, b) => (b.orl < a.orl ? b : a)).label;
                // Disbalanso pranešimas prioritetiškesnis, nes jis nurodo
                // KONKREČIĄ skaidulą, taigi yra veiksmingesnis nei bendras
                const key = isUnbalanced ? 'cable_orl_unbalanced' : 'cable_common_orl';
                diags.push({
                    sev: 'warning',
                    category: t(key + '_title') + ' (' + formatWavelength(wl) + ' nm)',
                    msg: t(key + '_msg', {
                        count: vals.length,
                        min: min.toFixed(1),
                        max: max.toFixed(1),
                        delta: delta.toFixed(1),
                        warn: RULES.orl.warn,
                        wl: formatWavelength(wl),
                        labels: labels,
                        worst: worst
                    }),
                    rec: t(key + '_rec'),
                    _scope: 'cable'
                });
            }
        }
    });

    // b) Bendri / daliniai fiziniai pažeidimai
    const locEvents = [];
    groups.forEach(g => {
        Object.entries(g.per_file || {}).forEach(([wl, ds]) => {
            (ds || []).forEach(d => {
                if (d._class !== 'segment') return;
                if (d.sev !== 'critical' && d.sev !== 'warning') return;
                const r = _parseSegmentRange(d.category);
                if (!r) return;
                locEvents.push({ label: labelOf(g), start: r.start, end: r.end, sev: d.sev, group: g });
            });
        });
    });
    const TOL = 0.15;
    const clusters = [];
    locEvents.forEach(ev => {
        const mid = (ev.start + ev.end) / 2;
        let cl = clusters.find(c => Math.abs(c.mid - mid) < TOL);
        if (!cl) { cl = { mid, items: [] }; clusters.push(cl); }
        cl.items.push(ev);
        cl.mid = cl.items.reduce((s, i) => s + (i.start + i.end) / 2, 0) / cl.items.length;
    });
    const allLabels = groups.map(labelOf);

    // Ar segmento anomalijos vietoje TOS PAČIOS skaidulos taip pat turi
    // makrolenkimo signatūrą (cross_wl, _class:'macrobend_point' - 1550 nm
    // slopimas žymiai didesnis nei 1310 nm ties tuo pačiu tašku)? Vien
    // segmento slopinimo padidėjimas savaime NEATSKIRIA makrolenkimo nuo
    // kitos priežasties (mechaninis spaudimas, prasta mova ir pan.) - šis
    // patikrinimas prideda tą specifiškumą pasinaudojant JAU esančiais
    // duomenimis, o ne nauju algoritmu.
    function macrobendSupportFraction(cl) {
        const uniqueByLabel = [...new Map(cl.items.map(i => [i.label, i])).values()];
        const withMacrobend = uniqueByLabel.filter(i =>
            (i.group.cross_wl || []).some(d => d._class === 'macrobend_point' && Math.abs(d._distance - cl.mid) < TOL)
        );
        return uniqueByLabel.length ? withMacrobend.length / uniqueByLabel.length : 0;
    }
    function macrobendNoteKey(frac) {
        if (frac >= 0.5) return 'cable_shared_damage_macrobend_yes';
        if (frac > 0) return 'cable_shared_damage_macrobend_partial';
        return 'cable_shared_damage_macrobend_no';
    }

    clusters.forEach(cl => {
        const affected = [...new Set(cl.items.map(i => i.label))];
        const hasCritical = cl.items.some(i => i.sev === 'critical');
        const pos = cl.mid.toFixed(2);
        const macrobendNote = t(macrobendNoteKey(macrobendSupportFraction(cl)));
        if (affected.length >= 2 && affected.length < allLabels.length) {
            const unaffected = allLabels.filter(l => !affected.includes(l));
            diags.push({
                sev: hasCritical ? 'critical' : 'warning',
                category: (hasCritical ? '💀 ' : '🟡 ') + t('cable_shared_damage_title', { pos }),
                msg: t('cable_shared_damage_msg', {
                    pos: pos,
                    affected: affected.join(', '),
                    unaffected: unaffected.join(', ')
                }) + ' ' + macrobendNote,
                rec: t('cable_shared_damage_rec'),
                _scope: 'cable'
            });
        } else if (affected.length === allLabels.length && allLabels.length >= 2) {
            diags.push({
                sev: hasCritical ? 'critical' : 'warning',
                category: '💀 ' + t('cable_all_damage_title', { pos }),
                msg: t('cable_all_damage_msg', {
                    pos: pos,
                    count: allLabels.length
                }) + ' ' + macrobendNote,
                rec: t('cable_all_damage_rec'),
                _scope: 'cable'
            });
        }
    });

    // c) Sistemiškai prastesnė skaidula
    if (groups.length >= 3) {
        groups.forEach(g => {
            const others = groups.filter(x => x !== g).map(x => x.score);
            const othersAvg = others.reduce((a, b) => a + b, 0) / others.length;
            if (othersAvg - g.score > 15) {
                const label = labelOf(g);
                diags.push({
                    sev: 'warning',
                    category: '📉 ' + t('cable_worse_fiber_title', { label }),
                    msg: t('cable_worse_fiber_msg', {
                        label: label,
                        score: Math.round(g.score),
                        avg: Math.round(othersAvg)
                    }),
                    rec: t('cable_worse_fiber_rec'),
                    _scope: 'cable'
                });
            }
        });
    }

    return diags;
}