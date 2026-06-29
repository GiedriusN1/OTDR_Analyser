import { state } from './state.js';
import { WL_COLORS } from './config.js';
import { t } from './utils.js';
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
                label: s.file + '(' + s.wavelength + 'nm)',
                data: s.trace.map(p => ({ x: p.x, y: p.y })),
                borderColor: WL_COLORS[Math.round(s.wavelength)] || '#888',
                borderWidth: 1.5,
                borderDash: [],
                pointRadius: 0,
                tension: 0.05,
                fill: false,
                showLine: true,
                _wl: s.wavelength,
                hidden: !state.activeWls.has(Math.round(s.wavelength)),
            })),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { onComplete: () => { drawOverlay(); } },
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
    setTimeout(() => { setupOverlay(ok);
        drawOverlay(); }, 350);
}

export function drawOverlay() {
    const chartEl = document.getElementById('traceChart');
    const ov = document.getElementById('overlayCanvas');
    const chart = window.traceChart;
    if (!chart || !ov || !chartEl) return;
    const rect = chartEl.getBoundingClientRect();
    ov.width = Math.round(rect.width);
    ov.height = Math.round(rect.height);
    const ctx = ov.getContext('2d');
    ctx.clearRect(0, 0, ov.width, ov.height);
    const xAxis = chart.scales.x,
        yAxis = chart.scales.y;
    if (!xAxis || !yAxis) return;
    const yT = yAxis.top,
        yB = yAxis.bottom;

    const ok = state.parsed.filter(p => p.ok);
    const visibleSors = ok.filter(s => state.activeWls.has(Math.round(s.wavelength)));
    if (!visibleSors.length) return;

    const TYPE_COLORS = { splice: '#00d4aa', refl: '#f7884f', end: '#e05c5c', wdm: '#4f8ef7', other: '#7a8099' };
    const groups = consolidateEvents(visibleSors);
    groups.forEach((g, gi) => {
        const px = xAxis.getPixelForValue(g.dist);
        if (px < xAxis.left - 2 || px > xAxis.right + 2) return;
        const mainType = g.events[0] ? classifyEvent(g.events[0]) : 'other';
        const col = TYPE_COLORS[mainType] || '#7a8099';

        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(px, yT);
        ctx.lineTo(px, yB);
        ctx.stroke();
        ctx.restore();

        const bW = 18,
            bH = 15,
            bY = yT + 3;
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

        const avgLoss = g.events.reduce((s, e) => s + e.loss, 0) / g.events.length;
        if (Math.abs(avgLoss) > 0.05) {
            const lossStr = (avgLoss > 0 ? '+' : '') + avgLoss.toFixed(2) + ' ' + t('unit_dB');
            const lc = avgLoss > 0.5 ? '#e05c5c' : avgLoss > 0.2 ? '#f0c84f' : '#7a8099';
            ctx.save();
            ctx.font = 'bold 10px JetBrains Mono,monospace';
            ctx.fillStyle = lc;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(lossStr, px + 3, bY + bH + 6);
            ctx.restore();
        }
    });

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

    function drawMarker(px, label, col, km) {
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(px, yT);
        ctx.lineTo(px, yB);
        ctx.stroke();
        ctx.setLineDash([]);
        const bW = 22,
            bH = 18,
            bY = yB - bH - 2;
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
        ctx.fillStyle = label === 'A' ? '#000' : '#fff';
        ctx.font = 'bold 12px Inter,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, px, bY + bH / 2);
        ctx.fillStyle = col;
        ctx.font = '9px JetBrains Mono,monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(km.toFixed(3) + ' ' + t('unit_km'), px, bY - 2);
        ctx.restore();
    }
    drawMarker(pxA, 'A', '#f0c84f', aKm);
    drawMarker(pxB, 'B', '#e05c5c', bKm);

    const trace = visibleSors[0].trace;
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
    ov.addEventListener('mouseup', () => { dragging = null; });
    ov.addEventListener('mouseleave', () => { dragging = null; });
    ov.addEventListener('touchstart', e => {
        const t = e.touches[0];
        const m = nearMarker(t);
        if (m) { dragging = m;
            e.preventDefault(); }
    }, { passive: false });
    ov.addEventListener('touchmove', e => {
        if (!dragging) return;
        const f = fracFromEvent(e.touches[0]);
        if (f === null) return;
        if (dragging === 'A') state.markerA = Math.min(f, state.markerB - 0.002);
        else state.markerB = Math.max(f, state.markerA + 0.002);
        drawOverlay();
        e.preventDefault();
    }, { passive: false });
    ov.addEventListener('touchend', () => { dragging = null; });
    document.getElementById('btnResetAB').onclick = () => { state.markerA = 0.08;
        state.markerB = 0.92;
        drawOverlay(); };
    window.addEventListener('resize', () => setTimeout(drawOverlay, 60));
}