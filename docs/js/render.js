import { state } from './state.js';
import { RULES } from './rules.js';
import { WL_COLORS } from './config.js';
import { t, toast, filterEvents, apply1kmCorrection, formatWavelength, getClosestStandardWavelength, escapeHtml } from './utils.js';
import { classifyEvent, consolidateEvents, stripWavelengthSuffix, commentForEvent, diagnoseAll } from './diagnostics.js';
import { analyzeCableWide, extractFiberId } from './fiber-analysis.js';
import { detectGhostReflections, annotateLaunchZoneAmbiguity, annotateNoiseZoneEvents, checkExpectedWdmCount, recommendApcIfManyGhosts } from './advanced-diagnostics.js';
import { assessMeasurementQuality } from './measurement-quality.js';
import { setupTraceChart, drawOverlay } from './chart.js';


// ── kilometrų reikšmių paryškinimas 
 // ── Bendras (total) nuostolis vienam failui - naudojame prietaiso pateiktą
// reikšmę TIK jei ji apima visą liniją; kitu atveju (prietaisas "pasidavė"
// anksčiau dėl rimto pažeidimo trasoje) naudojame patys apskaičiuotą
// (žr. parser.js: total_loss_calculated / total_loss_covers_full_line).
function effectiveTotalLoss(p) {
    if (p.total_loss_covers_full_line === false && typeof p.total_loss_calculated === 'number') {
        return p.total_loss_calculated;
    }
    return p.total_loss || 0;
}

function highlightDistances(category) {
    if (!category || !category.includes('@')) return category;
    return category.replace(
        /(@\s*)([\d.]+\s*[-–]\s*[\d.]+\s*km)/g,
        (match, prefix, numbers) => prefix + '<span class="highlight-distance">' + numbers + '</span>'
    );
}



// ── Rankinis eventos tipo perrašymas (EXFO FastReporter stiliaus) ──
// evRefs: masyvas { file, index } nuorodų į TIKRUS state.parsed eventų objektus
// (ne render-metu sukurtas kopijas iš consolidateEvents/apply1kmCorrection) - tik
// taip perrašymas persistuoja per pakartotinius renderAll() kvietimus.
const EVENT_TYPES = ['splice', 'refl', 'wdm', 'end', 'launch', 'event'];

function applyManualOverride(evRefs, newType) {
    evRefs.forEach(ref => {
        const sor = state.parsed.find(p => p.ok && p.file === ref.file);
        const orig = sor && sor.events.find(e => e.index === ref.index);
        if (orig) orig._overrideType = newType;
    });
    try {
        state.diagnostics = diagnoseAll(state.parsed.filter(p => p.ok));
        renderAll();
    } catch (e) {
        console.error('applyManualOverride: klaida perskaičiuojant/perpiešiant po rankinio perrašymo:', e);
        if (typeof toast === 'function') toast('Klaida atnaujinant vaizdą: ' + e.message, 'err');
    }
}

function eventTypeSelectHtml(cssClass, currentType, evRefsJson, labels) {
    const opts = EVENT_TYPES.map(ty =>
        '<option value="' + ty + '"' + (ty === currentType ? ' selected' : '') + '>' + (labels[ty] || ty) + '</option>'
    ).join('');
    return '<select class="' + cssClass + '" data-refs="' + escapeHtml(evRefsJson) + '" style="border:none;cursor:pointer;font:inherit;-webkit-appearance:none;appearance:none;padding:1px 14px 1px 5px;">' + opts + '</select>';
}

// ── renderAll ──
export function renderAll() {

    const ok = state.parsed.filter(p => p.ok);
    // Korekciją taikome vieną kartą čia
    const correctedOk = apply1kmCorrection(ok);
    const wls = [...state.activeWls].sort();
    renderOverview(correctedOk, wls);
    renderTrace(correctedOk, wls);
    renderEvents(correctedOk);
    renderDiags();
    renderComp(correctedOk, wls);
}

// ── Matavimo informacija (data/laikas, prietaisas, parametrai) — analogas
// EXFO ataskaitų "General Information" + "Test Parameters" sekcijoms.
function renderMeasurementInfo(ok) {
    const el = document.getElementById('ovMeasureInfo');
    if (!el) return;
    if (!ok.length) { el.innerHTML = ''; return; }

    const rows = ok.map(s => {
        const col = WL_COLORS[getClosestStandardWavelength(s.wavelength)] || '#888';
        const locStr = (s.location_a || s.location_b)
            ? escapeHtml(s.location_a || '—') + ' → ' + escapeHtml(s.location_b || '—')
            : '—';
        const usedCalc = s.total_loss_covers_full_line === false && typeof s.total_loss_calculated === 'number';
        const lossVal = effectiveTotalLoss(s);
        const lossCell = lossVal.toFixed(3) + ' ' + t('unit_dB') + (usedCalc ? ' <span title="' + t('label_calculated_loss_hint') + '" style="cursor:help">✱</span>' : '');
        return '<tr>' +
            '<td style="font-size:10px">' + escapeHtml(s.file) + '</td>' +
            '<td><span style="color:' + col + ';font-weight:600">' + formatWavelength(s.wavelength) + ' ' + t('unit_nm') + '</span></td>' +
            '<td class="mono" style="font-size:10px">' + escapeHtml(s.date || '—') + '</td>' +
            '<td style="font-size:10px">' + escapeHtml(s.otdr || s.supplier || '—') + '</td>' +
            '<td class="mono">' + (s.ior ? s.ior.toFixed(5) : '—') + '</td>' +
            '<td class="mono">' + (s.pulse_width ? s.pulse_width + ' ns' : '—') + '</td>' +
            '<td class="mono">' + s.range_km.toFixed(2) + ' ' + t('unit_km') + '</td>' +
            '<td class="mono" style="font-size:10px">' + (s.avg_time_s ? s.avg_time_s + ' s' : (s.num_avg ? s.num_avg + '×' : '—')) + '</td>' +
            '<td class="mono">' + lossCell + '</td>' +
            '<td style="font-size:10px">' + escapeHtml(s.cable_id || '—') + '</td>' +
            '<td style="font-size:10px">' + locStr + '</td>' +
            '</tr>';
    }).join('');

    el.innerHTML =
        '<div class="card" style="margin-bottom:.6rem;padding:10px 12px;">' +
        '<div class="card-title"><i class="ti ti-info-circle" style="color:var(--blue)"></i> <span>' + t('label_measurement_info') + '</span></div>' +
        '<div style="overflow-x:auto"><table class="cmp-table"><thead><tr>' +
        '<th>' + t('metrics_files') + '</th><th>' + t('unit_nm') + '</th><th>' + t('label_meas_datetime') + '</th><th>' + t('label_meas_instrument') + '</th>' +
        '<th>IOR</th><th>' + t('label_meas_pulse') + '</th><th>' + t('label_meas_range') + '</th><th title="' + t('label_meas_avg_hint') + '">' + t('label_meas_avg') + '</th><th>Bendras nuostolis</th><th>' + t('label_meas_cable_id') + '</th><th>A→B</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '</div>';
}

function renderMeasurementQuality(ok) {
    // Konteinerį kuriame dinamiškai (jei jo dar nėra DOM'e), kad nereikėtų
    // liesti index.html - įterpiame iškart po metrikų blokelio.
    let wrap = document.getElementById('ovQualityWrap');
    if (!wrap) {
        const metricsEl = document.getElementById('ovMetrics');
        if (!metricsEl) return;
        wrap = document.createElement('div');
        wrap.id = 'ovQualityWrap';
        metricsEl.insertAdjacentElement('afterend', wrap);
    }
    if (!ok.length) { wrap.innerHTML = ''; return; }

    const SEV_ICON = { critical: '🔴', warning: '🟡', info: '🔵' };
    wrap.innerHTML = ok.map(sor => {
        const q = assessMeasurementQuality(sor, state.has1kmLine);
        const stars = '★'.repeat(q.stars) + '☆'.repeat(5 - q.stars);
        const color = q.score >= 70 ? 'var(--teal)' : q.score >= 40 ? 'var(--yellow)' : 'var(--red)';
        const failed = q.checks.filter(c => !c.pass && c.weight);
        const passed = q.checks.filter(c => c.pass);
        const wl = formatWavelength(sor.wavelength);

        const failedHtml = failed.map(c =>
            '<div class="diag-item ' + (c.severity || 'warning') + '" style="margin-bottom:4px">' +
                '<div class="diag-icon">' + (SEV_ICON[c.severity] || '🟡') + '</div>' +
                '<div class="diag-body"><div class="msg" style="font-weight:600;margin-bottom:2px">' + escapeHtml(c.title) + '</div>' +
                '<div class="msg" style="font-size:11px">' + escapeHtml(c.detail || '') + '</div>' +
                (c.advice ? '<div class="rec">💡 ' + escapeHtml(c.advice) + '</div>' : '') +
                '</div></div>'
        ).join('');
        const passedHtml = passed.map(c => '<div style="font-size:11px;color:var(--muted);margin-bottom:2px">✓ ' + escapeHtml(c.title) + '</div>').join('');

        return '<details class="card" style="margin-bottom:.5rem" ' + (q.score < 70 ? 'open' : '') + '>' +
            '<summary style="cursor:pointer;display:flex;align-items:center;gap:8px;list-style:none">' +
                '<i class="ti ti-gauge" style="color:' + color + '"></i>' +
                '<span style="font-weight:600">📡 Matavimo kokybė — ' + escapeHtml(sor.file) + ' (' + wl + ' nm)</span>' +
                '<span style="margin-left:auto;color:' + color + ';font-size:15px;letter-spacing:1px">' + stars + '</span>' +
                '<span style="color:' + color + ';font-weight:700">' + q.score + '%</span>' +
            '</summary>' +
            '<div style="margin-top:8px">' +
                (failedHtml || '<div style="font-size:12px;color:var(--teal)">✓ Nėra reikšmingų problemų</div>') +
                '<div style="margin-top:6px">' + passedHtml + '</div>' +
                (q.reliable
                    ? '<div style="margin-top:6px;font-size:11px;color:var(--teal)">Galima pasitikėti rezultatais.</div>'
                    : '<div style="margin-top:6px;font-size:11px;color:var(--red);font-weight:600">Šios reflektogramos analizuoti nerekomenduojama be papildomo patikrinimo.</div>') +
            '</div>' +
        '</details>';
    }).join('');
}

function renderNoiseZoneBanner(ok) {
    let wrap = document.getElementById('ovNoiseZoneWrap');
    if (!wrap) {
        const qualityWrap = document.getElementById('ovQualityWrap');
        const anchor = qualityWrap || document.getElementById('ovMetrics');
        if (!anchor) return;
        wrap = document.createElement('div');
        wrap.id = 'ovNoiseZoneWrap';
        anchor.insertAdjacentElement('afterend', wrap);
    }
    if (!ok.length) { wrap.innerHTML = ''; return; }
    const zoneDiags = annotateNoiseZoneEvents(ok);
    if (!zoneDiags.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = zoneDiags.map(d =>
        '<div class="card" style="margin-bottom:.5rem;border-color:rgba(240,200,79,.4);background:rgba(240,200,79,.06)">' +
            '<div style="display:flex;align-items:flex-start;gap:8px">' +
                '<div style="font-size:16px">📉</div>' +
                '<div>' +
                    '<div style="font-weight:600;margin-bottom:3px">' + escapeHtml(d._file || '') + ' — ' + escapeHtml(d.category.replace('📉 ', '')) + '</div>' +
                    '<div style="font-size:11px;color:var(--muted)">Žemiau esantis radinių sąrašas gali apimti eventus šioje zonoje, kurie tikėtinai NĖRA realūs (žr. „Ghost reiškiniai / triukšmo zona" skiltį Diagnostikos tabe dėl detalės).</div>' +
                '</div>' +
            '</div>' +
        '</div>'
    ).join('');
}


export function renderOverview(ok, wls) {
    renderMeasurementInfo(ok);
    renderMeasurementQuality(ok);
    renderNoiseZoneBanner(ok);
    const multiFiber = state.diagnostics.length > 1;
    const allD = state.diagnostics.flatMap(g => {
        const fLabel = multiFiber ? (extractFiberId(g.group) || g.group) : null;
        const fBadge = fLabel ? '<span style="color:var(--muted);margin-right:4px;">' + escapeHtml(fLabel) + '</span>' : '';
        return [
            ...g.cross_wl.map(d => ({ ...d, _scope: fBadge + t('diag_scope_cross_wl') })),
            ...Object.entries(g.per_file).flatMap(([wl, ds]) => {
                const stdWl = getClosestStandardWavelength(wl);
                const color = WL_COLORS[stdWl] || '#888';
                return ds.map(d => ({ ...d, _scope: fBadge + '<span style="color:' + color + ';font-weight:600;">' + formatWavelength(wl) + ' ' + t('unit_nm') + '</span>' }));
            }),
        ];
    });
    const crit = allD.filter(d => d.sev === 'critical').length;
    const warn = allD.filter(d => d.sev === 'warning').length;
    const avgScore = state.diagnostics.reduce((s, g) => s + g.score, 0) / Math.max(state.diagnostics.length, 1);
    const grade = RULES.quality_score.grades.find(g => avgScore >= g.min);

    document.getElementById('ovMetrics').innerHTML =
        '<div class="mc teal"><div class="lbl">' + t('metrics_files') + '</div><div class="val">' + ok.length + '</div></div>' +
        '<div class="mc blue"><div class="lbl">' + t('metrics_wavelengths') + '</div><div class="val" style="font-size:13px">' + wls.map(w => formatWavelength(w)).join('/') + ' <span class="unit">' + t('unit_nm') + '</span></div></div>' +
        '<div class="mc"><div class="lbl" title="Visų įkeltų failų bendro (ne dB/km) nuostolio vidurkis">Bendras nuostolis (vid.)' + (ok.some(p => p.total_loss_covers_full_line === false) ? ' <span title="' + t('label_calculated_loss_hint') + '" style="cursor:help">✱</span>' : '') + '</div><div class="val">' + (ok.reduce((s, p) => s + effectiveTotalLoss(p), 0) / ok.length).toFixed(2) + '<span class="unit"> ' + t('unit_dB') + '</span></div></div>' +
        '<div class="mc red"><div class="lbl">' + t('metrics_critical') + '</div><div class="val">' + crit + '</div></div>' +
        '<div class="mc orange"><div class="lbl">' + t('metrics_warnings') + '</div><div class="val">' + warn + '</div></div>' +
        '<div class="mc" style="border-color:' + (grade?.color || '#888') + '33"><div class="lbl" title="Linijos/kabelio kokybė pagal rastus defektus - skiriasi nuo Matavimo kokybės žemiau">Linijos kokybė</div><div class="val" style="color:' + (grade?.color || '#888') + ';font-size:14px">' + Math.round(avgScore) + ' <span class="unit">/100</span></div></div>';

	const sevO = { critical: 0, warning: 1, info: 2 };
	const criticals = allD.filter(d => d.sev === 'critical');
	const warnings = allD.filter(d => d.sev === 'warning').slice(0, 3);
	
	
	
const top = allD.filter(d => d.sev !== 'info').sort((a, b) => sevO[a.sev] - sevO[b.sev]);
const SI = { critical: '🔴', warning: '🟡', info: '🔵' };

document.getElementById('ovDiags').innerHTML = top.map(d => {
    const categoryHtml = highlightDistances(d.category);
    const isSliding = d.category && d.category.includes('@');
    const slidingClass = isSliding ? ' sliding-segment' : '';
    let classes = 'diag-item ' + d.sev;
    if (d._class) classes += ' ' + d._class;
    if (isSliding) classes += ' sliding-segment';

    return '<div class="' + classes + '">' +
        '<div class="diag-icon">' + SI[d.sev] + '</div>' +
        '<div class="diag-body">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">' +
        '<div class="cat" style="margin:0">' + categoryHtml + '</div>' +
        '<span style="font-size:10px;background:rgba(255,255,255,.07);padding:1px 6px;border-radius:4px;color:var(--muted)">' + (d._scope || '') + '</span>' +
        '</div>' +
        '<div class="msg">' + d.msg + '</div>' +
        '<div class="rec">💡 ' + d.rec + '</div>' +
        '</div></div>';
}).join('') || '<div class="diag-item info"><div class="diag-icon">🔵</div><div class="diag-body"><div class="msg">' + t('diag_general_ok') + '</div></div></div>';
	}

export function renderTrace(ok, wls) {
    document.getElementById('wlBtns').innerHTML = wls.map(wl => {
    const stdWl = getClosestStandardWavelength(wl);
    return '<button type="button" class="wl-btn active" data-wl="' + wl + '" data-std="' + stdWl + '">' + formatWavelength(wl) + ' ' + t('unit_nm') + '</button>';
	}).join('');

    document.querySelectorAll('.wl-btn').forEach(b => {
        b.addEventListener('click', () => {
            const wl = parseFloat(b.dataset.wl);
            if (state.activeWls.has(wl)) {
                state.activeWls.delete(wl);
                b.classList.remove('active');
            } else {
                state.activeWls.add(wl);
                b.classList.add('active');
            }
            if (window.traceChart) {
                window.traceChart.data.datasets.forEach(ds => {
                    ds.hidden = !state.activeWls.has(ds._wl);
                });
                window.traceChart.update();
            }
            drawOverlay();
            renderEventStrip(state.parsed.filter(p => p.ok));
        });
    });

    document.getElementById('traceLegend').innerHTML = ok.map(s => {
        const col = WL_COLORS[getClosestStandardWavelength(s.wavelength)] || '#888';
        const wlStr = formatWavelength(s.wavelength);
		return '<div style="display:flex;align-items:center;gap:4px;cursor:pointer">' +
            '<div style="width:14px;height:3px;background:' + col + ';border-radius:2px;flex-shrink:0"></div>' +
            '<span style="color:var(--muted)">' + escapeHtml(s.file) + ' (' + wlStr + 'nm)</span></div>';
    }).join('');

    setupTraceChart(ok);

    setTimeout(() => {
        drawOverlay(ok);
        renderEventStrip(ok);
    }, 350);
}

export function renderEvents(ok) {
    const wls = [...new Set(ok.map(s => s.wavelength))].sort();
    document.getElementById('evFilterWl').innerHTML =
        '<option value="">' + t('label_all_wavelengths') + '</option>' +
        wls.map(w => '<option value="' + w + '">' + formatWavelength(w) + ' ' + t('unit_nm') + '</option>').join('');

    function render() {
        const wlF = parseFloat(document.getElementById('evFilterWl').value) || null;
        const typeF = document.getElementById('evFilterType').value;
        const consol = document.getElementById('evConsolidate').checked;
        const filtered = ok.filter(s => !wlF || Math.abs(s.wavelength - wlF) < 5);

        const filteredWithEvents = filtered.map(s => ({
            ...s,
            events: filterEvents(s.events)
        }));

        let groups = consolidateEvents(filteredWithEvents);
        const showWavelength = state.activeWls.size > 1;
        if (typeF) groups = groups.map(g => ({ ...g, events: g.events.filter(e => e.type === typeF) })).filter(g => g.events.length);

        const SI = { critical: '🔴', warning: '🟡', info: '⚪' };
        const TYPE_LABELS = {
            splice: t('event_splice'),
            refl: t('event_refl'),
            end: t('event_end'),
            wdm: t('event_wdm'),
            launch: t('launch_event'),
            event: t('event_other'),
            other: t('event_other')
        };

        if (consol) {
            document.getElementById('eventsBody').innerHTML = groups.map((g, gi) => {
                const types = [...new Set(g.events.map(e => e.type))];
                const mType = types.includes('wdm') ? 'wdm' :
                              types.includes('end') ? 'end' :
                              types.includes('launch') ? 'launch' :
                              types.includes('refl') ? 'refl' :
                              types.includes('event') ? 'event' :
                              'splice';
                const byWl = {};
                g.events.forEach(e => { if (!byWl[e.wl]) byWl[e.wl] = []; byWl[e.wl].push(e); });

		const wlSummary = Object.entries(byWl).sort(([a], [b]) => a - b).map(([wl, evs]) => {
			if (!evs || evs.length === 0) return '';

			const validEvs = evs.filter(e => {
				const loss = e.loss;
				if (Math.abs(e.distance) < 0.001) return false;
				return typeof loss === 'number' && !isNaN(loss);
			});
			if (validEvs.length === 0) return '';

			const avgLoss = validEvs.reduce((s, e) => s + e.loss, 0) / validEvs.length;
			const displayLoss = isNaN(avgLoss) ? 0 : avgLoss;
			const lc = displayLoss > RULES.splice.critical ? 'color:var(--red)' : displayLoss > RULES.splice.warn ? 'color:var(--yellow)' : 'color:var(--teal)';

			let reflStr = '';
			const reflValues = evs.filter(e => typeof e.refl === 'number' && !isNaN(e.refl) && Math.abs(e.refl) > 0.1);
			if (reflValues.length > 0) {
				const avgRefl = reflValues.reduce((s, e) => s + e.refl, 0) / reflValues.length;
				reflStr = ' <span style="color:var(--orange);font-size:10px;">(refl ' + avgRefl.toFixed(1) + ' dB)</span>';
			}

			const stdWl = getClosestStandardWavelength(wl);
			
			// Pridėti gainer žymeę, jei nuostolis neigiamas
			let gainerNote = '';
			if (displayLoss < -0.10) {
				gainerNote = ' <span style="color:var(--orange);font-size:10px;">⚠️ Gain artefaktas!</span>';
			}

			return '<span style="font-size:11px"><span style="color:' + WL_COLORS[stdWl] + '">' + formatWavelength(wl) + 'nm:</span> <span style="' + lc + ';font-family:JetBrains Mono,monospace">' + displayLoss.toFixed(3) + ' ' + t('unit_dB') + '</span>' + reflStr + gainerNote + '</span>';			
			
		}).filter(s => s !== '').join('  ');

// ─── RODOME VISADA ───
const wlSummaryHtml = wlSummary;

// ─── BANGOS ILGIO ŽYMENKLIAI ─ TIK JEI DAUGIAU NEI VIENA BANGA ───
const wlSpans = showWavelength ? [...new Set(g.events.map(e => e.wl))].sort().map(wl => {
    const stdWl = getClosestStandardWavelength(wl);
    return '<span style="font-size:10px;background:' + WL_COLORS[stdWl] + '22;color:' + WL_COLORS[stdWl] + ';padding:1px 5px;border-radius:3px">' + formatWavelength(wl) + 'nm</span>';
}).join('') : '';

            //    const wlSummaryHtml = showWavelength ? wlSummary : '';

                return '<div class="card" style="margin-bottom:5px;padding:10px 12px;">' +
                    '<div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">' +
                    '<span style="font-size:13px;font-weight:600;font-family:JetBrains Mono,monospace">#' + (gi + 1) + ' · ' + g.dist.toFixed(3) + ' ' + t('unit_km') + '</span>' +
                    '<span class="ev-tag ' + mType + '">' + TYPE_LABELS[mType] + '</span>' +
                    wlSpans +
                    '</div>' +
                    '<div style="display:flex;gap:12px;flex-wrap:wrap">' + wlSummaryHtml + '</div>' +
                    '</div>';
            }).join('') || '<div class="empty"><p>' + t('diag_event_strip_empty') + '</p></div>';
        } else {
            const rows = groups.flatMap(g => g.events);
            const TYPE_LABELS2 = {
                splice: t('event_splice'),
                refl: t('event_refl'),
                end: t('event_end'),
                wdm: t('event_wdm'),
                launch: t('launch_event'),
                event: t('event_other'),
                other: t('event_other')
            };
            // Grupuojame PAGAL FAILĄ (t.y. pagal vieną bangos ilgio trasą), kad
            // "dB" ir "Kaupiamasis dB" stulpeliai skaitytųsi be pertrūkio - jei
            // rikiuotume visus event'us kartu pagal atstumą, skirtingų bangos
            // ilgių event'ai susipintų tarpusavyje ir kaupiamoji suma taptus
            // neįskaitoma (nes ji prasminga tik palei VIENĄ fizinę trasą).
            const byFile = {};
            const fileOrder = [];
            rows.forEach(e => {
                if (!byFile[e.file]) { byFile[e.file] = []; fileOrder.push(e.file); }
                byFile[e.file].push(e);
            });

            // Kryžminio λ palyginimo makrolenkimo taškai (žr. diagnoseCrossWl()
            // "Makrolenkimo taškai") - naudojama, kad Events lentelės komentaras
            // NEREKOMENDUOTŲ "pervirinti movoje", kai λ palyginimas ŠIOJE
            // pozicijoje jau nustatė, kad tai makrolenkimas, ne suvirinimo defektas.
            const macrobendByFile = {};
            (state.diagnostics || []).forEach(g => {
                const points = (g.cross_wl || []).filter(d => d._class === 'macrobend_point');
                if (!points.length) return;
                Object.values(g.files || {}).forEach(fname => {
                    if (!macrobendByFile[fname]) macrobendByFile[fname] = [];
                    macrobendByFile[fname].push(...points.map(p => p._distance));
                });
            });

            document.getElementById('eventsBody').innerHTML = fileOrder.map(file => {
                const list = byFile[file].slice().sort((a, b) => a.distance - b.distance);
                const wl = list[0].wl;
                const col = WL_COLORS[getClosestStandardWavelength(wl)] || '#888';
                const mbDistances = macrobendByFile[file] || [];
                const tableRows = list.map((e, i) => {
                    const lc = e.loss > RULES.splice.critical ? 'loss-bad' : e.loss > RULES.splice.warn ? 'loss-warn' : 'loss-ok';
                    const mbMatch = mbDistances.some(d => Math.abs(d - e.distance) < RULES.wavelength_comparison.event_distance_tolerance);
                    const comment = commentForEvent(e, e.type, mbMatch);
                    // Rodome eilės numerį pagal DABAR matomą (po 1km korekcijos
                    // filtravimo) sąrašą, o ne originalų SOR failo e.index - kitaip
                    // pašalinus dirbtinės linijos eventą numeracija prasidėtų nuo 2.
                    return '<tr><td class="mono">' + (i + 1) + '</td>' +
                        '<td>' + eventTypeSelectHtml('ev-tag ev-type-select ' + e.type, e.type, JSON.stringify([{ file: e.file, index: e.index }]), TYPE_LABELS2) + '</td>' +
                        '<td class="mono">' + e.distance.toFixed(4) + '</td>' +
                        '<td class="mono ' + lc + '">' + (typeof e.loss === 'number' && !isNaN(e.loss) ? e.loss.toFixed(3) : '—') + '</td>' +
                        '<td class="mono" style="color:var(--muted)">' + (typeof e.cumulative_loss === 'number' ? e.cumulative_loss.toFixed(3) : '—') + '</td>' +
                        '<td class="mono">' + (typeof e.refl === 'number' && !isNaN(e.refl) && Math.abs(e.refl) > 0.1 ? e.refl.toFixed(2) : '—') + '</td>' +
                        '<td style="font-size:11px;color:rgba(232,234,240,.85);line-height:1.4">' +
                            '<div>' + escapeHtml(comment) + '</div>' +
                            '<input type="text" class="ev-comment-input" data-refs="' + escapeHtml(JSON.stringify([{ file: e.file, index: e.index }])) + '" value="' + escapeHtml(e._userComment || '') + '" placeholder="+ pastaba..." style="margin-top:3px;width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:2px 5px;color:var(--text);font-size:10px;font-family:inherit;" />' +
                        '</td></tr>';
                }).join('');
                return '<div class="card" style="padding:0;overflow-x:auto;margin-bottom:8px">' +
                    '<div style="padding:8px 12px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border)">' +
                    '<span style="color:' + col + '">●</span> ' + escapeHtml(file) + ' <span style="color:' + col + '">(' + formatWavelength(wl) + ' ' + t('unit_nm') + ')</span>' +
                    '</div>' +
                    '<table><colgroup><col style="width:4%"><col style="width:11%"><col style="width:8%"><col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:56%"></colgroup><thead><tr>' +
                    '<th>Nr.</th><th>' + t('label_all_types') + '</th><th>' + t('unit_km') + '</th><th>' + t('unit_dB') + '</th><th>' + t('label_cumulative') + ' ' + t('unit_dB') + '</th><th>' + t('diag_reflection') + ' ' + t('unit_dB') + '</th><th>' + t('label_comment') + '</th>' +
                    '</tr></thead><tbody>' + tableRows + '</tbody></table></div>';
            }).join('');
            document.querySelectorAll('.ev-type-select').forEach(sel => {
                sel.addEventListener('click', e => e.stopPropagation());
                sel.addEventListener('change', () => {
                    const refs = JSON.parse(sel.dataset.refs);
                    applyManualOverride(refs, sel.value);
                });
            });
            document.querySelectorAll('.ev-comment-input').forEach(inp => {
                inp.addEventListener('click', e => e.stopPropagation());
                inp.addEventListener('change', () => {
                    const refs = JSON.parse(inp.dataset.refs);
                    refs.forEach(ref => {
                        const sor = state.parsed.find(p => p.ok && p.file === ref.file);
                        const orig = sor && sor.events.find(e => e.index === ref.index);
                        if (orig) orig._userComment = inp.value;
                    });
                });
            });
        }
    }
    render();
    document.getElementById('evFilterWl').onchange = render;
    document.getElementById('evFilterType').onchange = render;
    document.getElementById('evConsolidate').onchange = render;
}

// ── Naudotos ribos (Pass/Fail Thresholds) ── generuojama TIESIOGIAI iš RULES.js,
// kad visada atspindėtų realiai naudojamas ribas (analogas EXFO "Pass/Fail
// Thresholds" lentelei ataskaitose).
function renderThresholdsTable() {
    const attRows = Object.entries(RULES.attenuation)
        .filter(([wl]) => wl !== 'default')
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([wl, lim]) => '<tr><td>' + formatWavelength(wl) + ' ' + t('unit_nm') + '</td><td class="mono">≤ ' + lim.warn + '</td><td class="mono">≤ ' + lim.max + '</td></tr>')
        .join('');

    const html =
        '<details class="card" style="margin-bottom:.6rem;padding:10px 12px;">' +
        '<summary style="cursor:pointer;font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;">' +
        '<i class="ti ti-ruler-2" style="color:var(--teal)"></i> ' + t('label_thresholds') +
        '</summary>' +
        '<div style="margin-top:8px;font-size:11px;color:var(--muted)">' +

        '<div style="font-weight:600;margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em;font-size:10px;">' + t('label_thresholds_attenuation') + '</div>' +
        '<table class="cmp-table" style="margin-bottom:8px;table-layout:fixed;width:100%"><colgroup><col style="width:40%"><col style="width:30%"><col style="width:30%"></colgroup><thead><tr><th>' + t('unit_nm') + '</th><th>' + t('label_thresholds_warn') + '</th><th>' + t('label_thresholds_critical') + '</th></tr></thead><tbody>' +
        attRows +
        '</tbody></table>' +

        '<div style="font-weight:600;margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em;font-size:10px;">' + t('label_thresholds_other') + '</div>' +
        '<table class="cmp-table" style="margin-bottom:8px;table-layout:fixed;width:100%"><colgroup><col style="width:40%"><col style="width:30%"><col style="width:30%"></colgroup><tbody>' +
        '<tr><td>' + t('diag_splice') + '</td><td class="mono">≤ ' + RULES.splice.warn + ' dB</td><td class="mono">≤ ' + RULES.splice.critical + ' dB</td></tr>' +
        '<tr><td>' + t('diag_connector') + '</td><td class="mono">≤ ' + RULES.connector.warn + ' dB</td><td class="mono">≤ ' + RULES.connector.critical + ' dB</td></tr>' +
        '<tr><td>' + t('diag_reflection') + '</td><td class="mono">≤ ' + RULES.reflection.warn + ' dB</td><td class="mono">≤ ' + RULES.reflection.critical + ' dB</td></tr>' +
        '<tr><td>ORL</td><td class="mono">≥ ' + RULES.orl.warn + ' dB</td><td class="mono">≥ ' + RULES.orl.critical + ' dB</td></tr>' +
        '<tr><td>1550 vs 1310 nm Δ</td><td class="mono">≤ ' + RULES.wavelength_comparison.loss_1550_vs_1310.warn_diff + ' dB/km</td><td class="mono">≤ ' + RULES.wavelength_comparison.loss_1550_vs_1310.critical_diff + ' dB/km</td></tr>' +
        '<tr><td>1625 vs 1550 nm Δ</td><td class="mono">≤ ' + RULES.wavelength_comparison.loss_1625_vs_1550.warn_diff + ' dB/km</td><td class="mono">—</td></tr>' +
        '<tr><td>' + t('diag_water_peak') + ' (1383 vs 1310)</td><td class="mono">—</td><td class="mono">≤ ' + RULES.wavelength_comparison.water_peak_max_diff + ' dB/km</td></tr>' +
        '</tbody></table>' +

        '<div style="font-weight:600;margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em;font-size:10px;">' + t('label_thresholds_acceptance') + '</div>' +
        '<table class="cmp-table" style="margin-bottom:8px;table-layout:fixed;width:100%"><colgroup><col style="width:40%"><col style="width:30%"><col style="width:30%"></colgroup><tbody>' +
        '<tr><td>' + t('diag_splice') + '</td><td class="mono">≤ ' + RULES.acceptance.splice.warn + ' dB</td><td class="mono">≤ ' + RULES.acceptance.splice.critical + ' dB</td></tr>' +
        '</tbody></table>' +

        '<div style="font-weight:600;margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em;font-size:10px;">PON splitter</div>' +
        '<table class="cmp-table" style="table-layout:fixed;width:100%"><colgroup><col style="width:40%"><col style="width:30%"><col style="width:30%"></colgroup><thead><tr><th>' + t('label_thresholds_ratio') + '</th><th>' + t('label_thresholds_typical_loss') + '</th><th>±' + t('label_thresholds_tolerance') + '</th></tr></thead><tbody>' +
        Object.entries(RULES.diagnostics.pon_splitter.ratios).map(([ratio, cfg]) =>
            '<tr><td>' + ratio + '</td><td class="mono">' + cfg.loss + ' dB</td><td class="mono">' + cfg.tol + ' dB</td></tr>'
        ).join('') +
        '</tbody></table>' +

        '<div style="margin-top:8px;font-size:10px;">' + t('label_thresholds_standard') + ': ' + (RULES.standard || 'ITU-T G.652D') + ' (v' + (RULES.version || '-') + ')</div>' +
        '</div></details>';
    return html;
}

export function renderDiags() {
    const lang = document.querySelector('.lang-btn.active')?.dataset.lang || 'lt';
    const SI = { critical: '🔴', warning: '🟡', info: '🔵' };
    let html = renderThresholdsTable();
	const cwLang = document.querySelector('.lang-btn.active')?.dataset.lang || 'lt';
	const cableDiags = analyzeCableWide(state.diagnostics, RULES, formatWavelength, cwLang);
    if (cableDiags.length) {
        html += '<div class="group-hdr"><i class="ti ti-cable" style="font-size:11px"></i> 🔗 Kabelio lygmens analizė (kelios skaidulos)</div>';
        html += '<div class="card" style="margin-bottom:.4rem">';
        html += cableDiags.map(d =>
            '<div class="diag-item ' + d.sev + '"><div class="diag-icon">' + { critical: '🔴', warning: '🟡', info: '🔵' }[d.sev] + '</div><div class="diag-body"><div class="cat">' + d.category + '</div><div class="msg">' + d.msg + '</div><div class="rec">💡 ' + d.rec + '</div></div></div>'
        ).join('');
        html += '</div>';
    }
    const correctedForAdv = apply1kmCorrection(state.parsed.filter(p => p.ok));
    const noiseZoneDiags = annotateNoiseZoneEvents(correctedForAdv);
    const ghostDiags = detectGhostReflections(correctedForAdv);
    const launchHints = annotateLaunchZoneAmbiguity(state.parsed.filter(p => p.ok), state.has1kmLine);
    const wdmCountHints = correctedForAdv.map(sor => {
        const wdmCount = (sor.events || []).filter(e => classifyEvent(e, sor.events, sor.range_km) === 'wdm').length;
        const q = assessMeasurementQuality(sor, state.has1kmLine);
        return checkExpectedWdmCount(sor.file, wdmCount, q, state.hasWdm);
    }).filter(Boolean);
    const apcHint = recommendApcIfManyGhosts(ghostDiags);
    const advDiags = [...noiseZoneDiags, ...ghostDiags, ...launchHints, ...wdmCountHints, ...(apcHint ? [apcHint] : [])];
    if (advDiags.length) {
        html += '<div class="group-hdr"><i class="ti ti-ghost-2" style="font-size:11px"></i> 👻 Ghost\'ai ir launch zonos užuominos</div>';
        html += '<div class="card" style="margin-bottom:.4rem">';
        html += advDiags.map(d =>
            '<div class="diag-item ' + d.sev + '"><div class="diag-icon">' + { critical: '🔴', warning: '🟡', info: '🔵' }[d.sev] + '</div><div class="diag-body"><div style="display:flex;align-items:center;gap:6px;margin-bottom:2px"><div class="cat" style="margin:0">' + d.category + '</div><span style="font-size:10px;background:rgba(255,255,255,.07);padding:1px 6px;border-radius:4px;color:var(--muted)">' + escapeHtml(d._file || '') + '</span></div><div class="msg">' + d.msg + '</div><div class="rec">💡 ' + d.rec + '</div></div></div>'
        ).join('');
        html += '</div>';
    }
    for (const grp of state.diagnostics) {
        const col = grp.grade?.color || '#888';
        const label = lang === 'en' ? grp.grade?.label_en : grp.grade?.label_lt;
        html += '<div class="group-hdr"><i class="ti ti-folder" style="font-size:11px"></i> ' + grp.group +
            ' <span class="score-badge" style="background:' + col + '22;color:' + col + '">' + Math.round(grp.score) + '/100 ' + (label || '') + '</span></div>';

        if (grp.cross_wl.length) {
            html += '<div class="card" style="margin-bottom:.4rem"><div class="card-title"><i class="ti ti-arrows-diff" style="color:var(--blue)"></i> ' + t('diag_scope_cross_wl') + '</div>';
			html += grp.cross_wl.map(d => {
				const catHtml = highlightDistances(d.category);
				return '<div class="diag-item ' + d.sev + '"><div class="diag-icon">' + SI[d.sev] + '</div><div class="diag-body"><div class="cat">' + catHtml + '</div><div class="msg">' + d.msg + '</div><div class="rec">💡 ' + d.rec + '</div></div></div>';
			}).join('');
            html += '</div>';
        }
        for (const [wl, diags] of Object.entries(grp.per_file)) {
            const wc = WL_COLORS[getClosestStandardWavelength(wl)] || '#888';
            html += '<div class="card" style="margin-bottom:.4rem"><div class="card-title"><span style="color:' + wc + '">●</span> ' + formatWavelength(wl) + ' ' + t('unit_nm') + '</div>';
			html += diags.map(d => {
				const catHtml = highlightDistances(d.category);
				return '<div class="diag-item ' + d.sev + '"><div class="diag-icon">' + SI[d.sev] + '</div><div class="diag-body"><div class="cat">' + catHtml + '</div><div class="msg">' + d.msg + '</div><div class="rec">💡 ' + d.rec + '</div></div></div>';
			}).join('');
            html += '</div>';
        }
    }
    document.getElementById('diagsWrap').innerHTML = html + (state.diagnostics.length ? '' : '<div class="empty"><p>' + t('comp_no_data') + '</p></div');
}

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
    // SVARBI PATAISA: grupuojame TAIP PAT kaip diagnoseAll() (diagnostics.js) -
    // pagal katalogą IR failo vardo šaknį (stripWavelengthSuffix), ne vien
    // katalogą. Anksčiau (dar prieš E4 pataisymą) čia buvo grupuojama tik
    // pagal katalogą, o po E4 pataisymo diagnoseAll() pakeitė savo grupės
    // raktą/pavadinimą į failo šaknį - dėl to state.diagnostics.find(g =>
    // g.group === dir) čia nebeberasdavo atitikmens, cross_wl visada likdavo
    // tuščias, ir vartotojui rodydavosi klaidingas "✅ normalu" net kai
    // Diagnostikos tabas teisingai rodė kritinį makrolenkimą.
    const groups = {};
    const groupLabels = {};
    ok.forEach(s => {
        let dir = s.path.split('/').slice(0, -1).join('/') || 'failai';
        if (dir === '__picked__' || dir === '_picked_') dir = t('diag_group_default');
        const fileRoot = stripWavelengthSuffix(s.file);
        const groupKey = dir + ' :: ' + fileRoot;
        if (!groups[groupKey]) {
            groups[groupKey] = {};
            groupLabels[groupKey] = fileRoot || dir;
        }
        groups[groupKey][s.wavelength] = s;
    });

    let html = '';
    for (const [groupKey, byWl] of Object.entries(groups)) {
        const dir = groupLabels[groupKey];
        const dWls = Object.keys(byWl).map(Number).sort();
        if (dWls.length < 2) continue;
        const grpDiag = state.diagnostics.find(g => g.group === dir);
        const crossDiags = grpDiag ? grpDiag.cross_wl : [];
        const att = {};
        dWls.forEach(wl => att[wl] = byWl[wl].avg_attenuation);
        html += '<div class="card"><div class="card-title"><i class="ti ti-arrows-diff" style="color:var(--blue)"></i> ' + dir + '</div>';
        html += '<table class="cmp-table" style="margin-bottom:10px"><thead><tr><th>' + t('comp_param') + '</th>' + dWls.map(w => '<th style="color:' + (WL_COLORS[getClosestStandardWavelength(w)] || '#888') + '">' + formatWavelength(w) + ' ' + t('unit_nm') + '</th>').join('') + '<th>' + t('comp_norm') + '</th><th>' + t('comp_conclusion') + '</th></tr></thead><tbody>';
        html += '<tr><td>' + t('comp_attenuation') + '</td>' + dWls.map(w => {
            const v = att[w];
            const stdW = getClosestStandardWavelength(w);
            const lim = RULES.attenuation[stdW] || RULES.attenuation.default;
            return '<td class="' + (v > lim.max ? 'cmp-worse' : v > lim.warn ? 'loss-warn' : 'cmp-better') + ' mono">' + v.toFixed(4) + '</td>';
        }).join('') + '<td style="color:var(--muted);font-size:10px">' + dWls.map(w => {
            const stdW = getClosestStandardWavelength(w);
            const lim = RULES.attenuation[stdW] || RULES.attenuation.default;
            return formatWavelength(w) + ': ≤' + lim.max;
        }).join(' / ') + '</td>';
        // Bangos ilgiai failų dWls masyve nėra tikslios standartinės reikšmės (pvz. 1314, 1541.3),
        // todėl artįmiausią standartą (1310/1550) reikia rasti PER getClosestStandardWavelength,
        // o ne aklai iekoti att[1310]/att[1550] - anksčiau tai visada grąžindavo "—".
        const stdToActual = {};
        dWls.forEach(w => { stdToActual[getClosestStandardWavelength(w)] = w; });
        const wA1310 = stdToActual[1310], wA1550 = stdToActual[1550];
        const r1550_1310 = (wA1310 != null && wA1550 != null && att[wA1310] && att[wA1550]) ? att[wA1550] / att[wA1310] : null;
        // SVARBI PATAISA: ši eilutėr lygina VIDUTINĮ visos linijos slopinimą -
        // vietinis (taškinis) makrolenkimas gali "ištirpti" vidurkyje ir čia
        // atrodyti "normalu", nors žemiau crossDiags teisingai rodo kritinį
        // radinį TAME PAČIAME taške. Be šios patikros išvados prieštaraudavo
        // viena kitai ir klaidino vartotoją. Jei žemiau yra realus lenkimo
        // radinys, viršutinė išvada nurodo į jį, o ne teigia "normalu".
        const bendFinding = crossDiags.find(d => (d.edu === 'bend' || d.edu === 'bend_point') && (d.sev === 'critical' || d.sev === 'warning'));
        const attConclusion = bendFinding
            ? '<span style="color:' + (bendFinding.sev === 'critical' ? 'var(--red)' : 'var(--yellow)') + '">' + (bendFinding.sev === 'critical' ? '🔴' : '🟡') + ' ' + t('comp_see_bend_below') + '</span>'
            : (r1550_1310 ? (r1550_1310 > 1.1 ? t('comp_1550_gt_1310') : t('comp_1550_lt_1310')) : '—');
        html += '<td style="font-size:10px">' + attConclusion + '</td></tr>';
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

export function renderEventStrip(ok) {
    const el = document.getElementById('evStrip');
    if (!el) return;
	
	console.log('renderEventStrip: ok.length=', ok.length);
    console.log('renderEventStrip: ok[0]?.events?.length=', ok[0]?.events?.length);

    const showWavelength = state.activeWls.size > 1;
    const visibleSors = ok.filter(s => state.activeWls.has(s.wavelength));
    const groups = consolidateEvents(visibleSors.length ? visibleSors : ok);
    if (!groups.length) {
        el.innerHTML = '<div style="color:var(--muted);font-size:11px">' + t('diag_event_strip_empty') + '</div>';
        return;
    }
    const totalKm = Math.max(...ok.map(s => s.range_km), 1);
    const STRIP_TYPE_LABELS = {
        splice: t('event_splice'), refl: t('event_refl'), wdm: t('event_wdm'),
        end: t('event_end'), launch: t('launch_event'), event: t('event_other')
    };
    const ICONS = {
		launch: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
		splice: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="4" x2="8" y2="12" stroke="currentColor" stroke-width="1.5"/></svg>',
        refl: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" stroke-width="1.5"/><polyline points="4,12 8,4 12,12" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
        wdm: '<svg width="22" height="22" viewBox="0 0 22 16" fill="none"><circle cx="11" cy="8" r="8" stroke="currentColor" stroke-width="1.5" fill="none"/><text x="11" y="12" font-size="9" fill="currentColor" text-anchor="middle" font-family="monospace" font-weight="bold">MUX</text></svg>',
        end: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="2" y1="8" x2="11" y2="8" stroke="currentColor" stroke-width="1.5"/><polyline points="8,5 12,8 8,11" stroke="currentColor" stroke-width="1.5" fill="none"/><line x1="13" y1="4" x2="13" y2="12" stroke="currentColor" stroke-width="2"/></svg>',
        other: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.5"/></svg>',
    };
    let html = '<div class="ev-strip">';
    html += '<div class="ev-node"><div class="ev-icon other" style="width:26px;height:26px;font-size:9px;font-weight:700;">OTDR</div><div class="ev-dist">0.000</div></div>';
    let prevDist = 0;
    /* nerodė eventų infirmacijos užvedus pelę 

		groups.forEach((g, gi) => {
        const type = g.events[0] ? classifyEvent(g.events[0]) : 'other';
        const segKm = g.dist - prevDist;
        const segPct = segKm / totalKm * 100;
        const minW = Math.max(22, segPct * 3);
        const avgLoss = g.events.reduce((s, e) => s + e.loss, 0) / g.events.length;
        const lossCol = avgLoss > RULES.splice.critical ? '#e05c5c' : avgLoss > RULES.splice.warn ? '#f0c84f' : avgLoss > 0.01 ? '#00d4aa' : '#555';
        const wlSpans = showWavelength ? [...new Set(g.events.map(e => e.wl))].sort().map(wl => '<span style="font-size:8px;background:' + WL_COLORS[wl] + '22;color:' + WL_COLORS[wl] + ';padding:1px 4px;border-radius:3px">' + formatWavelength(wl) + 'nm</span>').join(' ') : '';
        const wlInfo = showWavelength ? ' · ' + [...new Set(g.events.map(e => formatWavelength(e.wl)))].join(', ') + 'nm' : '';
        const tipStr = (gi + 1) + ' · ' + g.dist.toFixed(3) + ' ' + t('unit_km') + wlInfo;
	*/
	
	groups.forEach((g, gi) => {
		const type = g.events[0] ? classifyEvent(g.events[0]) : 'other';
		const segKm = g.dist - prevDist;
		const segPct = segKm / totalKm * 100;
		const minW = Math.max(22, segPct * 3);

		const avgLoss = g.events.reduce((s, e) => s + e.loss, 0) / g.events.length;
		const lossCol = avgLoss > RULES.splice.critical ? '#e05c5c' : avgLoss > RULES.splice.warn ? '#f0c84f' : avgLoss > 0.01 ? '#00d4aa' : '#555';

		// ── Tooltip'ui ──
		const firstEv = g.events[0];
		const lossStr = Math.abs(avgLoss) > 0.001 ? avgLoss.toFixed(2) + ' dB' : '0.00 dB';
		let reflStr = '';
		if (firstEv && firstEv.refl !== undefined && Math.abs(firstEv.refl) > 0.1) {
			reflStr = ' · refl ' + firstEv.refl.toFixed(1) + ' dB';
		}

		const wlSpans = showWavelength
			? [...new Set(g.events.map(e => e.wl))].sort().map(wl =>
				'<span style="font-size:8px;background:' + WL_COLORS[wl] + '22;color:' + WL_COLORS[wl] + ';padding:1px 4px;border-radius:3px">' + formatWavelength(wl) + 'nm</span>'
			  ).join(' ')
			: '';

		const wlInfo = showWavelength
			? ' · ' + [...new Set(g.events.map(e => formatWavelength(e.wl)))].join(', ') + 'nm'
			: '';

		const tipStr = (gi + 1) + ' · ' + g.dist.toFixed(3) + ' ' + t('unit_km') +
					   ' · loss ' + lossStr +
					   reflStr +
					   wlInfo;


	
		
	// HTML gamyba
        html += '<div class="ev-seg" style="min-width:' + minW + 'px;flex:' + Math.max(1, segPct) + '">';
        html += '<div class="ev-seg-line"></div>';
        html += '<div class="ev-seg-km">' + segKm.toFixed(2) + 'km</div></div>';

        const evRefsJson = JSON.stringify(g.events.map(e => ({ file: e.file, index: e.index })));
        html += '<div class="ev-node" data-tip="' + escapeHtml(tipStr) + '">';
        html += '<div class="ev-num">#' + (gi + 1) + '</div>';
        html += '<div class="ev-icon ' + type + '" style="position:relative;">' + ICONS[type] +
            '<select class="ev-tag ' + type + ' ev-type-select-strip" data-refs="' + escapeHtml(evRefsJson) + '" title="' + (STRIP_TYPE_LABELS[type] || type) + '" style="position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:none;">' +
            EVENT_TYPES.map(ty => '<option value="' + ty + '"' + (ty === type ? ' selected' : '') + '>' + (STRIP_TYPE_LABELS[ty] || ty) + '</option>').join('') +
            '</select></div>';
        html += '<div class="ev-loss" style="color:' + lossCol + '">' + (Math.abs(avgLoss) > 0.01 ? avgLoss.toFixed(2) + ' ' + t('unit_dB') : '') + '</div>';
        html += '<div class="ev-dist">' + g.dist.toFixed(3) + '</div>';
        html += '<div style="font-size:8px">' + wlSpans + '</div>';
        html += '</div>';
        prevDist = g.dist;
    });
    html += '</div>';
    el.innerHTML = html;

    el.querySelectorAll('.ev-node').forEach(node => {
        node.addEventListener('mouseenter', () => {
            evStripHover(node.getAttribute('data-tip') || '');
        });
        node.addEventListener('mouseleave', () => {
            evStripHover('');
        });
    });
    el.querySelectorAll('.ev-type-select-strip').forEach(sel => {
        sel.addEventListener('click', e => e.stopPropagation());
        sel.addEventListener('change', () => {
            const refs = JSON.parse(sel.dataset.refs);
            applyManualOverride(refs, sel.value);
        });
    });
}

window.renderEventStrip = renderEventStrip;

export function evStripHover(tip) {
    const el = document.getElementById('evStripInfo');
    if (!el) return;
    if (tip) { el.textContent = tip; el.style.opacity = '1'; }
    else { el.textContent = t('label_legend_hover'); el.style.opacity = '.5'; }
}
window.evStripHover = evStripHover;