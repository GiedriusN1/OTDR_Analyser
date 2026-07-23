import { state, resetState } from './state.js';
import { toast, setStatus, setProgress, guessWl, t, setLang, applyTranslations, escapeHtml } from './utils.js';
import { parseSOR } from './parser.js';
import { diagnoseAll } from './diagnostics.js';
import { renderAll, renderEventStrip, evStripHover } from './render.js';
import { drawOverlay } from './chart.js';
import { runAiAnalysis } from './ai.js';
import { exportExcel, exportPdf } from './export.js';

// ── DOM refs ──
const pickFiles = document.getElementById('pickFiles');
const pickDir = document.getElementById('pickDir');
const btnClear = document.getElementById('btnClear');
const btnAnalyze = document.getElementById('btnAnalyze');
const btnExcel = document.getElementById('btnExcel');
const btnPdf = document.getElementById('btnPdf');
const btnNotes = document.createElement('button');
btnNotes.className = 'btn sm';
btnNotes.id = 'btnNotes';
btnNotes.disabled = true;
btnNotes.title = 'Eksportuoti eventų perrašymus ir pastabas kaip .notes.json';
btnNotes.innerHTML = '<i class="ti ti-notes"></i> Pastabos';
btnPdf.insertAdjacentElement('afterend', btnNotes);
const chkWdm = document.getElementById('chkWdm');
const chk1kmLine = document.getElementById('chk1kmLine');
const apiKeyInput = document.getElementById('apiKey');
const btnSaveKey = document.getElementById('btnSaveKey');
const btnAiAnalyze = document.getElementById('btnAiAnalyze');
const btnResetAB = document.getElementById('btnResetAB');
const emptyMain = document.getElementById('emptyMain');
const resultsWrap = document.getElementById('resultsWrap');

/* // ── Language toggle ── senas kodas, nepersijungia po analizės

langBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        langBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const lang = btn.dataset.lang;
        setLang(lang);
        applyTranslations();
        if (state.parsed.length > 0) {
            renderAll();
        }
    });
});
*/

// ── Language toggle ── naujas kodas Perskaičiuoja diagnostiką su nauja kalba
const langBtns = document.querySelectorAll('.lang-btn');
langBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        langBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const lang = btn.dataset.lang;
        setLang(lang);
        applyTranslations();
        if (state.parsed.length > 0) {
            // Perskaičiuojame diagnostiką su nauja kalba
            const ok = state.parsed.filter(p => p.ok);
            state.diagnostics = diagnoseAll(ok);
            renderAll();
            // SVARBI PATAISA: statuso juostos pranešimas ("Išanalizuota N
            // failų") anksčiau buvo nustatomas TIK VIENĄ KARTĄ po analizės ir
            // likdavo "įšaldytas" ta kalba, kuri buvo aktyvi analizės metu -
            // perjungus kalbą jis nebeatsinaujindavo. Dabar perpiešiame jį
            // kartu su likusiu turiniu.
            setStatus(t('status_done', { count: ok.length }));
        }
    });
});



// Init language
const activeLangBtn = document.querySelector('.lang-btn.active');
if (activeLangBtn) setLang(activeLangBtn.dataset.lang);
else setLang('lt');
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
// Saugumo pastaba: raktas saugomas sessionStorage (ne localStorage), todėl
// jis automatiškai išnyksta uždarius naršyklės skirtuką/langą - taip
// sumažinama rizika, jei kada nors atsirastų XSS pažeidžiamumas (escapeHtml
// dengia žinomus vektorius, bet gynyba giluminiais sluoksniais nepakenks).
const API_KEY_STORAGE = 'otdr_api_key';
// Vienkartinė migracija: jei raktas buvo išsaugotas senuoju būdu
// (localStorage, prieš šį saugumo pataisymą), perkeliame į sessionStorage
// ir IŠTRINAME seną ilgalaikę kopiją, kad ji neliktų diske neribotą laiką.
const legacyKey = localStorage.getItem(API_KEY_STORAGE);
if (legacyKey) {
    sessionStorage.setItem(API_KEY_STORAGE, legacyKey);
    localStorage.removeItem(API_KEY_STORAGE);
}
const savedKey = sessionStorage.getItem(API_KEY_STORAGE);
if (savedKey) apiKeyInput.value = savedKey;
if (apiKeyInput) {
    apiKeyInput.title = 'Raktas saugomas tik šios naršyklės sesijoje (išnyks uždarius skirtuką/langą) - niekada nesiunčiamas jokiam serveriui, tik tiesiai į Anthropic API.';
}
btnSaveKey.addEventListener('click', () => {
    const k = apiKeyInput.value.trim();
    if (k) {
        sessionStorage.setItem(API_KEY_STORAGE, k);
        toast(t('toast_key_saved') + ' (raktas saugomas tik šioje naršyklės sesijoje)');
    }
});

// ── UI atnaujinimo funkcijos ──
function updateButtons() {
    const hasFiles = state.files.length > 0;
    if (btnAnalyze) btnAnalyze.disabled = !hasFiles;
    if (btnClear) btnClear.style.display = hasFiles ? 'flex' : 'none';
    if (btnExcel) btnExcel.disabled = true;  // bus įjungti po analizės
    if (btnPdf) btnPdf.disabled = true;
}

function renderSidebar() {
    try {
        const files = state.files;
        const fileCountEl = document.getElementById('fileCount');
        const fileListEl = document.getElementById('fileList');
        
        if (fileCountEl) {
            fileCountEl.textContent = files.length || '';
        }
        
        if (fileListEl) {
            if (files.length) {
                fileListEl.innerHTML = files.map((f, i) => {
                    const wl = guessWl(f.name);
                    const short = f.name.replace(/\.sor$/i, '');
                    return '<div class="file-item ' + (wl ? 'wl-' + wl : '') + '" title="' + escapeHtml(f.name) + '">' +
                        (wl ? '<span style="font-size:9px;font-weight:700">' + wl + '</span>' : '') +
                        '<span class="file-name">' + escapeHtml(short) + '</span>' +
                        '<i class="ti ti-x" style="font-size:9px;cursor:pointer;opacity:.6;margin-left:2px" onclick="window.removeFile(' + i + ')"></i>' +
                        '</div>';
                }).join('');
            } else {
                fileListEl.innerHTML = '<span style="font-size:11px;color:var(--muted)">' + t('label_no_files') + '</span>';
            }
        }
        
        updateButtons();
    } catch (e) {
        console.warn('renderSidebar klaida:', e);
    }
}

// ── Failų pridėjimas ──
function handleFiles(fileList) {
    const sorFiles = [...fileList].filter(f => /\.sor$/i.test(f.name));
    const notesFiles = [...fileList].filter(f => /\.notes\.json$/i.test(f.name));
    if (!sorFiles.length) {
        toast(t('toast_no_sor') + (fileList.length ? ' (' + t('toast_dup_skipped') + ')' : ''), 'err');
        return;
    }
    const existing = new Set(state.files.map(f => f.name + f.size));
    const newFiles = sorFiles.filter(f => !existing.has(f.name + f.size));
    state.files = [...state.files, ...newFiles];
    if (!state.notesFiles) state.notesFiles = [];
    state.notesFiles = [...state.notesFiles, ...notesFiles];
    const skipped = sorFiles.length - newFiles.length;
    renderSidebar();
    toast('Pridėta: ' + newFiles.length + ' failŵ' + (skipped ? ' (' + skipped + ' dublikatų praleista)' : '') + (notesFiles.length ? ' + ' + notesFiles.length + ' pastabų failas(-ai)' : ''));
}

pickFiles.addEventListener('change', e => { handleFiles(e.target.files);
    e.target.value = ''; });
pickDir.addEventListener('change', e => { handleFiles(e.target.files);
    e.target.value = ''; });

// ── Išvalymas ──
btnClear.addEventListener('click', () => {
    if (!confirm(t('toast_clear_confirm', { count: state.files.length }))) return;
    resetState();
    state.notesFiles = [];
    btnNotes.disabled = true;
    renderSidebar();
    emptyMain.style.display = 'block';
    resultsWrap.style.display = 'none';
    toast(t('toast_cleared'));
});

// ── WDM ──
chkWdm.addEventListener('change', e => {
    state.hasWdm = e.target.checked;
    if (state.parsed.length) {
        state.diagnostics = diagnoseAll(state.parsed.filter(p => p.ok));
        renderAll();
        toast(state.hasWdm ? t('toast_wdm_on') : t('toast_wdm_off'));
    }
});

// ── 1 km dirbtinė linija ──

if (chk1kmLine) {
    chk1kmLine.addEventListener('change', e => {
        state.has1kmLine = e.target.checked;
        console.log('1 km linija:', state.has1kmLine); // ← pridedame
        if (state.parsed.length) {
            const ok = state.parsed.filter(p => p.ok);
            state.diagnostics = diagnoseAll(ok);
            renderAll();
            toast(state.has1kmLine ? '1 km linijos režimas įjungtas' : '1 km linijos režimas išjungtas');
        }
    });
}




// ── Pašalinti failą (globali funkcija) ──
window.removeFile = (idx) => {
    state.files.splice(idx, 1);
    renderSidebar();
    if (!state.files.length) {
        btnAnalyze.disabled = true;
    }
};

// ── Analizė ──
btnAnalyze.addEventListener('click', async () => {
    btnAnalyze.disabled = true;
    btnAnalyze.innerHTML = '<span class="spinner"></span> ' + t('btn_analyzing');
    setProgress(5);
    setStatus(t('status_reading'));
    try {
        const parsed = [];
        const total = state.files.length;
        for (let i = 0; i < total; i++) {
            const f = state.files[i];
            try {
                const buf = await f.arrayBuffer();
                // Naudojame setTimeout, kad atlaisvintume UI giją
                await new Promise(resolve => setTimeout(resolve, 0));
                parsed.push(parseSOR(buf, f.name, f.webkitRelativePath || f.name));
            } catch (e) {
                parsed.push({ ok: false, file: f.name, error: e.message });
            }
            // Atnaujiname progresą dažniau
            const progress = 10 + 70 * (i + 1) / total;
            setProgress(progress);
            setStatus(t('status_reading') + ' (' + (i + 1) + '/' + total + ')');
            // Leidžiame UI atnaujinti
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        const ok = parsed.filter(p => p.ok);
        if (!ok.length) { 
            toast(t('toast_analyze_error'), 'err');
            btnAnalyze.disabled = false;
            btnAnalyze.innerHTML = '<i class="ti ti-search"></i> ' + t('btn_analyze'); 
            return; 
        }
        setProgress(85);
        setStatus(t('status_diagnosing'));
        state.parsed = parsed;
        // ── Pastabų (.notes.json) pritaikymas ──
        if (state.notesFiles && state.notesFiles.length) {
            for (const nf of state.notesFiles) {
                try {
                    const txt = await nf.text();
                    const data = JSON.parse(txt);
                    const sor = parsed.find(p => p.ok && p.file === data.sourceFile);
                    if (sor && Array.isArray(data.annotations)) {
                        data.annotations.forEach(a => {
                            const ev = sor.events.find(e => e.index === a.index);
                            if (ev) {
                                if (a.overrideType) ev._overrideType = a.overrideType;
                                if (a.comment) ev._userComment = a.comment;
                            }
                        });
                    }
                } catch (e) {
                    console.warn('Nepavyko pritaikyti pastabų failo ' + nf.name + ':', e.message);
                }
            }
        }
        state.diagnostics = diagnoseAll(ok);
        state.activeWls = new Set(ok.map(p => p.wavelength));
        setProgress(100);
        setStatus(t('status_done', { count: ok.length }));
        renderAll();
        emptyMain.style.display = 'none';
        resultsWrap.style.display = 'block';
        btnExcel.disabled = false;
        btnPdf.disabled = false;
        btnNotes.disabled = false;
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

// ── Pastabų (.notes.json) eksportas ──
btnNotes.addEventListener('click', async () => {
    const ok = state.parsed.filter(p => p.ok);
    const toExport = [];
    ok.forEach(sor => {
        const annotations = (sor.events || [])
            .filter(e => e._overrideType || e._userComment)
            .map(e => {
                const a = { index: e.index };
                if (e._overrideType) a.overrideType = e._overrideType;
                if (e._userComment) a.comment = e._userComment;
                return a;
            });
        if (!annotations.length) return;
        toExport.push({
            filename: sor.file.replace(/\.sor$/i, '') + '.notes.json',
            payload: { sourceFile: sor.file, exportedAt: new Date().toISOString(), annotations }
        });
    });
    if (!toExport.length) {
        toast('Nėra jokių perrašymų ar pastabų eksportui', 'err');
        return;
    }
    // showSaveFilePicker (Chrome/Edge) leidžia pačiam vartotojui pele nurodyti
    // tikslią vietą (pvz. tą patį aplanką kaip .sor failai) - <a download> visada
    // meta į numatytą Atsisiuntimų aplanką, be galimybės to pakeisti iš scenarijaus.
    const supportsPicker = 'showSaveFilePicker' in window;
    let savedCount = 0;
    for (const item of toExport) {
        const text = JSON.stringify(item.payload, null, 2);
        if (supportsPicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: item.filename,
                    types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(text);
                await writable.close();
                savedCount++;
                continue;
            } catch (e) {
                if (e.name === 'AbortError') continue; // vartotojas atšaukė šio failo išsaugojimą
                console.warn('showSaveFilePicker klaida, grįžtama prie standartinio atsisiuntimo:', e.message);
            }
        }
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = item.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        savedCount++;
    }
    if (savedCount) {
        toast('Išsaugota pastabų failų: ' + savedCount);
    } else {
        toast('Nėra jokių perrašymų ar pastabų eksportui', 'err');
    }
});

// ── AI ──
btnAiAnalyze.addEventListener('click', runAiAnalysis);

// ── Reset A/B ──
btnResetAB.addEventListener('click', () => {
    state.markerA = 0.08;
    state.markerB = 0.92;
    drawOverlay();
});

// ── Init ──
renderSidebar();