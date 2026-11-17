package lt.namai.sveikata;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.RemoteException;

import androidx.wear.watchface.complications.data.ComplicationData;
import androidx.wear.watchface.complications.data.ComplicationText;
import androidx.wear.watchface.complications.data.ComplicationType;
import androidx.wear.watchface.complications.data.LongTextComplicationData;
import androidx.wear.watchface.complications.data.MonochromaticImage;
import androidx.wear.watchface.complications.data.PlainComplicationText;
import androidx.wear.watchface.complications.data.RangedValueComplicationData;
import androidx.wear.watchface.complications.data.ShortTextComplicationData;
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService;
import androidx.wear.watchface.complications.datasource.ComplicationRequest;

/** Komplikacija: kiek šiandien išgerta. Paspaudus – pridedama vandens (+250 ml). */
public class VandensKomplikacija extends ComplicationDataSourceService {

    /** Ką daryti paspaudus. */
    protected PendingIntent paspaudus(Context c) {
        if (!Duomenys.susietas(c)) return atidaryti(c);
        Intent i = new Intent(c, Pliusas.class);
        return PendingIntent.getBroadcast(c, 1, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static PendingIntent atidaryti(Context c) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, 2, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static ComplicationText tekstas(String s) {
        return new PlainComplicationText.Builder(s).build();
    }

    ComplicationData duomenys(ComplicationType tipas, int viso, int tikslas, PendingIntent tap) {
        if (tikslas <= 0) tikslas = 2000;
        MonochromaticImage ikona = new MonochromaticImage.Builder(Icon.createWithResource(this, R.drawable.ic_lasas)).build();
        ComplicationText aprasas = tekstas("Išgerta " + viso + " ml iš " + tikslas + " ml");
        if (tipas == ComplicationType.RANGED_VALUE) {
            return new RangedValueComplicationData.Builder(Math.min(viso, tikslas), 0f, tikslas, aprasas)
                    .setText(tekstas(String.valueOf(viso)))
                    .setTitle(tekstas("ml"))
                    .setMonochromaticImage(ikona)
                    .setTapAction(tap)
                    .build();
        }
        if (tipas == ComplicationType.LONG_TEXT) {
            return new LongTextComplicationData.Builder(tekstas(viso + " / " + tikslas + " ml"), aprasas)
                    .setTitle(tekstas("Vanduo " + Math.round(100f * viso / tikslas) + " %"))
                    .setMonochromaticImage(ikona)
                    .setTapAction(tap)
                    .build();
        }
        return new ShortTextComplicationData.Builder(tekstas(String.valueOf(viso)), aprasas)
                .setTitle(tekstas("ml"))
                .setMonochromaticImage(ikona)
                .setTapAction(tap)
                .build();
    }

    @Override
    public void onComplicationRequest(ComplicationRequest request, ComplicationRequestListener listener) {
        Duomenys.Suvestine s = Duomenys.suvestine(this);
        try {
            listener.onComplicationData(duomenys(request.getComplicationType(), s.viso, s.tikslas, paspaudus(this)));
        } catch (RemoteException ignored) {
        }
        if (Duomenys.pasenusi(this)) Duomenys.fone(this);
    }

    @Override
    public ComplicationData getPreviewData(ComplicationType type) {
        return duomenys(type, 1250, 2000, null);
    }
}
