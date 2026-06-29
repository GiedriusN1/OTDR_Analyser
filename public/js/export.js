import { state } from './state.js';
import { toast } from './utils.js';
import { classifyEvent } from './diagnostics.js';

export async function exportExcel() {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    const ok = state.parsed.filter(p => p.ok);
    const wb = XLSX.utils.book_new();
    const sum = [
        ['Failas', 'nm', 'Nuostoliai dB', 'Slopinimas dB/km', 'ORL dB', 'Eventai', 'Ilgis km', 'Data']
    ];
    ok.forEach(s => sum.push([s.file, s.wavelength, s.total_loss, s.avg_attenuation, s.orl || '', s.events.length, s.range_km, s.date]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), 'Suvestine');
    const evs = [
        ['Failas', 'nm', 'Nr.', 'Tipas', 'Atstumas km', 'Nuostolis dB', 'Atspindys dB']
    ];
    ok.forEach(s => s.events.forEach(e => evs.push([s.file, s.wavelength, e.index, classifyEvent(e), e.distance, e.loss, e.refl])));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(evs), 'Eventai');
    const diags = [
        ['Sunkumas', 'Kategorija', 'Grupe', 'Problema', 'Rekomendacija']
    ];
    state.diagnostics.forEach(g => {
        g.cross_wl.forEach(d => diags.push([d.sev, d.category, g.group, d.msg, d.rec]));
        Object.entries(g.per_file).forEach(([wl, ds]) => ds.forEach(d => diags.push([d.sev, d.category, g.group + '/' + wl + 'nm', d.msg, d.rec])));
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(diags), 'Diagnostika');
    XLSX.writeFile(wb, 'otdr_analize.xlsx');
    toast('Excel atsisiunta');
}

export async function exportPdf() {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const ok = state.parsed.filter(p => p.ok);
    doc.setFillColor(22, 27, 39);
    doc.rect(0, 0, 297, 210, 'F');
    doc.setTextColor(0, 212, 170);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('OTDR SOR Analizes Ataskaita', 14, 14);
    doc.setTextColor(180, 185, 200);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Sugeneruota: ' + new Date().toLocaleString('lt-LT') + ' | ' + 'ITU-T G.652D / IEC 61280-4-1', 14, 20);
    doc.autoTable({
        startY: 25,
        margin: { left: 14, right: 14 },
        head: [
            ['Failas', 'nm', 'Nuostoliai dB', 'Slopinimas dB/km', 'ORL dB', 'Eventai', 'Ilgis km']
        ],
        body: ok.map(s => [s.file, s.wavelength, (s.total_loss || 0).toFixed(3), (s.avg_attenuation || 0).toFixed(4), (s.orl || 0).toFixed(2), s.events.length, (s.range_km || 0).toFixed(3)]),
        styles: { fillColor: [30, 36, 54], textColor: [220, 225, 235], fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [0, 180, 140], textColor: [0, 0, 0], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [37, 44, 64] },
    });
    const allD = state.diagnostics.flatMap(g => [...g.cross_wl.map(d => ['cross-wl', d]), ...Object.entries(g.per_file).flatMap(([wl, ds]) => ds.map(d => [wl + 'nm', d]))]);
    if (allD.length) {
        doc.addPage();
        doc.setFillColor(22, 27, 39);
        doc.rect(0, 0, 297, 210, 'F');
        doc.setTextColor(0, 212, 170);
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.text('Diagnostika ir rekomendacijos', 14, 13);
        doc.autoTable({
            startY: 18,
            margin: { left: 14, right: 14 },
            head: [
                ['Sunkumas', 'Sritis', 'Problema', 'Rekomendacija']
            ],
            body: allD.map(([scope, d]) => [d.sev.toUpperCase(), scope + ' ' + d.category, d.msg, d.rec]),
            styles: { fillColor: [30, 36, 54], textColor: [220, 225, 235], fontSize: 7.5, cellPadding: 3 },
            headStyles: { fillColor: [37, 61, 100], textColor: [150, 200, 255], fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [37, 44, 64] },
            columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 42 }, 2: { cellWidth: 115 }, 3: { cellWidth: 100 } },
            didParseCell: (dt) => {
                if (dt.column.index === 0 && dt.row.index >= 0) {
                    const v = (dt.cell.raw || '').toLowerCase();
                    if (v.includes('crit')) dt.cell.styles.textColor = [224, 92, 92];
                    else if (v.includes('warn')) dt.cell.styles.textColor = [240, 200, 79];
                    else dt.cell.styles.textColor = [0, 212, 170];
                }
            },
        });
    }
    const aiTxt = document.getElementById('aiContent').textContent;
    if (aiTxt && aiTxt.length > 20 && !aiTxt.includes('Klaida') && !aiTxt.includes('analizuoja')) {
        doc.addPage();
        doc.setFillColor(22, 27, 39);
        doc.rect(0, 0, 297, 210, 'F');
        doc.setTextColor(79, 142, 247);
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.text('AI analize (Claude)', 14, 13);
        doc.setTextColor(220, 225, 235);
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'normal');
        doc.text(doc.splitTextToSize(aiTxt, 265), 14, 20);
    }
    doc.save('otdr_analize.pdf');
    toast('PDF atsisiunta');
}

function loadScript(src) {
    if (document.querySelector('script[src="' + src + '"]')) return Promise.resolve();
    return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
    });
}