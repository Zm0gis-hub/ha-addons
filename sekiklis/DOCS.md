# Sekiklis – įdiegimo ir naudojimo instrukcija

Sekiklis kas kelias minutes patikrina prekių puslapius parduotuvėse ir, kai tik prekę galima pirkti, **iškart siunčia pranešimą į visus telefonus**. Paspaudus pranešimą atsidaro parduotuvės puslapis.

---

## 1. Įdiegimas

1. HA: **Nustatymai → Programėlės (Priedai) → Parduotuvė**. Saugykla jau pridėta (ten pat, kur Receptai, Ūkis ir kt.). Jei Sekiklio nematote – **⋮ → Ieškoti atnaujinimų** ir perkraukite puslapį.
2. Atidarykite **Sekiklis** → **Įdiegti**.
3. Įjunkite **Paleisti įjungus**, **Sargas (Watchdog)** ir **Rodyti šoniniame meniu**, spauskite **Paleisti**.

---

## 2. Pirmas žingsnis – patikrinkite pranešimus (būtina!)

1. Atidarykite **Sekiklis** šoniniame meniu.
2. Viršuje esanti juosta rodo, ar viskas gerai: 🟢 – veikia, 🟡 – patikrinkite, 🔴 – pranešimai neveiks (parašyta kodėl).
3. Spauskite **⚙️ → Siųsti bandomąjį pranešimą**. Per kelias sekundes jis turi ateiti į visus telefonus su HA programėle.
4. Paspauskite bet kurią prekę → **🧪 Imituoti atsiradimą**. Ateis lygiai toks pranešimas, koks bus tikras. Patikrinkite, ar paspaudus atsidaro parduotuvė.
5. *(Rekomenduojama)* Telefone: **Nustatymai → Programos → Home Assistant → Pranešimai → „Sekiklis – prekė atsirado“** – įjunkite garsą ir leidimą skambėti „Netrukdyti“ režimu.

---

## 3. Kaip naudotis

- **Pridėti prekę** – įklijuokite prekės nuorodą į laukelį viršuje ir spauskite **Sekti**. Pavadinimas ir kaina užsipildys patys.
- **Būsenos:** ✅ YRA · 🟢 galima užsakyti iš anksto · ❌ nėra · 🛡️ parduotuvė blokuoja automatinį tikrinimą · ⚠️ nepavyko patikrinti.
- Prekei atsiradus ateina pranešimas su mygtukais **🛒 Atidaryti** ir **🔕 Nutildyti**. Kol nenutildysite – kartojama (iš anksto kas 10 min., iki 6 kartų).
- Paspaudus prekę: tikrinti dabar, sustabdyti, **🔔 Pranešti / 👁 Tik stebėti**, **kainos riba**, pervadinti, istorija, nebesekti.
- **💸 Per brangu** – prekė yra, bet brangesnė nei nustatyta riba (baltiems iš karto 100 €). Telefonas neskambina.
- **🔀 Pakeista** – parduotuvė nuorodą nukreipė į kitą prekę. Jei tai ta pati prekė, spauskite „Tai ta pati prekė“.
- **🔎 Naujų nuorodų paieška** (sąrašo apačioje) – kas 15 min. ieško naujų GTA VI pultelių Senukai, Varle, Pigu ir Gameroom. Radus – įtraukia ir praneša „🆕 Nauja prekė“ (baltų brangesnių nei 100 € – tyliai).
- **⚙️ Nustatymai:** tikrinimo dažnis (iš anksto 5 min.), kuriuos telefonus naudoti (iš anksto – visus), pakartojimai, sargas.

**Sargas:** jei 30 min. nepavyksta patikrinti nė vienos parduotuvės (dingo internetas, parduotuvė pakeitė puslapį), ateis pranešimas „⚠️ Sekiklis neveikia“. Kai vėl veiks – „✅ Sekiklis vėl veikia“.

---

## 4. Kurios parduotuvės tinka

Tinka parduotuvės, kurių puslapyje yra standartinė prekės būsena (schema.org) – tokių dauguma: **Gameroom, Senukai** ir kt. Pridėjus naują nuorodą po minutės matysite, ar ji tikrinama.

**1A** (ir kitos su Cloudflare apsauga) automatinio tikrinimo neįsileidžia – bus 🛡️. Jos vis tiek bandomos kas 30 min., bet pasikliauti negalima.

Dažniau nei kas 3 min. tikrinti negalima – parduotuvės gali pradėti blokuoti.

---

## 5. Atskira ikonėlė telefone

- **Visur:** telefono Chrome atidarykite `https://<jūsų HA Cloud adresas>/hassio/ingress/xxxxxxxx_sekiklis` (kelią matysite adreso juostoje atidarę Sekiklį per šoninį meniu) → **⋮ → Pridėti prie pradžios ekrano**.
- **Tik namų tinkle:** `http://<HA IP>:8770` (jei Konfigūracijoje nustatytas PIN – reikės jį įvesti).

Prievadai: Receptai 8765, Rodukas 8766, Ūkis 8767, Sekiklis 8770.
