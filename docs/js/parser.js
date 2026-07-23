import { detectLaunchArtifactEnd } from './utils.js';

// Randa trasos y (dB) reikšmę bet kuriame atstume (km), tiesiškai
// interpoliuojant tarp dviejų artimiausių taškų. Naudojama kaupiamojo
// nuostolio (cumulative loss) skaičiavimui - traceData turi būti rikiuota
// pagal x didėjančia tvarka (visada taip yra, nes taip sukuriama parseSOR
// viduje).
function traceYAtDistance(traceData, distKm) {
    if (!traceData || !traceData.length) return null;
    const n = traceData.length;
    if (distKm <= traceData[0].x) return traceData[0].y;
    if (distKm >= traceData[n - 1].x) return traceData[n - 1].y;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (traceData[mid].x < distKm) lo = mid; else hi = mid;
    }
    const p1 = traceData[lo], p2 = traceData[hi];
    if (p2.x === p1.x) return p1.y;
    const frac = (distKm - p1.x) / (p2.x - p1.x);
    return p1.y + frac * (p2.y - p1.y);
}

export function parseSOR(buffer, filename, relpath) {
    // Bendras try-catch, kad sugaudytų visas klaidas
    try {
        // Saugumo patikra: realūs SOR failai paprastai ~50-500KB. 200MB riba
        // su dideliu atsargos koeficientu apsaugo nuo atminties išnaudojimo,
        // jei vartotojas (netyčia ar tyčia) įkelia milžinišką ar sugadintą
        // failą, kuris nėra tikras SOR (pvz. suklastotas didelis binarinis
        // failas su .sor plėtiniu).
        const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB
        if (buffer.byteLength > MAX_FILE_SIZE) {
            throw new Error('Failas per didelis (' + (buffer.byteLength / 1024 / 1024).toFixed(1) + ' MB) - viršija ' + (MAX_FILE_SIZE / 1024 / 1024) + ' MB saugos ribą. Tikri SOR failai paprastai yra 50-500 KB.');
        }
        const data = new Uint8Array(buffer);
        const view = new DataView(buffer);
        let pos = 0;
        const u8 = () => data[pos++];
        const u16 = () => { const v = view.getUint16(pos, true); pos += 2; return v; };
        const u32 = () => { const v = view.getUint32(pos, true); pos += 4; return v; };
        const i16 = () => { const v = view.getInt16(pos, true); pos += 2; return v; };
        const i32 = () => { const v = view.getInt32(pos, true); pos += 4; return v; };
        const cstr = () => { 
            let s = ''; 
            while (pos < data.length) { 
                const c = data[pos++]; 
                if (c === 0) break; 
                s += String.fromCharCode(c); 
            } 
            return s.trim(); 
        };
        const str = (n) => { 
            let s = ''; 
            for (let i = 0; i < n; i++) { 
                const c = data[pos++]; 
                if (c !== 0) s += String.fromCharCode(c); 
            } 
            return s.trim(); 
        };
        const byt = (n) => { 
            const b = data.slice(pos, pos + n); 
            pos += n; 
            return b; 
        };




        // === SIG ===
        let sig;
        try {
            sig = cstr();
        } catch (e) {
            throw new Error('Nepavyko nuskaityti SIG: ' + e.message);
        }
        const fmt = sig === 'Map' ? 2 : 1;
        if (fmt === 1) pos = 0;

        // === MAP ===
        let mapVer, mapSize, nBlks;
        try {
            mapVer = u16();
            mapSize = u32();
            nBlks = u16() - 1;
        } catch (e) {
            throw new Error('Nepavyko nuskaityti MAP bloko: ' + e.message);
        }

        const blocks = {};
        let startPos = mapSize;
        try {
            for (let i = 0; i < nBlks; i++) {
                const bn = cstr();
                const bv = u16();
                const bs = u32();
                blocks[bn] = { pos: startPos, size: bs };
                startPos += bs;
            }
        } catch (e) {
            throw new Error('Nepavyko nuskaityti blokų sąrašo: ' + e.message);
        }

        // E2 patch: jei nerasta nei FxdParams, nei DataPts bloko, tai ne SOR
        // failas (pvz. vien nulių arba atsitiktinių baitų failas) - be šio
        // patikrinimo toks failas anksčiau tyliai grąžindavo ok:true su
        // tuščiais/nuliniais laukais.
        if (!blocks.FxdParams && !blocks.DataPts) {
            throw new Error('Nerasta nei FxdParams, nei DataPts bloko - ne SOR failas');
        }

        const gen = {}, sup = {}, fxd = {};
        let events = [], traceData = [], summary = {};
        // E3 patch: įspėjimų sąrašas - kaupia visus "tęsiama" tipo klaidų
        // pranešimus, kad UI galėtų parodyti geltoną ženkliuką vietoj to,
        // kad klaidos tyliai dingtų console.warn viduje.
        const warnings = [];

        // === GenParams ===
        if (blocks.GenParams) {
            try {
                pos = blocks.GenParams.pos;
                if (fmt === 2) cstr();
                gen.lang = str(2);
                gen.cableId = cstr();
                gen.fiberId = cstr();
                if (fmt === 2) gen.fiberType = u16();
                gen.wavelength = u16();
                gen.locationA = cstr();
                gen.locationB = cstr();
                gen.cableCode = cstr();
                gen.buildCond = str(2);
                gen.userOffset = i32();
                if (fmt === 2) gen.userOffsetDist = i32();
                gen.operator = cstr();
                gen.comments = cstr();
            } catch (e) {
                console.warn('GenParams klaida (tęsiama):', e.message);
                warnings.push('GenParams: ' + e.message);
            }
        }

        // === SupParams ===
        if (blocks.SupParams) {
            try {
                pos = blocks.SupParams.pos;
                if (fmt === 2) cstr();
                sup.supplier = cstr();
                sup.otdr = cstr();
                sup.otdrSN = cstr();
                sup.module = cstr();
                sup.moduleSN = cstr();
                sup.software = cstr();
                sup.other = cstr();
            } catch (e) {
                console.warn('SupParams klaida (tęsiama):', e.message);
                warnings.push('SupParams: ' + e.message);
            }
        }

        // === FxdParams ===
        if (blocks.FxdParams) {
            try {
                pos = blocks.FxdParams.pos;
                if (fmt === 2) cstr();
                fxd.dateTime = u32();
                fxd.unit = str(2);
                fxd.wavelength = u16() * 0.1;
                fxd.acqOffset = i32();
                if (fmt === 2) fxd.acqOffsetDist = i32();
                u16();
                fxd.pulseWidth = u16();
                fxd.sampleSpacing = u32();
                fxd.numPts = u32();
                fxd.ior = u32() * 1e-5;
                fxd.bc = i16() * -0.1;
                fxd.numAvg = u32();
                if (fmt === 2) {
                    fxd.avgTime = u16() * 0.1;
                    fxd.range = u32() * 2e-5;
                    i32(); i32(); u16(); i16(); u16();
                } else {
                    fxd.range = u32() * 2e-5;
                }
                fxd.lossThresh = u16() * 0.001;
                i16(); u16();
                if (fmt === 2) { str(2); i32(); i32(); i32(); i32(); }
                const ior = fxd.ior || 1.4676;
                fxd.dx_km = fxd.sampleSpacing * 1e-8 * (299792.458 / 1e6) / ior;
                fxd.rangeCalc = fxd.dx_km * fxd.numPts;
            } catch (e) {
                console.warn('FxdParams klaida (tęsiama):', e.message);
                warnings.push('FxdParams: ' + e.message);
            }
        }

        // === DataPts (DIDŽIAUSIAS BLOKAS – su atminties valdymu) ===
        if (blocks.DataPts) {
            try {
                pos = blocks.DataPts.pos;
                if (fmt === 2) cstr();
                const N = u32();
                const nt = i16();
                const N2 = u32();
                const sf = u16() / 1000.0;
                const dataStartPos = pos; // E5: pradinė DataPts taškų masyvo pozicija

                // Apribojame taškų skaičių iki 50000
                const MAX_POINTS = 50000;
                let step = 1;
                if (N > MAX_POINTS) {
                    step = Math.ceil(N / MAX_POINTS);
                }
                step = Math.max(1, step);

                // E7 patch: anksčiau šis ciklas iteruodavo per KIEKVIENĄ i nuo
                // 0 iki N (net praleidžiamus taškus tik pridėdamas pos+=2) -
                // tai O(N) operacijų. Su sugadintu/bitflip'intu N (pvz. iš
                // fuzz testo, milijonai ar milijardai) tai sukeldavo kelių
                // sekundžių UI užšalimą. Dabar šokinėjame tiesiogiai per
                // baitų pozicijas TIK prie išsaugomų taškų (i += step,
                // bytePos = dataStartPos + i*2) - iteracijų skaičius visada
                // ≈ MAX_POINTS, nepriklausomai nuo to, koks milžiniškas N.
                const raw = [];
                let readCount = 0;
                for (let i = 0; i < N; i += step) {
                    const bytePos = dataStartPos + i * 2;
                    if (bytePos + 2 > data.length) break;
                    raw.push(view.getUint16(bytePos, true));
                    readCount++;
                }
                // Perkeliame pos į DataPts bloko pabaigą (logiškai) - tolesnis
                // kodas vis tiek eksplicitiškai persistato pos pagal kito
                // bloko poziciją, bet paliekame jį nuosekliai, o ne
                // nebaigtoje/atsitiktinėje vietoje.
                pos = Math.min(dataStartPos + N * 2, data.length);

                // E5 patch: kai step > 1 (retinimas), paskutinis trasos taškas
                // (N-1) dažniausiai NEBŪNA kas-step-tasis, todėl anksčiau
                // range_km baigdavosi trumpiau nei tikroji trasos pabaiga
                // (iki (step-1)*dx trūkumas). Skaitome jį tiesiogiai iš žinomos
                // baito pozicijos, nesutrikdydami tolesnio pos skaitymo.
                let lastRaw = null;
                const lastIdx = N - 1;
                if (step > 1 && N > 0) {
                    const lastPointPos = dataStartPos + lastIdx * 2;
                    if (lastPointPos + 2 <= data.length) {
                        lastRaw = view.getUint16(lastPointPos, true);
                    }
                }

                if (raw.length > 0) {
                    let ymax = -Infinity;
                    for (let i = 0; i < raw.length; i++) {
                        if (raw[i] > ymax) ymax = raw[i];
                    }
                    if (lastRaw !== null && lastRaw > ymax) ymax = lastRaw;
                    const dx = fxd.dx_km || 0;
                    // Sukuriame traceData iš retintų taškų
                    for (let i = 0; i < raw.length; i++) {
                        traceData.push({
                            x: parseFloat((dx * i * step).toFixed(4)),
                            y: parseFloat(((ymax - raw[i]) * sf * 0.001).toFixed(4))
                        });
                    }
                    // E5: pridedame tikrąjį paskutinį tašką, jei jo dar nėra
                    if (lastRaw !== null) {
                        const lastX = parseFloat((dx * lastIdx).toFixed(4));
                        const prevX = traceData.length ? traceData[traceData.length - 1].x : -1;
                        if (lastX > prevX) {
                            traceData.push({
                                x: lastX,
                                y: parseFloat(((ymax - lastRaw) * sf * 0.001).toFixed(4))
                            });
                        }
                    }
                }
            } catch (e) {
                console.warn('DataPts klaida (tęsiama):', e.message);
                warnings.push('DataPts: ' + e.message);
                // Jei nepavyko nuskaityti traceData, paliekame tuščią masyvą
                traceData = [];
            }
        }

        // === KeyEvents ===
        if (blocks.KeyEvents) {
            try {
                pos = blocks.KeyEvents.pos;
                if (fmt === 2) cstr();
                const ior = fxd.ior || 1.4676;
                const factor = 1e-4 * (299792.458 / 1e6) / ior;
                const nev = u16();
                // Apribojame eventų skaičių, kad nepadaugėtų
                const MAX_EVENTS = 500;
                const eventLimit = Math.min(nev, MAX_EVENTS);
                // E1 patch: jei bent vienas eventas nepavyksta nuskaityti arba
                // eventLimit < nev (apkarpyta), pos po šio ciklo yra nepatikimas
                // (nežinome, kiek baitų suvalgė nepavykęs eventas) - tada
                // totalLoss/ORL suvestinė toliau NEBESKAITOMA, kad neduotume
                // tylių neteisingų skaičių.
                let eventsFailed = false;
                if (eventLimit < nev) eventsFailed = true;

                for (let i = 0; i < eventLimit && pos < data.length; i++) {
                    try {
                        const idx = u16();
                        const distRaw = u32();
                        const slope = i16() * 0.001;
                        const splice = i16() * 0.001;
                        const refl = i32() * 0.001;
                        const tb = byt(8);
                        let typeStr = '';
                        for (const b of tb) if (b !== 0) typeStr += String.fromCharCode(b);
                        typeStr = typeStr.trim();
                        let peak = 0;
                        if (fmt === 2) { u32(); u32(); u32(); u32(); peak = u32() * factor; }
                        const comments = cstr();
						events.push({
							index: idx,
							originalDistance: parseFloat((distRaw * factor).toFixed(4)), // saugome originalą
							distance: parseFloat((distRaw * factor).toFixed(4)),         // display reikšmė
							slope,
							loss: splice,
							refl,
							typeStr,
							comments: comments.trim()
						});
                    } catch (e) {
                        // Jei vienas eventas blogas – praleidžiame ir tęsiame
                        console.warn('Event #' + i + ' klaida (praleidžiama):', e.message);
                        warnings.push('Event #' + i + ': ' + e.message);
                        eventsFailed = true; // E1: pos nuo šios vietos nebepatikimas
                        continue;
                    }
                }
                // E1 patch: totalLoss/ORL suvestinę skaitome TIK jei visi eventai
                // nuskaityti sėkmingai ir be apkarpymo - kitaip pos yra
                // išsiderinęs ir reikšmės būtų atsitiktinės, bet "tylios" (be
                // klaidos pranešimo vartotojui).
                if (!eventsFailed) {
                    try {
                        const tl = i32() * 0.001;
                        const ls = i32() * factor;
                        const le = u32() * factor;
                        const orl = u16() * 0.001;
                        // Gamintojo (OTDR įrenginio) ypatybė: 'le' yra atstumas,
                        // iki kurio PATS PRIETAISAS paskaičiavo totalLoss/orl -
                        // dažniausiai tai sutampa su range_km, BET jei prietaisas
                        // savo automatinėje analizėje aptiko rimtą pažeidimą ir
                        // pažymėjo jį kaip "linijos galą" (event tipas su 'E'),
                        // totalLoss apima TIK iki to taško, net jei SOR faile
                        // (trace masyve) yra duomenų toliau. Išsaugome 'le', kad
                        // UI galėtų aiškiai parodyti, kokį atstumą totalLoss
                        // realiai apima, o ne klaidingai vadinti jį "visos
                        // linijos nuostoliu".
                        summary = { totalLoss: tl, orl, totalLossEndKm: le };
                    } catch (e) {
                        // Jei nepavyksta – paliekame tuščią
                    }
                } else {
                    warnings.push('Suvestinė (total loss/ORL) praleista - eventų nuskaitymas buvo apkarpytas arba klaidingas, pozicija failo viduje nebepatikima.');
                }
            } catch (e) {
                console.warn('KeyEvents klaida (tęsiama):', e.message);
                warnings.push('KeyEvents: ' + e.message);
            }
        }
		
	//	console.log('lastEvent:', lastEvent);
	//	console.log('endDist:', endDist, 'rangeKm:', rangeKm);


		// === Rezultatas ===
		// ── BANGOS ILGIO NUSTATYMAS (su EXFO skalės korekcija) ──
		let wlFromGen = gen.wavelength || 0;
		let wlFromFxd = fxd.wavelength || 0;

		function isValidWavelength(val) {
			return val >= 1200 && val <= 1700;
		}

		function isScaledWavelength(val) {
			return val >= 120 && val <= 170;
		}

		let wl = 1550; // numatyta

		// 1) Jei fxd.wavelength yra priimtino diapazono – naudojame
		if (isValidWavelength(wlFromFxd)) {
			wl = wlFromFxd;
		} 
		// 2) Jei fxd.wavelength yra skalėje (EXFO: 131.0 vietoj 1310) – dauginame
		else if (isScaledWavelength(wlFromFxd)) {
			wl = wlFromFxd * 10;
		}
		// 3) Jei gen.wavelength yra priimtino diapazono – naudojame
		else if (isValidWavelength(wlFromGen)) {
			wl = wlFromGen;
		}
		// 4) Jei gen.wavelength yra skalėje – dauginame
		else if (isScaledWavelength(wlFromGen)) {
			wl = wlFromGen * 10;
		}
		// 5) Jei viskas nepavyksta – naudojame gen.wavelength (jei yra) arba 1550
		else {
			wl = wlFromGen || 1550;
		}

		// Užtikriname, kad wl būtų skaičius
		wl = parseFloat(wl);
		if (isNaN(wl) || wl < 100) wl = 1550;
		
        const rangeKm = fxd.rangeCalc || (traceData.length ? traceData[traceData.length - 1].x : 0);
		
				
let avgAtt = 0;
let launchArtifactEndKm = 0;
let calculatedTotalLoss = null;
let calculatedTotalLossEndKm = null;
if (traceData.length > 10) {
    try {
        // Aptinkame OTDR prijungimo (launch) artefakto pabaigą - fizikai pagrįstas
        // taškas, o ne aklas 10% ilgio nukirtimas. Šis pats rezultatas naudojamas
        // ir diagnostics.js segmentų analizėje bei pranešime, kad abu sutaptų.
        const artifact = detectLaunchArtifactEnd(traceData, fxd.pulseWidth, fxd.ior);
        launchArtifactEndKm = artifact.endKm;

        // SVARBI PATAISA: baigiame skaičiavimą PRIEŠ paskutinį įvykį (paprastai
        // tikras linijos galas su Fresnel/APC atspindžiu), o NE ties 90% viso
        // masyvo ilgio. Ankstesnė versija (10-90% aklas nukirtimas) daž​nai
        // patekdavo į pačią atspindžio artefakto zoną ties trasos galu (nes SOR
        // failo range_km dažnai apima papildomą triukšmo/atspindžio uodegą po
        // tikrojo linijos galo) - trace y reikšmės ten būna iškraipytos absoliučia
        // prasme (ymax etalonas dažnai būna kaip tik šiame atspindyje), todėl
        // vidutinis slopinimas būdavo smarkiai per didelis (klaidingai rodydavo
        // kelis kartus daugiau nei iš tišro yra).
        const lastEventDist = events.length ? events[events.length - 1].distance : null;
        let endLimitKm;
        if (lastEventDist && lastEventDist > launchArtifactEndKm + 0.1) {
            endLimitKm = lastEventDist - 0.05; // 50 m saugos riba prieš paskutinį įvykį
        } else {
            endLimitKm = traceData[Math.floor(traceData.length * 0.9)]?.x ?? (rangeKm * 0.9);
        }

        const seg = traceData.filter(p => p.x >= launchArtifactEndKm && p.x <= endLimitKm);

        if (seg.length > 2 && seg[seg.length - 1].x > seg[0].x) {
            const deltaY = seg[0].y - seg[seg.length - 1].y;
            const deltaX = seg[seg.length - 1].x - seg[0].x;
            avgAtt = deltaY / deltaX;
            // Patys paskaičiuojame viso (analizuoto) ruožo nuostolį (dB, NE
            // dB/km) - tai deltaY tarp paleidimo artefakto pabaigos ir
            // paskutinio įvykio/atspindžio, t.y. praktiškai visa trasa,
            // NEPRIKLAUSOMAI nuo to, ar prietaiso pačio pateiktas totalLoss
            // laukas (summary.totalLoss) apima visą liniją ar tik dalį jos
            // (žr. total_loss_end_km patikrą aukščiau). Naudinga, kai
            // prietaisas savo automatinėje analizėje "pasidavė" anksčiau
            // dėl rimto pažeidimo trasoje.
            calculatedTotalLoss = deltaY;
            calculatedTotalLossEndKm = seg[seg.length - 1].x;
        }
    } catch (e) {
        console.warn('Vidutinio slopinimo skaičiavimo klaida:', e.message);
    }

    // Kaupiamasis (cumulative) nuostolis kiekvienam event'ui - pilnas EXFO
    // stiliaus variantas, įtraukiantis IR paskirstytą skaidulos slopinimą
    // tarp event'ų, ne vien pačių event'ų nuostolius. Pati trasos kreivė
    // (traceData.y) jau YRA kaupiamasis nuostolis nuo paleidimo taško (nes
    // ji skaičiuojama kaip dB nuo ymax etalono) - todėl kaupiamąjį nuostolį
    // bet kuriame taške gauname tiesiog interpoliuodami trasos y reikšmę
    // toje vietoje, atėmę paleidimo artefakto pabaigos y reikšmę. Patikrinta
    // su realiais duomenimis: sutampa su prietaiso total_loss ±0.1dB.
    try {
        if (traceData.length > 10) {
            const launchY = traceYAtDistance(traceData, launchArtifactEndKm);
            if (launchY !== null) {
                for (const ev of events) {
                    // Įvykiai iki paleidimo artefakto pabaigos (dažniausiai
                    // pats launch event'as ties ~0km) - trasa ten dar
                    // netvarkinga (impulso soties zona), todėl kaupiamasis
                    // nuostolis būtų prasmingas skaičius. Laikome jį 0.
                    if (ev.distance <= launchArtifactEndKm) {
                        ev.cumulative_loss = 0;
                        continue;
                    }
                    const y = traceYAtDistance(traceData, ev.distance);
                    ev.cumulative_loss = (y !== null) ? parseFloat((launchY - y).toFixed(4)) : null;
                }
            }
        }
    } catch (e) {
        console.warn('Kaupiamojo nuostolio skaičiavimo klaida:', e.message);
    }
}


				
        const dt = fxd.dateTime ? new Date(fxd.dateTime * 1000).toLocaleString('lt-LT') : '';
        
        return {
            ok: true,
            file: filename,
            path: '__picked__/' + (relpath || filename),
            wavelength: wl,
            cable_id: gen.cableId || '',
            location_a: gen.locationA || '',
            location_b: gen.locationB || '',
            otdr: sup.otdr || sup.module || '',
            supplier: sup.supplier || '',
            software: sup.software || '',
            date: dt,
            pulse_width: fxd.pulseWidth || '',
            num_avg: (typeof fxd.numAvg === 'number' && fxd.numAvg > 0) ? fxd.numAvg : null,
            // avgTime skaitomas TIK fmt===2 ("Map") SOR failuose - senesniuose
            // (fmt===1) failuose šio lauko formatas nenumatytas, tad liks null.
            avg_time_s: (typeof fxd.avgTime === 'number' && fxd.avgTime > 0) ? fxd.avgTime : null,
            ior: fxd.ior || 1.4676,
            resolution_m: (fxd.dx_km || 0) * 1000,
            range_km: rangeKm,
            avg_attenuation: Math.round(avgAtt * 10000) / 10000,
            launch_artifact_m: Math.round(launchArtifactEndKm * 1000),
            total_loss: summary.totalLoss || 0,
            total_loss_end_km: (typeof summary.totalLossEndKm === 'number') ? summary.totalLossEndKm : null,
            // Ar prietaiso pateiktas total_loss apima VISĄ REALIĄ liniją.
            // SVARBI PATAISA: lyginame su PASKUTINIO ĮVYKIO atstumu, NE su
            // range_km - nes range_km yra tik akvizicijos langas (dažnai ~2×
            // ilgesnis už realią liniją, žr. lauko praktiką), o ne tikroji
            // linijos pabaiga. Ankstesnė versija (lyginimas su rangeKm)
            // klaidingai pažymėdavo BEVEIK KIEKVIENĄ sveiką failą kaip
            // "neapimantį visos linijos".
            total_loss_covers_full_line: (typeof summary.totalLossEndKm === 'number')
                ? Math.abs(summary.totalLossEndKm - (events.length ? events[events.length - 1].distance : rangeKm)) <= Math.max(0.05, rangeKm * 0.02)
                : null,
            // Patys apskaičiuotas viso analizuoto ruožo nuostolis (dB) - žr.
            // komentarą prie calculatedTotalLoss aukščiau. Naudokite šitą
            // lauką (ne total_loss), kai total_loss_covers_full_line===false.
            total_loss_calculated: (calculatedTotalLoss !== null) ? Math.round(calculatedTotalLoss * 1000) / 1000 : null,
            total_loss_calculated_end_km: calculatedTotalLossEndKm,
            orl: summary.orl || 0,
            num_pts: fxd.numPts || traceData.length,
            events: events,
            trace: traceData,
            warnings: warnings, // E3: UI gali parodyti geltoną ženkliuką, jei masyvas netuščias
        };
    } catch (e) {
        // Jei visa parsimo funkcija žlugo – grąžiname klaidą
        console.error('Bendra parseSOR klaida:', e);
        return {
            ok: false,
            file: filename,
            error: e.message,
            path: '__picked__/' + (relpath || filename),
            wavelength: 0,
            cable_id: '',
            location_a: '',
            location_b: '',
            otdr: '',
            supplier: '',
            software: '',
            date: '',
            pulse_width: '',
            num_avg: null,
            avg_time_s: null,
            ior: 1.4676,
            resolution_m: 0,
            range_km: 0,
            avg_attenuation: 0,
            launch_artifact_m: 0,
            total_loss: 0,
            total_loss_end_km: null,
            total_loss_covers_full_line: null,
            total_loss_calculated: null,
            total_loss_calculated_end_km: null,
            orl: 0,
            num_pts: 0,
            events: [],
            trace: [],
            warnings: [],
        };
    }
}