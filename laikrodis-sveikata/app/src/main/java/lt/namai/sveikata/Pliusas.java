package lt.namai.sveikata;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Paspausta komplikacija ar ciferblato „+“: pridedamas gėrimas (numatytai – pirmasis sąraše, pvz. vanduo). */
public class Pliusas extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context c = context.getApplicationContext();
        int tipas = intent.getIntExtra("tipas", -1);
        int ml = Duomenys.prideti(c, tipas, intent.getIntExtra("ml", 0));
        if (ml > 0) Duomenys.virpteleti(c);
        Duomenys.atnaujintiVisur(c);
        final PendingResult pr = goAsync();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Duomenys.sinchronizuoti(c);
                } finally {
                    pr.finish();
                }
            }
        }).start();
    }
}
