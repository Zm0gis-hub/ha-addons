# Receptai – įdiegimo ir naudojimo instrukcija

Receptai, savaitės meniu ir bendras pirkinių sąrašas šeimai. Programa veikia jūsų Home Assistant viduje. Visi duomenys (receptai, nuotraukos, meniu, istorija) saugomi priedo aplanke ir **automatiškai patenka į Home Assistant atsargines kopijas**.

---

## 1. Įdiegimas

Jei saugykla HA jau pridėta (pvz. diegiant kitą šios saugyklos programą), 1 žingsnį praleiskite.

1. HA: **Nustatymai → Programėlės (Priedai) → Parduotuvė → ⋮ (viršuje dešinėje) → Saugyklos** (Repositories). Įklijuokite saugyklos adresą (žr. README) ir spauskite **Pridėti**.
2. Perkraukite puslapį. Sąraše atsiras skiltis su **Receptai**. Atidarykite ir spauskite **Įdiegti** (ant Raspberry Pi – kelios minutės).
3. Įjunkite **Paleisti įjungus** ir **Rodyti šoniniame meniu**, spauskite **Paleisti**.
4. *(Nebūtina)* Skirtuke **Konfigūracija** įrašykite PIN, išsaugokite ir **Paleiskite iš naujo**. PIN reikalingas tik atskirai ikonėlei namų tinkle (žr. 2 skyrių).

---

## 2. Kaip atidaryti

- **HA programėlė ar naršyklė:** šoniniame meniu **Receptai**. Veikia visur, kur pasiekiate HA (namie ir per Home Assistant Cloud / Nabu Casa).
- **Mygtukas skydelyje:** atidarykite Receptai per šoninį meniu ir naršyklės adreso juostoje pažiūrėkite kelią – jis atrodo kaip `/hassio/ingress/xxxxxxxx_receptai`. Skydelyje: **✏️ Redaguoti → ＋ Pridėti kortelę → Mygtukas**, piktograma `mdi:silverware-fork-knife`, **Paspaudimo veiksmas: Naršyti**, įklijuokite tą kelią.
- **Atskira ikonėlė, veikianti visur:** telefono Chrome naršyklėje atidarykite `https://<jūsų HA Cloud adresas>/hassio/ingress/xxxxxxxx_receptai`, prisijunkite prie HA, tada **⋮ → Pridėti prie pradžios ekrano**.
- **Atskira ikonėlė tik namų tinkle:** Chrome atidarykite `http://<HA IP>:8765`, įveskite PIN, tada **⋮ → Pridėti prie pradžios ekrano**. HA IP: **Nustatymai → Sistema → Tinklas**.

Prievadai: Receptai 8765, Rodukas 8766, Ūkis 8767.

---

## 3. Naudojimas trumpai

- **Receptai → ＋ Naujas.** Ingredientus galima įvesti po vieną arba **📋 Įklijuoti sąrašą** (pvz. „500 g maltos mėsos“ – programa pati atskiria kiekį, vienetą ir produktą).
- **Originalas** išsaugomas automatiškai pirmą kartą išsaugant receptą, ir vėliau jo nekeičia jokie pakeitimai. Galima pridėti ir originalo nuotraukų.
- **Meniu**: prie dienos spauskite ＋. Receptas iškart patenka į pirkinių sąrašą (🛒 – įjungti/išjungti, ✓ – pagaminta).
- **Sąrašas → 🏠 Namų patikra**: pažymėkite *Turiu / Baigiasi / Reikia*.
- **Sąrašas → 🛒 Parduotuvėje**: prekės išrūšiuotos pagal skyrių tvarką, viršuje receptų progresas (pvz. 3/5).
- **Daugiau → Parduotuvės skyriai**: tempkite už ☰, kad tvarka atitiktų jūsų parduotuvę.
- **Daugiau → Produktai**: skyriaus keitimas, „visada turima“ (druska, aliejus…), dviejų produktų sujungimas.
- Prekė be skyriaus rodoma „Nepriskirta“ – parinkite skyrių, ir programa tai įsimins.


---

## 4. Receptų importas iš nuotraukų

Nufotografuokite receptus ir nusiųskite juos Claude pokalbyje su prašymu „paversk receptais importui“. Gausite `.json` failą. Programoje: **Daugiau → Importas ir eksportas → Pasirinkti failą**.

Failo formatas:

```json
{
  "receptai": [
    {
      "pavadinimas": "Blynai",
      "porcijos": 4,
      "zymos": ["pusryčiai"],
      "ingredientai": [
        {"produktas": "Miltai", "kiekis": 2, "vienetas": "stiklinė"},
        {"produktas": "Kiaušiniai", "kiekis": 3, "vienetas": "vnt"},
        {"produktas": "Druska", "vienetas": "pagal skonį"}
      ],
      "zingsniai": ["Išplakti.", "Kepti po 2 min."],
      "pastabos": "",
      "saltinis": "Močiutės sąsiuvinis",
      "originalas": "originalus recepto tekstas"
    }
  ]
}
```


---

## 5. Atnaujinimas

Kai išleidžiama nauja versija, HA parodo **Yra atnaujinimas**. Atidarykite programą ir spauskite **Atnaujinti**. Duomenys atnaujinant nedingsta.

Prieš didesnius pakeitimus verta pasidaryti atsarginę kopiją programos nustatymuose.
