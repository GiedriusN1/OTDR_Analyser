// ── Papildoma diagnostika: ghost'ai (įrodymais grįstas balų algoritmas) ir
// launch zonos artumo užuomina. Atskiras modulis, nepriklausomas nuo
// diagnostics.js vidinės classifyEvent()/diagnoseSingle() logikos.

// Teorinė Frenelio atspindžio riba vienam stiklo-oro paviršiui (dB).
export function theoreticalMaxReflectionDb(ior) {
    const n = ior || 1.4676;
    const R = ((n - 1) / (n + 1)) ** 2;
    return 10 * Math.log10(R);
}

// ── Ghost'ų aptikimas - įrodymais grįstas balų algoritmas ──
// Dauguma ghost'ų YRA SILPNESNI už bet kurį realų atspindį trasoje (nes
// signalas atsimuša du kartus), todėl fizikos riba (viršija Frenelio ribą)
// pagauna tik STIPRIAUSIUS ghost'us. Norint aptikti likusius, tikriname
// atstumų matematiką (2×d arba d1+d2 nuo žinomų stiprių atspindžių) IR
// numatomo ghost stiprumo atitikimą, o ne vien vieną absoliutų kriterijų.
export function detectGhostReflections(sors, opts = {}) {
    const baseTolerance = opts.distanceToleranceKm ?? 0.02;
    const strongReflDb = opts.strongReflectorDb ?? -35; // "stiprus" atspindys = potencialus ghost šaltinis
    const diags = [];

    (sors || []).forEach(sor => {
        const ior = sor.ior || 1.4676;
        const fresnelLimit = theoreticalMaxReflectionDb(ior);
        const events = (sor.events || []).filter(e => typeof e.refl === 'number' && e.refl !== 0);
        const strong = events.filter(e => e.refl > strongReflDb);

        // "Rule B" pagrindas: tipinis REALIŲ eventų (fizikiškai galimo atspindžio,
        // su reikšmingu nuostoliu) nuostolio dydis šioje trasoje - naudojamas
        // kaip palyginimo bazė, ne absoliutus 0dB reikalavimas (realybėje
        // matavimo triukšmas neleidžia ghost'ui rodyti tikslaus nulio).
        const plausibleLosses = (sor.events || [])
            .filter(e => typeof e.loss === 'number' && Math.abs(e.loss) > 0.2 &&
                (typeof e.refl !== 'number' || e.refl <= fresnelLimit))
            .map(e => Math.abs(e.loss))
            .sort((a, b) => a - b);
        const typicalLossDb = plausibleLosses.length
            ? plausibleLosses[Math.floor(plausibleLosses.length / 2)]
            : null;

        events.forEach(ev => {
            let score = 0;
            const reasons = [];

            // 1) Fizikos patikra - absoliutus, stipriausias įrodymas
            if (ev.refl > fresnelLimit + 0.3) {
                score += 80;
                reasons.push('Atspindys ' + ev.refl.toFixed(1) + ' dB VIRŠIJA fizikinę Frenelio ribą (' +
                    fresnelLimit.toFixed(1) + ' dB, IOR=' + ior.toFixed(4) + ') vienam stiklo-oro paviršiui - joks realus vienas atspindintis paviršius negali atspindėti tiek stipriai.');
            }

            // 1b) "Rule B" - žymiai mažesnis nuostolis nei tipinis realus
            // eventas šioje trasoje (ghost fiziškai neįneša tikro nuostolio,
            // bet triukšmas neleidžia jam rodyti lygiai 0 dB).
            if (typeof ev.loss === 'number' && typicalLossDb !== null && typicalLossDb > 0.3) {
                const lossRatio = Math.abs(ev.loss) / typicalLossDb;
                if (lossRatio < 0.5) {
                    score += 15;
                    reasons.push('Nuostolis (' + ev.loss.toFixed(3) + ' dB) žymiai mažesnis už tipinį realų eventą šioje trasoje (~' +
                        typicalLossDb.toFixed(2) + ' dB) - realus fizinis defektas paprastai įneša didesnį, pastebimą nuostolį; ghost - beveik jokio.');
                }
            }

            // 2) Atstumų kombinacijų patikra (2×d arba d1+d2 nuo stiprių atspindžių)
            // SVARBU: kandidatai negali sutapti su pačiu ev (pagal ATSTUMĄ, ne
            // objekto nuorodą) - kitaip labai arti nulio esantis stiprus
            // atspindys trivialiai "atitinka" beveik bet kurį eventą (0+X≈X).
            // Tolerancija SKALUOJASI su atstumu - fiksuota 20 m riba pagavo
            // trumpo nuotolio ghost'us, bet ilgo nuotolio dvigubo atspindžio
            // ghost'ai (pvz. ~9.5 km, dviguba ~4.77 km linija) realiuose
            // failuose (ODF-72 sk.3) rodė ~24-27 m nuokrypį nuo tikslaus 2×d -
            // kalibravimo/atstumo skaičiavimo paklaida natūraliai auga su
            // nuėjusiu keliu, tad fiksuota mažo atstumo riba jį praleisdavo.
            const tolerance = Math.max(baseTolerance, ev.distance * 0.003);
            let bestMatch = null;
            const distTol = 1e-6;
            strong.forEach(s1 => {
                if (Math.abs(s1.distance - ev.distance) < distTol) return;
                if (Math.abs(ev.distance - 2 * s1.distance) < tolerance) {
                    const predicted = 2 * s1.refl;
                    const diff = Math.abs(ev.distance - 2 * s1.distance);
                    if (!bestMatch || diff < bestMatch.diff) {
                        bestMatch = { type: '2x', a: s1, predicted, diff };
                    }
                }
                strong.forEach(s2 => {
                    if (s2 === s1) return;
                    if (Math.abs(s2.distance - ev.distance) < distTol) return;
                    // Abu kandidatai turi būti ARČIAU OTDR nei pats ev (ghost
                    // negali atsirasti prieš savo šaltinius optiniame kelyje).
                    if (s1.distance >= ev.distance || s2.distance >= ev.distance) return;
                    const sum = s1.distance + s2.distance;
                    const diff = Math.abs(ev.distance - sum);
                    if (diff < tolerance) {
                        const predicted = s1.refl + s2.refl;
                        if (!bestMatch || diff < bestMatch.diff) {
                            bestMatch = { type: 'sum', a: s1, b: s2, predicted, diff };
                        }
                    }
                });
            });
            if (bestMatch) {
                score += 40;
                const label = bestMatch.type === '2x'
                    ? '2× atstumas iki stipraus atspindžio @ ' + bestMatch.a.distance.toFixed(3) + ' km (' + bestMatch.a.refl.toFixed(1) + ' dB)'
                    : 'atstumų suma: @' + bestMatch.a.distance.toFixed(3) + ' km (' + bestMatch.a.refl.toFixed(1) + ' dB) + @' + bestMatch.b.distance.toFixed(3) + ' km (' + bestMatch.b.refl.toFixed(1) + ' dB)';
                reasons.push('Atstumas (' + ev.distance.toFixed(3) + ' km) atitinka ' + label + '.');
                if (Math.abs(ev.refl - bestMatch.predicted) < 8) {
                    score += 20;
                    reasons.push('Stiprumas (' + ev.refl.toFixed(1) + ' dB) atitinka numatomą ghost stiprumą (~' + bestMatch.predicted.toFixed(1) + ' dB).');
                }
            }

            if (score <= 0) return;
            const confidence = Math.min(99, score);
            let sev, label;
            if (confidence >= 70) { sev = 'warning'; label = '👻 Tikėtinas ghost'; }
            else if (confidence >= 30) { sev = 'info'; label = '❓ Galimas ghost (neaišku)'; }
            else return;

            diags.push({
                sev,
                category: label + ' — ' + confidence + '% @ ' + ev.distance.toFixed(3) + ' km',
                msg: reasons.join(' '),
                rec: confidence >= 70
                    ? 'Šis event\'as tikėtinai NĖRA realus defektas toje vietoje - patikrinkite fiziškai nurodytus atspindinčius taškus, ne pačią šią vietą.'
                    : 'Negalima vienareikšmiškai atskirti nuo nedokumentuoto realaus defekto - jei įmanoma, patikrinkite fiziškai arba palyginkite su žinoma topologija.',
                _class: 'ghost_candidate',
                _file: sor.file,
                _distance: ev.distance,
                _confidence: confidence,
                _scope: 'ghost'
            });
        });
    });
    return diags;
}

// ── Launch zonos artumo užuomina ──
// SVARBU: šis patikrinimas turi būti atliekamas su NEKOREGUOTOMIS (originaliomis)
// atstumų reikšmėmis, nes jis tikrina, ar netoli tikros ~1 km ribos yra
// sujungimo eventas - tai turi prasmę nepriklausomai nuo to, ar varnelė
// "1 km dirbtinė linija" uždėta.
//
// Jei varnelė UŽDĖTA, vartotojas jau pasakė, kad naudojama 1 km launch linija,
// ir apply1kmCorrection() tai jau įskaičiuoja - pranešti "galbūt tai launch
// linijos pabaiga" būtų nebereikalinga informacija. Tokiu atveju tik
// patikriname, ar ties ~1 km IŠ TIES yra atitinkamas eventas (nepriklausomai
// nuo varnelės, vien pagal duomenis) - jei jo NĖRA, tai gali reikšti, kad
// varnelė uždėta klaidingai (linijos faktiškai nėra arba ji kito ilgio).
export function annotateLaunchZoneAmbiguity(sors, has1kmLine = false, zoneKm = 1.0, toleranceKm = 0.25) {
    const diags = [];
    (sors || []).forEach(sor => {
        let foundNearZone = false;
        (sor.events || []).forEach(ev => {
            const loss = typeof ev.loss === 'number' ? Math.abs(ev.loss) : 0;
            const refl = typeof ev.refl === 'number' ? ev.refl : 0;
            const hasLossAndRefl = loss > 0.3 && refl !== 0 && refl > -55;
            if (!hasLossAndRefl) return;
            const nearLaunchZone = Math.abs(ev.distance - zoneKm) < toleranceKm;
            if (!nearLaunchZone) return;
            foundNearZone = true;
            if (has1kmLine) return; // jau žinoma ir įskaičiuota - papildoma užuomina nereikalinga

            diags.push({
                sev: 'info',
                category: 'ℹ️ Padidėjusi tikimybė: launch/ODF sujungimas @ ' + ev.distance.toFixed(3) + ' km',
                msg: 'Šis event\'as (nuostolis ' + loss.toFixed(2) + ' dB, atspindys ' + refl.toFixed(1) +
                    ' dB) yra ties ' + ev.distance.toFixed(3) + ' km - t.y. arti ' + zoneKm.toFixed(1) +
                    ' km ribos, kuri dažnai atitinka dirbtinės (launch) linijos pabaigą arba pirmą ODF/patch sujungimą po jos. ' +
                    'Toks derinys (nuostolis + atspindys) gali reikšti tiek WDM MUX/OADM įtaisą, tiek nešvarų ODF lizdą - abu vienodai tikėtini vidury trasos, bet šioje vietoje (arti pradžios) launch/ODF sujungimas yra tikėtinesnis paaiškinimas nei atsitiktinis defektas.',
                rec: 'Patikrinkite launch kabelio ir pirmo ODF jungties švarumą - tai dažniausia priežastis šioje vietoje.',
                _class: 'launch_zone_hint',
                _file: sor.file,
                _distance: ev.distance,
                _scope: 'launch_zone'
            });
        });

        if (has1kmLine && !foundNearZone) {
            diags.push({
                sev: 'info',
                category: 'ℹ️ Nerastas 1 km linijos pabaigos eventas',
                msg: 'Pažymėta, kad matavime naudojama 1 km dirbtinė (launch) linija, tačiau ties ~' + zoneKm.toFixed(1) +
                    ' km neaptiktas ryškus sujungimo eventas (nuostolis > 0.3 dB su atspindžiu), kuris paprastai žymi jos pabaigą.',
                rec: 'Patikrinkite, ar varnelė "1 km dirbtinė linija" uždėta teisingai - galbūt linija kito ilgio arba jos jungtis šiuo atveju yra labai švari (mažas nuostolis).',
                _class: 'launch_zone_missing',
                _file: sor.file,
                _scope: 'launch_zone'
            });
        }
    });
    return diags;
}

// ── Triukšmo pradžios aptikimas ir konsoliduota zonos žymėjimas ──
// Vietoj kiekvieno eventos triukšmingoje zonoje analizavimo atskirai (ką
// žmogus ir taip mato akimis grafike), randame TAŠKĄ, kur trasa pati tampa
// statistiniu triukšmu (slankaus lango tiesinės regresijos liekamasis
// nuokrypis staigiai ir ILGAM padidėja, lyginant su PAČIOS trasos
// medianiniu lygiu), ir pažymime VISUS už jo esančius eventus VIENU
// pranešimu. NEPATIKIMA labai pažeistoms linijoms, kur realūs lokalūs
// defektai patys savaime "triukšmina" - tokiu atveju tiesiog negrąžina
// rezultato (nerodoma jokia žinutė), o ne klaidingas ankstyvas taškas.
export function detectNoiseOnset(sor, opts = {}) {
    const windowKm = opts.windowKm ?? 0.15;
    const ratioThreshold = opts.ratioThreshold ?? 4.0;
    const minPersistKm = opts.minPersistKm ?? 1.0;
    const manualAbsoluteThreshold = opts.absoluteThresholdDb ?? null; // pažengusiems vartotojams
    const trace = sor.trace;
    if (!trace || trace.length < 100) return null;
    const n = trace.length;
    const dx = (trace[n - 1].x - trace[0].x) / n;
    const windowPts = Math.max(5, Math.round(windowKm / dx));
    const stepPts = Math.max(1, Math.round(windowPts / 3));
    const startKm = Math.max(0, (sor.launch_artifact_m || 0) / 1000 + 0.05);
    const startIdx0 = trace.findIndex(p => p.x >= startKm);
    if (startIdx0 < 0) return null;

    function localStd(startIdx) {
        const end = Math.min(n, startIdx + windowPts);
        const pts = trace.slice(startIdx, end);
        if (pts.length < 5) return null;
        const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
        if (sxx < 1e-10) return null;
        const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
        const slope = sxy / sxx;
        const intercept = my - slope * mx;
        const residualVar = pts.reduce((s, p) => {
            const pred = slope * p.x + intercept;
            return s + (p.y - pred) ** 2;
        }, 0) / pts.length;
        return { x: pts[0].x, residualStd: Math.sqrt(residualVar) };
    }

    const stats = [];
    for (let i = startIdx0; i < n; i += stepPts) {
        const st = localStd(i);
        if (st) stats.push(st);
    }
    if (stats.length < 10) return null;

    const sortedStd = [...stats].map(s => s.residualStd).sort((a, b) => a - b);
    const median = sortedStd[Math.floor(sortedStd.length / 2)];
    const threshold = manualAbsoluteThreshold ?? Math.max(median * ratioThreshold, 0.08);

    for (let i = 0; i < stats.length; i++) {
        if (stats[i].residualStd < threshold) continue;
        const startX = stats[i].x;
        const targetX = startX + minPersistKm;
        let j = i, belowCount = 0, totalCount = 0;
        while (j < stats.length && stats[j].x < targetX) {
            totalCount++;
            if (stats[j].residualStd < threshold * 0.6) belowCount++;
            j++;
        }
        if (j >= stats.length && stats[stats.length - 1].x < targetX) continue;
        if (totalCount > 0 && belowCount / totalCount < 0.15) {
            return { x: startX, residualStd: stats[i].residualStd, median };
        }
    }
    return null;
}

// Grąžina VIENĄ konsoliduotą pranešimą (ne per-event) apie triukšmo zoną,
// jei ji aptinkama, su sąrašu eventų, patenkančių į tą zoną.
export function annotateNoiseZoneEvents(sors) {
    const diags = [];
    (sors || []).forEach(sor => {
        const onset = detectNoiseOnset(sor);
        if (!onset) return;
        const affectedEvents = (sor.events || []).filter(e => e.distance > onset.x);
        if (!affectedEvents.length) return;

        // Ar VIENINTELIS "paveiktas" event'as yra pats deklaruotas tikras
        // galas ('E' tipo žyma)? Tai VISIŠKAI normalu ir tikėtasi (signalas
        // negrįžta iš linijos pabaigos - triukšmas iš karto po jos yra
        // fizikos dėsnis, ne anomalija) - tokiu atveju nereikia sunkiasvorio,
        // hedge'inančio pranešimo apie "tikėtinai NE realius event'us", nes
        // vienintelis event'as čia YRA realus, ir mes tai TIKRAI žinome (žr.
        // tą pačią 0.3 km ribą diagnostics.js/measurement-quality.js). Diags
        // apie patį galą jau rodomi kitur (diagnoseSingle "✅ Linijos galas
        // patvirtintas") - čia tiesiog praleidžiame, kad neliktų prieštaringų
        // pranešimų per daug garbės skiriant paprastam linijos galui.
        const declaredEnd = (sor.events || []).find(e => e.typeStr && e.typeStr.length > 1 && e.typeStr[1] === 'E');
        const onsetConfirmsRealEnd = declaredEnd && Math.abs(onset.x - declaredEnd.distance) <= 0.3;
        const otherEvents = onsetConfirmsRealEnd
            ? affectedEvents.filter(e => e !== declaredEnd)
            : affectedEvents;
        if (!otherEvents.length) return;

        const indices = otherEvents.map(e => '#' + e.index).join(', ');
        const nearBoundary = otherEvents.filter(e => e.distance - onset.x < 0.3);
        const boundaryNote = nearBoundary.length
            ? ' Atkreipkite dėmesį: ' + nearBoundary.map(e => '#' + e.index).join(', ') +
              ' yra arti pačios ribos (< 300m) - jei tai atitinka žinomo įtaiso (pvz. WDM) parašą, tikėtina, kad tai VIS DAR paskutinis realus trasos elementas, o ne triukšmas; vertinkite individualiai.'
            : '';
        diags.push({
            sev: 'warning',
            category: '📉 Trasa tampa triukšmu nuo ' + onset.x.toFixed(2) + ' km',
            msg: 'Nuo ' + onset.x.toFixed(2) + ' km signalo liekamasis nuokrypis staigiai ir ilgam padidėja (žymiai virš trasos vidutinio lygio) - trasa čia tampa statistiniu triukšmu, ne realiu signalu. Šioje zonoje esantys eventai (' + indices + ') tikėtinai NĖRA realūs fiziniai įvykiai (jungtys, suvirinimai, ghost reiškiniai) - tai atsitiktiniai triukšmo pikai, kuriuos OTDR programinė įranga klaidingai suklasifikuoja kaip eventus.' + boundaryNote,
            rec: 'Šios zonos individualiai neanalizuokite - jei reikia patikimų duomenų už ' + onset.x.toFixed(2) + ' km, pakartokite matavimą su ilgesniu impulsu ir vidurkinimu.',
            _class: 'noise_zone',
            _file: sor.file,
            _distance: onset.x,
            _scope: 'noise_zone'
        });
    });
    return diags;
}

// ── Tikėtinas trūkstamas antras WDM įtaisas ──
// Jei matavimas patikimas (geras impulsas, vidurkinimas, patikimas galas) IR
// vartotojas patvirtino WDM/PON buvimą, bet aptiktas tik VIENAS toks
// įtaisas - dažniausiai WDM sistemose jų būna bent 2 (pvz. abipus trasos).
// IŠIMTIS: sąmoningai trumpas matavimo range, neapimantis viso kelio iki
// antro įtaiso - tada tai normalu, todėl pranešimas tik informacinis.
export function checkExpectedWdmCount(fileName, wdmCount, qualityResult, hasWdm) {
    if (!hasWdm || wdmCount == null || wdmCount >= 2) return null;
    const pulseCheck = (qualityResult.checks || []).find(c => c.id === 'pulse');
    const avgCheck = (qualityResult.checks || []).find(c => c.id === 'averaging');
    const endCheck = (qualityResult.checks || []).find(c => c.id === 'end_reliability');
    const settingsGood = pulseCheck && pulseCheck.pass && avgCheck && avgCheck.pass;
    const endTrustworthy = !endCheck || endCheck.pass !== false;
    if (!settingsGood || !endTrustworthy) return null; // negalime patikimai spręsti - tylime

    return {
        sev: 'info',
        category: 'ℹ️ Aptiktas tik ' + wdmCount + ' WDM/PON įtaisas',
        msg: 'Pažymėjote, kad linijoje yra WDM/PON, matavimo nustatymai geri, o linijos galas patikimas - bet aptiktas tik ' + wdmCount + ' toks įtaisas. Dažniausiai WDM sistemose būna bent 2 (pvz. MUX abipus trasos arba MUX+OADM).',
        rec: 'Patikrinkite, ar antrasis WDM įtaisas nebuvo praleistas. Jei sąmoningai matuojate tik dalį trasos (trumpą atkarpą, ne visą kelią iki antro WDM) - šį pranešimą galima ignoruoti.',
        _class: 'wdm_count_hint',
        _file: fileName,
        _scope: 'wdm_count'
    };
}

// ── APC rekomendacija, kai aptikta daug ghost'ų ──
// Daug ghost'ų rodo, kad trasoje yra stiprūs, daug atspindintys taškai
// (PC/UPC jungtys, nešvarūs lizdai) - tai kenkia ne tik OTDR diagnostikai,
// bet ir realiam sistemos veikimui gyvoje (traffic-nešančioje) linijoje.
export function recommendApcIfManyGhosts(ghostDiags, threshold = 2) {
    const highConfidence = (ghostDiags || []).filter(d => (d._confidence || 0) >= 50);
    if (highConfidence.length < threshold) return null;
    return {
        sev: 'warning',
        category: '🔧 Rekomendacija: pereiti prie APC jungčių',
        msg: 'Aptikta ' + highConfidence.length + ' galimų ghost reiškinių šioje trasoje - tai rodo, kad linijoje yra stiprūs, daug atspindintys taškai (PC/UPC tipo jungtys, nešvarūs ODF lizdai). Tokie atspindžiai kenkia ne tik OTDR diagnostikai (ghost artefaktai, kaip matote), bet ir realiam sistemos veikimui: atgal į siųstuvą grįžtanti šviesa gali destabilizuoti DFB lazerius (padidėjęs triukšmas, mode-hopping), sutrikdyti EDFA stiprintuvus, pabloginti paslaugos kokybę (padidėjęs klaidų dažnis) ir ilgainiui pažeisti optinę įrangą.',
        rec: 'Pakeiskite ODF adapterius ir jungtis į APC (kampinio pjūvio) tipą - jų atspindys paprastai žemiau -60 dB, palyginti su PC/UPC ~-40 iki -55 dB, kas praktiškai pašalina šią riziką.',
        _class: 'apc_recommendation',
        _scope: 'apc'
    };
}
