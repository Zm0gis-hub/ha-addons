package lt.namai.sveikata;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Kai atsiranda ryšys – išsiunčia laukiančius įrašus. */
public class Siuntimas extends JobService {

    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                Duomenys.sinchronizuoti(getApplicationContext());
                boolean dar = Duomenys.suvestine(getApplicationContext()).laukia
                        && !Duomenys.p(getApplicationContext()).getString("klaida", "").isEmpty();
                jobFinished(params, dar);
            }
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
