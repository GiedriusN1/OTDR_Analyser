// ── OTDR matavimo kokybės vertinimas ──
// Grynas, be UI: priima parseSOR() rezultatą, grąžina balą + patikrų sąrašą
// žmogiška kalba. Testuojama atskirai, prieš integruojant į programą.

function pulseCheck(sor) {
    const rangeKm = sor.range_km || 0;
    const pulseNs = sor.pulse_width || 0;
    let recMin, recMax, label;
    if (rangeKm <= 5) { recMin = 10; recMax = 30; label: label = '≤5 km'; }
    else if (rangeKm <= 20) { recMin = 30; recMax = 100; label = '5–20 km'; }
    else { recMin = 100; recMax = 1000; label = '>20 km'; }

    if (pulseNs < recMin) {
        const ratio = recMin / pulseNs;
        return {
            id: 'pulse',
            pass: false,
            severity: ratio > 3 ? 'critical' : 'warning',
            weight: ratio > 3 ? 25 : 15,
            title: 'Impulsas per trumpas šios trasos ilgiui',
            detail: 'Naudotas impulsas ' + pulseNs + ' ns, o ' + rangeKm.toFixed(1) + ' km (' + label + ') trasai rekomenduojama ' + recMin + '–' + recMax + ' ns.',
            advice: 'Rekomenduojama: iki 5 km → 10–30 ns; 5–20 km → 30–100 ns; virš 20 km → 100–1000 ns.'
        };
    }
    if (pulseNs > recMax * 1.5) {
        return {
            id: 'pulse',
            pass: false,
            severity: 'warning',
            weight: 8,
            title: 'Impulsas gerokai ilgesnis nei būtina',
            detail: 'Naudotas impulsas ' + pulseNs + ' ns šios trasos ilgiui (' + label + ') galėjo suteikti pernelyg didelę dead zone, prarandant artimus įvykius.',
            advice: 'Trumpesnis impulsas (' + recMin + '–' + recMax + ' ns) leistų geriau matyti artimus eventus.'
        };
    }
    return { id: 'pulse', pass: true, title: 'Tinkamas impulsas' };
}

function averagingCheck(sor) {
    const rangeKm = sor.range_km || 0;
    const avgS = sor.avg_time_s;
    if (!avgS) return { id: 'averaging', pass: true, title: 'Vidurkinimo trukmė nežinoma (praleista patikra)' };
    let recMin;
    if (rangeKm <= 10) recMin = 15;
    else if (rangeKm <= 30) recMin = 30;
    else recMin = 60;

    if (avgS < recMin) {
        const ratio = recMin / avgS;
        return {
            id: 'averaging',
            pass: false,
            severity: ratio > 4 ? 'critical' : 'warning',
            weight: ratio > 4 ? 25 : 15,
            title: 'Per trumpas vidurkinimas (averaging)',
            detail: 'Naudota tik ' + avgS + ' s vidurkinimo ' + rangeKm.toFixed(1) + ' km trasai (rekomenduojama ≥ ' + recMin + ' s).',
            advice: 'Padidinkite averaging bent iki ' + recMin + ' s - žemesnis triukšmo lygis leis patikimiau matyti tolimus įvykius ir tiksliau apskaičiuoti ORL.'
        };
    }
    return { id: 'averaging', pass: true, title: 'Tinkamas vidurkinimas' };
}

function launchCheck(sor, has1kmLine) {
    const artifactM = sor.launch_artifact_m || 0;
    const pulseNs = sor.pulse_width || 0;
    const ior = sor.ior || 1.4676;
    // Ta pati formulė kaip utils.js detectLaunchArtifactEnd() - fizikai pagrįsta
    // minimali atsigavimo zona VIEN dėl impulso pločio, be jokio papildomo trukdžio.
    // Ilgesnis impulsas natūraliai reikalauja ilgesnio atsigavimo - lyginame su ŠIA
    // riba, o ne su fiksuotu skaičiumi, kitaip ilgus impulsus klaidingai pažymėtume.
    const cOver2n = (299792.458 / (2 * ior)) * 1e-9;
    const edzKm = pulseNs * cOver2n;
    const formulaFloorM = Math.max(10, edzKm * 8 * 1000) * 0.8;

    // Jei naudojama 1 km dirbtinė (launch) linija, ji pati yra ~1000 m buferis
    // prijungimo artefaktui nuslopinti - kol artefaktas telpa į šį buferį,
    // "nenaudoto launch kabelio" perspėjimas neteisingas (launch_artifact_m čia
    // aprašo artefaktą PRIEŠ korekciją, t.y. pačioje dirbtinėje linijoje, o ne
    // realioje matuojamoje linijoje).
    if (has1kmLine && artifactM <= 1000) {
        return { id: 'launch', pass: true, title: 'Launch kabelis (dirbtinė 1 km linija) naudotas' };
    }

    if (artifactM > formulaFloorM * 1.5 && artifactM > 100) {
        return {
            id: 'launch',
            pass: false,
            severity: 'warning',
            weight: 12,
            title: 'Galimai nenaudotas pulso slopinimo (launch) kabelis',
            detail: 'OTDR prijungimo artefaktas užima ' + artifactM + ' m - tai gerokai daugiau nei ' + Math.round(formulaFloorM) + ' m, kurių reikalautų vien ' + pulseNs + ' ns impulso fizika. Papildomas atsigavimas rodo stiprų trikdį (galimai nešvarus/atviras OTDR portas be launch kabelio).',
            advice: 'Naudokite launch (pulso slopinimo) kabelį prieš matuojamą liniją - taip pirmieji metrai bus tiksliai išmatuoti, o ne paslėpti papildomame sotiems atsigavimo šleife.'
        };
    }
    return { id: 'launch', pass: true, title: 'Launch kabelis (arba dirbtinė linija) naudotas' };
}

function saturationCheck(sor) {
    // Jei formulaFloorKm (impulso pagrįsta minimali riba) daug mažesnė nei
    // faktiškai aptikta dzEnd/launch_artifact_m - reiškia realus atsigavimas
    // buvo ženkliai ilgesnis nei vien impulso plotis paaiškintų (papildoma sotis).
    return { id: 'saturation', pass: true, title: 'Nėra požymių dėl papildomos saturacijos' };
}

function endOfFiberCheck(sor) {
    const rangeKm = sor.range_km || 0;
    const events = sor.events || [];
    if (!events.length) {
        return { id: 'end', pass: false, severity: 'critical', weight: 20, title: 'Nerasta jokių įvykių', detail: 'Nepavyko aptikti nė vieno event\'o - failas gali būti sugadintas arba tuščias.', advice: 'Patikrinkite failą, pakartokite matavimą.' };
    }
    const lastEv = events.find(e => e.typeStr && e.typeStr.length > 1 && e.typeStr[1] === 'E') || events.reduce((a, b) => a.distance > b.distance ? a : b);
    const isEndType = lastEv.typeStr && lastEv.typeStr.length > 1 && lastEv.typeStr[1] === 'E';
    const coverage = rangeKm > 0 ? lastEv.distance / rangeKm : 0;

    if (!isEndType && coverage < 0.7) {
        return {
            id: 'end',
            pass: false,
            severity: 'critical',
            weight: 25,
            title: 'Trasa gali būti neišmatuota iki galo',
            detail: 'Paskutinis aptiktas įvykis ties ' + lastEv.distance.toFixed(3) + ' km (tik ' + (coverage * 100).toFixed(0) + '% viso ' + rangeKm.toFixed(1) + ' km matavimo diapazono), ir neatpažintas kaip linijos galas.',
            advice: 'Padidinkite averaging ir/arba impulsą, kad OTDR "matytų" toliau, arba patikrinkite, ar linija tikrai tiek ilga.'
        };
    }
    if (isEndType && coverage < 0.5) {
        return {
            id: 'end',
            pass: true,
            severity: 'info',
            weight: 0,
            title: 'Linijos galas aptiktas gerokai anksčiau nei matavimo diapazonas',
            detail: 'Linijos galas ties ' + lastEv.distance.toFixed(3) + ' km, matavimo langas nustatytas iki ' + rangeKm.toFixed(1) + ' km - tai normalu, tiesiog matavimo diapazonas buvo su atsarga.',
        };
    }
    return { id: 'end', pass: true, title: 'Trasa pasiekė deklaruotą galą (patikimumas žr. atskirai)' };
}

function endReliabilityCheck(sor, settingsInadequate, corroboratingEvidence) {
    const events = sor.events || [];
    const lastEv = events.length ? (events.find(e => e.typeStr && e.typeStr.length > 1 && e.typeStr[1] === 'E') || events.reduce((a, b) => a.distance > b.distance ? a : b)) : null;
    const isEndType = lastEv && lastEv.typeStr && lastEv.typeStr.length > 1 && lastEv.typeStr[1] === 'E';
    if (!isEndType) return { id: 'end_reliability', pass: true, title: 'Praleista (linijos galas neaiškus)' };

    // Triukšmas PO deklaruoto galo yra visada (normalu, savaime nediagnostiška -
    // net tikras galas turi triukšmo "uodegą" už savęs). Vien atspindžio
    // buvimas/nebuvimas ties galo eventu TAIP PAT nepatikimas signalas atskirai
    // (patikrinta su realiais failais: ir tikras, ir klaidingas galas gali
    // turėti panašaus dydžio atspindį). Todėl patikima išvada galima tik
    // KOMBINUOJANT nustatymų tinkamumą su nepriklausomu signalo kokybės
    // rodikliu (ORL, vid. slopinimas) - jei abu prasti, deklaruotas galas
    // tikėtinai nepatikimas; jei nustatymai prasti, bet ORL/slopinimas švarūs,
    // galas tikėtinai tikras, tiesiog nustatymai buvo suboptimalūs.
    if (settingsInadequate && corroboratingEvidence) {
        return {
            id: 'end_reliability',
            pass: false,
            severity: 'critical',
            weight: 25,
            title: 'Deklaruotas linijos galas gali būti KLAIDINGAS',
            detail: 'Galas ties ' + lastEv.distance.toFixed(2) + ' km, o impulsas/vidurkinimas nepakankami IR papildomi rodikliai (ORL ir/arba vid. slopinimas) taip pat rodo problemą - šis "galas" gali būti ne tikras fizinis linijos galas, o vieta, kur signalas tiesiog nuskendo triukšme.',
            advice: 'Pakartokite matavimą su ilgesniu impulsu ir vidurkinimu prieš patvirtindami, kad tai tikras linijos galas - už jo gali slypėti dar neaptikti įvykiai (jungtys, suvirinimai, WDM įtaisai).'
        };
    }
    if (settingsInadequate) {
        return {
            id: 'end_reliability',
            pass: true,
            severity: 'info',
            weight: 0,
            title: 'Nustatymai neoptimalūs, bet kiti rodikliai (ORL, slopinimas) nerodo problemos - galas tikėtinai tikras',
        };
    }
    return { id: 'end_reliability', pass: true, title: 'Linijos galas tikėtinai patikimas' };
}

function rangeMarginCheck(sor) {
    const rangeKm = sor.range_km || 0;
    const events = sor.events || [];
    if (!events.length || rangeKm === 0) return { id: 'range_margin', pass: true, title: 'Range patikra praleista (nėra duomenų)' };
    const lastEv = events.find(e => e.typeStr && e.typeStr.length > 1 && e.typeStr[1] === 'E') || events.reduce((a, b) => a.distance > b.distance ? a : b);
    const ratio = lastEv.distance / rangeKm;

    if (ratio > 0.85) {
        return {
            id: 'range_margin',
            pass: false,
            severity: 'critical',
            weight: 20,
            title: 'Matavimo range nustatytas be atsargos',
            detail: 'Paskutinis aptiktas įvykis (' + lastEv.distance.toFixed(2) + ' km) sudaro ' + (ratio * 100).toFixed(0) + '% viso range (' + rangeKm.toFixed(1) + ' km) - praktiškai be atsargos.',
            advice: 'Taisyklė: range nustatykite ~2× žinomo/numatomo linijos ilgio. Per mažas range sumažina dinaminį diapazoną ir gali nutraukti matavimą prieš pasiekiant tikrą galą.'
        };
    }
    if (ratio > 0.6) {
        return {
            id: 'range_margin',
            pass: false,
            severity: 'warning',
            weight: 10,
            title: 'Matavimo range nustatytas su nepakankama atsarga',
            detail: 'Paskutinis aptiktas įvykis (' + lastEv.distance.toFixed(2) + ' km) sudaro ' + (ratio * 100).toFixed(0) + '% viso range (' + rangeKm.toFixed(1) + ' km).',
            advice: 'Rekomenduojama range ~2× žinomo/numatomo linijos ilgio, kad liktų atsargos.'
        };
    }
    return { id: 'range_margin', pass: true, title: 'Range nustatytas su tinkama atsarga' };
}

export function assessMeasurementQuality(sor, has1kmLine = false) {
    const pulseResult = pulseCheck(sor);
    const avgResult = averagingCheck(sor);
    const settingsInadequate = !pulseResult.pass || !avgResult.pass;
    const orl = sor.orl || 0;
    const avgAtt = sor.avg_attenuation || 0;
    const orlLooksBad = orl > 0 && orl < 27; // atitinka RULES.orl.warn likusioje programoje
    const attLooksElevated = avgAtt > 0.35; // apytikslė bendra riba, nepriklausomai nuo bangos
    const corroboratingEvidence = orlLooksBad || attLooksElevated;

    const checks = [
        pulseResult,
        avgResult,
        launchCheck(sor, has1kmLine),
        saturationCheck(sor),
        endOfFiberCheck(sor),
        endReliabilityCheck(sor, settingsInadequate, corroboratingEvidence),
        rangeMarginCheck(sor),
    ];
    let score = 100;
    checks.forEach(c => { if (!c.pass && c.weight) score -= c.weight; });
    score = Math.max(0, Math.min(100, score));
    const stars = Math.round(score / 20);
    const reliable = score >= 70;
    return { score, stars, reliable, checks };
}

export function formatReport(result) {
    const starStr = '★'.repeat(result.stars) + '☆'.repeat(5 - result.stars);
    let out = '──────────────────────────────────\n      MATAVIMO KOKYBĖ\n' + starStr + ' ' + result.score + '%\n';
    const passed = result.checks.filter(c => c.pass);
    const failed = result.checks.filter(c => !c.pass);
    passed.forEach(c => out += '✓ ' + c.title + '\n');
    if (failed.length) {
        out += 'Problemos:\n';
        failed.forEach(c => {
            const marks = c.severity === 'critical' ? '❌❌❌' : c.severity === 'warning' ? '❌❌' : '❌';
            out += marks + ' ' + c.title + '\n   → ' + c.detail + '\n   💡 ' + (c.advice || '') + '\n';
        });
    }
    out += result.reliable ? 'Galima pasitikėti rezultatais.\n' : 'Šios reflektogramos analizuoti nerekomenduojama be papildomo patikrinimo.\n';
    out += '──────────────────────────────────';
    return out;
}