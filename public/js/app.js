// ── Main application entry ──
import { state, resetState } from './state.js';
import {
    toast,
    setStatus,
    setProgress,
    guessWl,
    t,
    setLang,
    applyTranslations
} from './utils.js';
import { translations } from './translations.js';
import { parseSOR } from './parser.js';
import { diagnoseAll } from './diagnostics.js';
import { renderAll, renderEventStrip, evStripHover } from './render.js';
import { drawOverlay, setupOverlay } from './chart.js';
import { runAiAnalysis } from './ai.js';
import { exportExcel, exportPdf } from './export.js';

// ── DOM refs ──
const pickFiles = document.getElementById('pickFiles');
const pickDir = document.getElementById('pickDir');
const btnClear = document.getElementById('btnClear');
const btnAnalyze = document.getElementById('btnAnalyze');
const btnExcel = document.getElementById('btnExcel');
const btnPdf = document.getElementById('btnPdf');
const chkWdm = document.getElementById('chkWdm');
const apiKeyInput = document.getElementById('apiKey');
const btnSaveKey = document.getElementById('btnSaveKey');
const btnAiAnalyze = document.getElementById('btnAiAnalyze');
const btnResetAB = document.getElementById('btnResetAB');
const emptyMain = document.getElementById('emptyMain');
const resultsWrap = document.getElementById('resultsWrap');

// ── Language toggle ──
const langBtns = document.querySelectorAll('.lang-btn');
langBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        langBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const lang = btn.dataset.lang;
        setLang(lang);
        applyTranslations();
        // Re-render dynamic content if data exists
        if (state.parsed.length > 0) {
            renderAll();
        }
    });
});
// Set initial language from active button
const activeLangBtn = document.querySelector('.lang-btn.active');
if (activeLangBtn) {
    setLang(activeLangBtn.dataset.lang);
} else {
    setLang('lt');
}
applyTranslations();

// ── Tabs ──
document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
        document.querySelectorAll('.tab, .tab-content').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        document.getElementById('tab-' + t.dataset.tab).classList.add('active');
        if (t.dataset.tab === 'trace') setTimeout(drawOverlay, 100);
    });
});

// ── API Key ──
const savedKey = localStorage.getItem('otdr_api_key');
if (savedKey) apiKeyInput.value = savedKey;
btnSaveKey.addEventListener('click', () => {
    const k = apiKeyInput.value.trim();
    if (k) { localStorage.setItem('otdr_api_key', k);
        toast(t('toast_key_saved')); }
});

// ── File handling ──
function handleFiles(fileList) {
    const sorFiles = [...fileList].filter(f => /\.sor$/i.test(f.name));
    if (!sorFiles.length) {
        toast(t('toast_no_sor') + (fileList.length ? ' (' + t('toast_dup_skipped') + ')' : ''), 'err');
        return;
    }
    const existing = new Set(state.files.map(f => f.name + f.size));
    const newFiles = sorFiles.filter(f => !existing.has(f.name + f.size));
    state.files = [...state.files, ...newFiles];
    const skipped = sorFiles.length - newFiles.length;
    renderSidebar();
    btnAnalyze.disabled = false;
    toast('Pridėta: ' + newFiles.length + ' failų' + (skipped ? ' (' + skipped + ' dublikatų praleista)' : ''));
}

pickFiles.addEventListener('change', e => { handleFiles(e.target.files); });
pickDir.addEventListener('change', e => { handleFiles(e.target.files); });

btnClear.addEventListener('click', () => {
    if (!confirm(t('toast_clear_confirm', { count: state.files.length }))) return;
    resetState();
    renderSidebar();
    btnAnalyze.disabled = true;
    btnExcel.disabled = true;
    btnPdf.disabled = true;
    emptyMain.style.display = 'block';
    resultsWrap.style.display = 'none';
    toast(t('toast_cleared'));
});

chkWdm.addEventListener('change', e => {
    state.hasWdm = e.target.checked;
    if (state.parsed.length) {
        state.diagnostics = diagnoseAll(state.parsed.filter(p => p.ok));
        renderAll();
        toast(state.hasWdm ? t('toast_wdm_on') : t('toast_wdm_off'));
    }
});

function renderSidebar() {
    const files = state.files;
    document.getElementById('fileCount').textContent = files.length || '';
    btnClear.style.display = files.length ? 'flex' : 'none';
    document.getElementById('fileList').innerHTML = files.length ?
        files.map((f, i) => {
            const wl = guessWl(f.name);
            const short = f.name.replace(/\.sor$/i, '').slice(0, 22);
            return '<div class="file-item ' + (wl ? 'wl-' + wl : '') + '" title="' + f.name + '">' +
                (wl ? '<span style="font-size:9px;font-weight:700">' + wl + '</span>' : '') +
                '<span>' + short + '</span>' +
                '<i class="ti ti-x" style="font-size:9px;cursor:pointer;opacity:.6;margin-left:2px" onclick="window.removeFile(' + i + ')"></i>' +
                '</div>';
        }).join('') :
        '<span style="font-size:11px;color:var(--muted)">' + t('label_no_files') + '</span>';
}
window.removeFile = (idx) => {
    state.files.splice(idx, 1);
    renderSidebar();
    if (!state.files.length) btnAnalyze.disabled = true;
};

// ── Analyze ──
btnAnalyze.addEventListener('click', async () => {
    btnAnalyze.disabled = true;
    btnAnalyze.innerHTML = '<span class="spinner"></span> ' + t('btn_analyzing');
    setProgress(5);
    setStatus(t('status_reading'));
    try {
        const parsed = [];
        for (let i = 0; i < state.files.length; i++) {
            const f = state.files[i];
            try {
                const buf = await f.arrayBuffer();
                parsed.push(parseSOR(buf, f.name, f.webkitRelativePath || f.name));
            } catch (e) {
                parsed.push({ ok: false, file: f.name, error: e.message });
            }
            setProgress(10 + 70 * (i + 1) / state.files.length);
        }
        const ok = parsed.filter(p => p.ok);
        if (!ok.length) { toast(t('toast_analyze_error'), 'err'); return; }
        setProgress(85);
        setStatus(t('status_diagnosing'));
        state.parsed = parsed;
        state.diagnostics = diagnoseAll(ok);
        state.activeWls = new Set(ok.map(p => Math.round(p.wavelength)));
        setProgress(100);
        setStatus(t('status_done', { count: ok.length }));
        renderAll();
        emptyMain.style.display = 'none';
        resultsWrap.style.display = 'block';
        btnExcel.disabled = false;
        btnPdf.disabled = false;
        toast(t('toast_analyze_done', { count: ok.length }));
    } catch (e) {
        toast('Klaida: ' + e.message, 'err');
        console.error(e);
    } finally {
        btnAnalyze.disabled = false;
        btnAnalyze.innerHTML = '<i class="ti ti-search"></i> ' + t('btn_analyze');
        setTimeout(() => setProgress(0), 1500);
    }
});

// ── Export ──
btnExcel.addEventListener('click', exportExcel);
btnPdf.addEventListener('click', exportPdf);

// ── AI ──
// Language buttons for AI are already handled by the generic .lang-btn above.
btnAiAnalyze.addEventListener('click', runAiAnalysis);

// ── Reset A/B ──
btnResetAB.addEventListener('click', () => {
    state.markerA = 0.08;
    state.markerB = 0.5;
    drawOverlay();
});

// ── Init ──
renderSidebar();