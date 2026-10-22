# Pakeitimai

## 1.3.6
- Tvarkos keitimas mygtukais: viršuje ↕️ – prie užduočių atsiranda ▲ ▼ (iš sekcijos krašto užduotis pereina į kaimyninę sekciją). Veikia ir HA programėlėje, kur tempimas pirštu neveikia.
- Sub-užduotims – mygtukas „↕️ Tvarka“.
- Pašalintas tempimo testas ir rankenėlės ⠿ (naršyklėje tempimas ilgu paspaudimu lieka).

## 1.3.5
- ⚙️ apačioje – „🧪 Tempimo testas“ (diagnostika, kodėl HA programėlėje neveikia tempimas).

## 1.3.4
- Užduočių ir sub-užduočių eilutėse – rankenėlė ⠿: palietus tempimas prasideda iš karto (veikia HA programėlėje telefone). Ilgas paspaudimas taip pat lieka.

## 1.3.3
- Sąraše vietoj 📝 ženkliuko rodoma aprašymo pradžia (viena blankesnė eilutė).

## 1.3.2
- Sekcijos ir žymos lange emoji ir pavadinimas vienoje eilutėje; emoji renkamas iš telefono klaviatūros, siūlomų ženkliukų sąrašas pašalintas.

## 1.3.1
- Sekcijų ir žymų ženkliukui galima įrašyti bet kurį emoji iš telefono klaviatūros (taip pat vėliavas ir kitus sudėtinius).

## 1.3.0
- Užduotis gali turėti laiką „nuo–iki“ arba būti visos dienos (kaip Google kalendoriuje).
- Kiekviena užduotis turi savus priminimus (kelis): pvz. 30 min. prieš, 1 d. prieš 20:00, 1 sav. prieš. Bendri vakaro / ryto laikai pašalinti.
- Laikas rodomas sąraše, „Artimiausi“, HA kortelėje ir HA kalendoriuje.

## 1.2.0
- Priminimai telefone per Home Assistant programėlę: vakare prieš ir / ar ryte tą dieną, pavėluotos – kas rytą.
- Pranešime mygtukai „✓ Atlikta“ ir „Rytoj“ (atidėti dienai).
- Galima pasirinkti kelis telefonus ir išjungti priminimus konkrečiai užduočiai.

## 1.1.1
- Paruošta diegti iš GitHub saugyklos; HA kalendoriaus adresas nustatomas automatiškai.
- Instrukcija atnaujinta (Home Assistant Cloud vietoj Tailscale).

## 1.1.0
- Pasikartojančios užduotys: „Pagal kalendorių“ (pvz. šiukšlės kas 2 sav.) arba „Nuo atlikimo“ (pvz. filtrai kas 3 mėn.). Pažymėjus atlikta, užduotis lieka ir persikelia į kitą datą.
- Vieną kartą galima perkelti, o grafikas lieka nepakeistas, arba perkelti visą grafiką. Yra mygtukas „Praleisti šį kartą“ ir atlikimų istorija.
- Home Assistant jutiklis `sensor.ukis_artimiausi` ir paruošta kortelė pagrindiniam langui (⚙️ → Home Assistant).
- Kalendoriaus adresas, kurį galima prijungti prie HA kalendoriaus (integracija „Remote calendar“).

## 1.0.0
- Pirmoji versija: sekcijos ir užduotys (kurti, redaguoti, trinti, tempti ilgu paspaudimu – taip pat į kitą sekciją), greitas pridėjimas viršuje.
- Užduoties langas: aprašymas, data su greitais mygtukais, žymos, sub-užduotys, nuotraukos ir failai, komentarai su data.
- Atliktos užduotys lieka perbrauktos (nustatoma kiek laiko), vėliau pasiekiamos sekcijos apačioje.
- Rodinys „Artimiausi“: pavėluota (raudonai), šiandien, rytoj, šią ir kitą savaitę. Užduotys be datos čia nerodomos.
- Žymos / vietos ir paieška.
- Atsarginė kopija, atkūrimas ir importas iš .json.
