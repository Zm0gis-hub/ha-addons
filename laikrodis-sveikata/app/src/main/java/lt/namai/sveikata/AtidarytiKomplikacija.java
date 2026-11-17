package lt.namai.sveikata;

import android.app.PendingIntent;
import android.content.Context;

/** Ta pati komplikacija, bet paspaudus atidaroma programėlė. */
public class AtidarytiKomplikacija extends VandensKomplikacija {

    @Override
    protected PendingIntent paspaudus(Context c) {
        return atidaryti(c);
    }
}
