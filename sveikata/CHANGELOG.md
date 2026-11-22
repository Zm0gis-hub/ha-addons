# Pakeitimai

## 1.4.1
- Importo failo pasirinkimas veikia ir HA programėlėje telefone (be failų tipo apribojimo).

## 1.4.0
- **Kuri pusė skauda:** kairė, dešinė, abi vienodai, abi – kairė stipriau, abi – dešinė stipriau (mažos galvutės rodo, kuri pusė stipresnė). Seni įrašai lieka kaip buvo („Abi pusės“ = abi vienodai).
- **Ataskaitoje** – atskiras blokas „Kuri pusė skauda“: kiek kartų kairėje, dešinėje, abiejose ir kuri dažniau.

## 1.3.0
- **⬆ Importuoti galvos skausmų įrašus** (Nustatymai → Duomenys): JSON failas su senais įrašais (pvz. iš užrašų). Prieš įrašant parodoma, kiek įrašų ir už kokį laikotarpį bus pridėta; jau esantys (ta pati pradžia) praleidžiami, nauji vaistai pridedami automatiškai.
- Ataskaitoje vidutinė trukmė skaičiuojama tik įrašams su žinoma pabaiga.

## 1.2.1
- **Kur skauda:** naujas galvos piešinys (pagal eskizą) su švytinčiomis pažymėtomis sritimis ir paaiškinimu. Galvą galima **apsukti** (↻ Iš nugaros / Iš priekio) – iš nugaros pažymimas pakaušis.
- Mygtukai su mažomis galvutėmis: Kairė pusė, Abi pusės, Dešinė pusė (tik viena), Pakaušis, Kaklas – sutampa su piešiniu.
- Po piešiniu rodoma, kas pažymėta.

## 1.2.0
- **🤕 Galvos skausmo pildymas žingsniais:** po vieną klausimą – stiprumas slankikliu su spalva, vieta paspaudžiama ant galvos piešinio, pobūdis, simptomai ir provokatoriai dideliais mygtukais su ženkliukais, vaistai su „ar padėjo“, kas padėjo ir pastabos. Bet kurį žingsnį galima praleisti, išsaugoti – bet kada.
- Mygtukas **＋ Galvos skausmas** – mažas ir kuklus (telefone ir laikrodyje), daugiau vietos vandeniui.
- **💧 Žiedo animacija:** pridėjus gėrimą žiedas sklandžiai prisipildo, skaičius keičiasi palaipsniui (telefone ir laikrodžio programėlėje).
- Pataisa: įrašant praėjusį skausmą jis nebelieka „dar skauda“.
- Laikrodžio programėlė 1.2 (įdiegti iš naujo tuo pačiu failu).

## 1.1.0
- **☕ Kavos rūšys:** paspaudus „Kava“ iššoka pasirinkimas – Americano viengubas (150 ml), Americano dvigubas (250 ml), Cappuccino dvigubas (250 ml). Telefone ir laikrodyje (programėlėje ir plytelėje).
- Rūšis galima pridėti bet kuriam gėrimui: Nustatymai → Gėrimai → gėrimas → „Rodyti kaip rūšį po“. Kiekiai ir kofeinas keičiami kiekvienai rūšiai atskirai.
- Laikrodžio programėlė 1.1 (reikia įdiegti iš naujo tuo pačiu failu).

## 1.0.0
- Pirmoji versija.
- **Profiliai:** kiekvienas žmogus turi savo profilį ir mato tik savo duomenis. Atidarius per Home Assistant profilis parenkamas pagal prisijungusį HA naudotoją.
- **💧 Vanduo:** gėrimų mygtukai (vanduo, kava, arbata, limonadas, sultys – galima keisti), dienos tikslas, žiedas, šiandienos sąrašas, savaitės ir 30/90 dienų istorija, kofeino skaičiavimas.
- **🤕 Galvos skausmų dienoraštis:** pradžia ir pabaiga, stiprumas 0–10, tipas, vieta, pobūdis, simptomai, galimi provokatoriai, vaistai ir ar padėjo, kas dar padėjo, poveikis dienai, pastabos. Kalendorius su spalvomis.
- **📋 Ataskaita gydytojui:** santrauka, lentelė pagal mėnesius, kalendoriai, vaistų poveikis, dažniausi provokatoriai ir simptomai, visi įrašai, klausimai gydytojui. Spausdinimas / PDF ir CSV (Excel).
- **🔔 Pranešimai telefone:** priminimas atsigerti (su mygtukais „+250 ml“) ir klausimas „Ar padėjo vaistai?“ (Padėjo / Iš dalies / Nepadėjo).
- **⌚ Laikrodis (Wear OS):** programėlė, ciferblatas su vandens „+“, komplikacija bet kuriam ciferblatui ir plytelė.
