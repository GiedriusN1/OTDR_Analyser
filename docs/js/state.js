// ── Application state ──
export const state = {
    files: [],          // File objects
    parsed: [],         // parsed SOR results, pakoreguoti arba ne, priklausomai nuo 1km linija buvo naudojama ar ne  
	rawParsed: [],       // originalūs, nepakeisti duomenys
    diagnostics: [],    // diagnosis groups
    activeWls: new Set(),
    hasWdm: false,
	has1kmLine: false,
    aiLang: 'lt',
    markerA: 0.08,
    markerB: 0.5,
    // File System Access API (Chrome/Edge): pasirinkto aplanko rankena, kad
    // .notes.json failus galėtume rašyti TIESIOGIAI šalia .sor failų, be
    // atsisiuntimo į Downloads ir be pakartotinio "Išsaugoti kaip" dialogo.
    sorDirHandle: null,
    fileDirHandles: new Map(), // relPath -> jį saugančio paaplankio rankena
    // Kai failai pasirinkti pavieniui ("Failai" per showOpenFilePicker), aplankas
    // NEŽINOMAS (naršyklė jo neatskleidžia) - bet PAČIO failo rankeną turime, ir
    // ją galime naudoti kaip showSaveFilePicker() "startIn" užuominą, kad
    // Išsaugojimo dialogas atsidarytų TAME PAČIAME aplanke, kuriame yra .sor.
    fileHandles: new Map(), // failo vardas -> FileSystemFileHandle
};

// Helper to reset state (if needed)
export function resetState() {
    state.files = [];
    state.parsed = [];
	state.rawParsed = [];
    state.diagnostics = [];
    state.activeWls = new Set();
    state.hasWdm = false;
	state.has1kmLine = false;
    state.aiLang = 'lt';
    state.markerA = 0.08;
    state.markerB = 0.92;
    state.sorDirHandle = null;
    state.fileDirHandles = new Map();
    state.fileHandles = new Map();
}

