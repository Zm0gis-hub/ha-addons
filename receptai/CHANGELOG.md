# Pakeitimai

## 1.0.0
- Pirmoji versija: receptai su originalu ir nuotraukomis, porcijų perskaičiavimas, savaitės meniu, namų patikra, pirkinių sąrašas pagal parduotuvės skyrius su receptų progresu, gaminimo režimas su laikmačiais, statistika, importas ir eksportas.

## 1.1.0
- Kompaktiškas prekių pasiūlymų sąrašas (iki 5 pasiūlymų) vietoj didelio naršyklės sąrašo.
- 📋 mygtukas: visą sąrašą (pvz. iš Google Keep) galima įklijuoti iš karto.
- ＋ prideda prekę iš karto, be papildomo lango.
- Nupirkta žymima tik paspaudus varnelę; paspaudus prekę atsidaro jos detalės (kiekis, pastaba, skyrius, pašalinimas).
- Kompaktiškesnės sąrašo eilutės.

## 1.2.0
- Įvedimo laukas perkeltas į apačią ir visada matomas sąraše.
- Vietoj skyrių antraščių – skyriaus ženkliukas prieš kiekvieną prekę (tvarka išlieka pagal parduotuvę).
- Paspaudus prekę galima keisti pavadinimą ir nurodyti „pirkti papildomai“ (su − / ＋), net jei prekė iš recepto.
- Skyrių tempimas dabar veikia telefone.

## 1.3.0
- Pirkinių sąrašas rankinis (kaip Google Keep): prekės lieka įvesta tvarka, naujos – gale. Tvarką galima keisti ilgai palaikius prekę ir patempus.
- Smulkesnės kategorijos su atskirais ženkliukais (daržovės atskirai nuo vaisių, mėsa – nuo žuvies ir t. t.). Esami produktai perskirstyti automatiškai.
- Varnelė perkelta į dešinę; pažymėjus apačioje 5 s rodoma juosta „↶ Atšaukti“.
- Naujas „Daugiau → Pastabų paryškinimas“: pasirinktiems žodžiams pastabose – spalva ir paryškinimas.
- Receptų pavadinimai sąraše rodomi rėmeliuose, sutrumpinti iki 10 simbolių.

## 1.4.0
- „Baigti apsipirkimą“: nupirktos prekės nuimamos, receptai dingsta iš viršaus juostos, o nenupirktos recepto prekės lieka sąraše su recepto pavadinimu.
- Ta pati prekė sąraše visada viena eilutė – kiekiai sudedami, receptų pavadinimai ir pastabos sujungiami.

## 1.5.0
- Nauja išvaizda: šviesiai pilkas fonas, baltos kortelės be rėmelių, apvalūs terakotos spalvos mygtukai, Nunito šriftas. Veikia ir tamsiame režime. Funkcijos nepakeistos.

## 1.5.1
- Pataisyta: juosta „Atšaukti“ nebelieka matoma perėjus į kitą skirtuką.

## 1.5.2
- Gaminimo režime ingredientų sąrašas visada matomas (nebesusitraukia pereinant per žingsnius).

## 1.6.0
- Gaminant ekranas tikrai neužgęsta: Receptai per Home Assistant liepia HA programėlei telefone laikyti ekraną įjungtą; baigus gaminti (ar po 15 min. neveiklumo) atšaukiama.
- Užrašas „ekranas neužges“ rodomas tik tada, kai tai tikrai pavyko.
- Naujas „Daugiau → Ekranas gaminant“: būsena ir bandymo mygtukai.

## 1.6.1
- Ekrano laikymas: telefonas atpažįstamas pagal įrenginio pavadinimą (patikimiau, kai abu telefonai to paties gamintojo).
- „Ekranas gaminant“ puslapyje rodoma, koks asmuo ir kokie įrenginiai rasti.

## 1.6.2
- Didelis „Baigti apsipirkimą“ mygtukas pakeistas mažu žaliu ✓ mygtuku antraštėje, šalia „⋯“.

## 1.7.0
- Sąrašo meniu (⋮) kaip Google Keep: „Atžymėti visus elementus“, „Ištrinti pažymėtus elementus“, „Kopijuoti sąrašą“, „Išvalyti visą sąrašą“.
- Žalias ✓ mygtukas pašalintas – jo darbą atlieka „Ištrinti pažymėtus elementus“ (nenupirktos recepto prekės lieka).
- „Kopijuoti sąrašą“ nukopijuoja paprastą tekstą (be ženkliukų) – įklijuoti galima bet kur.

## 1.7.1
- Sąrašo ⋮ meniu dabar iškrenta iš viršaus dešinėje, kaip Google Keep.

## 1.8.0
- Prekių pasiūlymai didesni, aukštesni, kitokio atspalvio, su antrašte; kol jie atidaryti, sąrašas po jais nepaspaudžiamas.
- Pridėjus prekę ekranas nuslenka iki jos, o nauja prekė trumpam paryškinama.
- Įterpimas tarp prekių: paspaudus prekę – „↳ Įterpti naują prekę po šia“; toliau vedamos prekės dedamos iš eilės po ja (kaip Keep).

## 1.8.1
- Prekių pasiūlymai per visą ekrano plotį.

## 1.8.2
- 📋 mygtukas prie įvedimo lauko pašalintas; „Įklijuoti sąrašą“ perkeltas į ⋮ meniu.

## 1.8.3
- Pirkinių sąrašo tvarką galima keisti tempiant už kategorijos ženkliuko kairėje – tempimas prasideda iš karto ir veikia HA programėlėje telefone.
- Tempiant sąrašas nebepersipiešia dėl sinchronizacijos.

## 1.8.4
- Pirkinių sąraše mygtukas „↕️ Keisti tvarką“: prie prekių atsiranda ▲ ▼ (veikia ir HA programėlėje, kur tempimas pirštu neveikia).

## 1.8.5
- Pirkinių sąrašas grąžintas į 1.8.2 būseną (atšaukti 1.8.3 ir 1.8.4 tempimo ir ▲▼ pakeitimai).

## 1.9.0
- Naujas receptas „🔗 Iš nuorodos“: iš receptų svetainių automatiškai paimamas pavadinimas, porcijos, ingredientai, žingsniai ir patiekalo nuotrauka.
- Instagram nuorodos – bandymas paimti įrašo aprašymą (ne visada pavyksta, Instagram tai riboja).
- Naujas receptas „📝 Iš teksto“: įklijuotas recepto tekstas automatiškai išskaidomas į pavadinimą, porcijas, ingredientus ir žingsnius.
- Ingredientuose atpažįstami ir angliški vienetai (cup, tbsp, tsp).
