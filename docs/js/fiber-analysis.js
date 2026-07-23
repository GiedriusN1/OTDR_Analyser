import { t } from './utils.js';

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

function _parseOrlFromMsg(msg) {
    if (!msg) return null;
    const m = msg.match(/([\d.]+)\s*dB/);
    return m ? parseFloat(m[1]) : null;
}

// ── Kabelio lygmens analizė ──
export function analyzeCableWide(groups, RULES, formatWavelength, lang = 'lt') {
    const diags = [];
    if (!groups || groups.length < 2) return diags;

    const labelOf = g => extractFiberId(g.group) || g.group;

    // a) Bendra ORL problema
    const wlSet = new Set();
    groups.forEach(g => (g.wavelengths || []).forEach(wl => wlSet.add(wl)));
    wlSet.forEach(wl => {
        const vals = [];
        groups.forEach(g => {
            const ds = g.per_file[wl] || g.per_file[String(wl)];
            if (!ds) return;
            const orlD = ds.find(d => /ORL/i.test(d.category || ''));
            if (!orlD) return;
            const v = _parseOrlFromMsg(orlD.msg);
            if (v !== null) vals.push({ label: labelOf(g), orl: v });
        });
        if (vals.length >= Math.max(2, groups.length - 1)) {
            const nums = vals.map(v => v.orl);
            const min = Math.min(...nums), max = Math.max(...nums);
            if (max < RULES.orl.warn && (max - min) < 3) {
                const labels = vals.map(v => v.label).join(', ');
                diags.push({
                    sev: 'warning',
                    category: t('cable_common_orl_title') + ' (' + formatWavelength(wl) + ' nm)',
                    msg: t('cable_common_orl_msg', {
                        count: vals.length,
                        min: min.toFixed(1),
                        max: max.toFixed(1),
                        warn: RULES.orl.warn,
                        wl: formatWavelength(wl),
                        labels: labels
                    }),
                    rec: t('cable_common_orl_rec'),
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
                locEvents.push({ label: labelOf(g), start: r.start, end: r.end, sev: d.sev });
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
    clusters.forEach(cl => {
        const affected = [...new Set(cl.items.map(i => i.label))];
        const hasCritical = cl.items.some(i => i.sev === 'critical');
        const pos = cl.mid.toFixed(2);
        if (affected.length >= 2 && affected.length < allLabels.length) {
            const unaffected = allLabels.filter(l => !affected.includes(l));
            diags.push({
                sev: hasCritical ? 'critical' : 'warning',
                category: (hasCritical ? '💀 ' : '🟡 ') + t('cable_shared_damage_title', { pos }),
                msg: t('cable_shared_damage_msg', {
                    pos: pos,
                    affected: affected.join(', '),
                    unaffected: unaffected.join(', ')
                }),
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
                }),
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