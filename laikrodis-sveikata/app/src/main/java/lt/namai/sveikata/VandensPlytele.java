package lt.namai.sveikata;

import androidx.concurrent.futures.ResolvableFuture;
import androidx.wear.protolayout.ActionBuilders;
import androidx.wear.protolayout.ColorBuilders;
import androidx.wear.protolayout.DimensionBuilders;
import androidx.wear.protolayout.LayoutElementBuilders;
import androidx.wear.protolayout.ModifiersBuilders;
import androidx.wear.protolayout.ResourceBuilders;
import androidx.wear.protolayout.TimelineBuilders;
import androidx.wear.tiles.RequestBuilders;
import androidx.wear.tiles.TileBuilders;
import androidx.wear.tiles.TileService;

import com.google.common.util.concurrent.ListenableFuture;

import static androidx.wear.protolayout.DimensionBuilders.dp;
import static androidx.wear.protolayout.DimensionBuilders.expand;
import static androidx.wear.protolayout.DimensionBuilders.sp;

/** Plytelė: šiandien išgerta, žiedas ir greiti „+“ mygtukai. */
public class VandensPlytele extends TileService {

    private static final String RESURSAI = "1";
    private static final int MELYNA = 0xFF4FB3F0;
    private static final int TAMSI = 0xFF16303F;
    private static final int PILKA = 0xFF9AA0A6;
    private static final int MYGTUKAS = 0xFF1E3A4C;

    @Override
    protected ListenableFuture<TileBuilders.Tile> onTileRequest(RequestBuilders.TileRequest request) {
        String id = "";
        try {
            id = request.getCurrentState().getLastClickableId();
        } catch (Exception ignored) {
        }
        boolean prideta = false;
        if (id != null && id.startsWith("g:")) {
            try {
                int ml = Duomenys.prideti(this, Integer.parseInt(id.substring(2)), 0);
                if (ml > 0) {
                    Duomenys.virpteleti(this);
                    prideta = true;
                }
            } catch (NumberFormatException ignored) {
            }
        }
        if (prideta || Duomenys.pasenusi(this)) Duomenys.fone(this);
        ResolvableFuture<TileBuilders.Tile> f = ResolvableFuture.create();
        f.set(new TileBuilders.Tile.Builder()
                .setResourcesVersion(RESURSAI)
                .setFreshnessIntervalMillis(15 * 60 * 1000)
                .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(isdestymas()))
                .build());
        return f;
    }

    @Override
    protected ListenableFuture<ResourceBuilders.Resources> onTileResourcesRequest(RequestBuilders.ResourcesRequest request) {
        ResolvableFuture<ResourceBuilders.Resources> f = ResolvableFuture.create();
        f.set(new ResourceBuilders.Resources.Builder().setVersion(RESURSAI).build());
        return f;
    }

    private static LayoutElementBuilders.Text tekstas(String s, float dydis, int spalva, boolean storas) {
        LayoutElementBuilders.FontStyle.Builder fs = new LayoutElementBuilders.FontStyle.Builder()
                .setSize(sp(dydis))
                .setColor(ColorBuilders.argb(spalva));
        if (storas) fs.setWeight(LayoutElementBuilders.FONT_WEIGHT_BOLD);
        return new LayoutElementBuilders.Text.Builder()
                .setText(s)
                .setFontStyle(fs.build())
                .setMaxLines(1)
                .build();
    }

    private static ModifiersBuilders.Clickable paspaudimas(String id) {
        return new ModifiersBuilders.Clickable.Builder()
                .setId(id)
                .setOnClick(new ActionBuilders.LoadAction.Builder().build())
                .build();
    }

    private LayoutElementBuilders.LayoutElement mygtukas(Duomenys.Gerimas g) {
        return new LayoutElementBuilders.Box.Builder()
                .setWidth(dp(52))
                .setHeight(dp(52))
                .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
                .setModifiers(new ModifiersBuilders.Modifiers.Builder()
                        .setClickable(g.turiRusiu ? new ModifiersBuilders.Clickable.Builder()
                                .setId("r:" + g.id)
                                .setOnClick(atidaryti(g.id))
                                .build() : paspaudimas("g:" + g.id))
                        .setBackground(new ModifiersBuilders.Background.Builder()
                                .setColor(ColorBuilders.argb(MYGTUKAS))
                                .setCorner(new ModifiersBuilders.Corner.Builder().setRadius(dp(26)).build())
                                .build())
                        .build())
                .addContent(new LayoutElementBuilders.Column.Builder()
                        .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                        .addContent(tekstas(g.emoji, 18, 0xFFFFFFFF, false))
                        .addContent(tekstas(g.turiRusiu ? "›" : "+" + g.ml, 10, PILKA, false))
                        .build())
                .build();
    }

    private LayoutElementBuilders.LayoutElement isdestymas() {
        Duomenys.Suvestine s = Duomenys.suvestine(this);
        if (!Duomenys.susietas(this)) {
            return new LayoutElementBuilders.Box.Builder()
                    .setWidth(expand())
                    .setHeight(expand())
                    .setModifiers(new ModifiersBuilders.Modifiers.Builder()
                            .setClickable(new ModifiersBuilders.Clickable.Builder()
                                    .setId("atidaryti")
                                    .setOnClick(atidaryti())
                                    .build())
                            .build())
                    .addContent(tekstas("Atidarykite Sveikatą ir susiekite", 13, 0xFFFFFFFF, false))
                    .build();
        }
        float dalis = s.tikslas > 0 ? Math.min(1f, (float) s.viso / s.tikslas) : 0f;
        LayoutElementBuilders.Arc.Builder fonas = new LayoutElementBuilders.Arc.Builder()
                .setAnchorAngle(DimensionBuilders.degrees(0))
                .setAnchorType(LayoutElementBuilders.ARC_ANCHOR_START)
                .addContent(new LayoutElementBuilders.ArcLine.Builder()
                        .setLength(DimensionBuilders.degrees(359.9f))
                        .setThickness(dp(7))
                        .setColor(ColorBuilders.argb(TAMSI))
                        .build());
        LayoutElementBuilders.Arc.Builder progresas = new LayoutElementBuilders.Arc.Builder()
                .setAnchorAngle(DimensionBuilders.degrees(0))
                .setAnchorType(LayoutElementBuilders.ARC_ANCHOR_START)
                .addContent(new LayoutElementBuilders.ArcLine.Builder()
                        .setLength(DimensionBuilders.degrees(Math.max(0.5f, 359.9f * dalis)))
                        .setThickness(dp(7))
                        .setColor(ColorBuilders.argb(dalis > 0 ? MELYNA : TAMSI))
                        .build());

        LayoutElementBuilders.Row.Builder eile = new LayoutElementBuilders.Row.Builder()
                .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER);
        int n = 0;
        for (Duomenys.Gerimas g : Duomenys.virsutiniai(s)) {
            if (n == 3) break;
            if (n > 0) eile.addContent(new LayoutElementBuilders.Spacer.Builder().setWidth(dp(6)).build());
            eile.addContent(mygtukas(g));
            n++;
        }
        if (n == 0) eile.addContent(tekstas("Atidarykite programėlę", 12, PILKA, false));

        LayoutElementBuilders.Column.Builder vidus = new LayoutElementBuilders.Column.Builder()
                .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                .addContent(tekstas("💧 Vanduo", 12, PILKA, false))
                .addContent(tekstas(s.viso + " ml", 26, 0xFFFFFFFF, true))
                .addContent(tekstas("iš " + s.tikslas + " ml · " + s.procentai() + " %", 11, MELYNA, false))
                .addContent(new LayoutElementBuilders.Spacer.Builder().setHeight(dp(8)).build())
                .addContent(eile.build())
                .addContent(new LayoutElementBuilders.Spacer.Builder().setHeight(dp(6)).build())
                .addContent(new LayoutElementBuilders.Box.Builder()
                        .setModifiers(new ModifiersBuilders.Modifiers.Builder()
                                .setClickable(new ModifiersBuilders.Clickable.Builder()
                                        .setId("atidaryti")
                                        .setOnClick(atidaryti())
                                        .build())
                                .setPadding(new ModifiersBuilders.Padding.Builder().setAll(dp(6)).build())
                                .build())
                        .addContent(tekstas(s.skaudaNuo != null ? "🤕 nuo " + s.skaudaNuo + " ›" : "Daugiau ›", 11, PILKA, false))
                        .build());

        return new LayoutElementBuilders.Box.Builder()
                .setWidth(expand())
                .setHeight(expand())
                .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
                .addContent(fonas.build())
                .addContent(progresas.build())
                .addContent(vidus.build())
                .build();
    }

    private ActionBuilders.LaunchAction atidaryti() {
        return atidaryti(0);
    }

    /** Atidaro programėlę; grupe != 0 – iškart rodomas tos grupės (pvz. Kavos) rūšių pasirinkimas. */
    private ActionBuilders.LaunchAction atidaryti(int grupe) {
        ActionBuilders.AndroidActivity.Builder a = new ActionBuilders.AndroidActivity.Builder()
                .setPackageName(getPackageName())
                .setClassName(MainActivity.class.getName());
        if (grupe != 0) a.addKeyToExtraMapping("grupe", new ActionBuilders.AndroidIntExtra.Builder().setValue(grupe).build());
        return new ActionBuilders.LaunchAction.Builder().setAndroidActivity(a.build()).build();
    }
}
