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
}

