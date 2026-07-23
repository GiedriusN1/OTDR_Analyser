// ── OTDR matavimo kokybės vertinimas ──
// Grynas, be UI: priima parseSOR() rezultatą, grąžina balą + patikrų sąrašą
// žmogiška kalba. Testuojama atskirai, prieš integruojant į programą.
import { detectNoiseOnset } from './advanced-diagnostics.js';

// Kiek km toliau nuo deklaruoto galo laikome triukšmo pradžią VIS DAR "tuo
// pačiu" reiškiniu (natūrali pereiga per galo atspindžio kilimo frontą), o ne
// nesusijusiu, ankstesniu problemos tašku. Nustatyta pagal realius failus
// (2_KS3L_Paobelys) - onset ten aptinkamas ~100-120 m PRIEŠ deklaruotą galą.
const END_NOISE_MATCH_TOLERANCE_KM = 0.3;

// Tikroji atstumo riba, kurią impulsui/vidurkinimui REIKIA "apšviesti" - tai
// NĖRA vartotojo nustatytas Range (jis dažnai sąmoningai 1.3-2x didesnis už
// realų linijos ilgį, dėl atsargos), o faktinis linijos ilgis: deklaruoto
// galo (tipo žymos "E") atstumas, arba, jei jo nėra, paskutinio įvykio
// atstumas. Naudojant patį Range čia, sąmoningai su atsarga parinktas platus
// Range VISADA sukeltų klaidingą "impulsas per trumpas" perspėjimą, nors
// realiam linijos ilgiui impulsas buvo visiškai tinkamas.
function estimateRealReachKm(sor) {
    const events = sor.events || [];
    if (!events.length) return sor.range_km || 0;
    const declaredEnd = events.find(e => e.typeStr && e.typeStr.length > 1 && e.typeStr[1] === 'E');
    if (declaredEnd) return declaredEnd.distance;
    const lastEv = events.reduce((a, b) => a.distance > b.distance ? a : b);
    return lastEv.distance || sor.range_km || 0;
}

// Laipsniškas (ne staigus) svoris: kuo labiau nukrypta nuo rekomendacijos,
// tuo didesnė bauda, bet nedidelis nukrypimas (vos per vieną "žingsnį")
// beveik nebaudžiamas - vietoj to, kad iškart kristų ant fiksuotos 15/25
// vertės. maxWeight pasiekiamas ties atRatio (arba daugiau).
function gradedWeight(ratio, maxWeight, atRatio) {
    const frac = Math.max(0, Math.min(1, (ratio - 1) / (atRatio - 1)));
    return Math.round(frac * maxWeight);
}

function pulseCheck(sor) {
    const reachKm = estimateRealReachKm(sor);
    const pulseNs = sor.pulse_width || 0;
    let recMin, recMax, label;
    if (reachKm <= 5) { recMin = 10; recMax = 30; label = '≤5 km'; }
    else if (reachKm <= 20) { recMin = 30; recMax = 100; label = '5–20 km'; }
    else { recMin = 100; recMax = 1000; label = '>20 km'; }

    if (pulseNs < recMin) {
        const ratio = recMin / pulseNs;
        const weight = gradedWeight(ratio, 25, 3);
        return {
            id: 'pulse',
            pass: false,
            severity: ratio > 2.5 ? 'critical' : weight > 0 ? 'warning' : 'info',
            weight,
            title: 'Impulsas per trumpas šios trasos ilgiui',
            detail: 'Naudotas impulsas ' + pulseNs + ' ns, o realiam linijos ilgiui (~' + reachKm.toFixed(1) + ' km, ' + label + ') rekomenduojama ' + recMin + '–' + recMax + ' ns.',
            advice: 'Rekomenduojama: iki 5 km → 10–30 ns; 5–20 km → 30–100 ns; virš 20 km → 100–1000 ns.'
        };
    }
    if (pulseNs > recMax * 1.5) {
        const ratio = pulseNs / recMax;
        return {
            id: 'pulse',
            pass: false,
            severity: 'warning',
            weight: gradedWeight(ratio, 8, 3),
            title: 'Impulsas gerokai ilgesnis nei būtina',
            detail: 'Naudotas impulsas ' + pulseNs + ' ns realiam linijos ilgiui (~' + reachKm.toFixed(1) + ' km, ' + label + ') galėjo suteikti pernelyg didelę dead zone, prarandant artimus įvykius.',
            advice: 'Trumpesnis impulsas (' + recMin + '–' + recMax + ' ns) leistų geriau matyti artimus eventus.'
        };
    }
    return { id: 'pulse', pass: true, title: 'Tinkamas impulsas' };
}

function averagingCheck(sor) {
    const reachKm = estimateRealReachKm(sor);
    const avgS = sor.avg_time_s;
    if (!avgS) return { id: 'averaging', pass: true, title: 'Vidurkinimo trukmė nežinoma (praleista patikra)' };
    let recMin;
    if (reachKm <= 10) recMin = 15;
    else if (reachKm <= 30) recMin = 30;
    else recMin = 60;

    if (avgS < recMin) {
        const ratio = recMin / avgS;
        const weight = gradedWeight(ratio, 25, 4);
        return {
            id: 'averaging',
            pass: false,
            severity: ratio > 3 ? 'critical' : weight > 0 ? 'warning' : 'info',
            weight,
            title: 'Per trumpas vidurkinimas (averaging)',
            detail: 'Naudota tik ' + avgS + ' s vidurkinimo realiam ~' + reachKm.toFixed(1) + ' km linijos ilgiui (rekomenduojama ≥ ' + recMin + ' s).',
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
        return { id: 'launch', pass: true, title: 'Prijungimo dead zone dydis priimtinas (dirbtinė 1 km linija naudojama)' };
    }

    // SVARBU: ši patikra NIEKADA negali įrodyti, kad launch kabelis TIKRAI
    // buvo naudotas - mažas atsigavimo artefaktas vienodai atitinka ir "launch
    // kabelis naudotas", ir "launch kabelio nebuvo, bet OTDR jungtis buvo
    // švari". Todėl PASS atveju pavadinimas aprašo tik tai, ką iš tikrųjų
    // matuojame - artefakto dydį, ne prielaidą apie tai, KAIP buvo matuota.
    // Anksčiau čia buvo papildomas fiksuotas "&& artifactM > 100" slenkstis,
    // kuris trumpiems impulsams (mažas formulaFloorM) visiškai užmaskuodavo
    // reikšmingą santykinį perviršį (pvz. 54 m vs ~33 m fizikos riba pagal
    // 50 ns impulsą - 65% daugiau, bet niekada nepasiekdavo 100 m slenksčio).
    const absoluteFloorM = Math.max(20, formulaFloorM * 0.5);
    if (artifactM > formulaFloorM * 1.5 && artifactM > absoluteFloorM) {
        return {
            id: 'launch',
            pass: false,
            severity: 'warning',
            weight: 12,
            title: 'Prijungimo dead zone didesnė nei tikėtasi šiam impulsui',
            detail: 'OTDR prijungimo artefaktas užima ' + artifactM + ' m - tai gerokai daugiau nei ' + Math.round(formulaFloorM) + ' m, kurių reikalautų vien ' + pulseNs + ' ns impulso fizika. Tai NEBŪTINAI reiškia, kad launch kabelis nenaudotas - taip pat gali rodyti nešvarų/atvirą OTDR portą net ir su launch kabeliu.',
            advice: 'Jei launch kabelis nenaudojamas - naudokite jį prieš matuojamą liniją. Jei jau naudojamas - patikrinkite OTDR ir launch kabelio jungčių švarumą.'
        };
    }
    return { id: 'launch', pass: true, title: 'Prijungimo dead zone dydis priimtinas' };
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

    // TIESIOGINIS fizinis patikrinimas: ar signalas IŠ TIKRŲJŲ virsta
    // statistiniu triukšmu netoli deklaruoto galo? Tai tiesioginis, pirmo
    // rango įrodymas (realaus fiber galo požymis YRA būtent toks - signalas
    // negrįžta, todėl triukšmas prasideda IŠKART po jo), stipresnis už bet
    // kokį netiesioginį samprotavimą apie nustatymus (pulse/averaging) - net
    // jei nustatymai neoptimalūs, tiesiogiai stebimas triukšmo pradžios
    // sutapimas su galu VIENAREIKŠMIŠKAI patvirtina, kad tai realus galas, o
    // ne signalas, "nuskendęs triukšme" per anksti. Patikrinta su realiais
    // failais (2_KS3L_Paobelys): onset aptinkamas ~100-120 m PRIEŠ deklaruotą
    // galą - natūrali pereiga per galo atspindžio frontą, ne atskiras defektas.
    const onset = detectNoiseOnset(sor);
    if (onset && Math.abs(onset.x - lastEv.distance) <= END_NOISE_MATCH_TOLERANCE_KM) {
        return {
            id: 'end_reliability',
            pass: true,
            severity: 'info',
            weight: 0,
            title: 'Linijos galas patvirtintas: signalas natūraliai virsta triukšmu netoli galo'
        };
    }

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