import { RULES } from './rules.js';
import { state } from './state.js';
import { t, isArtificial1kmEvent, apply1kmCorrection, formatWavelength, getClosestStandardWavelength, detectLaunchArtifactEnd } from './utils.js';
import { detectNoiseOnset } from './advanced-diagnostics.js';

// ══════════════════════════════════════════════════════════════
//  1. LINIJOS GALO (End of Fiber) LOGIKA
// ══════════════════════════════════════════════════════════════

function isRealEndOfFiber(ev, events, rangeKm) {
    const maxDist = Math.max(...events.map(e => e.distance));
    if (ev.distance < maxDist - 0.01) return false;

    // SVARBI PATAISA: jei PATS PRIETAISAS savo Bellcore tipo žymoje ("0E...")
    // pažymėjo šį event'ą kaip linijos galą, tai autoritetingas signalas -
    // priimame jį NEPRIKLAUSOMAI nuo |loss| patikros žemiau. Be šito
      // patologiniuose failuose (kur po didelio pažeidimo prietaisas pats
    // "pasiduoda" ir apskaičiuoja absurdišką loss reikšmę savo pačio galo
    // žymai) event'as klaidingai patekdavo į suvirinimo/"gainer" klasifikaciją.
    if (ev.typeStr && ev.typeStr.length > 1 && ev.typeStr[1] === 'E') {
        return true;
    }

    if (Math.abs(ev.loss) > 0.05) return false;

    const refl = ev.refl || 0;
    const isFresnel = refl > -30 && refl < -5;
    const isApc = refl < -40 && refl > -70; // išplėsta iki -70 (buvo -60)
    const isBorder = refl >= -40 && refl <= -30 && Math.abs(ev.loss) < 0.01; // loss patikrinimas IŠLAIKYTAS
    // Triukšmo grindų aptikimas (jei nėra atspindžio signalo)
    const isNoiseEnd = ev.distance === maxDist && refl === 0;

    if (isFresnel || isApc || isBorder || isNoiseEnd) {
        return true;
    }
    return false;
}

function isGhostEvent(ev, events, rangeKm) {
    // 1) Po galo – aiškus ghost
    const realEnd = events.find(e => isRealEndOfFiber(e, events, rangeKm));
    if (realEnd && ev.distance > realEnd.distance + 0.01) return true;

    // 2) Jei ev.loss ≈ 0 ir ev.refl ≈ 0 – įtartinas ghost
    if (Math.abs(ev.loss) < 0.01 && Math.abs(ev.refl) < 0.1) return true;

    // 3) Atstumo kombinacijos
    const distances = events.map(e => e.distance);
    for (const d1 of distances) {
        for (const d2 of distances) {
            if (Math.abs(ev.distance - (d1 + d2)) < 0.01) return true;
            if (Math.abs(ev.distance - (2 * d1)) < 0.01) return true;
        }
    }
    return false;
}

// ══════════════════════════════════════════════════════════════
//  2. KLASIFIKAVIMAS (su kontekstu)
// ══════════════════════════════════════════════════════════════

/**
 * Aprašo skaidulos galo tikėtiną pobūdį pagal atspindžio dydį (dB).
 * Fizikinė logika: stiklo-oro sandūra (be jungties, be indekso derinimo)
 * duoda ~-14.7dB Frenelio atspindį; kuo žemesnis (neigiamesnis) atspindys,
 * tuo "švaresnė" / labiau suderinta jungtis (APC, indekso derinimas, geras
 * kontaktas su įrenginiu). Tikslus scenarijus ("nulūžo", "prijungta prie
 * įrangos" ir pan.) iš vien paties atspindžio negalima 100% atskirti - todėl
 * formuluotės vartoja "tikėtina", ne kategoriškus teiginius.
 */
export function describeEndOfFiber(refl) {
    // refl === 0 šiame kode reiškia "atspindys NEPASTEBĖTAS" (ne "0dB stiprus
    // atspindys") - dažnai reikškia, kad signalas tiesiog nuslopo iki triukšmo
    // ribos be aiškaus diskretaus atspindysio (galimas stiprus išskaidymas,
    // labai geras indekso derinimas, arba matavimo dinaminio diapazono pabaiga).
    if (Math.abs(refl) < 0.05) {
        return {
            label: 'Linijos galas be aiškaus atspindžio',
            detail: 'Signalas nuslopo iki triukšmo ribos be diskretaus atspindžio piko. Tikėtina: labai geras indekso suderinimas (index-matching gel), stiprus išsklaidymas (pvz. sulaužyta/susmulkėjusi skaidula) arba pasiekta OTDR matavimo diapazono riba.',
        };
    }
    if (refl > -14) {
        return {
            label: 'Atviras skaidulos galas (stiklas–ora)',
            detail: 'Labai stiprus atspindys (' + refl.toFixed(1) + ' dB) atitinka šviežio, neapsaugoto stiklo-oro pūvio Frenelio atspindį. Tikėtina: atviras nulūžtas arba nupjautas kabelio galas, PC jungtis be dangtelio.',
        };
    }
    if (refl > -20) {
        return {
            label: 'Atviras kabelio galas su PC jungtimi',
            detail: 'Stiprus atspindys (' + refl.toFixed(1) + ' dB) būdingas PC (physical contact) jungčiai be indekso derinimo skysčio - tikėtina atviras, neprijungtas kabelio galas su PC jungtimi.',
        };
    }
    if (refl > -30) {
        return {
            label: 'Atviras nulūžtas galas arba PC jungtis prie įrangos',
            detail: 'Vidutinis atspindys (' + refl.toFixed(1) + ' dB) - tikėtina arba nužulniai/nelygiai nulūžęs kabelio galas, arba PC jungtis, prijungta prie įrangos (kiek užterlĕjusi arba ne visai standartinė).',
        };
    }
    if (refl > -45) {
        return {
            label: 'Kabelio galas prijungtas prie įrangos (UPC)',
            detail: 'Nužemintas atspindys (' + refl.toFixed(1) + ' dB) būdingas švariai UPC jungčiai, prijungtai prie įrangos (siųstuvo, imtuvo, patch panelio) - geras kontaktas.',
        };
    }
    return {
        label: 'APC jungtis / indeksu suderintas užbaigimas',
        detail: 'Labai žemas atspindys (' + refl.toFixed(1) + ' dB) būdingas APC (kampinei) jungčiai arba indeksu suderintam užbaigimui - geriausias galimas variantas, atspindys praktikškai nekliudo matavimams.',
    };
}

// ── Trumpas, paprastas kalbos komentaras kiekvienam event'ui - naudojamas
// Events lentelėje (web + PDF), kad vartotojui nereikėtų atskirai lipti į
// Diagnostikos tabą, jog suprastų, ką konkreti eilutė reiškia. Linijos galo
// (end) atveju pilnai perpanaudoja describeEndOfFiber() - tą pačią logiką,
// kuri jau naudojama Diagnostikos pranešimams, kad paaiškinimai visur sutaptų.
export function commentForEvent(ev, type) {
    const loss = typeof ev.loss === 'number' ? ev.loss : 0;
    const refl = typeof ev.refl === 'number' ? ev.refl : 0;
    switch (type) {
        case 'launch':
            return 'Prijungimo taškas (OTDR įvadas) - matavimo pradžia, nevertinama kaip defektas.';
        case 'end':
            return describeEndOfFiber(refl).label + '. ' + describeEndOfFiber(refl).detail;
        case 'wdm':
            return 'WDM/PON atšaka (splitteris arba multiplekserius) - nuostolis atitinka įrangos specifikaciją, ne defektas.';
        case 'refl': {
            if (refl > RULES.reflection.critical) {
                return 'Kritinis atspindys (' + refl.toFixed(1) + ' dB) - tikėtina nešvari arba pažeista jungtis. Rekomenduojama nuvalyti/patikrinti mikroskopu.';
            }
            if (refl > RULES.reflection.warn) {
                return 'Padidėjęs atspindys (' + refl.toFixed(1) + ' dB) - verta nuvalyti jungtį profilaktiškai.';
            }
            return 'Atspindys (' + refl.toFixed(1) + ' dB) normos ribose.';
        }
        case 'splice':
        default: {
            if (loss > RULES.splice.critical) {
                return 'Didelis suvirinimo nuostolis (' + loss.toFixed(3) + ' dB, norma ≤ ' + RULES.splice.critical + ' dB) - rekomenduojama pervirinti movoje.';
            }
            if (loss > RULES.splice.warn) {
                return 'Padidėjęs suvirinimo nuostolis (' + loss.toFixed(3) + ' dB) - stebėti, pakartotinai matuoti.';
            }
            if (loss < RULES.gain_artifact.threshold) {
                return 'Neigiamas nuostolis ("gainer") - skirtingų tipų/gamintojų skaidulų suvirinimo artefaktas, ne realus pagerėjimas.';
            }
            return 'Suvirinimas normos ribose.';
        }
    }
}

export function classifyEvent(ev, allEvents = null, rangeKm = null) {
    const tStr = ev.typeStr || '';
    const cLow = (ev.comments || '').toLowerCase();
    const isWdmKeyword = RULES.wdm.keywords.some(k => cLow.includes(k));
    // E6 patch: pašalintas nenaudojamas 'noRefl' kintamasis (buvo priskiriamas,
    // bet niekur toliau šioje funkcijoje neskaitomas - negyvas kodas).
    const wdmMax = state.hasWdm ? 25.0 : RULES.wdm.loss_max;
    const wdmMin = state.hasWdm ? 1.5 : RULES.wdm.loss_min;

    const loss = Math.abs(ev.loss);
    const refl = ev.refl || 0;

    // 1) Launch Level (0 km)
    const launchDist = typeof ev.originalDistance === 'number' ? ev.originalDistance : ev.distance;
    if (typeof launchDist === 'number' && launchDist < 0.01) {
        return 'launch';
    }

    // 2) Tikras galas (su kontekstu)
    if (allEvents && rangeKm && isRealEndOfFiber(ev, allEvents, rangeKm)) {
        return 'end';
    }
/*
    // 3) WDM / PON splitter – SUGRIEŽTINTA
    if (loss >= wdmMin && loss <= wdmMax) {
        // Aiškus komentaras – visada WDM
        if (isWdmKeyword) return 'wdm';
        // Tik jei vartotojas patvirtino WDM
        if (state.hasWdm && (refl < -45 || loss > 3.5)) return 'wdm';
        // Kitu atveju – ne WDM, tęsiame
    }
*/
	// 3) WDM / PON splitter – supaprastinat, kai pažymėta WDM varnelė
	if (loss >= wdmMin && loss <= wdmMax) {
    if (isWdmKeyword) return 'wdm';
    if (state.hasWdm) return 'wdm';
	}
	if (loss > 0.5) return 'splice';
	
	

    // 4) Didelis suvirinimo nuostolis (prioritetas prieš atspindį)
    if (loss > 0.5) return 'splice';

    // 5) Neatspindintys įvykiai
    const noReflSignal = refl === 0 || refl < -60;

    // 6) Atspindys – tikri atspindžiai
    if (!noReflSignal && refl >= -65) {
        if (refl < -50 && loss < 0.05) {
            return 'splice';
        }
        return 'refl';
    }

    // 7) Suvirinimas – neatspindintys įvykiai su nuostoliais
    if (noReflSignal && loss >= 0.02) {
        return 'splice';
    }

    // 8) Jei loss ≈ 0, bet ne Launch Level ir ne galas – irgi suvirinimas
    if (noReflSignal && Math.abs(loss) < 0.01 && ev.distance > 0.01) {
        return 'splice';
    }

    // 9) Atsarginis pagal tipą
    if (tStr) {
        if (tStr[1] === 'r' || tStr[1] === 'R' || tStr.toLowerCase().includes('refl')) {
            return 'refl';
        }
        if (tStr.toLowerCase().includes('non-refl') || tStr.toLowerCase().includes('splc')) {
            return 'splice';
        }
    }

    // 10) Mikroskopiniai
    if (loss > 0 && loss < 0.02) {
        return 'event';
    }

    return 'event';
}

// ══════════════════════════════════════════════════════════
//  3. EVENTŲ KONSOLIDAVIMAS (su ghost filtravimu)
// ══════════════════════════════════════════════════════════════

export function consolidateEvents(sors) {
    const tol = RULES.wavelength_comparison.event_distance_tolerance;
    const allEvs = sors.flatMap(s =>
        s.events
            .filter(e => !isArtificial1kmEvent(e))
            // .filter(e => !isGhostEvent(e, s.events, s.range_km)) // laikinai išjungta
            .map(e => ({ ...e, wl: s.wavelength, file: s.file, type: classifyEvent(e, s.events, s.range_km) }))
    );
    allEvs.sort((a, b) => a.distance - b.distance);
    const groups = [];
    for (const ev of allEvs) {
        const grp = groups.find(g => Math.abs(g.dist - ev.distance) < tol);
        if (grp) {
            grp.events.push(ev);
            grp.dist = (grp.dist * grp.events.length + ev.distance) / (grp.events.length + 1);
        } else {
            groups.push({ dist: ev.distance, events: [ev] });
        }
    }
    return groups;
}

// ══════════════════════════════════════════════════════════
//  4. PADIDINTO SLOPINIMO RUOŽU APTIKIMAS (naujas algoritmas)
// ══════════════════════════════════════════════════════════════

/**
 * Automatiškai aptinka dead zone pabaigą iš trace.
 * Dead zone požymiai trace pradžioje:
 *  - Labai staigus nuostolių šuolis (dY/dX >> normos slopinimas)
 *  - Po šuolio trace stabilizuojasi — standartinis slopinimas
 * Grąžina: dead zone pabaigos atstumą km (nuo kurio galima analizuoti).
 */
function _detectDeadZoneEnd(trace, lim, pulseWidthNs, ior) {
    if (!trace || trace.length < 5) return 0.05;

    // 1. Fizinė formulė: c/(2n) km/ns, tada ADZ ≈ 8× EDZ
    const iorVal = ior || 1.4676;
    const c_over_2n_km_per_ns = (299792.458 / (2 * iorVal)) * 1e-9; // ≈ 0.0001021 km/ns
    const eventDeadZone_km = (pulseWidthNs || 0) * c_over_2n_km_per_ns;
    const estimatedDz = Math.max(0.01, eventDeadZone_km * 8);
    const searchLimit = Math.min(estimatedDz + 0.10, 0.40);

    // 2. Dinaminis patikrinimas pagal trace stabilizaciją
    const dzEnd = _findTraceStabilization(trace, lim, searchLimit);
    return Math.max(dzEnd, estimatedDz * 0.8); // saugos nuolaida
}

/**
 * Randa vietą kur trace "nustoja" kilti arba drastiškai svyruoti
 * ir pereina į stabilų slopinimą.
 */
function _findTraceStabilization(trace, lim, maxSearch) {
    const WINDOW_KM  = 0.020; // 20 m langas stabilumui tikrinti
    const STABLE_ATT = lim.max * 3.0;
    const NEED_STABLE = 3;

    let stableCount = 0;
    let lastStableX = 0;

    for (let i = 0; i < trace.length - 1; i++) {
        const p1 = trace[i];
        if (p1.x > maxSearch) break;

        let p2 = null;
        for (let j = i + 1; j < trace.length; j++) {
            if (trace[j].x >= p1.x + WINDOW_KM) { p2 = trace[j]; break; }
        }
        if (!p2) continue;

        const dx  = p2.x - p1.x;
        if (dx < 0.001) continue;
        const att = (p1.y - p2.y) / dx;

        if (att > 0 && att < STABLE_ATT) {
            stableCount++;
            if (stableCount === 1) lastStableX = p1.x;
            if (stableCount >= NEED_STABLE) {
                return Math.max(0.005, lastStableX - 0.010);
            }
        } else {
            stableCount = 0;
        }
    }

    return maxSearch * 0.3;
}

function _findEndDistance(sor) {
    const events = sor.events || [];
    const rangeKm = sor.range_km || 0;
    if (!events.length) return rangeKm * 0.9;
    const last = events[events.length - 1];
    if (Math.abs(last.loss) < 0.01) return last.distance;
    const trace = sor.trace;
    if (trace && trace.length > 10) {
        const noiseFloor = trace.slice(-Math.floor(trace.length * 0.05))
            .reduce((s, p) => s + p.y, 0) / Math.floor(trace.length * 0.05);
        for (let i = trace.length - 1; i >= 0; i--) {
            if (trace[i].y > noiseFloor + 1.0) {
                return Math.min(trace[i].x, rangeKm * 0.95);
            }
        }
    }
    return Math.min(last.distance + 0.2, rangeKm * 0.95);
}

/**
 * Apskaičiuoja guard zonos ilgį (km) pagal impulso plotį, panašiai kaip ADZ.
 * multiplier leidžia skirtingoms eventos rūšims (WDM, refl) taikyti skirtingą dydį.
 */
function _computeGuardKm(pulseWidthNs, ior, multiplier) {
    const iorVal = ior || 1.4676;
    const c_over_2n_km_per_ns = (299792.458 / (2 * iorVal)) * 1e-9; // ≈ 0.0001021 km/ns
    const edz_km = (pulseWidthNs || 0) * c_over_2n_km_per_ns;
    return Math.max(0.02, edz_km * multiplier); // min. 20 m saugos riba
}

function _buildBoundaries(events, endDist, dzEnd, pulseWidthNs, ior) {
    const DZ = dzEnd ?? 0.05;
    const ANALYSIS_START = DZ + 0.010;
    const WDM_GUARD = 0.05; // 50 m po WDM/PON

    // Atspindžio guard zona – pagal impulsą (žemėliau ADZ), stipriems atspindesiams platesnė
    const REFL_GUARD = _computeGuardKm(pulseWidthNs, ior, 10);

    const pts = [];
    pts.push(ANALYSIS_START);

    for (const ev of events) {
        const d = ev.distance;
        // sor.events neturi .type – klasifikuojame čia pat
        const evType = classifyEvent(ev, events, null);

        // WDM/PON eventas – praleidžiame patį tašką, bet atitraukiame ribą 50 m
        if (evType === 'wdm') {
            const guardEnd = d + WDM_GUARD;
            if (guardEnd < endDist && pts[pts.length - 1] + 0.020 < guardEnd) {
                pts.push(guardEnd);
            }
            continue;
        }

        // Stiprus atspindžio eventas – saturacijos pikas gali prasidėti PRIEŠ
        // pažymėtą tašką ir tęstis PO jo, tad guard abipus
        if (evType === 'refl' && (ev.refl || 0) > RULES.reflection.warn) {
            const guardStart = d - REFL_GUARD;
            const guardEnd = d + REFL_GUARD;
            if (guardStart > pts[pts.length - 1] + 0.020) {
                pts.push(guardStart);
            }
            if (guardEnd < endDist && pts[pts.length - 1] + 0.020 < guardEnd) {
                pts.push(guardEnd);
            }
            continue;
        }

        if (d <= ANALYSIS_START + 0.005) continue;
        if (d >= endDist - 0.020) continue;
        if (pts[pts.length - 1] + 0.020 < d) pts.push(d);
    }

    if (pts[pts.length - 1] + 0.020 < endDist) pts.push(endDist);

    return pts;
}

/**
 * Grąžina stipriai reflektuojančių eventų sąrašą su jų guard zonos ribomis,
 * kad būtų galima atfiltruoti segmentus, kritusius į patį piką.
 */
function _getReflGuardZones(events, pulseWidthNs, ior) {
    const REFL_GUARD = _computeGuardKm(pulseWidthNs, ior, 10);
    return events
        .filter(ev => classifyEvent(ev, events, null) === 'refl' && (ev.refl || 0) > RULES.reflection.warn)
        .map(ev => ({ start: ev.distance - REFL_GUARD, end: ev.distance + REFL_GUARD }));
}

/**
 * Pašalina iš trasos taškus, patenkančius į atspindžio guard zonas, kad joks
 * segmentas (net vidinis _measureSegments 0.5 km supjaustymas) negalėtų
 * apskaičiuoti regresijos per patį saturacijos piką.
 */
function _maskReflZones(trace, reflZones) {
    if (!reflZones.length) return trace;
    return trace.filter(p => !reflZones.some(z => p.x >= z.start && p.x <= z.end));
}

function _linearAttenuation(pts) {
    const n = pts.length;
    if (n < 2) return null;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n;
    const my = pts.reduce((s, p) => s + p.y, 0) / n;
    const ss = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    if (ss < 1e-10) return null;
    const sp = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
    const a = sp / ss;
    return Math.abs(a);
}

function _makeCategories(lim) {
    const max = lim.max;
    const T = {
        warn:       max * 1.2,
        high:       max * 1.5,
        critical:   max * 3.0,
        catastrophic: max * 6.0,
    };
    return {
        get(att) {
            if (att >= T.catastrophic) return 'catastrophic';
            if (att >= T.critical)     return 'critical';
            if (att >= T.high)         return 'high';
            if (att >= T.warn)         return 'elevated';
            return 'normal';
        },
        T,
    };
}

function _measureSegments(trace, boundaries, maxSegmentLength = 0.5) {
    const segments = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
        let start = boundaries[i];
        const end = boundaries[i + 1];

        // ── PIRMAM RUOŽUI (start < 0.5) naudojame mažesnius segmentus ──
        let segmentSize = (start < 0.5) ? 0.1 : maxSegmentLength;

        let currentEnd = start;
        while (currentEnd < end) {
            let segEnd = Math.min(currentEnd + segmentSize, end);
            let endPoint = null;
            for (const p of trace) {
                if (p.x >= segEnd) {
                    endPoint = p;
                    break;
                }
            }
            if (!endPoint) break;
            if (endPoint.x - start < 0.03) break;
            const pts = trace.filter(p => p.x >= start && p.x <= endPoint.x);
            if (pts.length < 3) break;
            const att = _linearAttenuation(pts);
            if (att !== null) {
                segments.push({ start, end: endPoint.x, att, pts });
            }
            start = endPoint.x;
            currentEnd = start + segmentSize;
        }
    }
    return segments;
}

function _mergeSegments(rawSegments, lim) {
    if (!rawSegments.length) return [];
    const CAT = _makeCategories(lim);
    const tagged = rawSegments.map(s => ({ ...s, cat: CAT.get(s.att) }));

    const merged = [];
    let current = { ...tagged[0] };

    for (let i = 1; i < tagged.length; i++) {
        const next = tagged[i];
        const gap = next.start - current.end;
        const lossDiff = Math.abs(current.att - next.att);

        const sameCategory = current.cat === next.cat;
        // SVARBI PATAISA: anksčiau čia buvo GRIEŽTAI ABSOLIUTUS 0.05 dB/km
        // slenkstis, nepriklausomai nuo pačių reikšmių dydžio. Tai prasminga
        // ties ~0.3-0.4 dB/km (arti normos), bet visiškai per griežta, kai
        // reikšmės jau ~0.7-1.2 dB/km diapazone - ten 0.05 dB/km yra vos ~5%
        // skirtumas, bet ilgą, palaipsniui banguojantį degradavusios linijos
        // ruožą (visą tos pačios kategorijos) suskaidydavo į daugybę beveik
        // identiškų atskirų pranešimų (pvz. 0.71 vs 0.76 dB/km NESUSIJUNGDAVO).
        // Dabar tolerancija SANTYKINĖ - 15% arba 0.05 dB/km, kas didesnis.
        const lossSimilar = lossDiff < Math.max(0.05, current.att * 0.15);

        const bothCritical = (current.cat === 'critical' || current.cat === 'catastrophic') &&
                             (next.cat === 'critical' || next.cat === 'catastrophic');
        const normalBridge = bothCritical && gap <= 0.005;

        if ((sameCategory && lossSimilar) || normalBridge) {
            const allPts = [...(current.pts || []), ...(next.pts || [])];
            const att = _linearAttenuation(allPts) ?? Math.max(current.att, next.att);
            current = {
                start: current.start,
                end: next.end,
                att,
                pts: allPts,
                cat: CAT.get(att),
            };
        } else {
            merged.push(current);
            current = { ...next };
        }
    }
    merged.push(current);

    return merged.filter(s => s.cat !== 'normal');
}

function _segmentsToDiagsFixed(segments, lim, wl, dzEnd) {
    const CAT = _makeCategories(lim);
    const diags = [];
    const DZ = dzEnd ?? 0.05;

    for (const seg of segments) {
        const { start, end, att, cat } = seg;

        // ── PRALEIDŽIAME TIK TIKRĄ DEAD ZONE (iki dzEnd) ──
        if (end <= DZ) continue;

        // ── JEI SEGMENTAS PRASIDEDA ARTU DZ, BET TĘSIASI TOLLIAU – KOREKCIJA ──
        let effectiveStart = Math.max(start, DZ);
        // Jei segmentas prasideda DZ viduje, apkarpome jį
        if (effectiveStart < DZ + 0.005) {
            effectiveStart = DZ + 0.005;
        }
        if (effectiveStart >= end - 0.010) continue;

        const loc = effectiveStart.toFixed(3) + '–' + end.toFixed(3) + ' km';

        // ── Jei šis ruožas yra po dead zone, bet dar nestabilus – praleidžiame ──
        // Tikriname, ar att yra artimas normai (≤ 1.5× normos) – jei taip, tai ne problema
        if (cat === 'elevated' && (end - effectiveStart) < 0.2) {
            // Trumpas elevated ruožas iškart po dead zone – tikriausiai likutinis artefaktas
            continue;
        }

        // ... toliau normali logika ...
        let sev, catLabel, msg, rec, weight = 1;
        switch (cat) {
            case 'catastrophic':
                sev = 'critical';
                catLabel = '💀 Kritinis pažeidimas';
                msg = 'Ruože ' + loc + ' slopinimas ' + att.toFixed(2) + ' dB/km — ' +
                      (att / lim.max).toFixed(1) + '× viršija normą (' + lim.max + ' dB/km prie ' + wl + ' nm). ' +
                      'Tikėtinas mechaninis kabelio pažeidimas, įtempimas arba lūžis.';
                rec = 'Nedelsiant patikrinti kabelio trasą ruože ' + loc + '. Ieškoti fizinio pažeidimo.';
                break;
            case 'critical':
                sev = 'critical';
                catLabel = 'Didelis slopinimas';
                msg = 'Ruože ' + loc + ' slopinimas ' + att.toFixed(3) + ' dB/km (' +
                      (att / lim.max).toFixed(1) + '× norma, ' + lim.max + ' dB/km prie ' + wl + ' nm). ' +
                      'Tikėtinas stiprus lenkimas, įtempimas arba žema temperatūra.';
                rec = 'Patikrinti movas ir kabelio tiesimo vietą ruože ' + loc +
                      '. Jei žiema — palaukti atšilimo ir pakartoti.';
                break;
            case 'high':
                sev = 'warning';
                catLabel = 'Padidėjęs slopinimas';
                msg = 'Ruože ' + loc + ' slopinimas ' + att.toFixed(3) + ' dB/km viršija normą ' +
                      lim.max + ' dB/km (prie ' + wl + ' nm). Galimas lenkimas arba spaudimas.';
                rec = 'Patikrinti movas ruože ' + loc + '. Jei kartojasi — patikrinti kabelio eigą.';
                weight = 0.75; // "high" - virš 1.5x normos, bet dar ne kritinė riba
                break;
            case 'elevated':
            default:
                sev = 'warning';
                catLabel = 'Šiek tiek padidėjęs slopinimas';
                msg = 'Ruože ' + loc + ' slopinimas ' + att.toFixed(3) + ' dB/km artimas normos ribai ' +
                      lim.max + ' dB/km (prie ' + wl + ' nm). Stebėti dinamiką.';
                rec = 'Pakartoti matavimą po 3–6 mėnesių. Jei blogėja — patikrinti kabelio eigą.';
                weight = 0.4; // "elevated" - tik 1.2-1.5x normos, ribinė situacija, ne rimtas defektas
                break;
        }

        diags.push({
            sev,
            category: catLabel + ' @ ' + loc,
            msg,
            rec,
            weight,
            _class: 'segment',
            _start: effectiveStart,
            _end: end,
            _att: att,
        });
    }

    return diags;
}

function analyzeSegmentAttenuation(sor) {
    const trace = sor.trace;
    const events = (sor.events || []).slice().sort((a, b) => a.distance - b.distance);
    const wl = getClosestStandardWavelength(sor.wavelength);
    const lim = RULES.attenuation[wl] || RULES.attenuation.default;

    if (!trace || trace.length < 10) return [];

    const pulseNs = sor.pulse_width || null;
    const ior = sor.ior || 1.4676;
    // Naudojame TĄ PAČIĄ artefakto ribos reikšmę kaip ir vidutinio slopinimo
    // skaičiavime (parser.js) - kad segmentų diagnostika ir pranešimas sutaptų.
    // Jei sor objektas senesnis (be launch_artifact_m), skaičiuojame iš naujo.
    const dzEnd = (typeof sor.launch_artifact_m === 'number' && sor.launch_artifact_m > 0)
        ? sor.launch_artifact_m / 1000
        : _detectDeadZoneEnd(trace, lim, pulseNs, ior);

    const endDist = _findEndDistance(sor);
    // SVARBI PATAISA: jei parser.js jau nustatė, kad duomenys nepatikimi
    // nuo tam tikro atstumo (prietaisas pats "pasidavė" dėl rimto
    // pažeidimo - žr. sor.unreliable_from_km), segmentų analizė NETURI
    // tęstis už šio taško. Be šios patikros, slankiojo lango algoritmas
    // generuodavo daugybę klaidingų "kritinių pažeidimų" pranešimų per
    // triukšmingą/nepatikimą trasos dalį, kurioje jokia prasminga
    // diagnostika iš viso negalima.
    const clampedEndDist = (typeof sor.unreliable_from_km === 'number')
        ? Math.min(endDist, sor.unreliable_from_km)
        : endDist;
    const boundaries = _buildBoundaries(events, clampedEndDist, dzEnd, pulseNs, ior);

    if (boundaries.length < 2) return [];

    // Pirmam ruožui (0–0.5) naudojame 0.1 km segmentus
    const reflZones = _getReflGuardZones(events, pulseNs, ior);
    const maskedTrace = _maskReflZones(trace, reflZones);
    const rawSegments = _measureSegments(maskedTrace, boundaries, 0.5);
    const merged = _mergeSegments(rawSegments, lim);

    return _segmentsToDiagsFixed(merged, lim, wl, dzEnd);
}

// ══════════════════════════════════════════════════════════════
//  5. VIENO SOR FAILO DIAGNOSTIKA
// ══════════════════════════════════════════════════════════════

export function diagnoseSingle(sor) {
    const diags = [];
    const wl = getClosestStandardWavelength(sor.wavelength);
    const att = sor.avg_attenuation;
    const lim = RULES.attenuation[wl] || RULES.attenuation.default;

    // ── -1. Triukšmo zonos aptikimas (jei parser.js jos dar nenustatė) ──
    // sor.unreliable_from_km yra rašomas žemiau (0c) esančios logikos ir
    // analyzeSegmentAttenuation() segmentų apkarpymo, BET iki šiol niekas jo
    // faktiškai NESTATYDAVO - komentaruose minima parser.js logika
    // (lastEventIsDeviceEnd/lastEventLossAnomalous) neegzistuoja, todėl laukas
    // visada likdavo undefined ir segmentų analizė tęsdavosi net per gryną
    // triukšmą už trasos "galo" (žr. detectNoiseOnset() advanced-diagnostics.js,
    // kuri šitą tašką patikimai randa, bet anksčiau buvo naudojama TIK
    // atskiram informaciniam pranešimui, ne segmentų apkarpymui). ──
    if (typeof sor.unreliable_from_km !== 'number') {
        const onset = detectNoiseOnset(sor);
        if (onset) sor.unreliable_from_km = onset.x;
    }

    // ── 0. OTDR prijungimo (launch) artefakto pranešimas ──
    // Jei aptiktas artefaktas (soties atsigavimo šleifas po paleidimo jungties)
    // ilgesnis nei 20 m, informuojame vartotoją - ši zona NEVERTINAMA nei
    // vidutinio slopinimo skaičiavime, nei segmentų defektų paieškoje.
    const artifactM = sor.launch_artifact_m || 0;
    if (artifactM > 20) {
        diags.push({
            sev: 'info',
            category: 'OTDR prijungimo artefaktas',
            msg: 'OTDR prijungimo artefaktas 0–' + artifactM + ' m. nevertinamas. Matavimui naudokite dirbtinę liniją.',
            rec: 'Naudokite pulso slopinimo (launch) kabelį prieš matuojamą liniją - taip pradinėr zona bus tiksliai išmatuota.'
        });
    }

    // ── 0b. "total_loss" (bendras nuostolis) apimties patikra ──
    // Gamintojo (OTDR įrenginio) ypatybė: kai kurie prietaisai savo VIDINĖJE
    // total_loss/ORL suvestinėje "linijos galu" laiko paskutinį jų PAČIŲ
    // automatiškai aptiktą 'E' tipo (End of fiber) įvykį - net jei tai buvo
    // sukelta rimto pažeidimo VIDURYJE linijos, o ne tikrojo fizinio galo.
    // SVARBU: lyginame NE su range_km (trasoje visada yra harmless triukšmo
    // "uodega" po paskutinio įvykio - tai normalu KIEKVIENAME SOR faile),
    // o su PASKUTINIO faktiškai užregistruoto KeyEvent atstumu. Jei
    // total_loss_end_km sutampa su paskutiniu įvykiu - viskas tvarkoje
    // (normalu). Jei total_loss sustoja PRIEŠ paskutinį įvykį - tai reiškia,
    // kad prietaiso suvestinė "pasidavė" anksčiau nei jo paties paskutinis
    // aptiktas įvykis - tikras anomalijos požymis (patvirtinta su det_1_port4.sor).
    if (typeof sor.total_loss_end_km === 'number' && sor.events && sor.events.length) {
        const lastEventDist = Math.max(...sor.events.map(e => e.distance));
        const gapKm = lastEventDist - sor.total_loss_end_km;
        if (lastEventDist > 0 && gapKm > 0.5 && (sor.total_loss_end_km / lastEventDist) < 0.95) {
            diags.push({
                sev: 'critical',
                category: '⚠️ Bendras nuostolis NEAPIMA visos linijos',
                msg: 'OTDR prietaisas paskaičiavo bendrą nuostolį (' + sor.total_loss.toFixed(3) + ' dB) tik iki ' + sor.total_loss_end_km.toFixed(3) + ' km - NE iki paskutinio jo paties užregistruoto įvykio (' + lastEventDist.toFixed(3) + ' km). Tikėtina, kad prietaisas savo vidinėje analizėje ties ' + sor.total_loss_end_km.toFixed(3) + ' km rastą pažeidimą palaikė linijos galu. Šis skaičius NEATSPINDI viso kabelio nuostolio.',
                rec: 'Nepasitikėti šiuo total_loss skaičiumi kaip visos linijos rodikliu. Patikrinti ruožą apie ' + sor.total_loss_end_km.toFixed(3) + ' km - tikėtinas rimtas pažeidimas, dėl kurio prietaisas nustojo skaičiuoti toliau.'
            });
        }
    }

    // ── 0c. Duomenys nepatikimi nuo tam tikro atstumo (prietaisas "pasidavė"
    // dėl rimto pažeidimo, ne dėl normalaus linijos galo) ──
    // Skiriasi nuo 0b: čia sor.unreliable_from_km jau nustatytas PAČIAME
    // parser.js (žr. lastEventIsDeviceEnd + lastEventLossAnomalous), todėl
    // MES PATYS jau nustojome skaičiuoti avg_attenuation/total_loss_calculated
    // už šio taško - šis pranešimas tiesiog paaiškina vartotojui KODĖL ir KĄ
    // daryti toliau.
    if (typeof sor.unreliable_from_km === 'number') {
        const badKm = sor.unreliable_from_km;
        const badEvent = (sor.events || []).find(e => Math.abs(e.distance - badKm) < 0.001) || null;
        const nearStart = badKm < 1.0;
        const lossStr = badEvent && typeof badEvent.loss === 'number' ? Math.abs(badEvent.loss).toFixed(2) + ' dB' : '';
        diags.push({
            sev: 'critical',
            category: '📵 Duomenys nepatikimi nuo ' + badKm.toFixed(3) + ' km',
            msg: 'Nuo ' + badKm.toFixed(3) + ' km prasideda triukšmas/nepatikimi duomenys — prietaisas pats nutraukė analizę šioje vietoje' + (lossStr ? ' (rastas ' + lossStr + ' nuostolis)' : '') + '. Tolimesnė trasos analizė (slopinimas, segmentai) negalima ir NEBUVO atlikta.',
            rec: nearStart
                ? 'Pašalinkite arba pataisykite didelį nuostolį ties ' + badKm.toFixed(3) + ' km (nešvari/pažeista jungtis, blogas suvirinimas) ir išmatuokite iš naujo.'
                : 'Pakartokite matavimą su ilgesniu impulsu (didesnis dinaminis diapazonas), kad OTDR "matytų" toliau už šio taško.'
        });
    }

    // ── 1. Bendras slopinimas ──
    // Kai sor.unreliable_from_km nustatytas, avg_attenuation lieka 0 ne todėl,
    // kad slopinimas realiai nulinis, o todėl, kad jo NEPAVYKO patikimai
    // apskaičiuoti (žr. 0c pranešimą aukščiau) - praleidžiame šį bloką, kad
    // neklaidintume vartotojo "atitinka normą" pranešimu.
    if (typeof sor.unreliable_from_km === 'number') {
        // 0c pranešimas jau paaiškino situaciją - papildomo nereikia.
    } else if (att > lim.max * 1.5) {
        diags.push({
            sev: 'critical',
            category: t('diag_attenuation'),
            msg: t('diag_attenuation_critical', { att: att.toFixed(3), max: lim.max, wl: formatWavelength(sor.wavelength) }),
            rec: t('rec_check_splices')
        });
    } else if (att > lim.max) {
        diags.push({
            sev: 'warning',
            category: t('diag_attenuation'),
            msg: t('diag_attenuation_warning', { att: att.toFixed(3), max: lim.max, wl: formatWavelength(sor.wavelength) }),
            rec: t('rec_check_splices_detail')
        });
    } else {
        // Geras slopinimas – informacinis pranešimas
        diags.push({
            sev: 'info',
            category: t('diag_attenuation'),
            msg: 'Vidutinis slopinimas: ' + att.toFixed(3) + ' dB/km prie ' + formatWavelength(sor.wavelength) + ' nm. (Norma: ≤ ' + lim.max + ' dB/km)',
            rec: 'Vidutinis slopinimas atitinka normą.'
        });
    }

    // ── 2. ORL ──
    const orl = sor.orl || 0;
    if (orl > 0 && orl < RULES.orl.critical) {
        // Kuo ORL arčiau kritinės ribos (ne toli už jos), tuo mažesnis baudos
        // svoris - ribinis atvejis (pvz. 1-2 dB už ribos) nėra tokia rimta
        // problema, kaip stipriai už ribos (pvz. 10+ dB už).
        const weight = Math.max(0.5, Math.min(1.0, (RULES.orl.critical - orl) / 5));
        diags.push({
            sev: 'critical',
            category: t('diag_orl') + ' ' + formatWavelength(sor.wavelength) + 'nm',
            msg: t('diag_orl_critical', { orl: orl.toFixed(2), critical: RULES.orl.critical }),
            rec: t('rec_check_connectors'),
            weight
        });
    } else if (orl > 0 && orl < RULES.orl.warn) {
        const weight = Math.max(0.3, Math.min(0.7, (RULES.orl.warn - orl) / 5));
        diags.push({
            sev: 'warning',
            category: t('diag_orl') + ' ' + formatWavelength(sor.wavelength) + 'nm',
            msg: t('diag_orl_warning', { orl: orl.toFixed(2), warn: RULES.orl.warn }),
            rec: t('rec_clean_connectors'),
            weight
        });
    }

    // ── 3. Padidinto slopinimo ruožai (naujas algoritmas) ──
    const slidingDiags = analyzeSegmentAttenuation(sor);
    diags.push(...slidingDiags);

    // ── 3b. Galimai per mažas matavimo Range ──
    // Kai paskutinis aptiktas įvykis yra arti pat Range ribos (ta pati 0.85
    // riba, kaip measurement-quality.js rangeMarginCheck), bet kokie "kritiniai"
    // slopinimo pranešimai trasos gale gali būti ne realus pažeidimas, o vien
    // OTDR dinaminio diapazono pabaiga - dažna praktika, kai operatorius
    // SĄMONINGAI sumažina Range už tikro linijos ilgio, norėdamas geriau
    // įžiūrėti trasos pradžią (patvirtinta realiais atvejais). Praleidžiame,
    // jei sor.unreliable_from_km jau nustatytas (0c pranešimas aukščiau jau
    // paaiškino situaciją tiksliau - nereikia dubliuoti). ──
    if (typeof sor.unreliable_from_km !== 'number' && sor.range_km > 0 && sor.events && sor.events.length) {
        const lastEv = sor.events.reduce((a, b) => a.distance > b.distance ? a : b);
        const rangeRatio = lastEv.distance / sor.range_km;
        if (rangeRatio > 0.85) {
            diags.push({
                sev: 'warning',
                category: '📏 Galimai per mažas matavimo Range',
                msg: 'Paskutinis aptiktas įvykis (' + lastEv.distance.toFixed(2) + ' km) sudaro ' + (rangeRatio * 100).toFixed(0) +
                    '% viso nustatyto Range (' + sor.range_km.toFixed(1) + ' km). Bet kokie "kritiniai" slopinimo pranešimai šioje trasos dalyje gali būti ne realus kabelio pažeidimas, o tai, kad nustatytas Range yra mažesnis arba tik nedaug didesnis už tikrą skaidulos ilgį - dinaminis diapazonas tiesiog "baigiasi" pačioje pabaigoje.',
                rec: 'Jei norite patikrinti visą liniją iki galo, pakartokite matavimą nustatę Range apie 2× didesnį nei numatomas linijos ilgis. Jei Range buvo sumažintas sąmoningai (geresnei pradžios rezoliucijai), šis pranešimas gali būti nereikšmingas.'
            });
        }
    }

    // ── 4. EventŲ apdorojimas ──
    for (const ev of sor.events) {
        // Launch Level – praleidžiame diagnostiką
        if (ev.distance < 0.001) continue;

        // 1 km dirbtinėr linija – praleidžiame
        if (isArtificial1kmEvent(ev)) {
            continue;
        }

        // Ghost'ai – praleidžiame
        if (isGhostEvent(ev, sor.events, sor.range_km)) {
            continue;
        }

        const d = ev.distance,
            loss = ev.loss,
            refl = ev.refl;
        const type = classifyEvent(ev, sor.events, sor.range_km);

        // Tikras linijos galas – informacinis
        if (type === 'end') {
            const endInfo = describeEndOfFiber(refl);
            diags.push({
                sev: 'info',
                category: endInfo.label + ' @ ' + d.toFixed(3) + ' ' + t('unit_km'),
                msg: endInfo.detail + ' (Atstumas: ' + d.toFixed(3) + ' km, atspindys: ' + refl.toFixed(1) + ' dB.)',
                rec: 'Jei tai neplanuotas galas – patikrinti movą arba ODF.'
            });
            continue;
        }

        // WDM / PON splitter
        if (type === 'wdm') {
            const ponR = RULES.diagnostics.pon_splitter;
            let splLabel = '';
            for (const [ratio, cfg] of Object.entries(ponR.ratios)) {
                if (Math.abs(loss - cfg.loss) <= cfg.tol) {
                    splLabel = ' (' + t('diag_pon') + ' ' + ratio + ')';
                    break;
                }
            }
            diags.push({
                sev: 'info',
                category: (splLabel ? t('diag_pon') : t('diag_wdm')) + ' @ ' + d.toFixed(3) + ' ' + t('unit_km'),
                msg: t('diag_wdm_info', { loss: loss.toFixed(2), dist: d.toFixed(3), splLabel: splLabel }),
                rec: t('rec_check_docs')
            });
            continue;
        }

        // Atspindžiai
        if (type === 'refl' && Math.abs(refl) > 0.1) {
            if (refl > RULES.reflection.critical) {
                diags.push({
                    sev: 'critical',
                    category: t('diag_reflection') + ' @ ' + d.toFixed(3) + ' ' + t('unit_km'),
                    msg: t('diag_refl_critical', { refl: refl.toFixed(1), dist: d.toFixed(3) }),
                    rec: 'Nuvalyti jungtį. Patikrinti mikroskopu.'
                });
            } else if (refl > RULES.reflection.warn) {
                diags.push({
                    sev: 'warning',
                    category: t('diag_reflection') + ' @ ' + d.toFixed(3) + ' ' + t('unit_km'),
                    msg: t('diag_refl_warning', { refl: refl.toFixed(1), dist: d.toFixed(3) }),
                    rec: 'Nuvalyti jungtį. Patikrinti mikroskopu.'
                });
            }
            // Galimas nutrū�imas – tik paskutiniame evente
            const maxDist = Math.max(...sor.events.map(e => e.distance));
            if (Math.abs(d - maxDist) < 0.001 && refl > RULES.diagnostics.fiber_break.reflectance_threshold && loss > 0.5) {
                diags.push({
                    sev: 'critical',
                    category: t('diag_fiber_break') + ' @ ' + d.toFixed(3) + ' ' + t('unit_km'),
                    msg: t('diag_break_critical', { diagnosis: t('diag_fiber_break'), dist: d.toFixed(3), refl: refl.toFixed(1) }),
                    rec: t('rec_break')
                });
            }
        }

        // Suvirinimai
        if (type === 'splice') {
            if (loss > RULES.splice.critical) {
                diags.push({
                    sev: 'critical',
                    category: t('diag_splice') + ' @ ' + d.toFixed(3) + ' ' + t('unit_km'),
                    msg: t('diag_splice_critical', { loss: loss.toFixed(3), dist: d.toFixed(3), critical: RULES.splice.critical }),
                    rec: t('rec_reroute')
                });
            } else if (loss > RULES.splice.warn) {
                diags.push({
                    sev: 'warning',
                    category: t('diag_splice') + ' @ ' + d.toFixed(3) + ' ' + t('unit_km'),
                    msg: t('diag_splice_warning', { loss: loss.toFixed(3), dist: d.toFixed(3) }),
                    rec: t('rec_monitor')
                });
            }
        }

        // Gainer artefaktas
        if (loss < RULES.gain_artifact.threshold) {
            diags.push({
                sev: 'info',
                category: t('diag_gainer') + ' @ ' + d.toFixed(3) + ' ' + t('unit_km'),
                msg: t('diag_gainer_info', { loss: loss.toFixed(3) }),
                rec: t('rec_bidirectional')
            });
        }
    }

    // ── 5. Jei nėra jokkiu diagnostiko pranešimŲ ──
    if (!diags.length) {
        diags.push({
            sev: 'info',
            category: t('diag_general_ok'),
            msg: t('diag_general_ok'),
            rec: t('rec_none')
        });
    }

    return diags;
}

// ══════════════════════════════════════════════════════════════
//  6. KELIŲ BANGŲ ILGŲ PALYGINIMAS
// ══════════════════════════════════════════════════════════

export function diagnoseCrossWl(byWl) {
    const diags = [];
    const keys = Object.keys(byWl).map(Number);
    if (keys.length < 2) return diags;

    function findWavelength(standard) {
        let closest = null;
        let minDiff = Infinity;
        for (const k of keys) {
            const diff = Math.abs(k - standard);
            if (diff < minDiff) {
                minDiff = diff;
                closest = k;
            }
        }
        return minDiff < 15 ? closest : null;
    }

    const wl1310 = findWavelength(1310);
    const wl1550 = findWavelength(1550);
    const wl1625 = findWavelength(1625);
    const wl1650 = findWavelength(1650);

    const att = {};
    keys.forEach(wl => att[wl] = byWl[wl].avg_attenuation);
    const cmp = RULES.wavelength_comparison;

    // 1310 vs 1550
    if (wl1310 !== null && wl1550 !== null && att[wl1310] != null && att[wl1550] != null) {
        const diff = att[wl1550] - att[wl1310];
        if (diff > cmp.loss_1550_vs_1310.critical_diff) {
            diags.push({
                sev: 'critical',
                category: '💀 ' + t('diag_macrobend') + ' (' + t('diag_scope_cross_wl') + ')',
                msg: t('diag_macrobend_critical', { att1550: att[wl1550].toFixed(3), att1310: att[wl1310].toFixed(3), diff: diff.toFixed(3) }),
                rec: t('rec_bend'),
                edu: 'bend'
            });
        } else if (diff > cmp.loss_1550_vs_1310.warn_diff) {
            diags.push({
                sev: 'warning',
                category: t('diag_macrobend') + ' (' + t('diag_scope_cross_wl') + ')',
                msg: t('diag_macrobend_warning', { att1550: att[wl1550].toFixed(3), att1310: att[wl1310].toFixed(3), diff: diff.toFixed(3) }),
                rec: t('rec_monitor'),
                edu: 'bend'
            });
        }
    }

    // Makrolenkimo taškai
    if (wl1310 !== null && wl1550 !== null) {
        const evs1310 = byWl[wl1310].events;
        const evs1550 = byWl[wl1550].events;
        // OTDR prijungimo artefakto zona (žr. diagnoseSingle 0. patikrą) - šioje
        // zonoje nuostolio duomenys nepatikimi abiem bangos ilgiams, todėl ji
        // NEVERTINAMA jokioje diagnostikoje. Imame didesnę iš dviejų bangų zonų,
        // kad neliktų tarpo, kur viena banga jau "švari", o kita dar artefakte.
        const dzEndKm = Math.max(
            (byWl[wl1310].launch_artifact_m || 0) / 1000,
            (byWl[wl1550].launch_artifact_m || 0) / 1000
        );

        for (const ev1550 of evs1550) {
            if (ev1550.distance < dzEndKm) continue;
            if (Math.abs(ev1550.loss) < cmp.event_loss_threshold) continue;
            const ev1310 = evs1310.find(e => Math.abs(e.distance - ev1550.distance) < cmp.event_distance_tolerance);
            const loss1310 = ev1310 ? Math.abs(ev1310.loss) : 0;
            const loss1550 = Math.abs(ev1550.loss);
            const ratio = loss1310 > 0.01 ? loss1550 / loss1310 : 99;

            if (!ev1310 || loss1310 < 0.05) {
                diags.push({
                    sev: 'critical',
                    category: '💀 ' + t('diag_macrobend') + ' @ ' + ev1550.distance.toFixed(3) + ' ' + t('unit_km'),
                    msg: t('diag_macrobend_point_critical', { loss: loss1550.toFixed(3), dist: ev1550.distance.toFixed(3) }),
                    rec: t('rec_bend_point', { dist: ev1550.distance.toFixed(3) }),
                    edu: 'bend_point'
                });
            } else if (ratio > cmp.event_ratio_threshold && loss1550 > 1.5) {
                // Jei > 1.5 dB – critical su kaukole
                diags.push({
                    sev: 'critical',
                    category: '💀 ' + t('diag_macrobend') + ' @ ' + ev1550.distance.toFixed(3) + ' ' + t('unit_km'),
                    msg: t('diag_macrobend_point_warning', { loss1550: loss1550.toFixed(3), ratio: ratio.toFixed(1), loss1310: loss1310.toFixed(3), dist: ev1550.distance.toFixed(3) }),
                    rec: t('rec_bend_point', { dist: ev1550.distance.toFixed(3) }),
                    edu: 'bend_point'
                });
            } else if (ratio > cmp.event_ratio_threshold && loss1550 > 0.3) {
                diags.push({
                    sev: 'warning',
                    category: t('diag_macrobend') + ' @ ' + ev1550.distance.toFixed(3) + ' ' + t('unit_km'),
                    msg: t('diag_macrobend_point_warning', { loss1550: loss1550.toFixed(3), ratio: ratio.toFixed(1), loss1310: loss1310.toFixed(3), dist: ev1550.distance.toFixed(3) }),
                    rec: t('rec_bend_point', { dist: ev1550.distance.toFixed(3) }),
                    edu: 'bend_point'
                });
            }
        }
    }

    // 1310 vs 1625
    if (wl1310 !== null && wl1625 !== null && att[wl1310] != null && att[wl1625] != null) {
        const diff = att[wl1625] - att[wl1310];
        if (diff > 0.05) {
            diags.push({
                sev: 'warning',
                category: t('diag_macrobend') + ' (1310 vs 1625)',
                msg: '1625 nm slopinimas (' + att[wl1625].toFixed(3) + ') didesnis nei 1310 nm (' + att[wl1310].toFixed(3) + ') per ' + diff.toFixed(3) + ' dB/km – galimas lenkimas.',
                rec: t('rec_microbend'),
                edu: 'bend'
            });
        }
    }

    // 1310 vs 1650
    if (wl1310 !== null && wl1650 !== null && att[wl1310] != null && att[wl1650] != null) {
        const diff = att[wl1650] - att[wl1310];
        if (diff > 0.05) {
            diags.push({
                sev: 'warning',
                category: t('diag_macrobend') + ' (1310 vs 1650)',
                msg: '1650 nm slopinimas (' + att[wl1650].toFixed(3) + ') didesnis nei 1310 nm (' + att[wl1310].toFixed(3) + ') per ' + diff.toFixed(3) + ' dB/km – galimas lenkimas.',
                rec: t('rec_microbend'),
                edu: 'bend'
            });
        }
    }

    // Vandens smailė (1383 nm)
    // Vandens smailė (1383 nm) – IEC 60793-2-50 patch: tikrasis LWP (low
    // water peak) pluošto reikalavimas yra SANTYKINIS, ne absoliutus –
    // Δα(1383 vs 1310) ≤ 0.03 dB/km, ne santykis su 1310/1550 vidurkiu.
    // Ankstesnis metodas (santykis su vidurkiu) buvo architektūrinis
    // supaprastinimas; šis tiksliau atitinka standartą.
    const wl1383 = findWavelength(1383);
    if (wl1383 !== null && wl1310 !== null && att[wl1383] != null && att[wl1310] != null) {
        const waterDiff = att[wl1383] - att[wl1310];
        if (waterDiff > cmp.water_peak_max_diff) {
            diags.push({
                sev: 'critical',
                category: t('diag_water_peak'),
                msg: t('diag_water_peak_critical', { att1383: att[wl1383].toFixed(3), att1310: att[wl1310].toFixed(3), diff: waterDiff.toFixed(3) }),
                rec: t('rec_water_peak'),
                edu: 'water'
            });
        }
    }

    // 1625 vs 1550
    if (wl1625 !== null && wl1550 !== null && att[wl1625] != null && att[wl1550] != null) {
        const diff = att[wl1625] - att[wl1550];
        if (diff > cmp.loss_1625_vs_1550.warn_diff) {
            diags.push({
                sev: 'warning',
                category: t('diag_1625'),
                msg: t('diag_1625_warning', { att1625: att[wl1625].toFixed(3), att1550: att[wl1550].toFixed(3), diff: diff.toFixed(3) }),
                rec: t('rec_microbend'),
                edu: 'bend'
            });
        }
    }

    return diags;
}

// ══════════════════════════════════════════════════════════════
//  7. KOKYBĖS BALAS
// ══════════════════════════════════════════════════════════════

export function calcQuality(diags) {
    let score = 100;
    for (const d of diags) {
        const base = RULES.quality_score.deductions[d.sev] || 0;
        // Svoris (weight) leidžia ribinėms/nedidelėms problemoms atimti mažiau
        // taškų nei toms pačios kategorijos, bet realiai rimtoms. Numatytasis
        // svoris = 1 (pilnas atskaitymas), jei diagnostika jo neurodo.
        const weight = (typeof d.weight === 'number') ? d.weight : 1;
        score -= base * weight;
    }
    score = Math.max(0, score);
    const grade = RULES.quality_score.grades.find(g => score >= g.min);
    return { score, grade };
}

// ══════════════════════════════════════════════════════════════
//  8. DIAGNOSTIKA VISIEMS SOR FAILAMS
// ══════════════════════════════════════════════════════════════

// E4 patch: iš failo vardo pašalina bangos ilgio žymą gale (pvz. "_1310",
// "-1550nm", " 1625 nm", arba EXFO stiliaus "131.0"), kad liktų tik linijos/
// kabelio vardo šaknis. Naudojama grupavimui - be šito, kelios skirtingos
// linijos su tuo pačiu bangos ilgiu tame pačiame kataloge susilieja į vieną
// grupę (žr. diagnoseAll patch žemiau).
export function stripWavelengthSuffix(filename) {
    let base = (filename || '').replace(/\.[a-zA-Z0-9]+$/, ''); // nuimame plėtinį
    base = base.replace(/[\s_\-]*1[0-9]{2,3}(\.[0-9]+)?(\s*nm)?$/i, ''); // nuimame bangos ilgio žymą gale
    return base.trim() || filename || '';
}

export function diagnoseAll(sors) {
    const correctedSors = apply1kmCorrection(sors);

    const groups = {};
    const groupLabels = {};
    correctedSors.forEach(s => {
        let dir = s.path.split('/').slice(0, -1).join('/') || 'failai';
        if (dir === '__picked__' || dir === '_picked_') dir = t('diag_group_default');
        // E4 patch: raktas dabar apima IR failo vardo šaknį (be bangos ilgio
        // žymos), ne vien katalogą - kitaip groups[dir][s.wavelength] = s
        // perrašydavo vienodus bangos ilgius skirtingoms linijoms tame
        // pačiame kataloge (pvz. Paobelys_1310 dingdavo po Zapranai_1310),
        // o kelių bangų palyginimas tada lygindavo skirtingų linijų eventus
        // tarpusavyje ir generuodavo klaidingus makrolenkimo pranešimus.
        const fileRoot = stripWavelengthSuffix(s.file);
        const groupKey = dir + ' :: ' + fileRoot;
        if (!groups[groupKey]) {
            groups[groupKey] = {};
            groupLabels[groupKey] = fileRoot || dir;
        }
        groups[groupKey][s.wavelength] = s;
    });

    return Object.entries(groups).map(([groupKey, byWl]) => {
        const group = groupLabels[groupKey];
        const crossWl = diagnoseCrossWl(byWl);
        const perFile = Object.fromEntries(
            Object.entries(byWl).map(([wl, s]) => [wl, diagnoseSingle(s)])
        );
        // Tikri failų vardai pagal bangos ilgį – naudojama eksporte (PDF/Excel),
        // kad "Failas" stulpelyje būtų realus failo vardas, o ne grupės numatytoji reikšmė
        const files = Object.fromEntries(
            Object.entries(byWl).map(([wl, s]) => [wl, s.file])
        );
        const allD = [...crossWl, ...Object.values(perFile).flat()];
        const { score, grade } = calcQuality(allD);
        return { group, wavelengths: Object.keys(byWl).map(Number).sort(), cross_wl: crossWl, per_file: perFile, files, score, grade };
    });
}

// ──────────────────────────────────────────────────────────────
//  PAPILDOMA: getSegmentOverlayData (vizualizacijai)
// ──────────────────────────────────────────────────────────────

export function getSegmentOverlayData(sor) {
    const wl = getClosestStandardWavelength(sor.wavelength);
    const lim = RULES.attenuation[wl] || RULES.attenuation.default;
    const CAT = _makeCategories(lim);
    const pulseNs = sor.pulse_width || null;
    const ior = sor.ior || 1.4676;
    const dzEnd = (typeof sor.launch_artifact_m === 'number' && sor.launch_artifact_m > 0)
        ? sor.launch_artifact_m / 1000
        : _detectDeadZoneEnd(sor.trace, lim, pulseNs, ior);
    const endDist = _findEndDistance(sor);
    const clampedEndDist = (typeof sor.unreliable_from_km === 'number')
        ? Math.min(endDist, sor.unreliable_from_km)
        : endDist;
    const events = (sor.events || []).slice().sort((a, b) => a.distance - b.distance);
    const boundaries = _buildBoundaries(events, clampedEndDist, dzEnd, pulseNs, ior);
    const reflZones = _getReflGuardZones(events, pulseNs, ior);
    const maskedTrace = _maskReflZones(sor.trace, reflZones);
    const raw = _measureSegments(maskedTrace, boundaries, 0.5);

    const COLORS = {
        catastrophic: 'rgba(224,  0,  0, 0.25)',
        critical:     'rgba(224, 92, 92, 0.18)',
        high:         'rgba(240,200, 79, 0.15)',
        elevated:     'rgba(240,200, 79, 0.08)',
        normal:       null,
    };

    return raw
        .map(s => ({ ...s, color: COLORS[CAT.get(s.att)], cat: CAT.get(s.att), dzEnd }))
        .filter(s => s.color !== null && s.end > dzEnd);
}