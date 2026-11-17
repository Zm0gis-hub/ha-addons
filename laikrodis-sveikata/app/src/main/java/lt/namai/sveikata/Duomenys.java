package lt.namai.sveikata;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.wear.tiles.TileService;
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Bendri duomenys programėlei, komplikacijoms ir plytelei.
 *
 * Būsena skaitoma iš HA jutiklio sensor.sveikata_vanduo_N (atributas „laikrodis“),
 * įrašai siunčiami per HA paslaugą hassio.addon_stdin į priedą „Sveikata“.
 * Be ryšio įrašai laukia eilėje ir išsiunčiami vėliau; kol HA jų nepatvirtina,
 * jie pridedami prie rodomos sumos vietoje.
 */
final class Duomenys {

    static final String PREFS = "sveikata";
    static final long SENA = 2 * 60 * 1000;   // po kiek laiko būseną verta atnaujinti
    private static final Object TINKLAS = new Object();
    private static final AtomicBoolean VYKSTA = new AtomicBoolean(false);

    private Duomenys() {
    }

    static SharedPreferences p(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean susietas(Context c) {
        SharedPreferences p = p(c);
        return !p.getString("url", "").isEmpty() && !p.getString("token", "").isEmpty();
    }

    static String siandien() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    private static JSONObject obj(Context c, String k) {
        try {
            return new JSONObject(p(c).getString(k, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static JSONArray arr(Context c, String k) {
        try {
            return new JSONArray(p(c).getString(k, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    // ------------------------------------------------------------------ suvestinė rodymui

    static final class Gerimas {
        int id;
        String pav;
        String emoji;
        int ml;
        boolean tikslui;
        int siandien;
    }

    static final class Suvestine {
        int viso;
        int tikslas = 2000;
        Gerimas[] gerimai = new Gerimas[0];
        /** Aktyvus galvos skausmas: null – neskauda. */
        String skaudaNuo;
        int skaudaStipr = -1;
        String[][] vaistai = new String[0][];
        String vardas = "";
        String klaida = "";
        boolean laukia;
        long atnaujinta;

        int procentai() {
            return tikslas > 0 ? Math.round(100f * viso / tikslas) : 0;
        }
    }

    static synchronized Suvestine suvestine(Context c) {
        Suvestine s = new Suvestine();
        SharedPreferences p = p(c);
        JSONObject b = obj(c, "busena");
        JSONObject l = b.optJSONObject("laikrodis");
        if (l == null) l = new JSONObject();
        boolean siand = siandien().equals(b.optString("diena"));
        s.viso = siand ? b.optInt("viso") : 0;
        s.tikslas = b.optInt("tikslas", 2000);
        s.vardas = l.optString("vardas", p.getString("vardas", ""));
        s.klaida = p.getString("klaida", "");
        s.atnaujinta = p.getLong("gauta", 0);
        Set<String> uids = new HashSet<>();
        JSONArray u = l.optJSONArray("u");
        if (siand && u != null) for (int i = 0; i < u.length(); i++) uids.add(u.optString(i));

        JSONArray g = l.optJSONArray("g");
        Map<Integer, Gerimas> pagalId = new HashMap<>();
        if (g != null) {
            s.gerimai = new Gerimas[g.length()];
            for (int i = 0; i < g.length(); i++) {
                JSONObject o = g.optJSONObject(i);
                Gerimas x = new Gerimas();
                x.id = o.optInt("i");
                x.pav = o.optString("n");
                x.emoji = o.optString("e", "💧");
                x.ml = o.optInt("ml", 250);
                x.tikslui = o.optInt("g", 1) != 0;
                x.siandien = siand ? o.optInt("s") : 0;
                s.gerimai[i] = x;
                pagalId.put(x.id, x);
            }
        }
        // vietiniai, dar HA nepatvirtinti įrašai
        String d = siandien();
        JSONArray v = arr(c, "vietiniai");
        for (int i = 0; i < v.length(); i++) {
            JSONObject o = v.optJSONObject(i);
            if (o == null || !d.equals(o.optString("d"))) continue;
            boolean serveryje = uids.contains(o.optString("u"));
            boolean atsaukta = o.optBoolean("x");
            int ml = o.optInt("ml");
            int zenklas = !atsaukta && !serveryje ? 1 : (atsaukta && serveryje ? -1 : 0);
            if (zenklas == 0) continue;
            if (o.optBoolean("g", true)) s.viso += zenklas * ml;
            Gerimas x = pagalId.get(o.optInt("t"));
            if (x != null) x.siandien += zenklas * ml;
        }
        if (s.viso < 0) s.viso = 0;

        JSONObject sk = l.optJSONObject("s");
        if (sk != null && siandienArVakar(sk.optString("d"))) {
            s.skaudaNuo = sk.optString("nuo");
            s.skaudaStipr = sk.isNull("st") ? -1 : sk.optInt("st", -1);
        }
        // vietinis skausmo pakeitimas, kol HA jo dar nepatvirtino
        JSONObject vs = obj(c, "skausmas_vietinis");
        if (vs.has("busena")) {
            if ("pradeta".equals(vs.optString("busena"))) {
                if (s.skaudaNuo == null) s.skaudaNuo = vs.optString("nuo");
                s.skaudaStipr = vs.optInt("st", s.skaudaStipr);
            } else {
                s.skaudaNuo = null;
            }
        }
        JSONArray m = l.optJSONArray("v");
        if (m != null) {
            s.vaistai = new String[m.length()][];
            for (int i = 0; i < m.length(); i++) {
                JSONObject o = m.optJSONObject(i);
                s.vaistai[i] = new String[]{String.valueOf(o.optInt("i")), o.optString("n")};
            }
        }
        s.laukia = arr(c, "eile").length() > 0;
        return s;
    }

    private static boolean siandienArVakar(String d) {
        // nebaigtas skausmas rodomas, net jei prasidėjo seniau
        return d != null && !d.isEmpty();
    }

    // ------------------------------------------------------------------ įrašai

    private static String naujasId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    }

    private static JSONObject komanda(Context c, String veiksmas) throws Exception {
        JSONObject k = new JSONObject();
        k.put("veiksmas", veiksmas);
        k.put("p", p(c).getInt("profilis", 0));
        k.put("u", naujasId());
        k.put("ts", System.currentTimeMillis() / 1000);
        return k;
    }

    private static void iEile(Context c, JSONObject k) {
        JSONArray e = arr(c, "eile");
        e.put(k);
        p(c).edit().putString("eile", e.toString()).apply();
    }

    /** Pridėti gėrimą (tipas &lt; 0 – pirmasis sąraše, ml &lt;= 0 – įprastas kiekis). Grąžina pridėtą kiekį. */
    static synchronized int prideti(Context c, int tipas, int ml) {
        Suvestine s = suvestine(c);
        Gerimas g = null;
        for (Gerimas x : s.gerimai) if (x.id == tipas || (tipas < 0 && g == null)) g = x;
        if (g == null && tipas < 0) {
            g = new Gerimas();
            g.id = -1;
            g.ml = 250;
            g.tikslui = true;
        }
        if (g == null) return 0;
        if (ml <= 0) ml = g.ml;
        try {
            JSONObject k = komanda(c, "gerti");
            k.put("t", g.id);
            k.put("ml", ml);
            iEile(c, k);
            JSONObject v = new JSONObject();
            v.put("u", k.getString("u"));
            v.put("ml", ml);
            v.put("t", g.id);
            v.put("g", g.tikslui);
            v.put("d", siandien());
            v.put("kada", System.currentTimeMillis());
            JSONArray a = arr(c, "vietiniai");
            a.put(v);
            p(c).edit().putString("vietiniai", a.toString()).apply();
        } catch (Exception e) {
            return 0;
        }
        return ml;
    }

    /** Atšaukti paskutinį per 30 min. pridėtą gėrimą. */
    static synchronized boolean atsaukti(Context c) {
        JSONArray a = arr(c, "vietiniai");
        for (int i = a.length() - 1; i >= 0; i--) {
            JSONObject o = a.optJSONObject(i);
            if (o == null || o.optBoolean("x")) continue;
            if (System.currentTimeMillis() - o.optLong("kada") > 30 * 60 * 1000) return false;
            try {
                o.put("x", true);
                p(c).edit().putString("vietiniai", a.toString()).apply();
                // jei dar neišsiųsta – tiesiog išmetam iš eilės
                JSONArray e = arr(c, "eile"), nauja = new JSONArray();
                boolean buvo = false;
                for (int j = 0; j < e.length(); j++) {
                    JSONObject k = e.optJSONObject(j);
                    if (k != null && o.optString("u").equals(k.optString("u"))) buvo = true;
                    else nauja.put(k);
                }
                if (!buvo) {
                    JSONObject k = komanda(c, "atsaukti");
                    k.put("u", o.optString("u"));
                    nauja.put(k);
                }
                p(c).edit().putString("eile", nauja.toString()).apply();
                return true;
            } catch (Exception e) {
                return false;
            }
        }
        return false;
    }

    static boolean galimaAtsaukti(Context c) {
        JSONArray a = arr(c, "vietiniai");
        for (int i = a.length() - 1; i >= 0; i--) {
            JSONObject o = a.optJSONObject(i);
            if (o == null || o.optBoolean("x")) continue;
            return System.currentTimeMillis() - o.optLong("kada") < 30 * 60 * 1000;
        }
        return false;
    }

    static synchronized void skausmas(Context c, int stiprumas) {
        try {
            JSONObject k = komanda(c, "skausmas");
            k.put("st", stiprumas);
            iEile(c, k);
            JSONObject v = new JSONObject();
            v.put("busena", "pradeta");
            v.put("nuo", new SimpleDateFormat("HH:mm", Locale.US).format(new Date()));
            v.put("st", stiprumas);
            p(c).edit().putString("skausmas_vietinis", v.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    static synchronized void praejo(Context c) {
        try {
            iEile(c, komanda(c, "praejo"));
            JSONObject v = new JSONObject();
            v.put("busena", "baigta");
            p(c).edit().putString("skausmas_vietinis", v.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    static synchronized void vaistas(Context c, int vaistoId) {
        try {
            JSONObject k = komanda(c, "vaistas");
            k.put("m", vaistoId);
            iEile(c, k);
        } catch (Exception ignored) {
        }
    }

    // ------------------------------------------------------------------ ryšys su HA

    static final class Atsakymas {
        int kodas;
        String tekstas;
    }

    static Atsakymas http(String metodas, String adresas, String token, String body) throws Exception {
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

    static final class Klaida extends Exception {
        Klaida(String s) {
            super(s);
        }
    }

    /** Išsiunčia eilę ir parsisiunčia būseną. Vykdyti ne pagrindinėje gijoje. */
    static void sinchronizuoti(Context c) {
        if (!susietas(c)) return;
        synchronized (TINKLAS) {
            SharedPreferences p = p(c);
            String url = p.getString("url", "");
            String token = p.getString("token", "");
            String priedas = p.getString("priedas", "");
            String jutiklis = p.getString("jutiklis", "");
            String klaida = "";
            try {
                JSONArray e = arr(c, "eile");
                for (int i = 0; i < e.length(); i++) {
                    JSONObject k = e.optJSONObject(i);
                    if (k == null) continue;
                    JSONObject body = new JSONObject();
                    body.put("addon", priedas);
                    body.put("input", k);
                    Atsakymas a = http("POST", url + "/api/services/hassio/addon_stdin", token, body.toString());
                    if (a.kodas == 401) throw new Klaida("Raktas nebegalioja – susiekite iš naujo");
                    if (a.kodas < 200 || a.kodas >= 300) throw new Klaida("HA klaida " + a.kodas);
                    pasalintiIsEiles(c, k.optString("u"), k.optString("veiksmas"));
                }
                Atsakymas a = http("GET", url + "/api/states/" + jutiklis, token, null);
                if (a.kodas == 401) throw new Klaida("Raktas nebegalioja – susiekite iš naujo");
                if (a.kodas == 404) throw new Klaida("HA nemato duomenų – ar veikia Sveikata?");
                if (a.kodas != 200) throw new Klaida("HA klaida " + a.kodas);
                JSONObject st = new JSONObject(a.tekstas);
                JSONObject at = st.optJSONObject("attributes");
                if (at == null || at.optJSONObject("laikrodis") == null) throw new Klaida("Atnaujinkite Sveikatos priedą");
                issaugotiBusena(c, st, at);
            } catch (Klaida e) {
                klaida = e.getMessage();
            } catch (Exception e) {
                klaida = "Nėra ryšio";
            }
            p.edit().putString("klaida", klaida).apply();
            if (!klaida.isEmpty() && arr(c, "eile").length() > 0) planuotiSiuntima(c);
        }
        atnaujintiVisur(c);
    }

    private static synchronized void pasalintiIsEiles(Context c, String uid, String veiksmas) {
        JSONArray e = arr(c, "eile"), nauja = new JSONArray();
        for (int i = 0; i < e.length(); i++) {
            JSONObject k = e.optJSONObject(i);
            if (k == null) continue;
            if (uid.equals(k.optString("u")) && veiksmas.equals(k.optString("veiksmas"))) continue;
            nauja.put(k);
        }
        p(c).edit().putString("eile", nauja.toString()).apply();
    }

    private static synchronized void issaugotiBusena(Context c, JSONObject st, JSONObject at) throws Exception {
        JSONObject b = new JSONObject();
        int viso = 0;
        try {
            viso = (int) Math.round(Double.parseDouble(st.optString("state", "0")));
        } catch (Exception ignored) {
        }
        b.put("viso", viso);
        b.put("tikslas", at.optInt("tikslas", 2000));
        b.put("diena", at.optString("diena"));
        b.put("laikrodis", at.optJSONObject("laikrodis"));
        // patvirtinti vietiniai įrašai nebereikalingi
        Set<String> uids = new HashSet<>();
        JSONArray u = at.optJSONObject("laikrodis").optJSONArray("u");
        if (u != null) for (int i = 0; i < u.length(); i++) uids.add(u.optString(i));
        Set<String> eileje = new HashSet<>();
        JSONArray e = arr(c, "eile");
        for (int i = 0; i < e.length(); i++) eileje.add(e.optJSONObject(i).optString("u"));
        JSONArray v = arr(c, "vietiniai"), liko = new JSONArray();
        String d = siandien();
        for (int i = 0; i < v.length(); i++) {
            JSONObject o = v.optJSONObject(i);
            if (o == null || !d.equals(o.optString("d"))) continue;
            boolean serveryje = uids.contains(o.optString("u"));
            boolean x = o.optBoolean("x");
            // laikom, kol nepatvirtinta (ir neatšaukta), arba atšaukta, bet serveryje dar yra
            if ((!x && !serveryje) || (x && serveryje) || eileje.contains(o.optString("u"))) liko.put(o);
            else if (!x && System.currentTimeMillis() - o.optLong("kada") < 30 * 60 * 1000) {
                o.put("patvirtinta", true);  // atšaukimui dar reikia žinoti paskutinį
                liko.put(o);
            }
        }
        SharedPreferences.Editor ed = p(c).edit()
                .putString("busena", b.toString())
                .putString("vietiniai", liko.toString())
                .putLong("gauta", System.currentTimeMillis())
                .putString("vardas", at.optJSONObject("laikrodis").optString("vardas", ""));
        if (e.length() == 0) ed.remove("skausmas_vietinis");
        ed.apply();
    }

    /** Sinchronizuoti fone (ne daugiau kaip vieną kartą vienu metu). */
    static void fone(final Context c) {
        if (!susietas(c) || !VYKSTA.compareAndSet(false, true)) return;
        final Context app = c.getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    sinchronizuoti(app);
                } finally {
                    VYKSTA.set(false);
                }
            }
        }).start();
    }

    static boolean pasenusi(Context c) {
        return System.currentTimeMillis() - p(c).getLong("gauta", 0) > SENA;
    }

    static void planuotiSiuntima(Context c) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;
            js.schedule(new JobInfo.Builder(1, new ComponentName(c, Siuntimas.class))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setBackoffCriteria(60000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                    .build());
        } catch (Exception ignored) {
        }
    }

    static void atnaujintiVisur(Context c) {
        try {
            ComplicationDataSourceUpdateRequester.create(c, new ComponentName(c, VandensKomplikacija.class)).requestUpdateAll();
        } catch (Exception ignored) {
        }
        try {
            ComplicationDataSourceUpdateRequester.create(c, new ComponentName(c, AtidarytiKomplikacija.class)).requestUpdateAll();
        } catch (Exception ignored) {
        }
        try {
            TileService.getUpdater(c).requestUpdate(VandensPlytele.class);
        } catch (Exception ignored) {
        }
    }

    static void virpteleti(Context c) {
        try {
            Vibrator v = (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.vibrate(VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE));
        } catch (Exception ignored) {
        }
    }

    static String ml(int ml) {
        if (ml >= 1000) return String.format(Locale.US, "%.1f l", ml / 1000f).replace('.', ',');
        return ml + " ml";
    }
}
