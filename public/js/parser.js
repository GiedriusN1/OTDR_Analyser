// ── SOR Parser ──
export function parseSOR(buffer, filename, relpath) {
    const data = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let pos = 0;
    const u8 = () => data[pos++];
    const u16 = () => { const v = view.getUint16(pos, true); pos += 2; return v; };
    const u32 = () => { const v = view.getUint32(pos, true); pos += 4; return v; };
    const i16 = () => { const v = view.getInt16(pos, true); pos += 2; return v; };
    const i32 = () => { const v = view.getInt32(pos, true); pos += 4; return v; };
    const cstr = () => { let s = ''; while (pos < data.length) { const c = data[pos++]; if (c === 0) break; s += String.fromCharCode(c); } return s.trim(); };
    const str = (n) => { let s = ''; for (let i = 0; i < n; i++) { const c = data[pos++]; if (c !== 0) s += String.fromCharCode(c); } return s.trim(); };
    const byt = (n) => { const b = data.slice(pos, pos + n); pos += n; return b; };

    const sig = cstr();
    const fmt = sig === 'Map' ? 2 : 1;
    if (fmt === 1) pos = 0;
    const mapVer = u16();
    const mapSize = u32();
    const nBlks = u16() - 1;
    const blocks = {};
    let startPos = mapSize;
    for (let i = 0; i < nBlks; i++) {
        const bn = cstr();
        const bv = u16();
        const bs = u32();
        blocks[bn] = { pos: startPos, size: bs };
        startPos += bs;
    }

    const gen = {}, sup = {}, fxd = {};
    let events = [], traceData = [], summary = {};

    if (blocks.GenParams) {
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
    }
    if (blocks.SupParams) {
        pos = blocks.SupParams.pos;
        if (fmt === 2) cstr();
        sup.supplier = cstr();
        sup.otdr = cstr();
        sup.otdrSN = cstr();
        sup.module = cstr();
        sup.moduleSN = cstr();
        sup.software = cstr();
        sup.other = cstr();
    }
    if (blocks.FxdParams) {
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
            i32();
            i32();
            u16();
            i16();
            u16();
        } else {
            fxd.range = u32() * 2e-5;
        }
        fxd.lossThresh = u16() * 0.001;
        i16();
        u16();
        if (fmt === 2) {
            str(2);
            i32();
            i32();
            i32();
            i32();
        }
        const ior = fxd.ior || 1.4676;
        fxd.dx_km = fxd.sampleSpacing * 1e-8 * (299792.458 / 1e6) / ior;
        fxd.rangeCalc = fxd.dx_km * fxd.numPts;
    }
    if (blocks.DataPts) {
        pos = blocks.DataPts.pos;
        if (fmt === 2) cstr();
        const N = u32();
        const nt = i16();
        const N2 = u32();
        const sf = u16() / 1000.0;
        const raw = [];
        for (let i = 0; i < N && pos + 2 <= data.length; i++) raw.push(u16());
        if (raw.length) {
            const ymax = Math.max(...raw);
            const dx = fxd.dx_km || 0;
            const step = Math.max(1, Math.floor(raw.length / 2000));
            for (let i = 0; i < raw.length; i += step) {
                traceData.push({
                    x: parseFloat((dx * i).toFixed(4)),
                    y: parseFloat(((ymax - raw[i]) * sf * 0.001).toFixed(4))
                });
            }
        }
    }
    if (blocks.KeyEvents) {
        pos = blocks.KeyEvents.pos;
        if (fmt === 2) cstr();
        const ior = fxd.ior || 1.4676;
        const factor = 1e-4 * (299792.458 / 1e6) / ior;
        const nev = u16();
        for (let i = 0; i < nev; i++) {
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
                    distance: parseFloat((distRaw * factor).toFixed(4)),
                    slope,
                    loss: splice,
                    refl,
                    typeStr,
                    comments: comments.trim()
                });
            } catch (e) { break; }
        }
        try {
            const tl = i32() * 0.001;
            const ls = i32() * factor;
            const le = u32() * factor;
            const orl = u16() * 0.001;
            summary = { totalLoss: tl, orl };
        } catch (e) { /* ignore */ }
    }

    const wl = gen.wavelength || Math.round(fxd.wavelength) || 1550;
    const rangeKm = fxd.rangeCalc || (traceData.length ? traceData[traceData.length - 1].x : 0);
    let avgAtt = 0;
    if (traceData.length > 10) {
        const s = Math.floor(traceData.length * .2);
        const e = Math.floor(traceData.length * .8);
        const seg = traceData.slice(s, e);
        if (seg.length && seg[seg.length - 1].x > seg[0].x) {
            avgAtt = (seg[0].y - seg[seg.length - 1].y) / (seg[seg.length - 1].x - seg[0].x);
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
        ior: fxd.ior || 1.4676,
        resolution_m: (fxd.dx_km || 0) * 1000,
        range_km: rangeKm,
        avg_attenuation: Math.round(avgAtt * 10000) / 10000,
        total_loss: summary.totalLoss || 0,
        orl: summary.orl || 0,
        num_pts: fxd.numPts || traceData.length,
        events,
        trace: traceData,
    };
}