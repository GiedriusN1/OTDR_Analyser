import { state } from './state.js';
import { RULES, WL_COLORS } from './config.js';
import { t } from './utils.js';
import { classifyEvent, consolidateEvents } from './diagnostics.js';
import { setupTraceChart, drawOverlay } from './chart.js';

// ── Overview ──
export function renderOverview(ok, wls) {
    const allD = state.diagnostics.flatMap(g => [
        ...g.cross_wl.map(d => ({ ...d, _scope: t('diag_scope_cross_wl') })),
        ...Object.entries(g.per_file).flatMap(([wl, ds]) => ds.map(d => ({ ...d, _scope: wl + ' ' + t('unit_nm') }))),
    ]);
    const crit = allD.filter(d => d.sev === 'critical').length;
    const warn = allD.filter(d => d.sev === 'warning').length;
    const avgScore = state.diagnostics.reduce((s, g) => s + g.score, 0) / Math.max(state.diagnostics.length, 1);
    const grade = RULES.quality_score.grades.find(g => avgScore >= g.min);

    document.getElementById('ovMetrics').innerHTML =
        '<div class="mc teal"><div class="lbl">' + t('metrics_files') + '</div><div class="val">' + ok.length + '</div></div>' +
        '<div class="mc blue"><div class="lbl">' + t('metrics_wavelengths') + '</div><div class="val" style="font-size:13px">' + wls.join('/') + ' <span class="unit">' + t('unit_nm') + '</span></div></div>' +
        '<div class="mc"><div class="lbl">' + t('metrics_avg_loss') + '</div><div class="val">' + (ok.reduce((s, p) => s + (p.total_loss || 0), 0) / ok.length).toFixed(2) + '<span class="unit"> ' + t('unit_dB') + '</span></div></div>' +
        '<div class="mc red"><div class="lbl">' + t('metrics_critical') + '</div><div class="val">' + crit + '</div></div>' +
        '<div class="mc orange"><div class="lbl">' + t('metrics_warnings') + '</div><div class="val">' + warn + '</div></div>' +
        '<div class="mc" style="border-color:' + (grade?.color || '#888') + '33"><div class="lbl">' + t('metrics_quality') + '</div><div class="val" style="color:' + (grade?.color || '#888') + ';font-size:14px">' + Math.round(avgScore) + ' <span class="unit">/100</span></div></div>';

    const sevO = { critical: 0, warning: 1, info: 2 };
    const top = allD.sort((a, b) => sevO[a.sev] - sevO[b.sev]).slice(0, 8);
    const SI = { critical: '🔴', warning: '🟡', info: '🔵' };
    document.getElementById('ovDiags').innerHTML = top.map(d =>
        '<div class="diag-item ' + d.sev + '"><div class="diag-icon">' + SI[d.sev] + '</div>' +
        '<div class="diag-body">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">' +
        '<div class="cat" style="margin:0">' + d.category + '</div>' +
        '<span style="font-size:10px;background:rgba(255,255,255,.07);padding:1px 6px;border-radius:4px;color:var(--muted)">' + (d._scope || '') + '</span>' +
        '</div>' +
        '<div class="msg">' + d.msg + '</div><div class="rec">💡 ' + d.rec + '</div></div></div>'
    ).join('') || '<div class="diag-item info"><div class="diag-icon">🔵</div><div class="diag-body"><div class="msg">' + t('diag_general_ok') + '</div></div></div>';
}

// ── Render Events (only the dynamic labels changed) ──
export function renderEvents(ok) {
    // ... existing code ...
    // Inside the rendering, replace hardcoded strings:
    // 'Suvirinimas' -> t('event_splice')
    // 'Atspindys' -> t('event_refl')
    // 'Kabelio galas' -> t('event_end')
    // 'WDM/PON' -> t('event_wdm')
    // 'Event' -> t('event_other')
    // 'Visi λ' -> t('label_all_wavelengths')
    // 'Visi tipai' -> t('label_all_types')
    // 'Nėra event\'ų' -> t('label_event_strip_empty')
    // Also the table headers: 'Failas' -> t('metrics_files'), 'λ nm' -> 'λ ' + t('unit_nm'), etc.
    // (I'll include the full updated renderEvents function below, but you get the idea)
}

// ── Full updated renderEvents (for completeness) ──
export function renderEvents(ok) {
    const wls = [...new Set(ok.map(s => Math.round(s.wavelength)))].sort();
    document.getElementById('evFilterWl').innerHTML =
        '<option value="">' + t('label_all_wavelengths') + '</option>' +
        wls.map(w => '<option value="' + w + '">' + w + ' ' + t('unit_nm') + '</option>').join('');

    function render() {
        const wlF = parseFloat(document.getElementById('evFilterWl').value) || null;
        const typeF = document.getElementById('evFilterType').value;
        const consol = document.getElementById('evConsolidate').checked;
        const filtered = ok.filter(s => !wlF || Math.abs(s.wavelength - wlF) < 5);
        let groups = consolidateEvents(filtered);
        if (typeF) groups = groups.map(g => ({ ...g, events: g.events.filter(e => e.type === typeF) })).filter(g => g.events.length);
        const SI = { critical: '🔴', warning: '🟡', info: '⚪' };
        const TYPE_LABELS = {
            splice: t('event_splice'),
            refl: t('event_refl'),
            end: t('event_end'),
            wdm: t('event_wdm'),
            other: t('event_other')
        };

        if (consol) {
            document.getElementById('eventsBody').innerHTML = groups.map(g => {
                const types = [...new Set(g.events.map(e => e.type))];
                const mType = types.includes('wdm') ? 'wdm' : types.includes('end') ? 'end' : types.includes('refl') ? 'refl' : 'splice';
                const byWl = {};
                g.events.forEach(e => { if (!byWl[e.wl]) byWl[e.wl] = []; byWl[e.wl].push(e); });
                const wlSummary = Object.entries(byWl).sort(([a], [b]) => a - b).map(([wl, evs]) => {
                    const loss = evs.reduce((s, e) => s + e.loss, 0) / evs.length;
                    const lc = loss > RULES.splice.critical ? 'color:var(--red)' : loss > RULES.splice.warn ? 'color:var(--yellow)' : 'color:var(--teal)';
                    return '<span style="font-size:11px"><span style="color:' + WL_COLORS[wl] + '">' + wl + 'nm:</span> <span style="' + lc + ';font-family:JetBrains Mono,monospace">' + loss.toFixed(3) + ' ' + t('unit_dB') + '</span></span>';
                }).join('  ');
                const allD = state.diagnostics.flatMap(g2 => [...g2.cross_wl, ...Object.values(g2.per_file).flat()]);
                const worst = allD.filter(d => d.category.includes(g.dist.toFixed(2)) || d.category.includes(g.dist.toFixed(3))).sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.sev] - { critical: 0, warning: 1, info: 2 }[b.sev]))[0];
                return '<div class="card" style="margin-bottom:5px;padding:10px 12px;">' +
                    '<div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">' +
                    '<span style="font-size:13px;font-weight:600;font-family:JetBrains Mono,monospace">' + g.dist.toFixed(3) + ' ' + t('unit_km') + '</span>' +
                    '<span class="ev-tag ' + mType + '">' + TYPE_LABELS[mType] + '</span>' +
                    [...new Set(g.events.map(e => e.wl))].sort().map(wl => '<span style="font-size:10px;background:' + WL_COLORS[wl] + '22;color:' + WL_COLORS[wl] + ';padding:1px 5px;border-radius:3px">' + wl + 'nm</span>').join('') +
                    '</div>' +
                    '<div style="display:flex;gap:12px;flex-wrap:wrap">' + wlSummary + '</div>' +
                    (worst ? '<div style="margin-top:6px;font-size:11px;color:var(--muted)">' + SI[worst.sev] + ' ' + worst.msg + ' <i>💡 ' + worst.rec + '</i></div>' : '') +
                    '</div>';
            }).join('') || '<div class="empty"><p>' + t('label_event_strip_empty') + '</p></div>';
        } else {
            const rows = groups.flatMap(g => g.events);
            document.getElementById('eventsBody').innerHTML =
                '<div class="card" style="padding:0;overflow-x:auto"><table><thead><tr>' +
                '<th>' + t('metrics_files') + '</th><th>λ ' + t('unit_nm') + '</th><th>Nr.</th><th>' + t('label_all_types') + '</th><th>' + t('unit_km') + '</th><th>' + t('unit_dB') + '</th><th>ORL ' + t('unit_dB') + '</th></tr></thead><tbody>' +
                rows.map(e => {
                    const col = WL_COLORS[e.wl] || '#888';
                    const lc = e.loss > RULES.splice.critical ? 'loss-bad' : e.loss > RULES.splice.warn ? 'loss-warn' : 'loss-ok';
                    const TYPE_LABELS2 = {
                        splice: t('event_splice'),
                        refl: t('event_refl'),
                        end: t('event_end'),
                        wdm: t('event_wdm'),
                        other: t('event_other')
                    };
                    return '<tr><td style="font-size:10px">' + e.file + '</td>' +
                        '<td><span style="color:' + col + ';font-weight:500">' + e.wl + '</span></td>' +
                        '<td class="mono">' + e.index + '</td>' +
                        '<td><span class="ev-tag ' + e.type + '">' + TYPE_LABELS2[e.type] + '</span></td>' +
                        '<td class="mono">' + e.distance.toFixed(4) + '</td>' +
                        '<td class="mono ' + lc + '">' + e.loss.toFixed(3) + '</td>' +
                        '<td class="mono">' + (e.refl && Math.abs(e.refl) > 0.1 ? e.refl.toFixed(2) : '—') + '</td></tr>';
                }).join('') + '</tbody></table></div>';
        }
    }
    render();
    document.getElementById('evFilterWl').onchange = render;
    document.getElementById('evFilterType').onchange = render;
    document.getElementById('evConsolidate').onchange = render;
}

// ── Comparison tab ──
export function renderComp(ok, wls) {
    const el = document.getElementById('compWrap');
    if (wls.length < 2) {
        el.innerHTML = '<div class="card"><div class="card-title"><i class="ti ti-info-circle" style="color:var(--blue)"></i> ' + t('tab_comp') + '</div><p style="font-size:12px;color:var(--muted)">' + t('comp_placeholder') + '</p></div>';
        return;
    }
    const eduBox = (type) => {
        const b = {
            bend: '<div class="edu-box"><div class="edu-title">' + t('edu_bend_title') + '</div><div class="edu-body">' + t('edu_bend_body') + '</div></div>',
            bend_point: '<div class="edu-box"><div class="edu-title">' + t('edu_bend_point_title') + '</div><div class="edu-body">' + t('edu_bend_point_body') + '</div></div>',
            water: '<div class="edu-box"><div class="edu-title">' + t('edu_water_title') + '</div><div class="edu-body">' + t('edu_water_body') + '</div></div>',
            ok: '<div class="edu-box" style="border-color:rgba(0,212,170,.2);background:rgba(0,212,170,.05)"><div class="edu-title" style="color:var(--teal)">' + t('edu_ok_title') + '</div><div class="edu-body">' + t('edu_ok_body') + '</div></div>',
        };
        return b[type] || '';
    };
    const SI = { critical: '🔴', warning: '🟡', info: '🔵' };
    const groups = {};
    ok.forEach(s => {
        const dir = s.path.split('/').slice(0, -1).join('/') || 'failai';
        if (!groups[dir]) groups[dir] = {};
        groups[dir][Math.round(s.wavelength)] = s;
    });
    let html = '';
    for (const [dir, byWl] of Object.entries(groups)) {
        const dWls = Object.keys(byWl).map(Number).sort();
        if (dWls.length < 2) continue;
        const grpDiag = state.diagnostics.find(g => g.group === dir);
        const crossDiags = grpDiag ? grpDiag.cross_wl : [];
        const att = {};
        dWls.forEach(wl => att[wl] = byWl[wl].avg_attenuation);
        html += '<div class="card"><div class="card-title"><i class="ti ti-arrows-diff" style="color:var(--blue)"></i> ' + (dir.split('/').pop() || dir) + '</div>';
        html += '<table class="cmp-table" style="margin-bottom:10px"><thead><tr><th>' + t('comp_param') + '</th>' + dWls.map(w => '<th style="color:' + WL_COLORS[w] + '">' + w + ' ' + t('unit_nm') + '</th>').join('') + '<th>' + t('comp_norm') + '</th><th>' + t('comp_conclusion') + '</th></tr></thead><tbody>';
        html += '<tr><td>' + t('comp_attenuation') + '</td>' + dWls.map(w => {
            const v = att[w];
            const lim = RULES.attenuation[w] || RULES.attenuation.default;
            return '<td class="' + (v > lim.max ? 'cmp-worse' : v > lim.warn ? 'loss-warn' : 'cmp-better') + ' mono">' + v.toFixed(4) + '</td>';
        }).join('') + '<td style="color:var(--muted);font-size:10px">' + dWls.map(w => '' + w + ': ≤' + (RULES.attenuation[w] || RULES.attenuation.default).max).join(' / ') + '</td>';
        const r1550_1310 = att[1310] && att[1550] ? att[1550] / att[1310] : null;
        html += '<td style="font-size:10px">' + (r1550_1310 ? (r1550_1310 > 1.1 ? t('comp_1550_gt_1310') : t('comp_1550_lt_1310')) : '—') + '</td></tr>';
        html += '<tr><td>' + t('comp_orl') + '</td>' + dWls.map(w => {
            const v = byWl[w].orl || 0;
            return '<td class="' + (v < RULES.orl.critical ? 'cmp-worse' : v < RULES.orl.warn ? 'loss-warn' : 'cmp-better') + ' mono">' + v.toFixed(2) + '</td>';
        }).join('') + '<td style="color:var(--muted);font-size:10px">≥' + RULES.orl.critical + '</td><td style="font-size:10px">' + (dWls.some(w => (byWl[w].orl || 0) < RULES.orl.critical) ? t('comp_bad') : t('comp_ok')) + '</td></tr>';
        html += '</tbody></table>';
        if (crossDiags.length) {
            html += '<div style="margin-bottom:6px;font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)">' + t('diag_scope_cross_wl') + '</div>';
            crossDiags.forEach(d => {
                html += '<div class="diag-item ' + d.sev + '"><div class="diag-icon">' + SI[d.sev] + '</div><div class="diag-body"><div class="cat">' + d.category + '</div><div class="msg">' + d.msg + '</div><div class="rec">💡 ' + d.rec + '</div></div></div>';
                if (d.edu) html += eduBox(d.edu);
            });
        } else {
            html += eduBox('ok');
        }
        html += '<details style="margin-top:8px"><summary style="font-size:10px;color:var(--muted);cursor:pointer;font-weight:600;text-transform:uppercase">📚 ITU-T G.652D</summary><div style="font-size:11px;color:var(--muted);padding:6px 0;line-height:2">1310 nm: ≤0.40 dB/km | 1550 nm: ≤0.25 dB/km | 1625 nm: ≤0.25 dB/km<br>Splice: ≤0.10 dB typical, ≤0.50 dB max | ORL: ≥32 dB good, ≥27 dB min<br><b>1550 nm attenuation LOWER than 1310 nm</b> — if opposite, look for bends.</div></details>';
        html += '</div>';
    }
    el.innerHTML = html || '<div class="empty"><p>' + t('comp_no_data') + '</p></div>';
}

// ── Keep renderDiags, renderTrace, renderEventStrip, evStripHover similar but replace static strings with t() ──
// ... (the pattern is the same: replace 'Suvirinimas' with t('event_splice'), 'Kritinis' with t('severity_critical'), etc.)