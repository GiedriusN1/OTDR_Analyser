import { state } from './state.js';
import { toast, t, formatWavelength, getClosestStandardWavelength, filterEvents } from './utils.js';
import { classifyEvent, consolidateEvents } from './diagnostics.js';
import { analyzeCableWide } from './fiber-analysis.js';
import { apply1kmCorrection } from './utils.js';
import { RULES } from './rules.js';
import { WL_COLORS } from './config.js';
import { NOTOSANS_REGULAR_BASE64, NOTOSANS_BOLD_BASE64 } from './fonts_data.js';

// ── Bendras (total) nuostolis - naudojame prietaiso pateiktą reikšmę TIK
// jei ji apima visą realią liniją; kitu atveju (prietaisas "pasidavė"
// anksčiau dėl rimto pažeidimo trasoje) naudojame patys apskaičiuotą
// (žr. parser.js: total_loss_calculated / total_loss_covers_full_line).
// Ta pati logika kaip render.js, kad UI ir eksportai visada sutaptų.
function effectiveTotalLoss(p) {
    if (p.total_loss_covers_full_line === false && typeof p.total_loss_calculated === 'number') {
        return p.total_loss_calculated;
    }
    return p.total_loss || 0;
}

export async function exportExcel() {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    const ok = state.parsed.filter(p => p.ok);
    const correctedOk = apply1kmCorrection(ok);
    const wb = XLSX.utils.book_new();
    const sum = [
        [t('metrics_files'), t('unit_nm'), t('unit_dB'), t('unit_dBkm'), 'ORL ' + t('unit_dB'), t('tab_events'), t('unit_km'), 'Data']
    ];
    correctedOk.forEach(s => sum.push([s.file, formatWavelength(s.wavelength), effectiveTotalLoss(s), s.avg_attenuation, s.orl || '', s.events.length, s.range_km, s.date]));
    const sumSheet = XLSX.utils.aoa_to_sheet(sum);
    sumSheet['!cols'] = [
        { wch: 32 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 18 }
    ];
    XLSX.utils.book_append_sheet(wb, sumSheet, 'Suvestine');

    const evs = [
        [t('metrics_files'), t('unit_nm'), 'Nr.', t('label_all_types'), t('unit_km'), t('unit_dB'), t('label_cumulative') + ' ' + t('unit_dB'), 'Refl ' + t('unit_dB')]
    ];
    correctedOk.forEach(s => s.events.slice().sort((a, b) => a.distance - b.distance).forEach((e, i) => evs.push([s.file, formatWavelength(s.wavelength), i + 1, classifyEvent(e), e.distance, e.loss, (typeof e.cumulative_loss === 'number' ? e.cumulative_loss : ''), e.refl])));
    const evsSheet = XLSX.utils.aoa_to_sheet(evs);
    evsSheet['!cols'] = [
        { wch: 32 }, { wch: 10 }, { wch: 6 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 10 }
    ];
    XLSX.utils.book_append_sheet(wb, evsSheet, 'Eventai');

    // ── Matavimo informacija (data/laikas, prietaisas, parametrai, cable ID, lokacijos) ──
    const meas = [
        [t('metrics_files'), t('unit_nm'), t('label_meas_datetime'), t('label_meas_instrument'), 'IOR', t('label_meas_pulse'), t('label_meas_range'), t('label_meas_avg'), t('label_meas_cable_id'), 'Location A', 'Location B']
    ];
    correctedOk.forEach(s => meas.push([
        s.file, formatWavelength(s.wavelength), s.date || '', s.otdr || s.supplier || '',
        s.ior ? s.ior.toFixed(5) : '', s.pulse_width || '', s.range_km,
        s.avg_time_s ? (s.avg_time_s + ' s') : (s.num_avg ? (s.num_avg + '×') : ''),
        s.cable_id || '', s.location_a || '', s.location_b || ''
    ]));
    const measSheet = XLSX.utils.aoa_to_sheet(meas);
    measSheet['!cols'] = [
        { wch: 32 }, { wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 20 }
    ];
    XLSX.utils.book_append_sheet(wb, measSheet, 'Matavimo info');

    // ── Naudotos ribos - generuojama tiesiogiai iš RULES.js, kad visada
    // atspindėtų realiai naudojamas diagnostikos ribas (audito pėdsakas). ──
    const thr = [['Parametras', 'Įspėjimas', 'Kritinė']];
    Object.entries(RULES.attenuation).filter(([wl]) => wl !== 'default').forEach(([wl, lim]) => {
        thr.push([wl + ' nm slopinimas (dB/km)', lim.warn, lim.max]);
    });
    thr.push(['Suvirinimas (dB)', RULES.splice.warn, RULES.splice.critical]);
    thr.push(['Jungtis (dB)', RULES.connector.warn, RULES.connector.critical]);
    thr.push(['Atspindys (dB)', RULES.reflection.warn, RULES.reflection.critical]);
    thr.push(['ORL (dB)', RULES.orl.warn, RULES.orl.critical]);
    thr.push(['1550 vs 1310 nm Δ (dB/km)', RULES.wavelength_comparison.loss_1550_vs_1310.warn_diff, RULES.wavelength_comparison.loss_1550_vs_1310.critical_diff]);
    thr.push(['1625 vs 1550 nm Δ (dB/km)', RULES.wavelength_comparison.loss_1625_vs_1550.warn_diff, '']);
    thr.push(['Vandens smailė 1383 vs 1310 (dB/km)', '', RULES.wavelength_comparison.water_peak_max_diff]);
    thr.push(['Priėmimo ribos - suvirinimas (dB)', RULES.acceptance.splice.warn, RULES.acceptance.splice.critical]);
    thr.push([]);
    thr.push(['Standartas', RULES.standard || 'ITU-T G.652D', 'v' + (RULES.version || '-')]);
    const thrSheet = XLSX.utils.aoa_to_sheet(thr);
    thrSheet['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, thrSheet, 'Naudotos ribos');

    const diags = [
        ['Sunkumas', 'Kategorija', 'Failas', 'Problema', 'Rekomendacija']
    ];
    state.diagnostics.forEach(g => {
        // Kelių bangų (cross_wl) pranešimai apima visus grupės failus - išvardijame juos
        const allFiles = g.files ? Object.values(g.files).join(', ') : g.group;
        g.cross_wl.forEach(d => diags.push([d.sev, d.category, allFiles, d.msg, d.rec]));
        // Vieno bangos ilgio pranešimai - naudojame TIKRĄ to bangos ilgio failo vardą
        Object.entries(g.per_file).forEach(([wl, ds]) => {
            const fileName = (g.files && g.files[wl]) || g.group;
            ds.forEach(d => diags.push([d.sev, d.category, fileName, d.msg, d.rec]));
        });
    });
	// ── Kabelio lygmens diagnostika (kelios skaidulos) ──
    const xlsxLang = document.querySelector('.lang-btn.active')?.dataset.lang || 'lt';
    const cableDiags = analyzeCableWide(state.diagnostics, RULES, formatWavelength, xlsxLang);
    cableDiags.forEach(d => diags.push([d.sev, d.category, t('label_cable_scope'), d.msg, d.rec]));
	
    const diagsSheet = XLSX.utils.aoa_to_sheet(diags);
    diagsSheet['!cols'] = [
        { wch: 10 }, { wch: 26 }, { wch: 26 }, { wch: 60 }, { wch: 60 }
    ];
    XLSX.utils.book_append_sheet(wb, diagsSheet, 'Diagnostika');

    XLSX.writeFile(wb, 'otdr_analize.xlsx');
    toast(t('toast_excel_download'));
}

// ── Įkelia įkomponuotą NotoSans šriftą (Regular + Bold) į jsPDF dokumentą.
//    Šriftas yra dalis projekto kodo (js/fonts_data.js) - jokios priklausomybės
//    nuo išorinio CDN, tad šis žingsnis visada pavyksta be tinklo užklausos. ──
function loadEmbeddedFont(doc) {
    doc.addFileToVFS('NotoSans-Regular.ttf', NOTOSANS_REGULAR_BASE64);
    doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
    doc.addFileToVFS('NotoSans-Bold.ttf', NOTOSANS_BOLD_BASE64);
    doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
    return 'NotoSans';
}

// ── Užfiksuoja ekrane matomą reflektogramos grafiką (Chart.js drobę +
// A/B žymeklių overlay) kaip PNG paveikslėlį PDF eksportui. Grąžina null,
// jei vartotojas dar neatidarė "Grafikai" skilties (canvas tada tuščias
// arba neegzistuoja). ──
// ── Sukuria ŠVIEŽIĄ, paslėptą, spausdinimui pritaikytą (baltas fonas, tamsus
// tekstas) grafiko canvas'ą specialiai PDF eksportui - vietoj to, kad
// fiksuotume ekrane jau nupieštą TAMSIOS temos grafiką (kuris turėtų baltą
// tekstą su juodu šešėliu, skirtą tamsiam fonui - PDF'e tai virsdavo
// nematomu "baltas ant balto" tekstu). Sunaikinama iškart po nuotraukos
// paėmimo, kad neliktų DOM'e. Event'ų žymeklių/atstumų overlay čia
// sąmoningai neperpiešiame (per daug spalvų/šešėlių logikos dubliuoti) -
// tikslūs skaičiai vis tiek yra Events/Diagnostika PDF puslapiuose. ──
// SVARBU: `ok` čia turi būti JAU pakoreguotas (apply1kmCorrection) masyvas -
// tiek trasos linijai, tiek event'ų žymekliams naudojame tą PATĮ masyvą, kad
// jie neišsiderintų tarpusavyje. Nekartojame korekcijos viduje, nes trasos
// taškams ji nėra idempotentiška (pt.x nėra saugomas originalas, kaip
// event'ų originalDistance) - antras pritaikymas nuslinktų liniją dar 1 km.
function renderPrintFriendlyChartImage(ok) {
    if (!window.Chart || !ok.length) return null;
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:900px;height:420px;';
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 650;
    holder.appendChild(canvas);
    document.body.appendChild(holder);
    let chart = null;
    try {
        chart = new Chart(canvas.getContext('2d'), {
            type: 'scatter',
            data: {
                datasets: ok.map(s => ({
                    label: s.file + ' (' + formatWavelength(s.wavelength) + 'nm)',
                    data: s.trace.map(p => ({ x: p.x, y: p.y })),
                    borderColor: WL_COLORS[getClosestStandardWavelength(s.wavelength)] || '#888',
                    borderWidth: 1.8,
                    pointRadius: 0,
                    tension: 0.05,
                    fill: false,
                    showLine: true,
                })),
            },
            options: {
                responsive: false,
                animation: false,
                backgroundColor: '#ffffff',
                plugins: { legend: { display: true, position: 'top', labels: { color: '#30323f', font: { size: 12 } } } },
                scales: {
                    x: {
                        type: 'linear',
                        ticks: { color: '#5a5a64', font: { size: 12 } },
                        grid: { color: 'rgba(0,0,0,0.08)' },
                        title: { display: true, text: t('chart_x_axis'), color: '#5a5a64', font: { size: 12 } }
                    },
                    y: {
                        ticks: { color: '#5a5a64', font: { size: 12 } },
                        grid: { color: 'rgba(0,0,0,0.08)' },
                        title: { display: true, text: t('chart_y_axis'), color: '#5a5a64', font: { size: 12 } }
                    }
                }
            },
            plugins: [{
                id: 'whiteBg',
                beforeDraw: (c) => {
                    const ctx = c.canvas.getContext('2d');
                    ctx.save();
                    ctx.globalCompositeOperation = 'destination-over';
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, c.width, c.height);
                    ctx.restore();
                }
            }]
        });
        // ── Event'ų žymekliai (vertikalios linijos + numeruoti ženkliukai) -
        // be jų grafikas atrodo tuščias/beprasmis. Ženkliukas pats turi
        // savo spalvotą foną (todėl baltas skaičius ant jo skaitomas
        // nepriklausomai nuo puslapio fono), bet atstumo/nuostolio etiketes
        // po ženkliuku piešiame TAMSIA spalva be šešėlio (ne baltai su
        // juodu šešėliu, kaip ekrano tamsios temos versijoje) - kitaip jos
        // vėl taptų nematomos baltame PDF fone. ──
        try {
            const xAxis = chart.scales.x, yAxis = chart.scales.y;
            const yT = yAxis.top, yB = yAxis.bottom;
            const filtered = ok.map(s => ({ ...s, events: filterEvents(s.events) }));
            const groups = consolidateEvents(filtered);
            const TYPE_COLORS = { splice: '#00a887', refl: '#e0762f', end: '#c94b4b', wdm: '#3f74d1', other: '#6a6f82' };
            const chartCtx = canvas.getContext('2d');
            groups.forEach((g, gi) => {
                const px = xAxis.getPixelForValue(g.dist);
                if (px < xAxis.left - 2 || px > xAxis.right + 2) return;
                const mainType = g.events[0] ? classifyEvent(g.events[0]) : 'other';
                const col = TYPE_COLORS[mainType] || '#6a6f82';

                chartCtx.save();
                chartCtx.strokeStyle = col;
                chartCtx.lineWidth = 1;
                chartCtx.beginPath();
                chartCtx.moveTo(px, yT);
                chartCtx.lineTo(px, yB);
                chartCtx.stroke();
                chartCtx.restore();

                const bW = 20, bH = 16, rowOffset = (gi % 2 === 1) ? (bH + 23) : 0, bY = yT + 3 + rowOffset;
                chartCtx.save();
                chartCtx.fillStyle = col;
                chartCtx.beginPath();
                chartCtx.roundRect ? chartCtx.roundRect(px - bW / 2, bY, bW, bH, 3) : chartCtx.rect(px - bW / 2, bY, bW, bH);
                chartCtx.fill();
                chartCtx.fillStyle = '#ffffff';
                chartCtx.font = 'bold 11px Inter,sans-serif';
                chartCtx.textAlign = 'center';
                chartCtx.textBaseline = 'middle';
                chartCtx.fillText(gi + 1, px, bY + bH / 2);
                chartCtx.restore();

                // Atstumas ir nuostolis - TAMSI spalva, be šešėlio (šviesiam fonui)
                chartCtx.save();
                chartCtx.fillStyle = '#3a3d4a';
                chartCtx.font = '9px JetBrains Mono,monospace';
                chartCtx.textAlign = 'left';
                chartCtx.textBaseline = 'top';
                chartCtx.fillText(g.dist.toFixed(3) + ' ' + t('unit_km'), px + 3, bY + bH + 3);
                const avgLoss = g.events.reduce((s, e) => s + e.loss, 0) / g.events.length;
                if (Math.abs(avgLoss) > 0.05) {
                    chartCtx.font = 'bold 9px JetBrains Mono,monospace';
                    chartCtx.fillText(avgLoss.toFixed(2) + ' ' + t('unit_dB'), px + 3, bY + bH + 23);
                }
                chartCtx.restore();
            });
        } catch (e) {
            console.warn('Nepavyko nupiešti event\u02bcų žymeklių PDF grafike:', e.message);
        }

        const dataUrl = canvas.toDataURL('image/png');
        return { dataUrl, width: canvas.width, height: canvas.height };
    } catch (e) {
        console.warn('Nepavyko sugeneruoti PDF grafiko:', e.message);
        return null;
    } finally {
        if (chart) chart.destroy();
        document.body.removeChild(holder);
    }
}

export async function exportPdf() {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const ok = state.parsed.filter(p => p.ok);
    const correctedOk = apply1kmCorrection(ok);

    const tableFont = loadEmbeddedFont(doc);

    // ── Spausdinimui draugiškas dizainas: baltas fonas, tamsus tekstas ──
    // (fono stačiakampio piešti nebereikia - jsPDF numatytasis fonas jau baltas)
    doc.setTextColor(0, 130, 100);
    doc.setFontSize(18);
    doc.setFont(tableFont, 'bold');
    doc.text(t('label_report_title'), 14, 15);
    doc.setTextColor(90, 90, 100);
    doc.setFontSize(10);
    doc.setFont(tableFont, 'normal');
    doc.text(t('label_generated') + ': ' + new Date().toLocaleString('lt-LT') + ' | ITU-T G.652D / IEC 61280-4-1', 14, 22);

    // Puslapio plotis (landscape A4) = 297mm. Paraštės 8+8=16mm -> turinio plotis 281mm.
    doc.autoTable({
        startY: 27,
        margin: { left: 8, right: 8 },
        head: [
            [t('metrics_files'), t('unit_nm'), t('unit_dB'), t('unit_dBkm'), 'ORL ' + t('unit_dB'), t('tab_events'), t('unit_km')]
        ],
        // Bangos ilgis formatuojamas per formatWavelength() - be to, žalias plaukiojantis
        // taškas (pvz. 1541.3000000000002) apvalinamas iki artimiausio standartinio ilgio,
        // nebent įjungtas WDM režimas (state.hasWdm) - tada rodomas tikslus DWDM kanalo ilgis.
        body: correctedOk.map(s => [s.file, formatWavelength(s.wavelength), effectiveTotalLoss(s).toFixed(3), (s.avg_attenuation || 0).toFixed(4), (s.orl || 0).toFixed(2), s.events.length, (s.range_km || 0).toFixed(3)]),
        styles: {
            fillColor: [255, 255, 255],
            textColor: [30, 32, 40],
            lineColor: [210, 213, 220],
            lineWidth: 0.1,
            fontSize: 10,
            cellPadding: 3,
            font: tableFont,
            overflow: 'linebreak'
        },
        headStyles: {
            fillColor: [0, 150, 120],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 10,
            font: tableFont
        },
        alternateRowStyles: { fillColor: [242, 246, 245] },
        columnStyles: {
            0: { cellWidth: 'auto' },  // failo pavadinimas - automatinis plotis pagal turinį
            1: { cellWidth: 26 },
            2: { cellWidth: 34 },
            3: { cellWidth: 42 },
            4: { cellWidth: 34 },
            5: { cellWidth: 28 },
            6: { cellWidth: 34 }
        },
        tableWidth: 'auto'
    });

    // ── Matavimo informacija (data/laikas, prietaisas, IOR, pulse, cable ID, lokacijos) ──
    // Lieka TAME PAČIAME puslapyje kaip antraštė ir suvestinė. Jei suvestinė
    // nusidriekia per žemai (daug failų), saugumo dėlei pereiname į naują
    // puslapį, kad antraštė "Matavimo informacija" nesusipintų su lentele.
    const measStartY = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 8 : 32;
    if (measStartY > 170) doc.addPage();
    const measTitleY = measStartY > 170 ? 14 : measStartY;
    doc.setTextColor(0, 130, 100);
    doc.setFontSize(13);
    doc.setFont(tableFont, 'bold');
    doc.text(t('label_measurement_info'), 14, measTitleY);
    doc.autoTable({
        startY: measTitleY + 5,
        margin: { left: 8, right: 8 },
        head: [[t('metrics_files'), t('unit_nm'), t('label_meas_datetime'), t('label_meas_instrument'), 'IOR', t('label_meas_pulse'), t('label_meas_avg'), t('label_meas_cable_id'), 'A→B']],
        body: correctedOk.map(s => [
            s.file, formatWavelength(s.wavelength), s.date || '—', s.otdr || s.supplier || '—',
            s.ior ? s.ior.toFixed(5) : '—', s.pulse_width ? s.pulse_width + ' ns' : '—',
            s.avg_time_s ? (s.avg_time_s + ' s') : (s.num_avg ? (s.num_avg + '×') : '—'),
            s.cable_id || '—', (s.location_a || s.location_b) ? (s.location_a || '—') + ' → ' + (s.location_b || '—') : '—'
        ]),
        styles: {
            fillColor: [255, 255, 255], textColor: [30, 32, 40], lineColor: [210, 213, 220],
            lineWidth: 0.1, fontSize: 9, cellPadding: 2.2, font: tableFont, overflow: 'linebreak'
        },
        headStyles: { fillColor: [60, 100, 160], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9, font: tableFont },
        alternateRowStyles: { fillColor: [242, 246, 245] },
        tableWidth: 'auto'
    });

    // ── Puslapis: Reflektogramos grafikas (ekrano nuotrauka su A/B žymekliais) ──
    doc.addPage();
    doc.setTextColor(0, 130, 100);
    doc.setFontSize(15);
    doc.setFont(tableFont, 'bold');
    doc.text(t('tab_trace'), 14, 14);
    const chart = renderPrintFriendlyChartImage(correctedOk);
    if (chart) {
        const pageW = 297, pageH = 210;
        const maxW = pageW - 16, maxH = pageH - 30;
        const ratio = chart.height / chart.width;
        let w = maxW, h = w * ratio;
        if (h > maxH) { h = maxH; w = h / ratio; }
        const x = (pageW - w) / 2;
        doc.addImage(chart.dataUrl, 'PNG', x, 20, w, h);
    } else {
        doc.setTextColor(150, 150, 150);
        doc.setFontSize(10);
        doc.setFont(tableFont, 'normal');
        doc.text(t('label_chart_unavailable'), 14, 25);
    }

    // ── Event'ų lentelė - grupuota pagal failą (kaip web'e), su Kaupiamasis
    // dB stulpeliu, kad matytųsi be pertrūkio kiekvienai trasai atskirai. ──
    doc.addPage();
    doc.setTextColor(0, 130, 100);
    doc.setFontSize(15);
    doc.setFont(tableFont, 'bold');
    doc.text(t('tab_events'), 14, 14);
    let evY = 19;
    const TYPE_LABELS_PDF = {
        splice: t('event_splice'), refl: t('event_refl'), end: t('event_end'),
        wdm: t('event_wdm'), launch: t('launch_event'), event: t('event_other'), other: t('event_other')
    };
    correctedOk.forEach(s => {
        const sortedEvents = s.events.slice().sort((a, b) => a.distance - b.distance);
        if (!sortedEvents.length) return;
        // Jei nebetelpa iki puslapio apačios - naujas puslapis
        if (evY > 180) { doc.addPage(); evY = 14; }
        doc.setTextColor(30, 32, 40);
        doc.setFontSize(10);
        doc.setFont(tableFont, 'bold');
        doc.text(s.file + ' (' + formatWavelength(s.wavelength) + ' ' + t('unit_nm') + ')', 14, evY);
        doc.autoTable({
            startY: evY + 3,
            margin: { left: 8, right: 8 },
            head: [['Nr.', t('label_all_types'), t('unit_km'), t('unit_dB'), t('label_cumulative') + ' ' + t('unit_dB'), t('diag_reflection') + ' ' + t('unit_dB')]],
            body: sortedEvents.map((e, i) => [
                i + 1,
                TYPE_LABELS_PDF[classifyEvent(e)] || classifyEvent(e),
                e.distance.toFixed(4),
                (typeof e.loss === 'number' && !isNaN(e.loss)) ? e.loss.toFixed(3) : '—',
                (typeof e.cumulative_loss === 'number') ? e.cumulative_loss.toFixed(3) : '—',
                (typeof e.refl === 'number' && !isNaN(e.refl) && Math.abs(e.refl) > 0.1) ? e.refl.toFixed(2) : '—'
            ]),
            styles: {
                fillColor: [255, 255, 255], textColor: [30, 32, 40], lineColor: [210, 213, 220],
                lineWidth: 0.1, fontSize: 8.5, cellPadding: 1.8, font: tableFont, overflow: 'linebreak'
            },
            headStyles: { fillColor: [0, 150, 120], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5, font: tableFont },
            alternateRowStyles: { fillColor: [242, 246, 245] },
            tableWidth: 'auto'
        });
        evY = (doc.lastAutoTable.finalY || evY) + 8;
    });

    // ── Naudotos ribos (Pass/Fail Thresholds) - tiesiogiai iš RULES.js ──
    doc.addPage();
    doc.setTextColor(0, 130, 100);
    doc.setFontSize(15);
    doc.setFont(tableFont, 'bold');
    doc.text(t('label_thresholds'), 14, 14);
    const thrBody = [];
    Object.entries(RULES.attenuation).filter(([wl]) => wl !== 'default').forEach(([wl, lim]) => {
        thrBody.push([wl + ' nm ' + t('label_thresholds_attenuation'), '≤ ' + lim.warn, '≤ ' + lim.max]);
    });
    thrBody.push([t('diag_splice'), '≤ ' + RULES.splice.warn + ' dB', '≤ ' + RULES.splice.critical + ' dB']);
    thrBody.push([t('diag_connector'), '≤ ' + RULES.connector.warn + ' dB', '≤ ' + RULES.connector.critical + ' dB']);
    thrBody.push([t('diag_reflection'), '≤ ' + RULES.reflection.warn + ' dB', '≤ ' + RULES.reflection.critical + ' dB']);
    thrBody.push(['ORL', '≥ ' + RULES.orl.warn + ' dB', '≥ ' + RULES.orl.critical + ' dB']);
    thrBody.push(['1550 vs 1310 nm Δ', '≤ ' + RULES.wavelength_comparison.loss_1550_vs_1310.warn_diff + ' dB/km', '≤ ' + RULES.wavelength_comparison.loss_1550_vs_1310.critical_diff + ' dB/km']);
    thrBody.push([t('diag_water_peak') + ' (1383 vs 1310)', '—', '≤ ' + RULES.wavelength_comparison.water_peak_max_diff + ' dB/km']);
    doc.autoTable({
        startY: 19,
        margin: { left: 8, right: 8 },
        head: [[t('label_thresholds_attenuation'), t('label_thresholds_warn'), t('label_thresholds_critical')]],
        body: thrBody,
        styles: {
            fillColor: [255, 255, 255], textColor: [30, 32, 40], lineColor: [210, 213, 220],
            lineWidth: 0.1, fontSize: 9, cellPadding: 2.2, font: tableFont, overflow: 'linebreak'
        },
        headStyles: { fillColor: [0, 150, 120], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9, font: tableFont },
        alternateRowStyles: { fillColor: [242, 246, 245] },
        tableWidth: 'auto'
    });
    doc.setTextColor(90, 90, 100);
    doc.setFontSize(8);
    doc.setFont(tableFont, 'normal');
    doc.text(t('label_thresholds_standard') + ': ' + (RULES.standard || 'ITU-T G.652D') + ' (v' + (RULES.version || '-') + ')', 14, (doc.lastAutoTable.finalY || 19) + 5);

    // ── Antras puslapis: Diagnostika ──
    // "Failas" stulpelis: cross_wl pranešimams (apima kelias bangas) rodome visus grupės
    // failus; per_file pranešimams - tikslų to bangos ilgio failo vardą (g.files[wl]).
    const allD = state.diagnostics.flatMap(g => {
        const allFiles = g.files ? Object.values(g.files).join(', ') : g.group;
        return [
            ...g.cross_wl.map(d => ({ ...d, _file: allFiles, _scope: 'λ palyginimas' })),
            ...Object.entries(g.per_file).flatMap(([wl, ds]) => {
                const fileName = (g.files && g.files[wl]) || g.group;
                return ds.map(d => ({ ...d, _file: fileName, _scope: formatWavelength(wl) + 'nm' }));
            })
        ];
    });

	const pdfLang = document.querySelector('.lang-btn.active')?.dataset.lang || 'lt';
		const cableDiags = analyzeCableWide(state.diagnostics, RULES, formatWavelength, pdfLang).map(d => ({
			...d,
			_file: t('label_cable_scope'),
			_scope: '🔗 ' + t('label_cable_level')
		}));
		allD.push(...cableDiags);

    if (allD.length) {
        doc.addPage();
        doc.setTextColor(0, 130, 100);
        doc.setFontSize(15);
        doc.setFont(tableFont, 'bold');
        doc.text(t('label_diag_recommendations_title'), 14, 14);

        const body = allD.map(d => [
            d.sev.toUpperCase(),
            d._scope + ' ' + d.category,
            d._file,
            d.msg,
            d.rec
        ]);

        // Turinio plotis (paraštės 5+5=10mm) = 287mm.
        doc.autoTable({
            startY: 19,
            margin: { left: 5, right: 5 },
			head: [
                [t('label_diag_severity'), t('label_diag_category'), t('label_diag_file'), t('label_diag_problem'), t('label_diag_recommendation')]
            ],
            body: body,
            styles: {
                fillColor: [255, 255, 255],
                textColor: [30, 32, 40],
                lineColor: [210, 213, 220],
                lineWidth: 0.1,
                fontSize: 9,
                cellPadding: 2.2,
                font: tableFont,
                overflow: 'linebreak'
            },
            headStyles: {
                fillColor: [40, 70, 120],
                textColor: [255, 255, 255],
                fontStyle: 'bold',
                fontSize: 9.5,
                font: tableFont
            },
            alternateRowStyles: { fillColor: [242, 246, 245] },
            columnStyles: {
                0: { cellWidth: 20 },
                1: { cellWidth: 42 },
                2: { cellWidth: 32 },
                3: { cellWidth: 'auto', overflow: 'linebreak' },
                4: { cellWidth: 'auto', overflow: 'linebreak' }
            },
            tableWidth: 'auto',
            didParseCell: (dt) => {
                if (dt.column.index === 0 && dt.row.index >= 0) {
                    const v = (dt.cell.raw || '').toLowerCase();
                    if (v.includes('crit')) dt.cell.styles.textColor = [190, 30, 30];
                    else if (v.includes('warn')) dt.cell.styles.textColor = [170, 110, 0];
                    else dt.cell.styles.textColor = [0, 130, 100];
                }
            }
        });
    }

    // ── AI analizė ──
    const aiTxt = document.getElementById('aiContent').textContent;
    if (aiTxt && aiTxt.length > 20 && !aiTxt.includes('Klaida') && !aiTxt.includes('Error') && !aiTxt.includes('analizuoja') && !aiTxt.includes('analyzing')) {
        doc.addPage();
        doc.setTextColor(60, 100, 200);
        doc.setFontSize(15);
        doc.setFont(tableFont, 'bold');
        doc.text('AI analizė (Claude)', 14, 14);
        doc.setTextColor(30, 32, 40);
        doc.setFontSize(9.5);
        doc.setFont(tableFont, 'normal');
        const lines = doc.splitTextToSize(aiTxt, 281);
        doc.text(lines, 8, 22);
    }

    doc.save('otdr_analize.pdf');
    toast(t('toast_pdf_download'));
}

function loadScript(src) {
    if (document.querySelector('script[src="' + src + '"]')) return Promise.resolve();
    return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
    });
}
