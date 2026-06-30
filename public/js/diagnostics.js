import { RULES } from './config.js';
import { state } from './state.js';
import { t } from './utils.js';

export function classifyEvent(ev) {
    const tStr = ev.typeStr || '';
    const cLow = (ev.comments || '').toLowerCase();
    const isWdmKeyword = RULES.wdm.keywords.some(k => cLow.includes(k));
    const noRefl = Math.abs(ev.refl) < 1.0;
    const wdmMax = state.hasWdm ? 25.0 : RULES.wdm.loss_max;
    const wdmMin = state.hasWdm ? 1.5 : RULES.wdm.loss_min;
    if (isWdmKeyword || (ev.loss >= wdmMin && ev.loss <= wdmMax && noRefl)) return 'wdm';
    if (tStr[0] === '9' || cLow.includes('end')) return 'end';
    if (tStr[1] === 'r' || tStr[1] === 'R' || ev.refl < -5) return 'refl';
    return 'splice';
}

export function consolidateEvents(sors) {
    const tol = RULES.wavelength_comparison.event_distance_tolerance;
    const allEvs = sors.flatMap(s => s.events.map(e => ({ ...e, wl: s.wavelength, file: s.file, type: classifyEvent(e) })));
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

export function diagnoseSingle(sor) {
    const diags = [];
    const wl = Math.round(sor.wavelength);
    const att = sor.avg_attenuation;
    const lim = RULES.attenuation[wl] || RULES.attenuation.default;

    if (att > lim.max * 1.5) {
        diags.push({
            sev: 'critical',
            category: t('diag_attenuation'),
            msg: t('diag_attenuation_critical', { att: att.toFixed(3), max: lim.max, wl }),
            rec: t('rec_check_splices')
        });
    } else if (att > lim.max) {
        diags.push({
            sev: 'warning',
            category: t('diag_attenuation'),
            msg: t('diag_attenuation_warning', { att: att.toFixed(3), max: lim.max, wl }),
            rec: t('rec_check_splices_detail')
        });
    }

    const orl = sor.orl || 0;
    if (orl > 0 && orl < RULES.orl.critical) {
        diags.push({
            sev: 'critical',
            category: t('diag_orl'),
            msg: t('diag_orl_critical', { orl: orl.toFixed(2), critical: RULES.orl.critical }),
            rec: t('rec_check_connectors')
        });
    } else if (orl > 0 && orl < RULES.orl.warn) {
        diags.push({
            sev: 'warning',
            category: t('diag_orl'),
            msg: t('diag_orl_warning', { orl: orl.toFixed(2), warn: RULES.orl.warn }),
            rec: t('rec_clean_connectors')
        });
    }

    for (const ev of sor.events) {
        const d = ev.distance,
            loss = ev.loss,
            refl = ev.refl;
        const type = classifyEvent(ev);

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

        if (type === 'refl') {
            if (refl > RULES.reflection.critical) {
                diags.push({
                    sev: 'critical',
                    category: t('diag_reflection') + ' @ ' + d.toFixed(3) + ' ' + t('unit_km'),
                    msg: t('diag_refl_critical', { refl: refl.toFixed(1), dist: d.toFixed(3) }),
                    rec: t('rec_clean_reflection')
                });
            } else if (refl > RULES.reflection.warn) {
                diags.push({
                    sev: 'warning',
                    category: t('diag_reflection') + ' @ ' + d.toFixed(3) + ' ' + t('unit_km'),
                    msg: t('diag_refl_warning', { refl: refl.toFixed(1), dist: d.toFixed(3) }),
                    rec: t('rec_clean_reflection')
                });
            }
            if (refl > RULES.diagnostics.fiber_break.reflectance_threshold) {
                diags.push({
                    sev: 'critical',
                    category: t('diag_fiber_break') + ' @ ' + d.toFixed(3) + ' ' + t('unit_km'),
                    msg: t('diag_break_critical', { diagnosis: t('diag_fiber_break'), dist: d.toFixed(3), refl: refl.toFixed(1) }),
                    rec: t('rec_break')
                });
            }
        }

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

        if (loss < RULES.gain_artifact.threshold) {
            diags.push({
                sev: 'info',
                category: t('diag_gainer') + ' @ ' + d.toFixed(3) + ' ' + t('unit_km'),
                msg: t('diag_gainer_info', { loss: loss.toFixed(3) }),
                rec: t('rec_bidirectional')
            });
        }
    }

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

export function diagnoseCrossWl(byWl) {
    const diags = [];
    const wls = Object.keys(byWl).map(Number).sort();
    if (wls.length < 2) return diags;
    const att = {};
    wls.forEach(wl => att[wl] = byWl[wl].avg_attenuation);
    const cmp = RULES.wavelength_comparison;

    if (att[1310] != null && att[1550] != null) {
        const diff = att[1550] - att[1310];
        if (diff > cmp.loss_1550_vs_1310.critical_diff) {
            diags.push({
                sev: 'critical',
                category: t('diag_macrobend') + ' (' + t('diag_scope_cross_wl') + ')',
                msg: t('diag_macrobend_critical', { att1550: att[1550].toFixed(3), att1310: att[1310].toFixed(3), diff: diff.toFixed(3) }),
                rec: t('rec_bend'),
                edu: 'bend'
            });
        } else if (diff > cmp.loss_1550_vs_1310.warn_diff) {
            diags.push({
                sev: 'warning',
                category: t('diag_macrobend') + ' (' + t('diag_scope_cross_wl') + ')',
                msg: t('diag_macrobend_warning', { att1550: att[1550].toFixed(3), att1310: att[1310].toFixed(3), diff: diff.toFixed(3) }),
                rec: t('rec_monitor'),
                edu: 'bend'
            });
        }
    }

    if (byWl[1310] && byWl[1550]) {
        const evs1310 = byWl[1310].events;
        const evs1550 = byWl[1550].events;
        for (const ev1550 of evs1550) {
            if (Math.abs(ev1550.loss) < cmp.event_loss_threshold) continue;
            const ev1310 = evs1310.find(e => Math.abs(e.distance - ev1550.distance) < cmp.event_distance_tolerance);
            const loss1310 = ev1310 ? Math.abs(ev1310.loss) : 0;
            const loss1550 = Math.abs(ev1550.loss);
            const ratio = loss1310 > 0.01 ? loss1550 / loss1310 : 99;

            if (!ev1310 || loss1310 < 0.05) {
                diags.push({
                    sev: 'critical',
                    category: t('diag_macrobend') + ' @ ' + ev1550.distance.toFixed(3) + ' ' + t('unit_km'),
                    msg: t('diag_macrobend_point_critical', { loss: loss1550.toFixed(3), dist: ev1550.distance.toFixed(3) }),
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

    if (att[1383] != null) {
        const ref = ((att[1310] || 0) + (att[1550] || 0)) / 2;
        if (att[1383] > ref * RULES.wavelength_comparison.water_peak_ratio) {
            diags.push({
                sev: 'critical',
                category: t('diag_water_peak'),
                msg: t('diag_water_peak_critical', { att1383: att[1383].toFixed(3) }),
                rec: t('rec_water_peak'),
                edu: 'water'
            });
        }
    }

    if (att[1625] != null && att[1550] != null) {
        const diff = att[1625] - att[1550];
        if (diff > cmp.loss_1625_vs_1550.warn_diff) {
            diags.push({
                sev: 'warning',
                category: t('diag_1625'),
                msg: t('diag_1625_warning', { att1625: att[1625].toFixed(3), att1550: att[1550].toFixed(3), diff: diff.toFixed(3) }),
                rec: t('rec_microbend'),
                edu: 'bend'
            });
        }
    }

    return diags;
}

export function calcQuality(diags) {
    let score = 100;
    for (const d of diags) {
        score -= (RULES.quality_score.deductions[d.sev] || 0);
    }
    score = Math.max(0, score);
    const grade = RULES.quality_score.grades.find(g => score >= g.min);
    return { score, grade };
}

export function diagnoseAll(sors) {
    const groups = {};
    sors.forEach(s => {
        // const dir = s.path.split('/').slice(0, -1).join('/') || 'failai';
		// naujos 2 eilutės žemiau
		let dir = s.path.split('/').slice(0, -1).join('/') || 'failai';
if 		(dir === '__picked__' || dir === '_picked_') dir = t('diag_overall_status');
		
		
        if (!groups[dir]) groups[dir] = {};
        groups[dir][Math.round(s.wavelength)] = s;
    });
    return Object.entries(groups).map(([group, byWl]) => {
        const crossWl = diagnoseCrossWl(byWl);
        const perFile = Object.fromEntries(
            Object.entries(byWl).map(([wl, s]) => [wl, diagnoseSingle(s)])
        );
        const allD = [...crossWl, ...Object.values(perFile).flat()];
        const { score, grade } = calcQuality(allD);
        return { group, wavelengths: Object.keys(byWl).map(Number).sort(), cross_wl: crossWl, per_file: perFile, score, grade };
    });
}