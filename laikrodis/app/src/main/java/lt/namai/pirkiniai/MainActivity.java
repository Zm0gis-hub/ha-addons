package lt.namai.pirkiniai;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Pirkinių sąrašas iš Home Assistant priedo „Receptai“.
 * Sąrašas skaitomas iš jutiklio sensor.receptai_pirkiniai (atributas „laikrodis“),
 * prekė pažymima per HA paslaugą hassio.addon_stdin.
 * Be ryšio rodomas paskutinis išsaugotas sąrašas, o pažymėjimai išsiunčiami vėliau.
 */
public class MainActivity extends Activity {

    private static final int ZALIA = 0xFF3DDC97;
    private static final int PILKA = 0xFF9AA0A6;
    private static final int TAMSI = 0xFF202124;
    private static final long KAS_KIEK = 5000;      // sąrašo atnaujinimas, ms
    private static final long PERRASYMAS = 20000;   // kiek laikyti vietinį pažymėjimą, kol HA pasiveja

    static class Preke {
        int id;
        String pav;
        String kiekis;
        boolean x;
    }

    private SharedPreferences prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService tinklas = Executors.newSingleThreadExecutor();

    private final List<Preke> prekes = new ArrayList<>();
    /** Dar neišsiųsti pažymėjimai: prekės id -> pažymėta. */
    private final Map<Integer, Boolean> laukia = new HashMap<>();
    /** Ką tik išsiųsti pažymėjimai: id -> {pažymėta(1/0), galioja iki}. */
    private final Map<Integer, long[]> neseniai = new HashMap<>();

    private boolean matomas = false;
    private boolean sinchronizuoja = false;
    private boolean sarasoEkranas = false;
    private String busena = "";

    private ListView sarasas;
    private Adapteris adapteris;
    private TextView antraste;
    private TextView busenosEilute;

    // susiejimo ekranas
    private boolean ivedamasAdresas = false;
    private String ivestis = "";
    private String kodas = "";
    private TextView ivestiesLaukas;
    private TextView nurodymas;
    private boolean siejama = false;

    private final Runnable ciklas = new Runnable() {
        @Override
        public void run() {
            if (!matomas || !sarasoEkranas) return;
            sinchronizuoti();
            ui.postDelayed(this, KAS_KIEK);
        }
    };

    private final Runnable perrikiuoti = new Runnable() {
        @Override
        public void run() {
            rikiuoti();
            if (adapteris != null) adapteris.notifyDataSetChanged();
            atnaujintiAntraste();
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("pirkiniai", MODE_PRIVATE);
        ikeltiIssaugota();
        if (prefs.getString("url", "").isEmpty() || prefs.getString("token", "").isEmpty()) {
            rodytiSusiejima();
        } else {
            rodytiSarasa();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        matomas = true;
        ui.removeCallbacks(ciklas);
        ui.post(ciklas);
    }

    @Override
    protected void onPause() {
        super.onPause();
        matomas = false;
        ui.removeCallbacks(ciklas);
        issaugoti();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        tinklas.shutdown();
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void virpteleti() {
        try {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v != null) v.vibrate(VibrationEffect.createOneShot(20, VibrationEffect.DEFAULT_AMPLITUDE));
        } catch (Exception ignored) {
        }
    }

    // ------------------------------------------------------------------ išsaugojimas

    private void ikeltiIssaugota() {
        try {
            JSONArray a = new JSONArray(prefs.getString("sarasas", "[]"));
            prekes.clear();
            for (int i = 0; i < a.length(); i++) prekes.add(isJson(a.getJSONObject(i)));
            JSONObject l = new JSONObject(prefs.getString("laukia", "{}"));
            Iterator<String> it = l.keys();
            while (it.hasNext()) {
                String k = it.next();
                laukia.put(Integer.parseInt(k), l.getBoolean(k));
            }
        } catch (Exception ignored) {
        }
    }

    private void issaugoti() {
        try {
            JSONArray a = new JSONArray();
            for (Preke p : prekes) {
                JSONObject o = new JSONObject();
                o.put("i", p.id);
                o.put("n", p.pav);
                o.put("k", p.kiekis);
                o.put("x", p.x ? 1 : 0);
                a.put(o);
            }
            JSONObject l = new JSONObject();
            for (Map.Entry<Integer, Boolean> e : laukia.entrySet()) l.put(String.valueOf(e.getKey()), e.getValue());
            prefs.edit().putString("sarasas", a.toString()).putString("laukia", l.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    private static Preke isJson(JSONObject o) {
        Preke p = new Preke();
        p.id = o.optInt("i");
        p.pav = o.optString("n", "");
        p.kiekis = o.optString("k", "");
        p.x = o.optInt("x", 0) != 0;
        return p;
    }

    // ------------------------------------------------------------------ sąrašo ekranas

    private void rodytiSarasa() {
        sarasoEkranas = true;
        sarasas = new ListView(this);
        sarasas.setBackgroundColor(Color.BLACK);
        sarasas.setDivider(null);
        sarasas.setVerticalScrollBarEnabled(true);
        sarasas.setClipToPadding(false);
        sarasas.setPadding(0, dp(18), 0, dp(40));

        LinearLayout virsus = new LinearLayout(this);
        virsus.setOrientation(LinearLayout.VERTICAL);
        virsus.setGravity(Gravity.CENTER_HORIZONTAL);
        virsus.setPadding(dp(30), 0, dp(30), dp(6));
        antraste = new TextView(this);
        antraste.setTextColor(ZALIA);
        antraste.setTextSize(15);
        antraste.setTypeface(Typeface.DEFAULT_BOLD);
        antraste.setGravity(Gravity.CENTER);
        virsus.addView(antraste);
        busenosEilute = new TextView(this);
        busenosEilute.setTextColor(PILKA);
        busenosEilute.setTextSize(11);
        busenosEilute.setGravity(Gravity.CENTER);
        virsus.addView(busenosEilute);
        sarasas.addHeaderView(virsus, null, false);

        final TextView apacia = new TextView(this);
        apacia.setText("Susieti iš naujo");
        apacia.setTextColor(PILKA);
        apacia.setTextSize(12);
        apacia.setGravity(Gravity.CENTER);
        apacia.setPadding(dp(20), dp(18), dp(20), dp(18));
        apacia.setOnClickListener(new View.OnClickListener() {
            private long pirmas = 0;

            @Override
            public void onClick(View v) {
                long dabar = System.currentTimeMillis();
                if (dabar - pirmas < 4000) {
                    prefs.edit().remove("url").remove("token").apply();
                    sarasoEkranas = false;
                    rodytiSusiejima();
                } else {
                    pirmas = dabar;
                    apacia.setText("Paspauskite dar kartą, kad atsietumėte");
                    ui.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            apacia.setText("Susieti iš naujo");
                        }
                    }, 4000);
                }
            }
        });
        sarasas.addFooterView(apacia, null, false);

        adapteris = new Adapteris();
        sarasas.setAdapter(adapteris);
        setContentView(sarasas);
        sarasas.requestFocus();
        rikiuoti();
        atnaujintiAntraste();
        if (matomas) {
            ui.removeCallbacks(ciklas);
            ui.post(ciklas);
        }
    }

    private void atnaujintiAntraste() {
        if (antraste == null) return;
        int liko = 0;
        for (Preke p : prekes) if (!p.x) liko++;
        if (prekes.isEmpty()) antraste.setText("Pirkiniai");
        else if (liko == 0) antraste.setText("Viskas nupirkta");
        else antraste.setText("Pirkti: " + liko);
        String b = busena;
        if (b.isEmpty() && prekes.isEmpty()) b = "Sąrašas tuščias";
        busenosEilute.setText(b);
        busenosEilute.setVisibility(b.isEmpty() ? View.GONE : View.VISIBLE);
    }

    /** Nepirktos prekės viršuje (programos tvarka), nupirktos – apačioje. */
    private void rikiuoti() {
        List<Preke> a = new ArrayList<>(), b = new ArrayList<>();
        for (Preke p : prekes) (p.x ? b : a).add(p);
        prekes.clear();
        prekes.addAll(a);
        prekes.addAll(b);
    }

    private void paspausta(Preke p) {
        p.x = !p.x;
        laukia.put(p.id, p.x);
        neseniai.remove(p.id);
        virpteleti();
        adapteris.notifyDataSetChanged();
        atnaujintiAntraste();
        ui.removeCallbacks(perrikiuoti);
        ui.postDelayed(perrikiuoti, 1500);
        issaugoti();
        sinchronizuoti();
    }

    class Adapteris extends BaseAdapter {
        @Override
        public int getCount() {
            return prekes.size();
        }

        @Override
        public Object getItem(int i) {
            return prekes.get(i);
        }

        @Override
        public long getItemId(int i) {
            return prekes.get(i).id;
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }

        @Override
        public View getView(int i, View v, ViewGroup parent) {
            LinearLayout eil;
            TextView zyme, pav, kiek;
            if (v == null) {
                eil = new LinearLayout(MainActivity.this);
                eil.setOrientation(LinearLayout.HORIZONTAL);
                eil.setGravity(Gravity.CENTER_VERTICAL);
                eil.setPadding(dp(22), dp(7), dp(22), dp(7));
                eil.setMinimumHeight(dp(50));
                zyme = new TextView(MainActivity.this);
                zyme.setId(1);
                zyme.setGravity(Gravity.CENTER);
                zyme.setTextSize(14);
                zyme.setTypeface(Typeface.DEFAULT_BOLD);
                zyme.setTextColor(Color.BLACK);
                eil.addView(zyme, new LinearLayout.LayoutParams(dp(26), dp(26)));
                LinearLayout tekstai = new LinearLayout(MainActivity.this);
                tekstai.setOrientation(LinearLayout.VERTICAL);
                tekstai.setPadding(dp(10), 0, 0, 0);
                pav = new TextView(MainActivity.this);
                pav.setId(2);
                pav.setTextSize(16);
                pav.setMaxLines(2);
                tekstai.addView(pav);
                kiek = new TextView(MainActivity.this);
                kiek.setId(3);
                kiek.setTextSize(12);
                kiek.setTextColor(PILKA);
                kiek.setMaxLines(1);
                tekstai.addView(kiek);
                eil.addView(tekstai, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            } else {
                eil = (LinearLayout) v;
                zyme = eil.findViewById(1);
                pav = eil.findViewById(2);
                kiek = eil.findViewById(3);
            }
            final Preke p = prekes.get(i);
            GradientDrawable g = new GradientDrawable();
            g.setShape(GradientDrawable.OVAL);
            if (p.x) {
                g.setColor(ZALIA);
                zyme.setText("✓");
            } else {
                g.setColor(Color.TRANSPARENT);
                g.setStroke(dp(2), PILKA);
                zyme.setText("");
            }
            zyme.setBackground(g);
            pav.setText(p.pav);
            pav.setTextColor(p.x ? PILKA : Color.WHITE);
            pav.setPaintFlags(p.x ? pav.getPaintFlags() | Paint.STRIKE_THRU_TEXT_FLAG
                    : pav.getPaintFlags() & ~Paint.STRIKE_THRU_TEXT_FLAG);
            kiek.setText(p.kiekis);
            kiek.setVisibility(p.kiekis == null || p.kiekis.isEmpty() ? View.GONE : View.VISIBLE);
            eil.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    paspausta(p);
                }
            });
            return eil;
        }
    }

    // ------------------------------------------------------------------ sinchronizavimas

    private void sinchronizuoti() {
        if (sinchronizuoja) return;
        final String url = prefs.getString("url", "");
        final String token = prefs.getString("token", "");
        final String priedas = prefs.getString("priedas", "");
        final String jutiklis = prefs.getString("jutiklis", "sensor.receptai_pirkiniai");
        if (url.isEmpty() || token.isEmpty()) return;
        sinchronizuoja = true;
        final Map<Integer, Boolean> siusti = new HashMap<>(laukia);
        tinklas.execute(new Runnable() {
            @Override
            public void run() {
                final List<Integer> issiusta = new ArrayList<>();
                String klaida = "";
                JSONArray gauta = null;
                try {
                    for (Map.Entry<Integer, Boolean> e : siusti.entrySet()) {
                        JSONObject in = new JSONObject();
                        in.put("veiksmas", "pazymeti");
                        in.put("id", e.getKey());
                        in.put("x", e.getValue());
                        JSONObject body = new JSONObject();
                        body.put("addon", priedas);
                        body.put("input", in);
                        Atsakymas a = http("POST", url + "/api/services/hassio/addon_stdin", token, body.toString());
                        if (a.kodas == 401) throw new Klaida("Raktas nebegalioja – susiekite iš naujo");
                        if (a.kodas < 200 || a.kodas >= 300) throw new Klaida("HA klaida " + a.kodas);
                        issiusta.add(e.getKey());
                    }
                    Atsakymas a = http("GET", url + "/api/states/" + jutiklis, token, null);
                    if (a.kodas == 401) throw new Klaida("Raktas nebegalioja – susiekite iš naujo");
                    if (a.kodas == 404) throw new Klaida("HA nemato sąrašo – ar veikia Receptai?");
                    if (a.kodas != 200) throw new Klaida("HA klaida " + a.kodas);
                    JSONObject at = new JSONObject(a.tekstas).optJSONObject("attributes");
                    gauta = at == null ? null : at.optJSONArray("laikrodis");
                    if (gauta == null) throw new Klaida("Atnaujinkite Receptus iki 1.12.0");
                } catch (Klaida e) {
                    klaida = e.getMessage();
                } catch (Exception e) {
                    klaida = "Nėra ryšio – rodomas išsaugotas sąrašas";
                }
                final String k = klaida;
                final JSONArray g = gauta;
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        baigta(siusti, issiusta, g, k);
                    }
                });
            }
        });
    }

    private void baigta(Map<Integer, Boolean> siusta, List<Integer> issiusta, JSONArray gauta, String klaida) {
        sinchronizuoja = false;
        long dabar = System.currentTimeMillis();
        for (Integer id : issiusta) {
            Boolean buvo = siusta.get(id);
            // jei per tą laiką paspausta dar kartą – paliekam eilėje
            if (buvo != null && buvo.equals(laukia.get(id))) laukia.remove(id);
            neseniai.put(id, new long[]{buvo != null && buvo ? 1 : 0, dabar + PERRASYMAS});
        }
        if (gauta != null) {
            List<Preke> nauji = new ArrayList<>();
            for (int i = 0; i < gauta.length(); i++) {
                JSONObject o = gauta.optJSONObject(i);
                if (o == null) continue;
                Preke p = isJson(o);
                long[] n = neseniai.get(p.id);
                if (n != null) {
                    if (n[1] < dabar || (n[0] == 1) == p.x) neseniai.remove(p.id);
                    else p.x = n[0] == 1;
                }
                Boolean l = laukia.get(p.id);
                if (l != null) p.x = l;
                nauji.add(p);
            }
            // laukiantys pažymėjimai prekėms, kurių sąraše nebėra, nebereikalingi
            Iterator<Integer> it = laukia.keySet().iterator();
            while (it.hasNext()) {
                int id = it.next();
                boolean yra = false;
                for (Preke p : nauji) if (p.id == id) yra = true;
                if (!yra) it.remove();
            }
            // kol pirštas ką tik žymėjo, eilės tvarkos nekeičiam (kad eilutės nešokinėtų)
            boolean tasPats = nauji.size() == prekes.size();
            if (tasPats) {
                Map<Integer, Preke> pagalId = new HashMap<>();
                for (Preke p : nauji) pagalId.put(p.id, p);
                for (Preke p : prekes) if (!pagalId.containsKey(p.id)) tasPats = false;
                if (tasPats) {
                    for (Preke p : prekes) {
                        Preke n = pagalId.get(p.id);
                        p.pav = n.pav;
                        p.kiekis = n.kiekis;
                        if (p.x != n.x) {
                            p.x = n.x;
                            ui.removeCallbacks(perrikiuoti);
                            ui.postDelayed(perrikiuoti, 1500);
                        }
                    }
                }
            }
            if (!tasPats) {
                prekes.clear();
                prekes.addAll(nauji);
                rikiuoti();
            }
            issaugoti();
        }
        busena = klaida;
        if (klaida.isEmpty() && !laukia.isEmpty()) busena = "Siunčiama…";
        if (adapteris != null) adapteris.notifyDataSetChanged();
        atnaujintiAntraste();
        if (!laukia.isEmpty() && klaida.isEmpty() && matomas) sinchronizuoti();
    }

    static class Klaida extends Exception {
        Klaida(String s) {
            super(s);
        }
    }

    static class Atsakymas {
        int kodas;
        String tekstas;
    }

    private static Atsakymas http(String metodas, String adresas, String token, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(adresas).openConnection();
        try {
            c.setRequestMethod(metodas);
            c.setConnectTimeout(8000);
            c.setReadTimeout(10000);
            if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                OutputStream os = c.getOutputStream();
                os.write(body.getBytes(StandardCharsets.UTF_8));
                os.close();
            }
            Atsakymas a = new Atsakymas();
            a.kodas = c.getResponseCode();
            InputStream is = a.kodas >= 400 ? c.getErrorStream() : c.getInputStream();
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            if (is != null) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
                is.close();
            }
            a.tekstas = new String(bo.toByteArray(), StandardCharsets.UTF_8);
            return a;
        } finally {
            c.disconnect();
        }
    }

    // ------------------------------------------------------------------ susiejimo ekranas

    private void rodytiSusiejima() {
        sarasoEkranas = false;
        ivedamasAdresas = false;
        ivestis = "";
        kodas = "";
        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(Color.BLACK);
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER_HORIZONTAL);
        l.setPadding(dp(26), dp(22), dp(26), dp(44));

        nurodymas = new TextView(this);
        nurodymas.setTextColor(Color.WHITE);
        nurodymas.setTextSize(12);
        nurodymas.setGravity(Gravity.CENTER);
        l.addView(nurodymas);

        ivestiesLaukas = new TextView(this);
        ivestiesLaukas.setTextColor(ZALIA);
        ivestiesLaukas.setTextSize(22);
        ivestiesLaukas.setTypeface(Typeface.DEFAULT_BOLD);
        ivestiesLaukas.setGravity(Gravity.CENTER);
        ivestiesLaukas.setPadding(0, dp(4), 0, dp(4));
        l.addView(ivestiesLaukas);

        String[][] klavisai = {{"1", "2", "3"}, {"4", "5", "6"}, {"7", "8", "9"}, {".", "0", "⌫"}};
        for (String[] eile : klavisai) {
            LinearLayout e = new LinearLayout(this);
            e.setOrientation(LinearLayout.HORIZONTAL);
            e.setGravity(Gravity.CENTER);
            for (final String k : eile) {
                TextView t = mygtukas(k, TAMSI, Color.WHITE);
                t.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        klavisas(k);
                    }
                });
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(50), dp(36));
                lp.setMargins(dp(3), dp(3), dp(3), dp(3));
                e.addView(t, lp);
            }
            l.addView(e);
        }
        TextView gerai = mygtukas("Gerai", ZALIA, Color.BLACK);
        gerai.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                patvirtinti();
            }
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(162), dp(40));
        lp.setMargins(0, dp(6), 0, 0);
        l.addView(gerai, lp);

        sv.addView(l);
        setContentView(sv);
        sv.requestFocus();
        atnaujintiSusiejima("");
    }

    private TextView mygtukas(String tekstas, int fonas, int spalva) {
        TextView t = new TextView(this);
        t.setText(tekstas);
        t.setTextSize(17);
        t.setTextColor(spalva);
        t.setGravity(Gravity.CENTER);
        GradientDrawable g = new GradientDrawable();
        g.setColor(fonas);
        g.setCornerRadius(dp(18));
        t.setBackground(g);
        return t;
    }

    private void atnaujintiSusiejima(String zinute) {
        if (!zinute.isEmpty()) nurodymas.setText(zinute);
        else if (ivedamasAdresas) nurodymas.setText("HA nerastas automatiškai. Įveskite HA IP adresą (rodomas Receptuose)");
        else nurodymas.setText("Telefone: Receptai → Daugiau → Laikrodis. Įveskite kodą");
        String r = ivestis;
        if (!ivedamasAdresas && r.length() > 3) r = r.substring(0, 3) + " " + r.substring(3);
        ivestiesLaukas.setText(r.isEmpty() ? (ivedamasAdresas ? "192.168…" : "– – –") : r);
    }

    private void klavisas(String k) {
        if (siejama) return;
        if (k.equals("⌫")) {
            if (!ivestis.isEmpty()) ivestis = ivestis.substring(0, ivestis.length() - 1);
        } else if (k.equals(".")) {
            if (ivedamasAdresas && ivestis.length() < 15) ivestis += ".";
        } else if (ivestis.length() < (ivedamasAdresas ? 15 : 6)) {
            ivestis += k;
        }
        atnaujintiSusiejima("");
    }

    private void patvirtinti() {
        if (siejama) return;
        final List<String> adresai = new ArrayList<>();
        if (ivedamasAdresas) {
            if (ivestis.length() < 7) return;
            adresai.add(ivestis);
        } else {
            if (ivestis.length() != 6) return;
            kodas = ivestis;
            String senas = prefs.getString("namu_adresas", "");
            if (!senas.isEmpty()) adresai.add(senas);
            adresai.add("homeassistant.local");
            adresai.add("homeassistant");
        }
        siejama = true;
        atnaujintiSusiejima("Jungiamasi…");
        final String kod = kodas;
        tinklas.execute(new Runnable() {
            @Override
            public void run() {
                String zinute = null;
                JSONObject ok = null;
                String tikes = "";
                for (String h : adresai) {
                    try {
                        Atsakymas a = http("GET", "http://" + h + ":8765/api/laikrodis/susieti?kodas="
                                + URLEncoder.encode(kod, "UTF-8"), null, null);
                        if (a.kodas == 200) {
                            ok = new JSONObject(a.tekstas);
                            tikes = h;
                        } else if (a.kodas == 403) {
                            zinute = new JSONObject(a.tekstas).optString("error", "Neteisingas kodas");
                        } else {
                            zinute = "Atnaujinkite Receptus iki 1.12.0";
                        }
                        break;
                    } catch (Exception ignored) {
                        // bandome kitą adresą
                    }
                }
                final JSONObject o = ok;
                final String z = zinute;
                final String t = tikes;
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        susieta(o, z, t);
                    }
                });
            }
        });
    }

    private void susieta(JSONObject ok, String zinute, String adresas) {
        siejama = false;
        if (ok != null) {
            prefs.edit()
                    .putString("url", ok.optString("url", ""))
                    .putString("token", ok.optString("token", ""))
                    .putString("priedas", ok.optString("priedas", ""))
                    .putString("jutiklis", ok.optString("jutiklis", "sensor.receptai_pirkiniai"))
                    .putString("namu_adresas", adresas)
                    .apply();
            prekes.clear();
            laukia.clear();
            neseniai.clear();
            busena = "";
            virpteleti();
            rodytiSarasa();
            return;
        }
        if (zinute != null) {
            // HA rastas, bet kodas netiko – įvesti kodą iš naujo
            ivedamasAdresas = false;
            ivestis = "";
            atnaujintiSusiejima(zinute + ". Įveskite kodą iš naujo");
            return;
        }
        // nepavyko prisijungti – prašome IP adreso
        ivedamasAdresas = true;
        ivestis = "";
        atnaujintiSusiejima("");
    }
}
