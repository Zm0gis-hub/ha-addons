# Rodukas – įdiegimo ir naudojimo instrukcija

Augintinio priežiūra: maistas, svoris, skiepai, vizitai, dokumentai ir procedūros. Programa veikia jūsų Home Assistant viduje. Visi duomenys ir įkelti failai (skenai, nuotraukos, PDF) saugomi priedo aplanke ir **automatiškai patenka į Home Assistant atsargines kopijas**.

---

## 1. Įdiegimas

Jei saugykla HA jau pridėta (pvz. diegiant kitą šios saugyklos programą), 1 žingsnį praleiskite.

1. HA: **Nustatymai → Programėlės (Priedai) → Parduotuvė → ⋮ (viršuje dešinėje) → Saugyklos** (Repositories). Įklijuokite saugyklos adresą (žr. README) ir spauskite **Pridėti**.
2. Perkraukite puslapį. Sąraše atsiras skiltis su **Rodukas**. Atidarykite ir spauskite **Įdiegti** (ant Raspberry Pi – kelios minutės).
3. Įjunkite **Paleisti įjungus** ir **Rodyti šoniniame meniu**, spauskite **Paleisti**.
4. *(Nebūtina)* Skirtuke **Konfigūracija** įrašykite PIN, išsaugokite ir **Paleiskite iš naujo**. PIN reikalingas tik atskirai ikonėlei namų tinkle (žr. 2 skyrių).

---

## 2. Kaip atidaryti

- **HA programėlė ar naršyklė:** šoniniame meniu **Rodukas**. Veikia visur, kur pasiekiate HA (namie ir per Home Assistant Cloud / Nabu Casa).
- **Mygtukas skydelyje:** atidarykite Rodukas per šoninį meniu ir naršyklės adreso juostoje pažiūrėkite kelią – jis atrodo kaip `/hassio/ingress/xxxxxxxx_rodukas`. Skydelyje: **✏️ Redaguoti → ＋ Pridėti kortelę → Mygtukas**, piktograma `mdi:dog`, **Paspaudimo veiksmas: Naršyti**, įklijuokite tą kelią.
- **Atskira ikonėlė, veikianti visur:** telefono Chrome naršyklėje atidarykite `https://<jūsų HA Cloud adresas>/hassio/ingress/xxxxxxxx_rodukas`, prisijunkite prie HA, tada **⋮ → Pridėti prie pradžios ekrano**.
- **Atskira ikonėlė tik namų tinkle:** Chrome atidarykite `http://<HA IP>:8766`, įveskite PIN, tada **⋮ → Pridėti prie pradžios ekrano**. HA IP: **Nustatymai → Sistema → Tinklas**.

Prievadai: Receptai 8765, Rodukas 8766, Ūkis 8767.

---

## 3. Pirmieji žingsniai

1. **Pradžia → ⚙️ → Profilis**: gimimo data, lytis, čipo nr., tikslinis svoris, alergijos, skubios pagalbos klinika.
2. **⚙️ → Keisti nuotrauką**.
3. **Vizitai → Kontaktai**: veterinarija, SPA ir kt.
4. **Maistas → ＋ Naujas**: įrašykite maistą ir **pakuotės lentelę** (šuns svoris → g per dieną).
5. **Maistas → 🧮 Skaičiuoklė**: pasirinkite maistą ir svorį, programa pasiūlys gramus. Nurodykite, kiek kartų per dieną šeriate ir per kiek įdėjimų – matysite, po kiek gramų dėti. Išsaugokite.
6. **Sveikata → Skiepai**: įveskite skiepus ir antiparazitines su „galioja iki“ data.
7. **⚙️ → Priminimai**: pasirinkite telefoną, į kurį siųsti priminimus, ir paspauskite **Išbandyti pranešimą**.
8. **⚙️ → Priežiūra namuose**: paspaudę procedūrą pasitaisykite, kaip dažnai ir kada priminti.


---

## 4. Kas kur

| Skiltis | Kas ten |
|---|---|
| 🐶 **Pradžia** | Vardas, amžius (arba skaičiavimas iki gimtadienio), svoris, mygtukas **Įvesti naują**, priežiūra (ausys, nagai), maistas, vaistai, skiepai |
| 📅 **Kalendorius** | Mėnesio vaizdas, dienos įrašai, pastabos bet kuriai dienai, visa laiko juosta su filtrais |
| 🩺 **Sveikata** | Skiepai ir apsauga, **Vaistinėlė** (vaistai ir priežiūros priemonės), sveikatos žurnalas su nuotraukomis, svorio grafikas |
| 🍽️ **Maistas** | Dabartinis maitinimas, skaičiuoklė, visa istorija, maistų sąrašas su lentelėmis ir pastabomis |
| 🏥 **Vizitai** | Vizitai su kaina ir dokumentais, kontaktai (skambinti vienu paspaudimu), visi dokumentai |

**Priežiūra namuose:** raukšlės ir dantys – kasdien, nežymima. Ausys ir nagai rodomi pradžios ekrane su skaičiavimu („po 3 d.“, „šiandien“, „vėluoja 1 d.“). **✓ Atlikta** galima spausti bet kada – ir anksčiau, tada kitas kartas skaičiuojamas nuo tos dienos.

**Priminimai telefone:** kai ateina laikas, nustatytą valandą (pvz. 23:00) į telefoną ateina pranešimas su mygtukais **✓ Atlikta** ir **Rytoj**. Paspaudus **✓ Atlikta**, programoje pažymima automatiškai. Jei nepažymėta – primenama kitą dieną vėl. Nustatymai: **⚙️ → Priežiūra namuose → paspausti procedūrą**.

**Skiepų priminimai:** likus 14 d. iki galiojimo pabaigos ir galiojimo dieną. Antiparazitinėms pranešime yra mygtukas **✓ Duota** – jis automatiškai įrašo naują davimą tokiam pat laikotarpiui. Nustatymai: **⚙️ → Priminimai**.

**Skiepai ir vaistai pradžios ekrane:** skiepai suskleisti, kai viskas galioja ilgiau nei 60 d.; vaistai suskleisti, kai nieko neduodama.

**Vaistinėlė** (Sveikata → Vaistinėlė): vaistai ir vitaminai (kursai nuo–iki) bei priežiūros priemonės – servetėlės, valikliai, šampūnai, purškalai. Prie priemonės: kam naudojama, kaip, nuo kada, pakuotės ir sudėties nuotraukos, žymė **⚠️ netinka**. Nebenaudojamos lieka skiltyje „Anksčiau naudota“.

**Profilis** (paspausti augintinio kortelę pradžios ekrane): visa informacija – čipas, pasas, draudimas, alergijos, skubios pagalbos klinika. Iš čia:
- **🖨 Priežiūros kortelė** – vienas lapas su maistu, vaistais, priemonėmis, procedūromis, skiepais ir kontaktais (pvz. auklei ar viešbučiui);
- **🩺 Lapas veterinarui** – pasirinkto laikotarpio (1–12 mėn.) sveikatos įrašai, svorio pokytis, vizitai, vaistai, maistas ir priemonės.

Spausdinti arba išsaugoti PDF geriausia per atskirą ikonėlę Chrome naršyklėje arba kompiuteryje – HA programėlė telefone spausdinimo gali neatidaryti.

**Dokumentai:** galima įkelti nuotraukas, PDF skenus ir video. Failai saugomi originalios raiškos. PDF rodomas pačioje programoje.


---

## 5. Esamos istorijos importas

Senus skiepus, svorius, vizitus ir kt. galima suvesti ranka arba paprašyti Claude pokalbyje paruošti `.json` failą (pvz. iš skiepų paso nuotraukos). Importas: **⚙️ → Importuoti duomenis**. Importas tik papildo – nieko neištrina.

Failo formatas (visos dalys nebūtinos):

```json
{
  "profilis": {"gimimo_data": "2016-11-02", "lytis": "Patinas", "cipas": "...", "tikslinis_svoris": 8.2, "alergijos": "..."},
  "kontaktai": [{"vardas": "Klinika", "kategorija": "Veterinarija", "telefonas": "+370...", "adresas": "..."}],
  "svoriai": [{"data": "2026-01-10", "kg": 8.7, "pastaba": ""}],
  "skiepai": [{"tipas": "Vakcina", "pavadinimas": "Pasiutligė", "data": "2025-11-05", "galioja_iki": "2026-11-05", "serija": ""}],
  "vaistai": [{"pavadinimas": "...", "doze": "...", "daznis": "...", "nuo": "2026-03-01", "iki": "2026-03-07", "priezastis": "..."}],
  "maistai": [{"pavadinimas": "...", "gamintojas": "...", "tipas": "Sausas", "lentele": [[6, 90], [8, 112]], "pastabos": "", "netinka": false}],
  "maitinimas": [{"maistas": "...", "nuo": "2026-03-01", "iki": null, "g_per_diena": 110, "maitinimai": 2, "idejimai": 2}],
  "vizitai": [{"data": "2026-03-01", "kategorija": "VET", "kontaktas": "Klinika", "pavadinimas": "...", "kaina": 92.5, "svoris": 8.6, "pastabos": ""}],
  "priemones": [{"pavadinimas": "...", "gamintojas": "...", "paskirtis": "Ausys", "naudojimas": "...", "nuo": "2026-01-10", "iki": null, "netinka": false}],
  "zurnalas": [{"data": "2026-02-27", "kategorija": "Šlubavimas", "sunkumas": 2, "tekstas": "..."}]
}
```

`tipas` skiepams: Vakcina, Antiparazitinė, Kita. `sunkumas`: 0–3.


---

## 6. Atsarginė kopija

- **⚙️ → Atsisiųsti atsarginę kopiją** – vienas ZIP su viskuo. Atkurti: **⚙️ → Atkurti iš atsarginės kopijos** (pakeičia visus duomenis).

---

## 7. Atnaujinimas

Kai išleidžiama nauja versija, HA parodo **Yra atnaujinimas**. Atidarykite programą ir spauskite **Atnaujinti**. Duomenys atnaujinant nedingsta.

Prieš didesnius pakeitimus verta pasidaryti atsarginę kopiją programos nustatymuose.
