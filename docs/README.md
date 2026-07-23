# OTDR SOR Analizatorius / OTDR SOR Analyzer

Modulinė, naršyklėje veikianti OTDR (SOR formatu) matavimų analizės priemonė su kelių bangų ilgių palyginimu, AI diagnostika (Claude) ir ataskaitų eksportu.
A modular, browser-based analysis tool for OTDR measurements (SOR format) with multi-wavelength comparison, AI diagnostics (Claude), and report export.

**🇱🇹 [Lietuvių](#lietuvių) · 🇬🇧 [English](#english)**

---

## Lietuvių

### Apie projektą

Šis įrankis leidžia įkelti vieną ar kelis `.sor` failus (Bellcore/Telcordia GR-196 formatas), automatiškai juos išanalizuoti pagal ITU-T G.652D rekomendacijas ir gauti suprantamą, lietuviškai/angliškai paaiškintą diagnostiką — be jokio serverio ar backend'o, viskas skaičiuojama naršyklėje.

### Savybės

- **SOR failų nuskaitymas** – standartinis Bellcore/Telcordia SOR formatas (su/be Map bloko).
- **Kelių bangų ilgių analizė** – automatiškai atpažįsta 1310, 1383, 1490, 1550, 1625, 1650 nm ir DWDM kanalus (WDM režimu rodomas tikslus bangos ilgis).
- **Įvykių (event'ų) atpažinimas** – suvirinimai, jungtys/atspindžiai, WDM/PON atšakos, PON splitterių santykiai (1:2, 1:4 ... 1:64), kabelio galas.
- **Segmentų slopinimo analizė** – slankaus lango algoritmas randa padidėjusio slopinimo ruožus (galimas lenkimas, įtempimas, movos problema), su automatiniu OTDR prijungimo (launch) artefakto ir dead zone atmetimu.
- **Makrolenkimo aptikimas** – tiek pavienių taškų (1550 vs 1310 nm santykis), tiek visos linijos lygmeniu (1310/1550/1625/1650 nm palyginimas), su vandens smailės (1383 nm) patikra.
- **Ghost atspindžių aptikimas** – įrodymais grįstas balų algoritmas (Frenelio fizikos riba + atstumų/stiprumo atitikimas), kad realūs defektai nebūtų painiojami su antriniais atspindžiais.
- **Triukšmo zonos / dead zone apsauga** – automatiškai randa tašką, kur trasa tampa statistiniu triukšmu, ir toliau nebetęsia segmentų analizės, kad triukšmas nebūtų klaidingai palaikytas „kritiniu pažeidimu“.
- **Matavimo Range patikra** – įspėja, jei paskutinis įvykis yra arti pat nustatyto Range ribos (galimai per mažas Range numatomam linijos ilgiui).
- **1 km dirbtinės (launch) linijos palaikymas** – varnelė, kuri automatiškai atima dirbtinės linijos ilgį iš visų atstumų ir event'ų.
- **Matavimo kokybės balas** – 0–100 (★–★★★★★), vertina impulso plotį, vidurkinimo trukmę, launch kabelio naudojimą, deklaruoto linijos galo patikimumą ir Range atsargą.
- **Kabelio lygmens (kelių skaidulų) analizė** – lygina to paties kabelio skaidulas tarpusavyje.
- **Interaktyvūs grafikai** – vilkite A/B žymeklius tiesiai ant reflektogramos, kad matuotumėte nuostolį bet kurioje atkarpoje.
- **Event'ų juosta ir lentelė** – vizualus event'ų išdėstymas, redaguojamas tipas ir pastabos kiekvienam event'ui.
- **Claude AI integracija** – generuokite techninę ataskaitą lietuvių arba anglų kalba tiesiogiai iš analizės duomenų.
- **Dvikalbė sąsaja** – visa sąsaja perjungiama tarp lietuvių ir anglų kalbų vienu mygtuku.
- **Eksportas** – pilna Excel (XLSX) ir spausdinimui pritaikyta PDF ataskaita (su įkomponuotu šriftu lietuviškiems simboliams).

### Failų struktūra

```
docs/
├── index.html                    – pagrindinis HTML puslapis, importmap
├── favicon.ico / .png / .svg
├── css/
│   └── styles.css                – visa sąsajos stilistika (šviesi/tamsi tema)
├── js/
│   ├── app.js                    – įėjimo taškas: failų įkėlimas, mygtukų/varnelių logika
│   ├── state.js                  – bendra programos būsena (įkelti failai, diagnostika, parinktys)
│   ├── config.js                 – bangos ilgių spalvų paletė
│   ├── translations.js           – LT/EN vertimų žodynas ir t()/applyTranslations()
│   ├── utils.js                  – bendri pagalbiniai metodai, 1 km linijos korekcija, launch artefakto skaičiavimas
│   ├── rules.js                  – visos diagnostikos ribos (ITU-T G.652D) vienoje vietoje
│   ├── parser.js                 – binarinio SOR failo skaitytuvas
│   ├── diagnostics.js            – pagrindinis diagnostikos variklis (segmentai, ORL, makrolenkimas, WDM/PON)
│   ├── advanced-diagnostics.js   – ghost'ų aptikimas, launch zonos užuominos, triukšmo zonos (dead zone) aptikimas
│   ├── measurement-quality.js    – matavimo kokybės balas (impulsas, vidurkinimas, Range atsarga, galo patikimumas)
│   ├── fiber-analysis.js         – kabelio lygmens (kelių skaidulų) analizė
│   ├── chart.js                  – Chart.js reflektogramos braižymas + A/B žymeklių sluoksnis
│   ├── render.js                 – visų skirtukų (Apžvalga/Event'ai/Diagnostika/λ) DOM atvaizdavimas
│   ├── ai.js                     – Claude API integracija
│   ├── export.js                 – Excel ir PDF ataskaitų generavimas
│   ├── fonts_data.js             – įkomponuotas NotoSans šriftas (base64) PDF eksportui
│   └── package.json              – tuščias Node metaduomenų failas (be paleidžiamų priklausomybių)
├── server.js                     – minimalus statinis Node serveris lokaliam peržiūrėjimui
├── package.json                  – Node metaduomenys (be paleidžiamų priklausomybių)
└── README.md                     – šis failas
```

### Technologijos

- HTML5 / CSS3 / JavaScript (ES modules), be jokio build žingsnio ar framework'o.
- [Chart.js](https://www.chartjs.org/) – reflektogramos braižymas.
- [Tabler Icons](https://tabler.io/icons) – piktogramos.
- [SheetJS](https://sheetjs.com/) – Excel eksportas.
- [jsPDF](https://github.com/parallax/jsPDF) + [jspdf-autotable](https://github.com/simonbengtsson/jspdf-autotable) – PDF eksportas.
- Visos trys bibliotekos (Chart.js/SheetJS/jsPDF) įkeliamos iš CDN – jokių `npm install` priklausomybių paleidimui nereikia.

### Diegimas ir paleidimas

1. Atsisiųskite arba klonuokite repozitoriją ir pereikite į `docs/` aplanką.

2. Paleiskite statinį serverį (bet kurį iš šių būdų):

   - **Įkomponuotas Node serveris** (be jokių priklausomybių):
     ```bash
     node server.js
     ```
     Atsidarys `http://127.0.0.1:8000`.
   - **Python**:
     ```bash
     python3 -m http.server 8000
     ```
   - **Node.js** (su `serve` paketu):
     ```bash
     npx serve .
     ```
   - **Visual Studio Code** su *Live Server*: dešiniuoju pelės mygtuku ant `index.html` → *Open with Live Server*.

3. Atidarykite naršyklėje adresą, kurį pateikė serveris.

### Naudojimas

1. **Įkelkite SOR failus** – spauskite *Failai* arba *Aplankas* ir pasirinkite matavimo failus.
2. **Nustatykite parinktis** – pažymėkite *Linijoje yra WDM / PON* ir/arba *Matavime yra 1 km dirbtinė linija*, jei taikoma.
3. **Spauskite *Analizuoti*** – sistema nuskaitys failus, atliks diagnostiką ir parodys rezultatus.
4. **Naršykite skirtukus** – *Apžvalga*, *Grafikai*, *Event'ai*, *Diagnostika*, *λ Palyginimas*, *Claude AI*.
5. **Keiskite kalbą** – viršuje dešinėje paspauskite LT / EN mygtukus.
6. **Naudokite AI** – įveskite savo Claude API raktą (išsaugomas naršyklėje), pasirinkite kalbą ir spauskite *Analizuoti su Claude*.
7. **Eksportuokite** – mygtukai *Excel* ir *PDF* sukuria pilnas ataskaitas.

### API raktas

AI funkcijai reikalingas [Claude API raktas](https://console.anthropic.com/settings/keys). Raktas saugomas tik naršyklės lokalioje saugykloje (localStorage) – niekur nesiunčiamas, išskyrus tiesiogiai į Anthropic API. **Niekada neskelbkite savo rakto viešai.**

### Licencija

Šis projektas yra atviro kodo (MIT). Naudokite savo rizika, be jokių garantijų.

---

## English

### About

This tool lets you load one or more `.sor` files (Bellcore/Telcordia GR-196 format), automatically analyze them against ITU-T G.652D recommendations, and get clear, plain-language diagnostics in Lithuanian or English — entirely in the browser, no server or backend required.

### Features

- **SOR file parsing** – standard Bellcore/Telcordia SOR format (with or without a Map block).
- **Multi-wavelength analysis** – auto-detects 1310, 1383, 1490, 1550, 1625, 1650 nm and DWDM channels (exact wavelength shown in WDM mode).
- **Event recognition** – splices, connectors/reflections, WDM/PON branches, PON splitter ratios (1:2, 1:4 … 1:64), end of fiber.
- **Segment attenuation analysis** – a sliding-window algorithm finds sections of elevated loss (possible bend, tension, bad splice), with automatic exclusion of the OTDR launch (connector) artifact and dead zone.
- **Macrobend detection** – both single-point (1550 vs 1310 nm ratio) and whole-line level (1310/1550/1625/1650 nm comparison), plus a water-peak (1383 nm) check.
- **Ghost reflection detection** – an evidence-based scoring algorithm (Fresnel physics limit + distance/strength matching), so real defects aren't confused with secondary reflections.
- **Noise-zone / dead-zone protection** – automatically finds the point where the trace becomes statistical noise and stops segment analysis there, so noise isn't misread as "critical damage".
- **Measurement range check** – warns when the last detected event sits right at the edge of the configured Range (possibly too short for the actual fiber length).
- **1 km artificial launch line support** – a checkbox that automatically subtracts the launch line's length from every distance and event.
- **Measurement quality score** – 0–100 (★–★★★★★), scoring pulse width, averaging time, launch cable usage, declared-end reliability, and range margin.
- **Cable-wide (multi-fiber) analysis** – cross-compares fibers belonging to the same cable.
- **Interactive charts** – drag A/B markers directly on the reflectogram to measure loss over any section.
- **Event strip and table** – visual event layout, editable type and per-event notes.
- **Claude AI integration** – generate a technical report in Lithuanian or English directly from the analysis data.
- **Bilingual UI** – the entire interface switches between Lithuanian and English with one click.
- **Export** – full Excel (XLSX) and print-ready PDF reports (with an embedded font for Lithuanian characters).

### File structure

```
docs/
├── index.html                    – main HTML page, import map
├── favicon.ico / .png / .svg
├── css/
│   └── styles.css                – all UI styling (light/dark theme)
├── js/
│   ├── app.js                    – entry point: file loading, button/checkbox wiring
│   ├── state.js                  – shared app state (loaded files, diagnostics, options)
│   ├── config.js                 – wavelength color palette
│   ├── translations.js           – LT/EN string dictionary and t()/applyTranslations()
│   ├── utils.js                  – shared helpers, 1 km line correction, launch artifact detection
│   ├── rules.js                  – all diagnostic thresholds (ITU-T G.652D) in one place
│   ├── parser.js                 – binary SOR file reader
│   ├── diagnostics.js            – core diagnostics engine (segments, ORL, macrobend, WDM/PON)
│   ├── advanced-diagnostics.js   – ghost detection, launch-zone hints, noise-zone (dead zone) detection
│   ├── measurement-quality.js    – measurement quality score (pulse, averaging, range margin, end reliability)
│   ├── fiber-analysis.js         – cable-wide (multi-fiber) analysis
│   ├── chart.js                  – Chart.js reflectogram rendering + A/B marker overlay
│   ├── render.js                 – DOM rendering for all tabs (Overview/Events/Diagnostics/λ)
│   ├── ai.js                     – Claude API integration
│   ├── export.js                 – Excel and PDF report generation
│   ├── fonts_data.js             – embedded NotoSans font (base64) for PDF export
│   └── package.json              – empty Node metadata file (no runtime dependencies)
├── server.js                     – minimal static Node server for local preview
├── package.json                  – Node metadata (no runtime dependencies)
└── README.md                     – this file
```

### Technology

- HTML5 / CSS3 / JavaScript (ES modules), no build step or framework.
- [Chart.js](https://www.chartjs.org/) – reflectogram rendering.
- [Tabler Icons](https://tabler.io/icons) – icons.
- [SheetJS](https://sheetjs.com/) – Excel export.
- [jsPDF](https://github.com/parallax/jsPDF) + [jspdf-autotable](https://github.com/simonbengtsson/jspdf-autotable) – PDF export.
- All three libraries (Chart.js/SheetJS/jsPDF) are loaded from a CDN – no `npm install` is needed to run the app.

### Installation & running

1. Download or clone the repository and go into the `docs/` folder.

2. Start a static server (any of the following):

   - **Built-in Node server** (no dependencies):
     ```bash
     node server.js
     ```
     Opens at `http://127.0.0.1:8000`.
   - **Python**:
     ```bash
     python3 -m http.server 8000
     ```
   - **Node.js** (with the `serve` package):
     ```bash
     npx serve .
     ```
   - **Visual Studio Code** with *Live Server*: right-click `index.html` → *Open with Live Server*.

3. Open the address the server printed in your browser.

### Usage

1. **Load SOR files** – click *Files* or *Folder* and select your measurement files.
2. **Set options** – check *Line has WDM / PON* and/or *Measurement uses a 1 km artificial line* if applicable.
3. **Click *Analyze*** – the app parses the files, runs diagnostics, and shows the results.
4. **Browse the tabs** – *Overview*, *Charts*, *Events*, *Diagnostics*, *λ Comparison*, *Claude AI*.
5. **Switch language** – click the LT / EN buttons in the top right.
6. **Use AI** – enter your Claude API key (stored in your browser), pick a language, and click *Analyze with Claude*.
7. **Export** – the *Excel* and *PDF* buttons produce full reports.

### API key

The AI feature requires a [Claude API key](https://console.anthropic.com/settings/keys). The key is stored only in your browser's local storage (localStorage) and is never sent anywhere except directly to the Anthropic API. **Never share your key publicly.**

### License

This project is open source (MIT). Use at your own risk, with no warranties.
