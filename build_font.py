"""
Sukuria docs/js/fonts_data.js su pilnu NotoSans šriftu (Regular+Bold),
palaikančiu lietuviškus diakritikus IR baziné lotynu abecele,
suderinamu su jsPDF 2.5.1 (composite glifai isplokstinti).

Paleiskite is projekto sakninio aplanko (kur yra docs/ poaplankis):
    python3 build_font.py
"""
import subprocess
import sys
import os
import base64
import shutil
import tempfile

def run(cmd, cwd=None):
    use_shell = os.name == 'nt' and cmd[0] in ('npm', 'npx')
    print(">>", " ".join(cmd))
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, shell=use_shell)
    if r.returncode != 0:
        print("STDOUT:", r.stdout)
        print("STDERR:", r.stderr)
        raise SystemExit(f"Klaida vykdant: {' '.join(cmd)}")
    return r.stdout

def decompose_composites(font_path, out_path):
    from fontTools.ttLib import TTFont
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    f = TTFont(font_path)
    glyf = f['glyf']
    glyph_set = f.getGlyphSet()
    count = 0
    for name in f.getGlyphOrder():
        g = glyf[name]
        if g.isComposite():
            count += 1
            dpen = DecomposingRecordingPen(glyph_set)
            glyph_set[name].draw(dpen)
            pen = TTGlyphPen(glyph_set)
            dpen.replay(pen)
            glyf[name] = pen.glyph()
    f.save(out_path)
    print(f"  Isplokstinta {count} composite glifu ({os.path.basename(font_path)})")

def main():
    # 1) Randame docs/js/ aplanka
    docs_js = None
    for candidate in ['docs/js', 'js']:
        if os.path.isdir(candidate):
            docs_js = candidate
            break
    if not docs_js:
        raise SystemExit("Nerandu docs/js/ aplanko. Paleiskite skripta is projekto sakninio aplanko.")
    print("Rasta docs/js/ aplankas:", os.path.abspath(docs_js))

    tmp = tempfile.mkdtemp(prefix="fontbuild_")
    print("Laikinas aplankas:", tmp)

    # 2) npm install @fontsource/noto-sans
    run(["npm", "init", "-y"], cwd=tmp)
    run(["npm", "install", "@fontsource/noto-sans"], cwd=tmp)

    files_dir = os.path.join(tmp, "node_modules", "@fontsource", "noto-sans", "files")
    if not os.path.isdir(files_dir):
        raise SystemExit(f"Nerandu {files_dir} - npm install nepavyko?")

    from fontTools.ttLib import TTFont

    outputs = {}
    for weight, style in [("400", "Regular"), ("700", "Bold")]:
        latin_woff2 = os.path.join(files_dir, f"noto-sans-latin-{weight}-normal.woff2")
        latinext_woff2 = os.path.join(files_dir, f"noto-sans-latin-ext-{weight}-normal.woff2")

        latin_ttf = os.path.join(tmp, f"latin-{style}.ttf")
        latinext_ttf = os.path.join(tmp, f"latinext-{style}.ttf")

        f1 = TTFont(latin_woff2); f1.flavor = None; f1.save(latin_ttf)
        f2 = TTFont(latinext_woff2); f2.flavor = None; f2.save(latinext_ttf)

        merged_ttf = os.path.join(tmp, f"merged-{style}.ttf")
        run([sys.executable, "-m", "fontTools.merge",
             "--output-file=" + merged_ttf, latin_ttf, latinext_ttf])

        subset_ttf = os.path.join(tmp, f"subset-{style}.ttf")
        run([sys.executable, "-m", "fontTools.subset", merged_ttf,
             "--output-file=" + subset_ttf,
             "--unicodes=U+0020-007E,U+00A0-00FF,U+0100-017F,U+2013-2014,U+2018-201E,U+20AC",
             "--layout-features=*", "--glyph-names", "--symbol-cmap", "--legacy-cmap",
             "--notdef-glyph", "--notdef-outline", "--recommended-glyphs"])

        flat_ttf = os.path.join(tmp, f"flat-{style}.ttf")
        decompose_composites(subset_ttf, flat_ttf)

        # Patikra
        chk = TTFont(flat_ttf)
        cmap = chk.getBestCmap()
        missing_basic = [chr(c) for c in list(range(0x41,0x5B))+list(range(0x61,0x7B)) if c not in cmap]
        lt = {'a':0x105,'c':0x10D,'e1':0x119,'e2':0x117,'i':0x12F,'s':0x161,'u1':0x173,'u2':0x16B,'z':0x17E}
        missing_lt = [k for k,v in lt.items() if v not in cmap]
        remaining_composite = sum(1 for n in chk.getGlyphOrder() if chk['glyf'][n].isComposite())
        print(f"  {style}: truksta baziniu={missing_basic}, truksta LT={missing_lt}, liko composite={remaining_composite}")
        if missing_basic or missing_lt or remaining_composite:
            raise SystemExit(f"PATIKRA NEPAVYKO del {style}!")

        with open(flat_ttf, 'rb') as fh:
            outputs[style] = base64.b64encode(fh.read()).decode('ascii')

    # 3) Generuojame fonts_data.js
    content = '''// NotoSans TTF sriftas (Regular + Bold), ikoduotas base64.
// Naudojamas PDF eksporte (export.js) lietuviskiems diakritikams.
// Sugeneruota automatiskai build_font.py skriptu (merge + subset + decompose).

export const NOTOSANS_REGULAR_BASE64 = "''' + outputs["Regular"] + '''";

export const NOTOSANS_BOLD_BASE64 = "''' + outputs["Bold"] + '''";
'''
    out_path = os.path.join(docs_js, "fonts_data.js")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(content)

    print()
    print("SEKME! Irasyta:", os.path.abspath(out_path))
    print("Dydis:", os.path.getsize(out_path), "baitu")

    shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main()