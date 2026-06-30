import { state } from './state.js';
import { toast, t } from './utils.js';
import { classifyEvent } from './diagnostics.js';

export async function runAiAnalysis() {
    const apiKey = document.getElementById('apiKey').value.trim();
    if (!apiKey) { toast(t('toast_no_key'), 'err'); return; }
    const ok = state.parsed.filter(p => p.ok);
    if (!ok.length) { toast(t('toast_no_files'), 'err'); return; }
    const btn = document.getElementById('btnAiAnalyze');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> ' + t('btn_ai_analyzing');
    const contentEl = document.getElementById('aiContent');
    contentEl.style.display = 'block';
    contentEl.textContent = t('label_ai_wait');
    const summary = {
        files: ok.length,
        wavelengths: [...new Set(ok.map(s => s.wavelength))].sort(),
        measurements: ok.map(s => ({
            file: s.file,
            wavelength: s.wavelength,
            range_km: s.range_km.toFixed(2),
            avg_attenuation: s.avg_attenuation.toFixed(4),
            total_loss: s.total_loss.toFixed(3),
            orl: s.orl.toFixed(2),
            events: s.events.map(e => ({
                dist_km: e.distance.toFixed(3),
                loss_dB: e.loss.toFixed(3),
                refl_dB: e.refl.toFixed(1),
                type: classifyEvent(e),
                comment: e.comments
            }))
        })),
        cross_wl_findings: state.diagnostics.flatMap(g => g.cross_wl.map(d => ({ sev: d.sev, cat: d.category, msg: d.msg })))
    };
    const lang = state.aiLang;
    const sysLt = `Esi OTDR matavimų specialistas Lietuvoje. Rašai trumpas technines ataskaitas ryšių technikams.

SVARBIAUSIA: rašyk TIK tai ką matai OTDR duomenyse. Nefantazuok.

DRAUDŽIAMA:
- Siūlyti vizualiai peržiūrėti skaidulą ruože — kabelis po žeme, tikrinamos tik movos ir ODF
- Rašyti "pakeisti X metrų segmentą" dėl atspindžio — atspindys yra taškinis reiškinys
- Vartoti: pergręsti, perrūšiavimas, degrinimas, peržengimas, neprigimtai sugedusi, dempingas, korozija, destruktyvus, suvirinimo dėžė
- Naudoti Markdown lenteles su | --- | — rašyk paprastą tekstą
- Spėlioti apie temperatūrą ar aplinką

TAISYKLINGI TERMINAI: splice=suvirinimas, pervirinti suvirinimą; connector=jungtis, nuvalyti jungtį; closure=mova; open end=atviras skaidulos galas; fiber break=skaidulos nutrūkimas. Nežinai termino — palik angliškai.

FORMATAS (tik paprastas tekstas):
BENDRA BŪKLĖ:
[1-2 sakiniai]

PROBLEMOS:
1. [atstumas] km — [problema] — [reikšmė] (norma: [norma]) — [veiksmas]

REKOMENDUOJAMI DARBAI:
1. Ties [atstumas] km: [konkretus veiksmas]

IŠVADA: [tinkama/netinkama, kokioms paslaugoms]

Standartas: ITU-T G.652D.`;

    const sysEn = `You are an OTDR measurement specialist. Write short technical reports for field technicians.

CRITICAL: write ONLY what you see in OTDR data. No speculation.

FORBIDDEN: suggest visually inspecting fiber route; write replace X meter segment for reflectance; use Markdown tables.

FORMAT (plain text only):
OVERALL STATUS: [1-2 sentences]
ISSUES:
1. [distance] km — [problem] — [value] (limit: [limit]) — [action]
RECOMMENDED ACTIONS:
1. At [distance] km: [specific action]
CONCLUSION: [suitable/not suitable]
Standard: ITU-T G.652D.`;

    const sysPrompt = lang === 'lt' ? sysLt : lang === 'en' ? sysEn : (sysLt + '\n\nAlso provide the full analysis in English after the Lithuanian version.');
    const wdmNote = state.hasWdm ? '\n\nSVARBU: Linijoje yra WDM MUX arba PON splitter. Didelis slopinimas ties MUX/splitter eventais yra NORMALUS.' : '';
    const userPrompt = 'OTDR matavimų duomenys:\n' + JSON.stringify(summary, null, 2) + wdmNote + '\n\nPateik ataskaitą. Tik paprastas tekstas, be lentelių.';
    try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1500,
                system: sysPrompt,
                messages: [{ role: 'user', content: userPrompt }]
            }),
        });
        if (!res.ok) {
            const e = await res.json();
            throw new Error(e.error && e.error.message || res.statusText);
        }
        const data = await res.json();
        contentEl.textContent = data.content.map(c => c.text || '').join('');
        toast(t('toast_ai_done'));
    } catch (e) {
        contentEl.textContent = t('label_ai_error') + e.message;
        toast(t('toast_ai_error') + e.message, 'err');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="ti ti-sparkles"></i> ' + t('btn_ai_analyze');
    }
}