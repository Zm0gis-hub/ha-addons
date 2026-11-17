# Sveikata – įdiegimo ir naudojimo instrukcija

Galvos skausmų (migrenos) dienoraštis ir išgerto vandens sekimas. Be reklamų, veikia jūsų Home Assistant viduje. Duomenys **automatiškai patenka į Home Assistant atsargines kopijas** ir niekur kitur nesiunčiami.

Kiekvienas žmogus turi **savo profilį** ir mato tik savo duomenis.

---

## 1. Įdiegimas

1. HA: **Nustatymai → Programėlės (Priedai) → Parduotuvė**. Saugykla jau pridėta (iš kitų programų), tad perkraukite puslapį – sąraše atsiras **Sveikata**. *(Jei neatsiranda: ⋮ → Tikrinti atnaujinimus.)*
2. Atidarykite **Sveikata** → **Įdiegti**.
3. Įjunkite **Paleisti įjungus** ir **Rodyti šoniniame meniu**, spauskite **Paleisti**.

## 2. Profiliai (kiekvienam savo)

- Atidarykite Sveikatą per HA programėlę telefone (šoninis meniu → **Sveikata**). Pirmą kartą programa paprašys **sukurti profilį** – įrašykite vardą ir spauskite **Sukurti**.
- Profilis susiejamas su tuo HA naudotoju, kuriuo prisijungta. Kitą kartą jis atsidarys iš karto.
- Antra pusė daro tą patį **savo** telefone (savo HA paskyra). Jos profilio jūs nematysite, o ji – jūsų.
- Svarbu: kiekvienas turi būti prisijungęs prie HA **savo** naudotoju. Jei antra pusė dar neturi HA paskyros: HA → **Nustatymai → Žmonės → Pridėti asmenį** (įjunkite „Leisti prisijungti“).
- *(Nebūtina)* **⚙️ Nustatymai → Profilis → Profilio PIN** – jo paklaus, jei profilį bandytų pasirinkti kitas naudotojas arba atidarius naršyklėje per prievadą 8769.

## 3. Kaip naudotis

| Skiltis | Kas ten |
|---|---|
| 💧 **Vanduo** | Paspauskite gėrimą – pridedamas įprastas kiekis (pvz. +250 ml). **Kava** turi rūšis: paspaudus iššoka pasirinkimas (Americano, Cappuccino). **Kitas kiekis** – pasirinkti kiekį ar laiką. Žiedas rodo dienos tikslą. Įrašą ištrinti – ✕. **📈 Istorija** – 7/30/90 dienų. |
| 🤕 **Galva** | **Skauda galvą** – vienas paspaudimas + stiprumas. Kol skauda, viršuje juosta: **💊 Vaistai**, **✏️ Pildyti** (simptomai, provokatoriai ir kt.), **✔ Praėjo**. Kalendoriuje dienos nuspalvintos pagal stiprumą, 💊 – vartoti vaistai. **Įrašyti praėjusį** – jei pamiršote įrašyti. |
| 📋 **Ataskaita** | Ataskaita gydytojui už 1/3/6/12 mėn. ar savo laikotarpį. **🖨 Spausdinti / PDF** (patogiausia kompiuteryje → „Išsaugoti kaip PDF“) ir **CSV** Excel'iui. Apačioje – „Klausimai gydytojui“. |
| ⚙️ **Nustatymai** | Vardas, vandens tikslas, gėrimai (pavadinimas, kiekis, ar skaičiuoti į tikslą, kofeinas, rūšys – pvz. Kava → Americano / Cappuccino), **mano vaistai** (rūšis svarbi ataskaitai), pranešimai, laikrodis, duomenų atsisiuntimas. |

**Vaistų rūšis** (triptanas, nuskausminamasis, NVNU ir kt.) naudojama ataskaitoje: skaičiuojama, kiek dienų per mėnesį vartota vaistų nuo skausmo. Jei jų daug, ataskaitoje atsiranda pastaba – verta aptarti su gydytoju.

## 4. Pranešimai telefone

**⚙️ Nustatymai → 🔔 Pranešimai telefone.** Telefonas surandamas automatiškai pagal jūsų HA naudotoją (jei ne – pažymėkite). **📨 Išbandyti**.

- **💧 Priminti atsigerti** – tik tada, kai atsiliekate nuo dienos tikslo ir seniai gėrėte, ne dažniau nei nurodyta. Pranešime yra mygtukai „+250 ml vanduo“ – paspaudus įrašoma iš karto (pranešimas matomas ir laikrodyje).
- **💊 Ar padėjo vaistai?** – po nurodyto laiko (numatytai 2 val.) atsiunčiamas klausimas su mygtukais Padėjo / Iš dalies / Nepadėjo.

Priedas turi būti rodomas šoniniame meniu, kad paspaudus pranešimą atsidarytų Sveikata.

## 5. Laikrodis (Wear OS, pvz. OnePlus Watch 2R)

Laikrodžiui yra du failai: programėlė **Sveikata** ir ciferblatas **Sveikata – vanduo**. Jie veikia ir ne namie (per HA išorinį adresą, pvz. Nabu Casa).

### a) Įdiegimas iš kompiuterio (Windows)

1. Laikrodyje: **Nustatymai → Sistema → Apie → 7 kartus bakstelėkite „Versijos numeris“** (įsijungia Kūrėjo parinktys).
2. **Kūrėjo parinktys**: įjunkite **ADB derinimas** ir **Belaidis derinimas**. Laikrodis turi būti tame pačiame Wi-Fi kaip kompiuteris.
3. Kompiuteryje paleiskite failą **Idiegti-sveikata-i-laikrodi.bat** (dukart spustelėkite) ir sekite nurodymus. Failas pats atsisiunčia viską, ko reikia, ir įdiegia abu failus.
4. Baigus laikrodyje galite išjungti **Belaidis derinimas**.

Failus galima atsisiųsti ir ranka: [programėlė](https://github.com/Zm0gis-hub/ha-addons/releases/download/sveikata-laikrodis/sveikata-laikrodis.apk), [ciferblatas](https://github.com/Zm0gis-hub/ha-addons/releases/download/sveikata-laikrodis/sveikata-ciferblatas.apk).

### b) Susiejimas su savo profiliu

1. Telefone: **Sveikata → ⚙️ Nustatymai → ⌚ Laikrodis → Susieti laikrodį**.
2. Pirmą kartą (tik vieną kartą abiem): įrašykite HA adresą iš išorės (pvz. `https://xxxx.ui.nabu.casa`) ir **ilgalaikį prieigos raktą** (HA → jūsų vardas apačioje kairėje → **Sauga** → **Ilgalaikiai prieigos raktai** → **Sukurti raktą**; administratoriaus paskyroje). **Išsaugoti ir patikrinti**.
3. **Gauti susiejimo kodą**. Laikrodyje (namų Wi-Fi) atidarykite **Sveikata** ir įveskite 6 skaitmenų kodą.
4. Antra pusė savo laikrodį susieja atidariusi Sveikatą **savo** telefone – laikrodis bus susietas su jos profiliu.

### c) Ciferblatas su vandens „+“

1. Laikrodyje ilgai palaikykite ciferblatą → slinkite iki galo → **＋ Pridėti** → **Sveikata – vanduo**.
2. Kraštu – šiandien išgerto vandens žiedas, apačioje – kiek išgerta ir **＋**. Paspaudus **＋** pridedama įprasta vandens porcija (laikrodis švelniai suvirpa).
3. Jei vietoje kiekio parašyta „Vanduo: nustatykite“: ilgai palaikykite ciferblatą → **Redaguoti** (pieštukas) → slinkite iki komplikacijų → palieskite apatinę vietą → **Sveikata → Vanduo ＋ (paspaudus pridedama)**.
4. Kairė ir dešinė vietos (žingsniai, baterija) keičiamos ten pat.

### d) Kiti būdai

- **Komplikacija bet kuriam ciferblatui** (pvz. OnePlus): redaguojant ciferblatą pasirinkite **Sveikata → Vanduo ＋** (paspaudus pridedama) arba **Vanduo (atidaro programėlę)**.
- **Plytelė**: braukite ciferblatą į kairę → ilgai palaikykite plytelę → **＋** → **Vanduo**. Trys greiti mygtukai (pirmi trys gėrimai sąraše).
- **Programėlė Sveikata**: visi gėrimai (ilgai palaikius – kitas kiekis; Kava – rūšių pasirinkimas), **↶ Atšaukti paskutinį**, **🤕 Skauda galvą** su stiprumu, **💊 Išgėriau vaistų**, **✔ Praėjo**.

Be ryšio įrašai išsaugomi laikrodyje ir išsiunčiami, kai ryšys atsiranda.

## 6. Prievadai

Receptai 8765, Rodukas 8766, Ūkis 8767, Dovanos 8768, **Sveikata 8769** (naršyklė kompiuteryje namų tinkle, laikrodžio susiejimas).
