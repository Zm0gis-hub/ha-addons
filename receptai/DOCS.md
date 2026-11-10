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

## 4. Receptas iš nuorodos ar teksto

**Receptai → ＋ Naujas** viršuje:
- **🔗 Iš nuorodos** – įklijuokite recepto puslapio adresą. Daugumai receptų svetainių programa pati paima pavadinimą, porcijas, ingredientus, žingsnius ir nuotrauką. Instagram – tik bandymas (Instagram dažnai neleidžia).
- **📝 Iš teksto** – įklijuokite recepto tekstą (pvz. Instagram aprašymą, nukopijuotą per Google Lens). Ingredientai ir žingsniai atskiriami automatiškai, vėliau galima pataisyti.

## 4a. Receptų importas iš nuotraukų

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

## 4b. Pirkinių sąrašas laikrodyje (Wear OS)

Laikrodžio programėlė **Pirkiniai** rodo tą patį pirkinių sąrašą: galima slinkti ir paspaudus pažymėti prekę. Pažymėjimas iškart matosi ir telefone. Jei parduotuvėje dingsta ryšys, laikrodis rodo paskutinį sąrašą, o pažymėjimus išsiunčia, kai ryšys atsiranda. Tinka bet kuriam Wear OS laikrodžiui.

**A. Paruošti Receptus (vieną kartą)**

1. Atnaujinkite Receptus iki 1.12.0 ar naujesnės.
2. HA: apačioje kairėje paspauskite savo vardą → skirtukas **Sauga** → apačioje **Ilgalaikiai prieigos raktai** → **Sukurti raktą**, pavadinimas „Laikrodis“. Nukopijuokite rodomą raktą (jis rodomas tik vieną kartą).
3. Receptai → **Daugiau → Laikrodis**: įrašykite HA adresą, kuriuo HA pasiekiate ne namie (pvz. `https://xxxx.ui.nabu.casa`), įklijuokite raktą ir spauskite **Išsaugoti ir patikrinti**. Turi parašyti „Viskas veikia“.

**B. Įdiegti programėlę į laikrodį (vieną kartą kiekvienam laikrodžiui)**

Programėlės nėra „Play“ parduotuvėje, todėl ji įkeliama iš telefono (žemiau) arba iš Windows kompiuterio: laikrodyje atlikite 2–3 žingsnius, tada kompiuteryje paleiskite failą `laikrodis/Idiegti-i-laikrodi.bat` iš saugyklos (https://github.com/Zm0gis-hub/ha-addons/blob/main/laikrodis/Idiegti-i-laikrodi.bat → „Download raw file“) ir sekite nurodymus. Kompiuteris ir laikrodis turi būti tame pačiame Wi-Fi.

1. Telefone atsisiųskite failą: `https://github.com/Zm0gis-hub/ha-addons/releases/download/laikrodis/pirkiniai-laikrodis.apk`
2. Laikrodyje: **Nustatymai → Apie laikrodį → Programinės įrangos informacija** → 7 kartus bakstelėkite **Versijos numeris**, kol parašys, kad esate kūrėjas.
3. Laikrodyje: **Nustatymai → Kūrėjo parinktys** → įjunkite **ADB derinimas** ir **Belaidis derinimas** (laikrodis turi būti prijungtas prie to paties Wi-Fi kaip telefonas).
4. Telefone iš „Play“ parduotuvės įdiekite **Bugjaeger** (nemokama). Joje: kištuko piktograma viršuje → **Susieti** (Pair). Laikrodyje: **Belaidis derinimas → Susieti naują įrenginį** – įveskite į telefoną laikrodžio rodomą kodą, IP adresą ir prievadą. Tada prisijunkite (Connect) su IP ir prievadu, rodomais lange „Belaidis derinimas“.
5. Bugjaeger: skirtukas **Paketai** (Packages) → **＋** → **Pasirinkti APK failą** → atsisiųstas `pirkiniai-laikrodis.apk`.
6. Įdiegus laikrodyje išjunkite **Belaidis derinimas** (taupo bateriją).

**C. Susieti**

1. Laikrodis prijungtas prie namų Wi-Fi. Atidarykite jame **Pirkiniai**.
2. Telefone: Receptai → **Daugiau → Laikrodis → Gauti susiejimo kodą**.
3. Laikrodyje įveskite 6 skaitmenų kodą ir spauskite **Gerai**. Jei laikrodis paprašys IP adreso – įveskite tą, kurį rodo Receptai po kodu.

Pakeitus laikrodį pakartokite B ir C. Programėlę atnaujinti reikia tik tada, kai tai parašyta Receptų pakeitimuose (tas pats B žingsnis, sena versija pasikeičia nauja).

## 5. Atnaujinimas

Kai išleidžiama nauja versija, HA parodo **Yra atnaujinimas**. Atidarykite programą ir spauskite **Atnaujinti**. Duomenys atnaujinant nedingsta.

Prieš didesnius pakeitimus verta pasidaryti atsarginę kopiją programos nustatymuose.
