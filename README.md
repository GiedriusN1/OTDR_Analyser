# OTDR SOR Analizatorius

Modulinė OTDR matavimų (SOR formatu) analizės priemonė su kelių bangų ilgių palyginimu, AI diagnostika (Claude) ir ataskaitų eksportu.

## Savybės

- **SOR failų nuskaitymas** – palaiko standartinį SOR formatą (Map / non‑Map).
- **Kelių bangų ilgių analizė** – automatiškai atpažįsta 1310, 1383, 1490, 1550, 1625 nm.
- **Įvykių (eventų) atpažinimas** – suvirinimai, atspindžiai, WDM/PON, kabelio galai.
- **Išsami diagnostika** – slopinimas, ORL, makrolenkimai, vandens smailė, splitter identifikavimas.
- **Kokybės balas** – nuo 0 iki 100, su spalvotu vertinimu.
- **Interaktyvūs grafikai** – vilkite A/B žymeklius, kad matuotumėte nuostolius atkarpoje.
- **Eventų juosta** – vizualus įvykių išdėstymas palei skaidulą.
- **Claude AI integracija** – generuokite technines ataskaitas lietuvių ar anglų kalba.
- **Dvikalbė sąsaja** – visas vartotojo sąsaja gali būti rodoma lietuvių arba anglų kalba.
- **Eksportas** – į Excel (XLSX) ir PDF.

## Technologijos

- HTML5 / CSS3 / JavaScript (ES modules)
- [Chart.js](https://www.chartjs.org/) – reflektogramos braižymas
- [Tabler Icons](https://tabler.io/icons) – piktogramos
- [SheetJS](https://sheetjs.com/) – Excel eksportas
- [jsPDF](https://github.com/parallax/jsPDF) + [jspdf-autotable](https://github.com/simonbengtsson/jspdf-autotable) – PDF eksportas

## Diegimas ir paleidimas

1.  **Atsisiųskite arba klonuokite repozitoriją.**

2.  **Nukopijuokite visus failus** į norimą aplanką. Struktūra turi būti tokia:

```
OTDR_Analyser/
    public/
        index.html
        css/
            styles.css
        js/
            config.js
            utils.js
            state.js
            translations.js
            parser.js
            diagnostics.js
            render.js
            chart.js
            ai.js
            export.js
            app.js
    README.md
```

# OTDR SOR Analizatorius

Modulinė OTDR matavimų (SOR formatu) analizės priemonė su kelių bangų ilgių palyginimu, AI diagnostika (Claude) ir ataskaitų eksportu.

## Savybės

- **SOR failų nuskaitymas** – palaiko standartinį SOR formatą (Map / non‑Map).
- **Kelių bangų ilgių analizė** – automatiškai atpažįsta 1310, 1383, 1490, 1550, 1625 nm.
- **Įvykių (eventų) atpažinimas** – suvirinimai, atspindžiai, WDM/PON, kabelio galai.
- **Išsami diagnostika** – slopinimas, ORL, makrolenkimai, vandens smailė, splitter identifikavimas.
- **Kokybės balas** – nuo 0 iki 100, su spalvotu vertinimu.
- **Interaktyvūs grafikai** – vilkite A/B žymeklius, kad matuotumėte nuostolius atkarpoje.
- **Eventų juosta** – vizualus įvykių išdėstymas palei skaidulą.
- **Claude AI integracija** – generuokite technines ataskaitas lietuvių ar anglų kalba.
- **Dvikalbė sąsaja** – visas vartotojo sąsaja gali būti rodoma lietuvių arba anglų kalba.
- **Eksportas** – į Excel (XLSX) ir PDF.

## Technologijos

- HTML5 / CSS3 / JavaScript (ES modules)
- [Chart.js](https://www.chartjs.org/) – reflektogramos braižymas
- [Tabler Icons](https://tabler.io/icons) – piktogramos
- [SheetJS](https://sheetjs.com/) – Excel eksportas
- [jsPDF](https://github.com/parallax/jsPDF) + [jspdf-autotable](https://github.com/simonbengtsson/jspdf-autotable) – PDF eksportas

## Diegimas ir paleidimas

1. Atsisiųskite arba klonuokite repozitoriją.

2. Įsitikinkite, kad aplankų struktūra yra tokia:

```
OTDR_Analyser/
    public/
        index.html
        css/
            styles.css
        js/
            config.js
            utils.js
            state.js
            translations.js
            parser.js
            diagnostics.js
            render.js
            chart.js
            ai.js
            export.js
            app.js
    README.md
```

3. Paleiskite statinį serverį nukreipdami į `public/` aplanką:

   - **Visual Studio Code** su *Live Server*: dešiniuoju pelės mygtuku ant `index.html` → *Open with Live Server*.
   - **Python**:
     ```bash
     cd public
     python3 -m http.server 8000
     ```
   - **Node.js** (su serve paketu):
     ```bash
     npx serve public
     ```

4. Atidarykite naršyklėje adresą, kurį pateikė serveris (pvz., `http://localhost:8000`).

## Naudojimas

1. **Įkelkite SOR failus** – spauskite *Failai* arba *Aplankas* ir pasirinkite matavimo failus.
2. **Nustatykite parinktis** – pažymėkite *Linijoje yra WDM / PON*, jei taikoma.
3. **Spauskite *Analizuoti*** – sistema nuskaitys failus, atliks diagnostiką ir parodys rezultatus.
4. **Naršykite skirtukus** – *Apžvalga*, *Grafikai*, *Event'ai*, *Diagnostika*, *λ Palyginimas*, *Claude AI*.
5. **Keiskite kalbą** – viršuje dešinėje paspauskite LT / EN mygtukus, kad perjungtumėte sąsają.
6. **Naudokite AI** – įveskite savo Claude API raktą (išsaugomas naršyklėje), pasirinkite kalbą ir spauskite *Analizuoti su Claude*.
7. **Eksportuokite** – mygtukai *Excel* ir *PDF* sukuria ataskaitas.

## API raktas

AI funkcijai reikalingas [Claude API raktas](https://console.anthropic.com/settings/keys). Raktas saugomas naršyklės lokalioje saugykloje (localStorage). **Niekada neskelbkite savo rakto viešai.**

## Licencija

Šis projektas yra atviro kodo (MIT). Naudokite savo rizika, be jokių garantijų.

Update 2026-06-28: Visi moduliai yra atskirti, `translations.js` turi visus reikalingus raktus, o `app.js` – pagrindinis įėjimo taškas su kalbos perjungimu. 
Sąsaja dabar pilnai veikia tiek lietuvių, tiek anglų kalbomis.
