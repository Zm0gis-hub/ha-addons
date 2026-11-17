package lt.namai.sveikata;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Laikrodžio programėlė „Sveikata“: gėrimų pliusinimas, galvos skausmo ir vaistų žymėjimas.
 * Duomenys – priede „Sveikata“ (Home Assistant).
 */
public class MainActivity extends Activity {

    static final int MELYNA = 0xFF4FB3F0;
    static final int PILKA = 0xFF9AA0A6;
    static final int TAMSI = 0xFF202124;
    static final int MYGTUKAS = 0xFF1E3A4C;
    static final int RAUDONA = 0xFFE2533B;
    private static final long KAS_KIEK = 10000;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService tinklas = Executors.newSingleThreadExecutor();
    private boolean matomas = false;
    private String ekranas = "";
    private ScrollView sv;

    private final Runnable ciklas = new Runnable() {
        @Override
        public void run() {
            if (!matomas || !"pagr".equals(ekranas)) return;
            tinklas.execute(new Runnable() {
                @Override
                public void run() {
                    Duomenys.sinchronizuoti(getApplicationContext());
                    ui.post(new Runnable() {
                        @Override
                        public void run() {
                            if ("pagr".equals(ekranas)) rodytiPagrindini(false);
                        }
                    });
                }
            });
            ui.postDelayed(this, KAS_KIEK);
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Duomenys.susietas(this)) {
            rodytiPagrindini(true);
            atidarytiGrupe(getIntent());
        } else rodytiSusiejima();
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        if (Duomenys.susietas(this)) atidarytiGrupe(i);
    }

    /** Iš plytelės paspaudus grupę (pvz. Kava) – iškart rodomas rūšių pasirinkimas. */
    private void atidarytiGrupe(Intent i) {
        int id = i != null ? i.getIntExtra("grupe", 0) : 0;
        if (id == 0) return;
        i.removeExtra("grupe");
        Duomenys.Gerimas g = Duomenys.pagalId(Duomenys.suvestine(this), id);
        if (g != null && g.turiRusiu) rodytiRusis(g);
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
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        tinklas.shutdown();
    }

    @Override
    public void onBackPressed() {
        if (Duomenys.susietas(this) && !"pagr".equals(ekranas) && !"susieti".equals(ekranas)) rodytiPagrindini(true);
        else super.onBackPressed();
    }

    int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private TextView tekstas(String s, float dydis, int spalva, boolean storas) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(dydis);
        t.setTextColor(spalva);
        t.setGravity(Gravity.CENTER);
        if (storas) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private TextView mygtukas(String tekstas, int fonas, int spalva) {
        TextView t = new TextView(this);
        t.setText(tekstas);
        t.setTextSize(15);
        t.setTextColor(spalva);
        t.setGravity(Gravity.CENTER);
        t.setPadding(dp(6), dp(4), dp(6), dp(4));
        GradientDrawable g = new GradientDrawable();
        g.setColor(fonas);
        g.setCornerRadius(dp(22));
        t.setBackground(g);
        return t;
    }

    private LinearLayout.LayoutParams lp(int w, int h, int virsus) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h);
        p.setMargins(0, dp(virsus), 0, 0);
        p.gravity = Gravity.CENTER_HORIZONTAL;
        return p;
    }

    private LinearLayout naujasEkranas(String vardas) {
        ekranas = vardas;
        sv = new ScrollView(this);
        sv.setBackgroundColor(Color.BLACK);
        sv.setVerticalScrollBarEnabled(true);
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER_HORIZONTAL);
        l.setPadding(dp(24), dp(16), dp(24), dp(44));
        sv.addView(l);
        setContentView(sv);
        sv.requestFocus();
        return l;
    }

    /** Žiedas su išgertu kiekiu. */
    static class Ziedas extends View {
        float dalis;
        String virsus = "", apacia = "";
        final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

        Ziedas(Context c) {
            super(c);
        }

        @Override
        protected void onDraw(Canvas c) {
            float w = getWidth(), h = getHeight(), s = Math.min(w, h), st = s * 0.075f;
            RectF r = new RectF((w - s) / 2 + st, (h - s) / 2 + st, (w + s) / 2 - st, (h + s) / 2 - st);
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(st);
            p.setStrokeCap(Paint.Cap.ROUND);
            p.setColor(0xFF16303F);
            c.drawArc(r, 0, 360, false, p);
            if (dalis > 0) {
                p.setColor(MELYNA);
                c.drawArc(r, -90, 360 * Math.min(1f, dalis), false, p);
            }
            p.setStyle(Paint.Style.FILL);
            p.setTextAlign(Paint.Align.CENTER);
            p.setColor(Color.WHITE);
            p.setTypeface(Typeface.DEFAULT_BOLD);
            p.setTextSize(s * 0.2f);
            c.drawText(virsus, w / 2, h / 2 + s * 0.04f, p);
            p.setTypeface(Typeface.DEFAULT);
            p.setColor(PILKA);
            p.setTextSize(s * 0.1f);
            c.drawText(apacia, w / 2, h / 2 + s * 0.2f, p);
        }
    }

    // ------------------------------------------------------------------ pagrindinis ekranas

    private void rodytiPagrindini(boolean slinktiIVirsu) {
        int y = sv != null && !slinktiIVirsu ? sv.getScrollY() : 0;
        Duomenys.Suvestine s = Duomenys.suvestine(this);
        LinearLayout l = naujasEkranas("pagr");

        Ziedas z = new Ziedas(this);
        z.dalis = s.tikslas > 0 ? (float) s.viso / s.tikslas : 0;
        z.virsus = String.valueOf(s.viso);
        z.apacia = "iš " + s.tikslas + " ml";
        l.addView(z, lp(dp(118), dp(118), 0));

        String b = s.klaida.isEmpty() ? (s.laukia ? "Siunčiama…" : (s.vardas.isEmpty() ? "" : s.vardas)) : s.klaida;
        if (!b.isEmpty()) {
            TextView bt = tekstas(b, 11, s.klaida.isEmpty() ? PILKA : 0xFFF2994A, false);
            l.addView(bt, lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 2));
        }

        if (s.gerimai.length == 0) {
            l.addView(tekstas("Gėrimų sąrašas atsiras prisijungus prie HA", 12, PILKA, false),
                    lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 8));
        }
        // gėrimų mygtukai po du eilutėje
        List<Duomenys.Gerimas> virsus = Duomenys.virsutiniai(s);
        LinearLayout eile = null;
        for (int i = 0; i < virsus.size(); i++) {
            final Duomenys.Gerimas g = virsus.get(i);
            if (i % 2 == 0) {
                eile = new LinearLayout(this);
                eile.setOrientation(LinearLayout.HORIZONTAL);
                eile.setGravity(Gravity.CENTER);
                l.addView(eile, lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 6));
            }
            TextView t = mygtukas(g.emoji + " " + g.pav + "\n" + (g.turiRusiu ? "pasirinkti ›" : "+" + g.ml + " ml") + (g.siandien > 0 ? " · " + Duomenys.ml(g.siandien) : ""), MYGTUKAS, Color.WHITE);
            t.setTextSize(13);
            t.setMaxLines(2);
            t.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (g.turiRusiu) rodytiRusis(g);
                    else gerti(g.id, 0);
                }
            });
            t.setOnLongClickListener(new View.OnLongClickListener() {
                @Override
                public boolean onLongClick(View v) {
                    if (g.turiRusiu) rodytiRusis(g);
                    else rodytiKieki(g);
                    return true;
                }
            });
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(52), 1);
            p.setMargins(dp(3), 0, dp(3), 0);
            eile.addView(t, p);
        }
        if (s.gerimai.length > 0) {
            l.addView(tekstas("Ilgai palaikius – kitas kiekis", 10, PILKA, false),
                    lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 4));
        }
        if (Duomenys.galimaAtsaukti(this)) {
            TextView at = mygtukas("↶ Atšaukti paskutinį", TAMSI, PILKA);
            at.setTextSize(13);
            at.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (Duomenys.atsaukti(MainActivity.this)) {
                        Duomenys.virpteleti(MainActivity.this);
                        Duomenys.atnaujintiVisur(MainActivity.this);
                        Duomenys.fone(MainActivity.this);
                    }
                    rodytiPagrindini(false);
                }
            });
            l.addView(at, lp(dp(170), dp(38), 8));
        }

        // galvos skausmas
        if (s.skaudaNuo == null) {
            TextView sk = mygtukas("🤕 Skauda galvą", 0xFF3A2420, 0xFFFFD2C8);
            sk.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    rodytiStipruma();
                }
            });
            l.addView(sk, lp(dp(170), dp(44), 14));
        } else {
            l.addView(tekstas("🤕 Skauda nuo " + s.skaudaNuo + (s.skaudaStipr >= 0 ? " (" + s.skaudaStipr + "/10)" : ""), 13, 0xFFFFB4A6, true),
                    lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 14));
            TextView vt = mygtukas("💊 Išgėriau vaistų", MYGTUKAS, Color.WHITE);
            vt.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    rodytiVaistus();
                }
            });
            l.addView(vt, lp(dp(170), dp(42), 6));
            TextView pr = mygtukas("✔ Praėjo", 0xFF1D3326, 0xFF6CC690);
            pr.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    Duomenys.praejo(MainActivity.this);
                    Duomenys.virpteleti(MainActivity.this);
                    Duomenys.fone(MainActivity.this);
                    rodytiPagrindini(false);
                }
            });
            l.addView(pr, lp(dp(170), dp(42), 6));
        }

        final TextView atsieti = tekstas("Susieti iš naujo", 11, PILKA, false);
        atsieti.setPadding(dp(10), dp(16), dp(10), dp(10));
        atsieti.setOnClickListener(new View.OnClickListener() {
            private long pirmas = 0;

            @Override
            public void onClick(View v) {
                long dabar = System.currentTimeMillis();
                if (dabar - pirmas < 4000) {
                    Duomenys.p(MainActivity.this).edit().remove("url").remove("token").remove("busena").remove("eile").remove("vietiniai").apply();
                    Duomenys.atnaujintiVisur(MainActivity.this);
                    rodytiSusiejima();
                } else {
                    pirmas = dabar;
                    atsieti.setText("Paspauskite dar kartą, kad atsietumėte");
                }
            }
        });
        l.addView(atsieti, lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 10));
        final int yy = y;
        if (yy > 0) sv.post(new Runnable() {
            @Override
            public void run() {
                sv.scrollTo(0, yy);
            }
        });
    }

    private void gerti(int tipas, int ml) {
        int prideta = Duomenys.prideti(this, tipas, ml);
        if (prideta > 0) Duomenys.virpteleti(this);
        Duomenys.atnaujintiVisur(this);
        Duomenys.fone(this);
        rodytiPagrindini(!"pagr".equals(ekranas));
    }

    private void atgal(LinearLayout l) {
        TextView a = tekstas("‹ Atgal", 13, PILKA, false);
        a.setPadding(dp(10), dp(4), dp(10), dp(6));
        a.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                rodytiPagrindini(true);
            }
        });
        l.addView(a, lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0));
    }

    /** Grupės (pvz. Kava) rūšių pasirinkimas. */
    private void rodytiRusis(final Duomenys.Gerimas gr) {
        LinearLayout l = naujasEkranas("rusys");
        atgal(l);
        l.addView(tekstas(gr.emoji + " " + gr.pav, 15, Color.WHITE, true), lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 2));
        for (final Duomenys.Gerimas g : Duomenys.rusys(Duomenys.suvestine(this), gr.id)) {
            TextView t = mygtukas(g.pav + "\n+" + g.ml + " ml" + (g.siandien > 0 ? " · " + Duomenys.ml(g.siandien) : ""), MYGTUKAS, Color.WHITE);
            t.setTextSize(13);
            t.setMaxLines(2);
            t.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    gerti(g.id, 0);
                }
            });
            t.setOnLongClickListener(new View.OnLongClickListener() {
                @Override
                public boolean onLongClick(View v) {
                    rodytiKieki(g);
                    return true;
                }
            });
            l.addView(t, lp(ViewGroup.LayoutParams.MATCH_PARENT, dp(52), 6));
        }
        l.addView(tekstas("Ilgai palaikius – kitas kiekis", 10, PILKA, false),
                lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 4));
    }

    private void rodytiKieki(final Duomenys.Gerimas g) {
        LinearLayout l = naujasEkranas("kiekis");
        atgal(l);
        l.addView(tekstas(g.emoji + " " + g.pav, 15, Color.WHITE, true), lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 2));
        int[] kiekiai = {100, 150, 200, 250, 300, 330, 400, 500, 750};
        LinearLayout eile = null;
        for (int i = 0; i < kiekiai.length; i++) {
            final int k = kiekiai[i];
            if (i % 3 == 0) {
                eile = new LinearLayout(this);
                eile.setOrientation(LinearLayout.HORIZONTAL);
                eile.setGravity(Gravity.CENTER);
                l.addView(eile, lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 6));
            }
            TextView t = mygtukas(String.valueOf(k), k == g.ml ? MELYNA : MYGTUKAS, k == g.ml ? Color.BLACK : Color.WHITE);
            t.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    gerti(g.id, k);
                }
            });
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(42), 1);
            p.setMargins(dp(3), 0, dp(3), 0);
            eile.addView(t, p);
        }
        l.addView(tekstas("ml", 11, PILKA, false), lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 4));
    }

    private void rodytiStipruma() {
        LinearLayout l = naujasEkranas("stiprumas");
        atgal(l);
        l.addView(tekstas("Kaip stipriai skauda?", 14, Color.WHITE, true), lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 2));
        String[] pav = {"Lengvai (3)", "Vidutiniškai (5)", "Stipriai (7)", "Labai stipriai (9)"};
        int[] reiksme = {3, 5, 7, 9};
        int[] spalva = {0xFFF2CD4A, 0xFFF29A3A, 0xFFE2533B, 0xFFB3261E};
        for (int i = 0; i < pav.length; i++) {
            final int st = reiksme[i];
            TextView t = mygtukas(pav[i], spalva[i], i < 2 ? Color.BLACK : Color.WHITE);
            t.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    Duomenys.skausmas(MainActivity.this, st);
                    Duomenys.virpteleti(MainActivity.this);
                    Duomenys.fone(MainActivity.this);
                    rodytiPagrindini(true);
                }
            });
            l.addView(t, lp(dp(180), dp(42), 6));
        }
        l.addView(tekstas("Daugiau (simptomai, provokatoriai) – telefone", 10, PILKA, false), lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 8));
    }

    private void rodytiVaistus() {
        Duomenys.Suvestine s = Duomenys.suvestine(this);
        LinearLayout l = naujasEkranas("vaistai");
        atgal(l);
        l.addView(tekstas("Kokį vaistą išgėrėte?", 14, Color.WHITE, true), lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 2));
        if (s.vaistai.length == 0) {
            l.addView(tekstas("Vaistų sąrašo nėra. Įrašykite vaistus telefone: Sveikata → Nustatymai → Mano vaistai", 12, PILKA, false),
                    lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 8));
        }
        for (final String[] v : s.vaistai) {
            TextView t = mygtukas("💊 " + v[1], MYGTUKAS, Color.WHITE);
            t.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View x) {
                    try {
                        Duomenys.vaistas(MainActivity.this, Integer.parseInt(v[0]));
                    } catch (NumberFormatException ignored) {
                    }
                    Duomenys.virpteleti(MainActivity.this);
                    Duomenys.fone(MainActivity.this);
                    rodytiPagrindini(true);
                }
            });
            l.addView(t, lp(dp(190), dp(42), 6));
        }
    }

    // ------------------------------------------------------------------ susiejimo ekranas

    private boolean ivedamasAdresas = false;
    private String ivestis = "";
    private TextView ivestiesLaukas;
    private TextView nurodymas;
    private boolean siejama = false;

    private void rodytiSusiejima() {
        ivedamasAdresas = false;
        ivestis = "";
        LinearLayout l = naujasEkranas("susieti");
        l.setPadding(dp(26), dp(22), dp(26), dp(44));

        nurodymas = tekstas("", 12, Color.WHITE, false);
        l.addView(nurodymas);

        ivestiesLaukas = tekstas("", 22, MELYNA, true);
        ivestiesLaukas.setPadding(0, dp(4), 0, dp(4));
        l.addView(ivestiesLaukas);

        String[][] klavisai = {{"1", "2", "3"}, {"4", "5", "6"}, {"7", "8", "9"}, {".", "0", "⌫"}};
        for (String[] eile : klavisai) {
            LinearLayout e = new LinearLayout(this);
            e.setOrientation(LinearLayout.HORIZONTAL);
            e.setGravity(Gravity.CENTER);
            for (final String k : eile) {
                TextView t = mygtukas(k, TAMSI, Color.WHITE);
                t.setTextSize(17);
                t.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        klavisas(k);
                    }
                });
                LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(50), dp(36));
                p.setMargins(dp(3), dp(3), dp(3), dp(3));
                e.addView(t, p);
            }
            l.addView(e);
        }
        TextView gerai = mygtukas("Gerai", MELYNA, Color.BLACK);
        gerai.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                patvirtinti();
            }
        });
        l.addView(gerai, lp(dp(162), dp(40), 6));
        atnaujintiSusiejima("");
    }

    private void atnaujintiSusiejima(String zinute) {
        if (!zinute.isEmpty()) nurodymas.setText(zinute);
        else if (ivedamasAdresas) nurodymas.setText("HA nerastas automatiškai. Įveskite HA IP adresą (rodomas Sveikatoje)");
        else nurodymas.setText("Telefone: Sveikata → Nustatymai → Laikrodis. Įveskite kodą");
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

    private String kodas = "";

    private void patvirtinti() {
        if (siejama) return;
        final List<String> adresai = new ArrayList<>();
        SharedPreferences p = Duomenys.p(this);
        if (ivedamasAdresas) {
            if (ivestis.length() < 7) return;
            adresai.add(ivestis);
        } else {
            if (ivestis.length() != 6) return;
            kodas = ivestis;
            String senas = p.getString("namu_adresas", "");
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
                        Duomenys.Atsakymas a = Duomenys.http("GET", "http://" + h + ":8769/api/laikrodis/susieti?kodas="
                                + URLEncoder.encode(kod, "UTF-8"), null, null);
                        if (a.kodas == 200) {
                            ok = new JSONObject(a.tekstas);
                            tikes = h;
                        } else if (a.kodas == 403) {
                            zinute = new JSONObject(a.tekstas).optString("error", "Neteisingas kodas");
                        } else {
                            zinute = "Atnaujinkite Sveikatos priedą";
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
            Duomenys.p(this).edit()
                    .putString("url", ok.optString("url", ""))
                    .putString("token", ok.optString("token", ""))
                    .putString("priedas", ok.optString("priedas", ""))
                    .putString("jutiklis", ok.optString("jutiklis", ""))
                    .putInt("profilis", ok.optInt("profilis", 0))
                    .putString("vardas", ok.optString("vardas", ""))
                    .putString("namu_adresas", adresas)
                    .remove("busena").remove("eile").remove("vietiniai").remove("skausmas_vietinis").remove("klaida")
                    .apply();
            Duomenys.virpteleti(this);
            rodytiPagrindini(true);
            ui.removeCallbacks(ciklas);
            ui.post(ciklas);
            return;
        }
        if (zinute != null) {
            ivedamasAdresas = false;
            ivestis = "";
            atnaujintiSusiejima(zinute + ". Įveskite kodą iš naujo");
            return;
        }
        ivedamasAdresas = true;
        ivestis = "";
        atnaujintiSusiejima("");
    }
}
