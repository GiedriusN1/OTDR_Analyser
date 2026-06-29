// ── Application state ──
export const state = {
    files: [],          // File objects
    parsed: [],         // parsed SOR results
    diagnostics: [],    // diagnosis groups
    activeWls: new Set(),
    hasWdm: false,
    aiLang: 'lt',
    markerA: 0.08,
    markerB: 0.5,
};

// Helper to reset state (if needed)
export function resetState() {
    state.files = [];
    state.parsed = [];
    state.diagnostics = [];
    state.activeWls = new Set();
    state.hasWdm = false;
    state.aiLang = 'lt';
    state.markerA = 0.08;
    state.markerB = 0.92;
}