# Ūkis – įdiegimo ir naudojimo instrukcija

Namų užduočių sąrašas, kaip paprasta Asana: sekcijos, užduotys, pasikartojimai ir priminimai. Programa veikia jūsų Home Assistant viduje. Visi duomenys ir failai **automatiškai patenka į Home Assistant atsargines kopijas**.

---

## 1. Įdiegimas

Jei saugykla HA jau pridėta (pvz. diegiant kitą šios saugyklos programą), 1 žingsnį praleiskite.

1. HA: **Nustatymai → Programėlės (Priedai) → Parduotuvė → ⋮ (viršuje dešinėje) → Saugyklos** (Repositories). Įklijuokite saugyklos adresą (žr. README) ir spauskite **Pridėti**.
2. Perkraukite puslapį. Sąraše atsiras skiltis su **Ūkis**. Atidarykite ir spauskite **Įdiegti** (ant Raspberry Pi – kelios minutės).
3. Įjunkite **Paleisti įjungus** ir **Rodyti šoniniame meniu**, spauskite **Paleisti**.
4. *(Nebūtina)* Skirtuke **Konfigūracija** įrašykite PIN, išsaugokite ir **Paleiskite iš naujo**. PIN reikalingas tik atskirai ikonėlei namų tinkle (žr. 2 skyrių).

---

## 2. Kaip atidaryti

- **HA programėlė ar naršyklė:** šoniniame meniu **Ūkis**. Veikia visur, kur pasiekiate HA (namie ir per Home Assistant Cloud / Nabu Casa).
- **Mygtukas skydelyje:** atidarykite Ūkis per šoninį meniu ir naršyklės adreso juostoje pažiūrėkite kelią – jis atrodo kaip `/hassio/ingress/xxxxxxxx_ukis`. Skydelyje: **✏️ Redaguoti → ＋ Pridėti kortelę → Mygtukas**, piktograma `mdi:home-roof`, **Paspaudimo veiksmas: Naršyti**, įklijuokite tą kelią.
- **Atskira ikonėlė, veikianti visur:** telefono Chrome naršyklėje atidarykite `https://<jūsų HA Cloud adresas>/hassio/ingress/xxxxxxxx_ukis`, prisijunkite prie HA, tada **⋮ → Pridėti prie pradžios ekrano**.
- **Atskira ikonėlė tik namų tinkle:** Chrome atidarykite `http://<HA IP>:8767`, įveskite PIN, tada **⋮ → Pridėti prie pradžios ekrano**. HA IP: **Nustatymai → Sistema → Tinklas**.

Prievadai: Receptai 8765, Rodukas 8766, Ūkis 8767.

---

## 3. Kaip naudotis

| Skiltis | Kas ten |
|---|---|
| 📋 **Užduotys** | Sekcijos su užduotimis. Viršuje – greitas pridėjimas (įrašote, spaudžiate Enter; dešinėje pasirenkate sekciją). |
| 📅 **Artimiausi** | Tik užduotys su data: pavėluota, šiandien, rytoj, šią ir kitą savaitę, vėliau. |
| 🏷️ **Žymos** | Paieška ir užduotys pagal žymą (pvz. „Senukai“ – ką pirkti toje parduotuvėje). |

- **Atlikta** – paspauskite apskritimą. Kelias sekundes galima **Atšaukti**.
- **Tvarka** – ilgai palaikykite užduotį ir tempkite. Galima nutempti ir į kitą sekciją.
- **Sekcijos meniu** (⋯ prie pavadinimo): pridėti užduotį, pervadinti, perkelti, ištrinti. Paspaudus pavadinimą sekcija suskleidžiama.
- **Užduoties langas**: pavadinimą galima keisti tiesiog spaudžiant ant jo; data su greitais mygtukais; žymos; aprašymas (išsaugomas automatiškai); sub-užduotys (ilgu paspaudimu keičiama tvarka); nuotraukos ir failai; komentarai su data.
- **Atliktos** lieka perbrauktos iki kitos dienos pabaigos (keičiama ⚙️ Nustatymuose), vėliau – sekcijos apačioje „Rodyti atliktas“.

---

## 4. Pasikartojančios užduotys

Užduoties lange paspauskite **🔁 Kartojimas**:
- **Pagal kalendorių** – fiksuotas grafikas (šiukšlės kas 2 sav., stiklas kas 5 sav.). Nesvarbu, kada pažymėsite – kita data skaičiuojama pagal grafiką.
- **Nuo atlikimo** – kita data skaičiuojama nuo tos dienos, kai pažymėjote (filtrai, katilo patikra).

Pažymėjus **✓ Atlikta**, užduotis neišnyksta, o persikelia į kitą datą (kelias sekundes galima **Atšaukti**). **⏭ Praleisti šį kartą** – perkelia be įrašo į istoriją.

Pakeitus datą, programa paklaus: **Tik šį kartą** (pvz. per šventes išveža kitą dieną – kiti kartai lieka pagal grafiką) arba **Perkelti visą grafiką**.

---

## 5. Home Assistant

**Kortelė pagrindiniame lange.** Programa sukuria jutiklį `sensor.ukis_artimiausi` su artimiausiomis užduotimis (kiek dienų į priekį – ⚙️ → Home Assistant). Kortelės kodą rasite **⚙️ → Home Assistant → Kortelė pagrindiniam langui**: nukopijuokite ir HA skydelyje **✏️ Redaguoti → ＋ Pridėti kortelę → Žymėjimas (Markdown) → Rodyti kodo redaktorių**, įklijuokite.

**HA kalendorius (nebūtina).** **⚙️ → Home Assistant → Rodyti HA kalendoriuje** – ten yra adresas. HA: **Nustatymai → Įrenginiai ir paslaugos → ＋ Pridėti integraciją → Remote calendar**, įklijuokite adresą. Užduotys su data ir būsimi kartojimai atsiras HA Kalendoriuje.

---

## 6. Importas

Užduotis galima suvesti ir iš `.json` failo (pvz. paprašius Claude paruošti iš sąrašo): **⚙️ → Importuoti užduotis**. Importas tik papildo.

```json
{
  "sekcijos": [
    {"pavadinimas": "Darbai", "uzduotys": [
      {"pavadinimas": "Tvora", "aprasymas": "...", "data": "2026-11-01", "zymos": ["Senukai"], "subuzduotys": ["Išmatuoti", "Nupirkti stulpus"]},
      {"pavadinimas": "Stiklas", "data": "2026-10-28", "kartojimas": {"tipas": "kalendorius", "kas": 5, "vnt": "sav"}}
    ]}
  ]
}
```

`kartojimas.tipas`: `kalendorius` arba `nuo_atlikimo`; `vnt`: `d`, `sav`, `men`, `m` (metai).

---

## 7. Laikas ir priminimai telefone

**Laikas.** Užduoties lange, kai nurodyta data, yra jungiklis **Visa diena**. Išjungus jį, galima nurodyti laiką „nuo–iki“ (kaip Google kalendoriuje).

**Priminimai** nustatomi kiekvienai užduočiai atskirai: **🔔 Priminimai telefone → ＋ Pridėti priminimą**. Jų gali būti keli.
- Užduočiai su laiku – pagal nutylėjimą **30 min. prieš**. Vienetai: min., val., d., sav.
- Visos dienos užduočiai – pagal nutylėjimą **tą dieną 13:00**. Galima nurodyti, pvz., **1 d. prieš, 20:00** (šiukšlės) arba **1 sav. prieš** (filtrai, druska).

Užduotys be priminimų į telefoną nesiunčiamos.

**⚙️ → Priminimai telefone:** pasirinkite telefoną (-us), kuriuose įdiegta Home Assistant programėlė, ir spauskite **Išbandyti pranešimą**. Ten pat – **Priminti pavėluotas** (kasdien užduoties laiku arba 13:00, kol nepažymėsite).

Pranešime yra mygtukas **✓ Atlikta** (pasikartojanti užduotis persikelia į kitą datą), o užduočiai, kurios data šiandien ar jau praėjo, – ir **Rytoj** (atideda vienai dienai). Jei vienu metu susidaro daugiau nei 4 priminimai, ateina vienas suvestinės pranešimas.

---

## 8. Atnaujinimas

Kai išleidžiama nauja versija, HA parodo **Yra atnaujinimas**. Atidarykite programą ir spauskite **Atnaujinti**. Duomenys atnaujinant nedingsta.

Prieš didesnius pakeitimus verta pasidaryti atsarginę kopiją programos nustatymuose.
