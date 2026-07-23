// ══════════════════════════════════════════════════════════════
// RULES – vienintelis diagnostikos ribų šaltinis.
// Norint pakeisti bet kokią ribą (slopinimas, suvirinimas,
// atspindys, WDM, priėmimo kriterijai ir t.t.) - keiskite TIK ČIA.
// ══════════════════════════════════════════════════════════════

export const RULES = {
    version: '2.1',
    standard: 'ITU-T G.652D / IEC 61280-4-1',
    attenuation: {
        1310: { max: 0.40, warn: 0.35 },
        1383: { max: 0.40, warn: 0.35 },
        1490: { max: 0.30, warn: 0.25 },
        1550: { max: 0.25, warn: 0.22 },
        1625: { max: 0.25, warn: 0.22 },
        default: { max: 0.35, warn: 0.30 },
    },
    orl: { critical: 27, warn: 32 },
    splice: { critical: 0.50, warn: 0.20, typical: 0.05 },
    connector: { critical: 1.00, warn: 0.50 },
    reflection: { critical: -40, warn: -50 },
    wdm: {
        loss_min: 2.5,
        loss_max: 8.0,
        refl_threshold: -45,
        keywords: ['wdm', 'mux', 'oadm', 'roadm', 'cwdm', 'dwdm', 'multiplex', 'splitter', 'coupler', 'tap'],
    },
    gain_artifact: { threshold: -0.10 },
    wavelength_comparison: {
        // E: warn_diff pakelta nuo 0.01 iki 0.05 dB/km - 0.01 buvo per griežta,
        // realaus matavimo triukšmas (segmentų vidurkinimas, launch/end efektai)
        // dažnai svyruoja ±0.02-0.05 dB/km net sveikoje trasoje, todėl 0.01
        // generuodavo klaidingus makrolenkimo įspėjimus vien dėl matavimo paklaidos.
        loss_1550_vs_1310: { critical_diff: 0.05, warn_diff: 0.05 },
        event_1550_not_1310_loss: 0.15,
        event_ratio_threshold: 3.0,
        // Vandens smailės (1383nm) riba pagal IEC 60793-2-50: santykinė, ne
        // absoliuti - Δα(1383 vs 1310) ≤ 0.03 dB/km realiam LWP (low water
        // peak) pluoštui. water_peak_ratio paliktas suderinamumui, bet
        // diagnostics.js dabar naudoja water_peak_max_diff (žr. diagnoseCrossWl).
        water_peak_ratio: 1.30,
        water_peak_max_diff: 0.03,
        event_distance_tolerance: 0.15,
        event_loss_threshold: 0.15,
        loss_1625_vs_1550: { warn_diff: 0.05 },
    },
    diagnostics: {
        macro_bend: {
            confidence_high: 0.90,
            confidence_medium: 0.70,
            diagnosis_lt: 'Tikėtinas makrolenkimas',
            recommendation_lt: 'Patikrinti movą arba kabelio tiesimo vietą ties nurodytu atstumu. Min. lenkimo spindulys G.652: 30 mm.',
        },
        pon_splitter: {
            ratios: {
                '1:2': { loss: 3.5, tol: 1.0 },
                '1:4': { loss: 7.2, tol: 1.2 },
                '1:8': { loss: 10.5, tol: 1.5 },
                '1:16': { loss: 13.8, tol: 1.8 },
                '1:32': { loss: 17.0, tol: 2.0 },
                '1:64': { loss: 20.5, tol: 2.5 },
            },
            max_reflectance: -50,
            min_loss: 3.0,
        },
        fiber_break: {
            reflectance_threshold: -25,
            diagnosis_lt: 'Tikėtinas skaidulos nutrūkimas arba atviras galas',
            recommendation_lt: 'Patikrinti movą arba ODF ties nurodytu atstumu.',
        },
        apc: { good: -60, warn: -50, critical: -45 },
        ghost: { trigger_reflectance: -35, amplitude_ratio_max: 0.85 },
    },
    quality_score: {
        deductions: { critical: 40, warning: 20, info: 0 },
        grades: [
            { min: 90, label_lt: 'Puiki', label_en: 'Excellent', color: '#00d4aa' },
            { min: 70, label_lt: 'Gera', label_en: 'Good', color: '#4f8ef7' },
            { min: 50, label_lt: 'Patenkinama', label_en: 'Satisfactory', color: '#f0c84f' },
            { min: 0, label_lt: 'Bloga', label_en: 'Poor', color: '#e05c5c' },
        ],
    },

    // ── PRIĖMIMO (acceptance) RIBOS – naujai sumontuotų/pervirintų movų vertinimui ──
    // TODO: ribos šiuo metu = tos pačios kaip bendra RULES.splice (placeholder).
    // Paderinkite pagal savo įmonės priėmimo standartą (dažnai griežtesnis nei
    // bendra eksploatacijos norma, pvz. 0.10/0.30 dB vietoj 0.20/0.50 dB).
    acceptance: {
        splice: { critical: 0.25, warn: 0.10 },
    },
};
