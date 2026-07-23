import { state } from './state.js';
import { WL_COLORS } from './config.js';
import { t, apply1kmCorrection, filterEvents, formatWavelength, getClosestStandardWavelength } from './utils.js';
import { classifyEvent, consolidateEvents } from './diagnostics.js';

let traceChartInstance = null;

export function getTraceChart() {
    return traceChartInstance;
}

export function setupTraceChart(ok) {
    const ctx = document.getElementById('traceChart').getContext('2d');
    if (traceChartInstance) {
        traceChartInstance.destroy();
        traceChartInstance = null;
    }

    traceChartInstance = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: ok.map(s => ({
                label: s.file + '(' + formatWavelength(s.wavelength) + 'nm)',
                data: s.trace.map(p => ({ x: p.x, y: p.y })),
                // borderColor: WL_COLORS[Math.round(s.wavelength)] || '#888',
				borderColor: WL_COLORS[getClosestStandardWavelength(s.wavelength)] || '#888',
                borderWidth: 1.5,
                borderDash: [],
                pointRadius: 0,
                tension: 0.05,
                fill: false,
                showLine: true,
                _wl: s.wavelength,
                hidden: !state.activeWls.has(s.wavelength),
            })),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            // animation: { onComplete: () => { drawOverlay(); } },
			animation: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: c => c[0].raw.x.toFixed(3) + ' ' + t('unit_km'),
                        label: c => c.dataset.label + ': ' + c.raw.y.toFixed(3) + ' ' + t('unit_dB')
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    ticks: { color: '#7a8099', font: { size: 13, family: 'JetBrains Mono' } },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    title: { display: true, text: t('chart_x_axis'), color: '#7a8099', font: { size: 12 } }
                },
                y: {
                    ticks: { color: '#7a8099', font: { size: 13, family: 'JetBrains Mono' } },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    title: { display: true, text: t('chart_y_axis'), color: '#7a8099', font: { size: 12 } }
                }
            }
        }
    });

    window.traceChart = traceChartInstance;
    setTimeout(() => {
        setupOverlay(ok);
        drawOverlay();
    }, 350);
}

export function drawOverlay() {
    const chartEl = document.getElementById('traceChart');
    const ov = document.getElementById('overlayCanvas');
    const chart = window.traceChart;
    if (!chart || !ov || !chartEl) return;

    const rect = chartEl.getBoundingClientRect();
    // NERYŠKUS TEKSTAS PATAISYMAS: anksčiau ov.width/height buvo lygus CSS
    // dydžiui (rect.width/height) - tai reiškia, kad canvas vidinė piksele
    // raiška ignoravo ekrano tankį (devicePixelRatio). HiDPI/Retina ekranuose
    // (dpr=2 ir daugiau) tai darė tekstą ir linijas neryškias, o dar labiau
    // ištemptas PDF eksporte. Dabar canvas'o piksele raiška padidinama dpr
    // kartų, o CSS dydis paliekamas toks pat (per style.width/height), ir
    // kontekstas atitinkamai skaliuojamas - visa likusi piešimo logika
    // (xAxis.getPixelForValue ir t.t., veikianti CSS-pikselių erdvėje)
    // nekeičiama.
    const dpr = window.devicePixelRatio || 1;
    ov.width = Math.round(rect.width * dpr);
    ov.height = Math.round(rect.height * dpr);
    ov.style.width = rect.width + 'px';
    ov.style.height = rect.height + 'px';
    const ctx = ov.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const xAxis = chart.scales.x,
        yAxis = chart.scales.y;
    if (!xAxis || !yAxis) return;
    const yT = yAxis.top,
        yB = yAxis.bottom;

    // ── 1. Paimame originalius SOR ──
    const rawOk = state.parsed.filter(p => p.ok);
    // ── 2. PRITAIKOME 1 km KOREKCIJĄ (jei įjungta varnelė) ──
    const ok = apply1kmCorrection(rawOk);

    // ── 3. Filtruojame pagal aktyvius bangos ilgius ──
    const visibleSors = ok.filter(s => state.activeWls.has(s.wavelength));
    if (!visibleSors.length) return;

    // ── 4. PRITAOME 1 km FILTRĄ (pašaliname 0 km eventus) ──
    const filteredSors = visibleSors.map(s => ({
        ...s,
        events: filterEvents(s.events)
    }));

    // ── 5. Konsoliduojame eventus ──
    const groups = consolidateEvents(filteredSors);

    // ── 6. Piešiame markerius ──
    const TYPE_COLORS = { splice: '#00d4aa', refl: '#f7884f', end: '#e05c5c', wdm: '#4f8ef7', other: '#7a8099' };

    groups.forEach((g, gi, arr) => {
        const px = xAxis.getPixelForValue(g.dist);
        if (px < xAxis.left - 2 || px > xAxis.right + 2) return;
        const mainType = g.events[0] ? classifyEvent(g.events[0]) : 'other';
        const col = TYPE_COLORS[mainType] || '#7a8099';

        // Vertikali linija
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(px, yT);
        ctx.lineTo(px, yB);
        ctx.stroke();
        ctx.restore();

        // Žymeklis su numeriu - kas antras (gi nelyginis) žemiau pastumtas,
        // kad artimi vienas šalia kito event'ai nebesusiliestų/nepersidengtų.
        const bW = 18,
            bH = 15,
            rowOffset = (gi % 2 === 1) ? (bH + 23) : 0,
            bY = yT + 3 + rowOffset;
        ctx.save();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(px - bW / 2 + 3, bY);
        ctx.lineTo(px + bW / 2 - 3, bY);
        ctx.quadraticCurveTo(px + bW / 2, bY, px + bW / 2, bY + 3);
        ctx.lineTo(px + bW / 2, bY + bH - 3);
        ctx.quadraticCurveTo(px + bW / 2, bY + bH, px + bW / 2 - 3, bY + bH);
        ctx.lineTo(px - bW / 2 + 3, bY + bH);
        ctx.quadraticCurveTo(px - bW / 2, bY + bH, px - bW / 2, bY + bH - 3);
        ctx.lineTo(px - bW / 2, bY + 3);
        ctx.quadraticCurveTo(px - bW / 2, bY, px - bW / 2 + 3, bY);
        ctx.closePath();
        ctx.fill();

        // Trikampėliai apačioje
        ctx.beginPath();
        ctx.moveTo(px - 4, bY + bH);
        ctx.lineTo(px + 4, bY + bH);
        ctx.lineTo(px, bY + bH + 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px Inter,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(gi + 1, px, bY + bH / 2);
        ctx.restore();

        // Nuostolio tekstas
        const avgLoss = g.events.reduce((s, e) => s + e.loss, 0) / g.events.length;
        if (Math.abs(avgLoss) > 0.05) {
            const lossStr = avgLoss.toFixed(2) + ' ' + t('unit_dB');
            ctx.shadowColor = 'rgba(0,0,0,0.9)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.font = 'bold 10px JetBrains Mono,monospace';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(lossStr, px + 3, bY + bH + 6);
            ctx.shadowBlur = 0;
        }

        // Atstumas (po nuostoliu)
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.font = '8px JetBrains Mono,monospace';
        ctx.fillStyle = '#aaaaaa';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(g.dist.toFixed(3) + ' ' + t('unit_km'), px + 3, bY + bH + 16);
        ctx.shadowBlur = 0;
        if (gi > 0) {
            const prevDist = arr[gi - 1].dist;
            const segLength = g.dist - prevDist;
            if (segLength > 0.001) {
                const segPx = (xAxis.getPixelForValue(prevDist) + px) / 2;
                const segKm = segLength.toFixed(3);
                ctx.shadowColor = 'rgba(0,0,0,0.9)';
                ctx.shadowBlur = 6;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
                ctx.font = 'bold 8px JetBrains Mono,monospace';
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(segKm + ' ' + t('unit_km'), segPx, yB - 4);
                ctx.shadowBlur = 0;
            }
        }
    });

    // ── 6. A/B žymekliai ──
    const xMin = xAxis.min,
        xMax = xAxis.max;
    const aKm = xMin + (xMax - xMin) * state.markerA;
    const bKm = xMin + (xMax - xMin) * state.markerB;
    const pxA = xAxis.getPixelForValue(aKm);
    const pxB = xAxis.getPixelForValue(bKm);

    const pxL = Math.min(pxA, pxB),
        pxR = Math.max(pxA, pxB);
    ctx.fillStyle = 'rgba(255,255,180,0.04)';
    ctx.fillRect(pxL, yT, pxR - pxL, yB - yT);

    function drawMarker(px, label, col, km, offsetX = 0) {
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(px, yT);
        ctx.lineTo(px, yB);
        ctx.stroke();
        ctx.setLineDash([]);
        const bW2 = 22,
            bH2 = 18,
            bY2 = yB - bH2 - 2;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(px - bW2 / 2 + 3, bY2);
        ctx.lineTo(px + bW2 / 2 - 3, bY2);
        ctx.quadraticCurveTo(px + bW2 / 2, bY2, px + bW2 / 2, bY2 + 3);
        ctx.lineTo(px + bW2 / 2, bY2 + bH2 - 3);
        ctx.quadraticCurveTo(px + bW2 / 2, bY2 + bH2, px + bW2 / 2 - 3, bY2 + bH2);
        ctx.lineTo(px - bW2 / 2 + 3, bY2 + bH2);
        ctx.quadraticCurveTo(px - bW2 / 2, bY2 + bH2, px - bW2 / 2, bY2 + bH2 - 3);
        ctx.lineTo(px - bW2 / 2, bY2 + 3);
        ctx.quadraticCurveTo(px - bW2 / 2, bY2, px - bW2 / 2 + 3, bY2);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = label === 'A' ? '#000' : '#fff';
        ctx.font = 'bold 12px Inter,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, px, bY2 + bH2 / 2);

        ctx.fillStyle = col;
        ctx.font = '9px JetBrains Mono,monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(km.toFixed(3) + ' ' + t('unit_km'), px + offsetX, bY2 - 2);
        ctx.restore();
    }

    drawMarker(pxA, 'A', '#f0c84f', aKm, -30);
    drawMarker(pxB, 'B', '#e05c5c', bKm, 30);

    // A→B nuostolis
    const trace = visibleSors[0]?.trace || [];
    function yAtX(km) {
        let b = trace[0];
        for (const p of trace)
            if (Math.abs(p.x - km) < Math.abs(b.x - km)) b = p;
        return b.y;
    }
    const yA = yAtX(aKm),
        yB2 = yAtX(bKm);
    const dist = Math.abs(bKm - aKm);
    const loss = (yA - yB2).toFixed(3);
    const att2 = dist > 0 ? (Math.abs(yA - yB2) / dist).toFixed(3) : '—';

    const el = document.getElementById('abLoss');
    if (el) {
        el.textContent = t('label_ab_loss_format', { loss: loss, att: att2, dist: dist.toFixed(3) });
        const activeWl = visibleSors[0]?.wavelength;
        if (activeWl) {
            const stdWl = getClosestStandardWavelength(activeWl);
            el.style.color = WL_COLORS[stdWl] || '#00d4aa';
        } else {
            el.style.color = '#00d4aa';
        }
    }
}

export function setupOverlay(ok) {
    const ov = document.getElementById('overlayCanvas');
    if (!ov) return;
    let dragging = null;

    function fracFromEvent(e) {
        const chart = window.traceChart;
        if (!chart) return null;
        const rect = ov.getBoundingClientRect();
        const xAxis = chart.scales.x;
        const px = (e.clientX - rect.left) * (ov.width / rect.width);
        return Math.max(0, Math.min(1, (px - xAxis.left) / (xAxis.right - xAxis.left)));
    }

    function nearMarker(e) {
        const f = fracFromEvent(e);
        if (f === null) return null;
        const dA = Math.abs(f - state.markerA),
            dB = Math.abs(f - state.markerB);
        if (dA < 0.04 && dA <= dB) return 'A';
        if (dB < 0.04 && dB < dA) return 'B';
        return null;
    }
    ov.addEventListener('mousedown', e => {
        const m = nearMarker(e);
        if (m) { dragging = m;
            e.preventDefault(); }
    });

    ov.addEventListener('mousemove', e => {
        ov.style.cursor = nearMarker(e) ? 'ew-resize' : 'crosshair';
        if (!dragging) return;
        const f = fracFromEvent(e);
        if (f === null) return;
        if (dragging === 'A') state.markerA = Math.min(f, state.markerB - 0.002);
        else state.markerB = Math.max(f, state.markerA + 0.002);
        drawOverlay();
    });
    ov.addEventListener('mouseup', () => { dragging = null; 
	});
    ov.addEventListener('mouseleave', () => { dragging = null; 
	});
    ov.addEventListener('touchstart', e => {
        const t = e.touches[0];
        const m = nearMarker(t);
        if (m) { dragging = m;
            e.preventDefault(); }
    }, 
	{ passive: false });
    ov.addEventListener('touchmove', e => {
        if (!dragging) return;
        const f = fracFromEvent(e.touches[0]);
        if (f === null) return;
        if (dragging === 'A') state.markerA = Math.min(f, state.markerB - 0.002);
        else state.markerB = Math.max(f, state.markerA + 0.002);
        drawOverlay();
        e.preventDefault();
    }, 
	{ passive: false });
    ov.addEventListener('touchend', () => { dragging = null; });
    document.getElementById('btnResetAB').onclick = () => { state.markerA = 0.08;
        state.markerB = 0.92;
        drawOverlay(); };
    window.addEventListener('resize', () => setTimeout(drawOverlay, 60));
}