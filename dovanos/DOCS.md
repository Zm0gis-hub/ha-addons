# Dovanos – įdiegimo ir naudojimo instrukcija

Dovanų idėjos, progos ir išlaidos vienoje vietoje: Kalėdos, gimtadieniai, Velykos, Mamos ir Tėčio dienos, Joninės ir kitos progos. Programa veikia jūsų Home Assistant viduje. Visi duomenys **automatiškai patenka į Home Assistant atsargines kopijas** ir niekur kitur nesiunčiami.

---

## 1. Įdiegimas

Jei saugykla HA jau pridėta (pvz. diegiant kitą šios saugyklos programą), 1 žingsnį praleiskite.

1. HA: **Nustatymai → Programėlės (Priedai) → Parduotuvė → ⋮ (viršuje dešinėje) → Saugyklos** (Repositories). Įklijuokite saugyklos adresą (žr. README) ir spauskite **Pridėti**.
2. Perkraukite puslapį. Sąraše atsiras **Dovanos**. Atidarykite ir spauskite **Įdiegti**.
3. Įjunkite **Paleisti įjungus** ir **Rodyti šoniniame meniu**, spauskite **Paleisti**.
4. *(Nebūtina)* Skirtuke **Konfigūracija** įrašykite PIN, išsaugokite ir **Paleiskite iš naujo**. PIN reikalingas tik atskirai ikonėlei namų tinkle.

---

## 2. Kaip atidaryti

- **Kompiuteryje ar HA programėlėje:** šoniniame meniu **Dovanos**.
- **Atskira ikonėlė telefone (veikia visur):** Chrome atidarykite `https://<jūsų HA Cloud adresas>/hassio/ingress/xxxxxxxx_dovanos` (kelią matysite adreso juostoje, atidarę Dovanas per šoninį meniu), prisijunkite ir **⋮ → Pridėti prie pradžios ekrano**.
- **Atskira ikonėlė tik namų tinkle:** Chrome atidarykite `http://<HA IP>:8768`, įveskite PIN, tada **⋮ → Pridėti prie pradžios ekrano**.

Prievadai: Receptai 8765, Rodukas 8766, Ūkis 8767, Dovanos 8768.

Sąsaja viena: kompiuteryje meniu kairėje ir kortelės keliais stulpeliais, telefone meniu apačioje ir kortelės viena po kitos.

---

## 3. Kaip naudotis

| Skiltis | Kas ten |
|---|---|
| ⏳ **Artėja** | Artimiausios progos (gimtadieniai ir įjungtos šventės). Matyti, kam jau nupirkta (✓), kam tik idėjos (💡), kam dar nieko (·). Paspaudus – atidaroma proga. |
| 🎁 **Progos** | Visos progos pagal metus su sumomis. **＋ Nauja proga** – bet kuri proga, pvz. krikštynos. |
| 💡 **Idėjos** | Laukiančios idėjos pagal žmogų. **→ Proga** – priskirti idėją progai. |
| 👥 **Žmonės** | Artimieji, jų gimtadieniai ir pastabos. Žmogaus lange – idėjos ir visa dovanų istorija per metus. |
| 📊 **Statistika** | Išlaidos per metus, pagal progą, žmogų ir parduotuvę. |
| 🔍 **Paieška** | „Ar jau dovanojom?“ – ieško per visas dovanas, parduotuves ir žmones. |

**Progos langas** – kaip lentelėje: kiekvienam gavėjui kortelė su dovanomis ir suma.
- **Pridėti dovaną** – rašykite į kortelės apačią ir spauskite Enter. Kainą galima rašyti iškart: `Kava 8,99` arba `Knyga 15 €`.
- **Būsena** – paspauskite ženkliuką kairėje: 💡 Idėja → ✓ Nupirkta → 🎁 Įteikta. Sumoje skaičiuojamos tik nupirktos ir įteiktos.
- Paspaudus dovaną – visi laukai: kam, proga, kaina, parduotuvė, nuoroda, pastaba.
- Jei žmogus turi laukiančių idėjų, jos rodomos kortelėje – paspaudus idėja priskiriama šiai progai.
- **＋ Gavėjas** – pridėti žmogų. **Kiti** – dovanos be konkretaus gavėjo (pvz. kaimynams).
- **⋯** viršuje – biudžetas, pastabos, trynimas.
- Kuriant naujų metų Kalėdas (ar kitą šventę), gavėjai nukopijuojami iš praėjusių metų.

**＋ Idėja** (apačioje dešinėje, matomas visur) – greitas įrašymas: parašote idėją, pasirenkate kam (nebūtina), **Įrašyti**. Patogiausia telefone, kai kas nors šauna į galvą.

**Spalvos** – žmogaus lange **✏️ → Spalva** (pvz. vienos pusės giminei mėlyna, kitos – rožinė). Spalvotas rėmelis matomas progų, žmonių ir idėjų kortelėse. Būsimos datos rodomos žaliai, praėjusios – blankiai.

**Žmogus gali būti ir grupė** – pvz. „Tėvams“ ar „Kaimynams“. Gimtadienis rašomas `MM-DD`, pvz. `03-15`. Žmogaus, kuriam nebedovanojate, netrinkite – pažymėkite **Archyvuoti**, istorija liks.

---

## 4. Importas iš Google Sheets ar Excel

1. Google Sheets: **Failas → Atsisiųsti → Microsoft Excel (.xlsx)**. Viename faile bus visi lapai. *(Tinka ir **.csv**, bet tada atsisiunčiamas tik atidarytas lapas.)*
2. Dovanose: **⚙️ Nustatymai → Pasirinkti .xlsx ar .csv failą**.
3. Atsiras peržiūra: kokios progos, kiek dovanų, kokie gavėjai. Nuimkite varneles nuo to, ko nereikia, ir spauskite **Importuoti**.

Programa atpažįsta tokį išdėstymą: skyriaus eilutė („Kalėdos“, „Gimtadieniai“, „Šventinės dienos“ ir metai), po jos – gavėjų (ar švenčių) pavadinimai, po jais – dovanos su varnele ir kaina. Gimtadienių antraštėse data `MM-DD` tampa žmogaus gimtadieniu. Pažymėtos varnele dovanos tampa „Įteikta“ (būsimoms progoms – „Nupirkta“), nepažymėtos ir prasidedančios „Gal …“ – idėjomis.

Importas tik papildo – to paties failo nekelkite du kartus (peržiūroje jau esančios progos pažymėtos „jau yra“). Jei tas pats žmogus lentelėje užrašytas skirtingai (pvz. „Tomui“ ir „Tomo“), atsiras du žmonės. **Žmonės → 🔗 Sujungti**: programa parodys panašių vardų poras – pasirinkite, kuris vardas lieka (arba įrašykite naują, pvz. „Sesė“), ir spauskite **Sujungti**. Jei pora iš tikrųjų skirtingi žmonės – **Skirtingi**.

---

## 5. Importas iš JSON

Pvz. kai Claude paruošia idėjų sąrašą: **⚙️ → Importuoti JSON**.

```json
{
  "people": [{"name": "Jonas", "birthday": "03-15", "notes": "Mėgsta kavą"}],
  "ideas": [{"title": "Termosas", "person": "Jonas", "price": 25, "shop": "Parduotuvė"}],
  "occasions": [
    {"kind": "christmas", "year": 2026, "recipients": ["Jonas"],
     "gifts": [{"title": "Kava", "person": "Jonas", "price": 8.99, "status": "bought"}]}
  ]
}
```

`kind`: `christmas`, `birthday` (su `"person"`), `easter`, `mother`, `father`, `midsummer`, `valentine`, `other` (su `"title"` ir `"date"`). `status`: `idea`, `bought`, `given`.

---

## 6. Atsarginė kopija ir atnaujinimas

**⚙️ → Atsisiųsti kopiją** – visi duomenys viename faile; **Atkurti iš kopijos** – grąžina juos (dabartiniai pakeičiami).

Kai išleidžiama nauja versija, HA parodo **Yra atnaujinimas** – spauskite **Atnaujinti**. Duomenys nedingsta.
