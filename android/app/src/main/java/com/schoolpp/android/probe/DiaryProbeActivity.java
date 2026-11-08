package com.schoolpp.android.probe;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.WindowInsets;
import android.window.OnBackInvokedDispatcher;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;

import org.json.JSONException;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

public final class DiaryProbeActivity extends Activity {
    private static final String DIARY_HOST = "diary.e-schools.by";
    private static final String LOGIN_HOST = "oauth.rios.unibel.by";
    private static final String DIARY_URL = "https://" + DIARY_HOST + "/";
    private static final String ON_DIARY_ORIGIN =
        "location.origin === 'https://diary.e-schools.by' && window.top === window";
    private static final long AUTO_INTERVAL = 15 * 60_000;
    private static final String LAST_ATTEMPT = "android_sync_attempt";
    private static final String HAS_SYNCED = "android_sync_confirmed";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable poll = this::readProbe;
    private final Runnable timeout = () -> finishProbe("Дневник отвечает слишком долго. Попробуйте ещё раз.");
    private final Runnable waitForWeek = this::checkWeek;
    private final Runnable autoSync = this::tryAutoSync;
    private final Runnable autoLoginTimeout = () -> finishProbe("");
    private SyncBanner banner;
    private FrameLayout pages;
    private WebView diary;
    private AndroidSyncPage schoolpp;
    private AndroidDashboard dashboard;
    private SharedPreferences settings;
    private String probeScript;
    private String readinessScript;
    private String probeKey;
    private String attempt;
    private long deadline;
    private boolean pageReady;
    private boolean pageFailed;
    private boolean preparing;
    private boolean automatic;
    private boolean resumed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        settings = getPreferences(MODE_PRIVATE);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.rgb(241, 245, 240));
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            layout.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                );
                int keyboard = insets.getInsets(WindowInsets.Type.ime()).bottom;
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard));
                return insets;
            });
        }

        banner = new SyncBanner(this);
        LinearLayout.LayoutParams bannerParams = new LinearLayout.LayoutParams(-1, -2);
        bannerParams.setMargins(dp(10), dp(5), dp(10), dp(5));
        layout.addView(banner, bannerParams);
        pages = new FrameLayout(this);
        layout.addView(pages, new LinearLayout.LayoutParams(-1, 0, 1));
        schoolpp = new AndroidSyncPage(pages, handler);
        dashboard = new AndroidDashboard(pages, () -> beginSync(false), this::showDashboardError,
            () -> { if (automatic) cancelAndReturn(); });
        setContentView(layout);
        if (Build.VERSION.SDK_INT >= 33)
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);

        try {
            probeScript = readAsset("diary-probe.js");
            readinessScript = readAsset("diary-ready.js");
        } catch (IOException error) {
            /* The dashboard remains available if the sync assets are missing. */
        }
        dashboard.show();
    }

    private String readAsset(String name) throws IOException {
        try (InputStream asset = getAssets().open(name)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            for (int read; (read = asset.read(chunk)) != -1; ) buffer.write(chunk, 0, read);
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void loadSource() {
        pageReady = false;
        pageFailed = false;
        if (diary == null) {
            diary = new WebView(this);
            configureBrowser(diary);
            diary.setWebViewClient(new DiaryClient());
            pages.addView(diary, new FrameLayout.LayoutParams(-1, -1));
        }
        diary.setVisibility(automatic ? View.INVISIBLE : View.VISIBLE);
        if (!automatic) diary.bringToFront();
        diary.loadUrl(DIARY_URL);
    }

    static void configureBrowser(WebView browser) {
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
    }

    private static boolean isDiaryUrl(String value) {
        return isHttpsUrlOnHost(value, DIARY_HOST);
    }

    private static boolean isAllowedPageUrl(String value) {
        return isDiaryUrl(value) || isHttpsUrlOnHost(value, LOGIN_HOST);
    }

    static boolean isHttpsUrlOnHost(String value, String host) {
        if (value == null) return false;
        try {
            URI url = URI.create(value);
            return "https".equalsIgnoreCase(url.getScheme())
                && host.equalsIgnoreCase(url.getHost())
                && url.getUserInfo() == null
                && (url.getPort() == -1 || url.getPort() == 443);
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    private boolean canCollect() {
        return pageReady && !pageFailed && diary != null && isDiaryUrl(diary.getUrl());
    }

    private void beginSync(boolean inBackground) {
        if (!resumed) return;
        if (attempt != null) {
            if (!inBackground && automatic) {
                automatic = false;
                handler.removeCallbacks(autoLoginTimeout);
                dashboard.hide();
                diary.setVisibility(View.VISIBLE);
                diary.bringToFront();
                banner.show("Синхронизация…", true, this::cancelAndReturn);
            }
            return;
        }
        if (probeScript == null || readinessScript == null) {
            if (!inBackground) banner.show(
                "Не удалось загрузить синхронизацию. Переустановите School++.",
                false, () -> beginSync(false));
            return;
        }
        handler.removeCallbacks(autoSync);
        attempt = UUID.randomUUID().toString().replace("-", "");
        automatic = inBackground;
        settings.edit().putLong(LAST_ATTEMPT, System.currentTimeMillis()).apply();
        if (automatic) handler.postDelayed(autoLoginTimeout, 12_000);
        else {
            dashboard.hide();
            banner.show("Синхронизация · открываем госдневник…", true, this::cancelAndReturn);
        }
        loadSource();
    }

    private void checkWeek() {
        if (attempt == null || preparing || !canCollect()) return;
        String id = attempt;
        String url = diary.getUrl();
        diary.evaluateJavascript(readinessScript, result -> {
            if (!id.equals(attempt) || !canCollect()) return;
            if (!url.equals(diary.getUrl())) {
                handler.post(waitForWeek);
                return;
            }
            if ("true".equals(result)) {
                prepareCollection(id);
            } else {
                if (!automatic) banner.update("Войдите в госдневник и откройте неделю");
                handler.postDelayed(waitForWeek, 650);
            }
        });
    }

    private void prepareCollection(String id) {
        preparing = true;
        String sourceUrl = diary.getUrl();
        handler.removeCallbacks(autoLoginTimeout);
        if (!automatic) banner.update("Синхронизация · подключаем School++…");
        schoolpp.prepare(id, new AndroidSyncPage.Listener() {
            @Override
            public void onReady() {
                if (!id.equals(attempt)) return;
                if (canCollect() && sourceUrl.equals(diary.getUrl()))
                    startProbe("__schoolppAndroidProbe_" + id);
                else finishProbe("Страница дневника изменилась. Повторите синхронизацию.");
            }

            @Override
            public void onSaved() {
                if (!id.equals(attempt)) return;
                boolean keepSection = automatic;
                settings.edit().putBoolean(HAS_SYNCED, true).apply();
                cancelAndReturn();
                dashboard.showUpdated(keepSection);
            }

            @Override
            public void onError(String message) {
                finishProbe(message);
            }
        });
    }

    private void startProbe(String key) {
        probeKey = key;
        deadline = SystemClock.elapsedRealtime() + 50_000;
        if (!automatic) banner.update("Синхронизация · собираем уроки и оценки…");
        handler.postDelayed(timeout, 50_000);
        diary.evaluateJavascript(probeScript + "(" + JSONObject.quote(key) + ")", result -> {
            if (!key.equals(probeKey)) return;
            if ("true".equals(result)) handler.post(poll);
            else finishProbe("Открой неделю в госдневнике и запусти проверку снова.");
        });
    }

    private void readProbe() {
        String key = probeKey;
        if (key == null) return;
        if (SystemClock.elapsedRealtime() >= deadline) {
            timeout.run();
            return;
        }
        if (diary == null || !isDiaryUrl(diary.getUrl())) {
            finishProbe("Страница изменилась. Открой неделю и повтори проверку.");
            return;
        }
        String script = "(() => { if (!(" + ON_DIARY_ORIGIN + ")) return null;"
            + "const run = window[" + JSONObject.quote(key) + "];"
            + "return run?.page === location.href ? run.result : null; })()";
        diary.evaluateJavascript(script, result -> {
            if (!key.equals(probeKey)) return;
            if (result == null || "null".equals(result) || result.length() > 1024) {
                finishProbe("Страница изменилась. Открой неделю и повтори проверку.");
                return;
            }
            try {
                JSONObject report = new JSONObject(result);
                switch (report.optString("state")) {
                    case "running":
                        int total = report.optInt("expectedWeeks");
                        if (total > 0) {
                            if (!automatic) banner.update("Собираем недели: " + report.optInt("loadedWeeks") + " из " + total);
                        }
                        handler.postDelayed(poll, 500);
                        break;
                    case "done":
                        submitProbe(key);
                        break;
                    default:
                        finishProbe(errorMessage(report.optString("reason")));
                }
            } catch (JSONException error) {
                finishProbe("Не удалось прочитать результат проверки.");
            }
        });
    }

    private void submitProbe(String key) {
        String script = "(() => { if (!(" + ON_DIARY_ORIGIN + ")) return null;"
            + "const run = window[" + JSONObject.quote(key) + "];"
            + "return run?.page === location.href && run.result.state === 'done' ? run.exportText : null; })()";
        diary.evaluateJavascript(script, result -> {
            if (!key.equals(probeKey)) return;
            if (result == null || !result.startsWith("\"") || result.length() > 4_100_000) {
                finishProbe("Не удалось передать собранный дневник. Повтори синхронизацию.");
                return;
            }
            try {
                String export = new JSONArray("[" + result + "]").getString(0);
                if (export.getBytes(StandardCharsets.UTF_8).length > 2_000_000) {
                    finishProbe("Дневник слишком большой для передачи.");
                    return;
                }
                stopProbe(true);
                if (!automatic) banner.update("Сохраняем дневник в School++…");
                schoolpp.save(export);
            } catch (JSONException error) {
                finishProbe("Не удалось прочитать собранный дневник.");
            }
        });
    }

    private static String errorMessage(String reason) {
        return switch (reason) {
            case "sign_in_or_session_unavailable" -> "Сеанс госдневника истёк. Повторите синхронизацию и войдите снова.";
            case "switch_week_then_retry" -> "Откройте другую неделю в госдневнике и повторите синхронизацию.";
            case "time_limit", "request_timeout" -> "Дневник отвечает слишком долго. Попробуй ещё раз.";
            case "incomplete_collection" -> "Удалось прочитать только часть дневника. Повтори проверку.";
            case "payload_too_large" -> "Дневник оказался слишком большим для пробного сбора.";
            default -> "Не удалось собрать дневник. Открой неделю и повтори проверку.";
        };
    }

    private void stopProbe(boolean cancelInPage) {
        String key = probeKey;
        probeKey = null;
        handler.removeCallbacks(poll);
        handler.removeCallbacks(timeout);
        if (cancelInPage && key != null && diary != null && isDiaryUrl(diary.getUrl())) {
            diary.evaluateJavascript("(() => { if (!(" + ON_DIARY_ORIGIN + ")) return;"
                + "const key = " + JSONObject.quote(key) + ";"
                + "window[key]?.cancel(); delete window[key]; })()", null);
        }
    }

    private void finishProbe(String message) {
        boolean showError = attempt != null && !automatic && !message.isEmpty();
        cancelAndReturn();
        if (showError) banner.show(message, false, () -> beginSync(false));
    }

    private void showDashboardError() {
        if (attempt != null) return;
        banner.show("Не удалось открыть School++. Проверьте интернет.", false, () -> {
            banner.hide();
            dashboard.retry();
        });
    }

    private void cancelAndReturn() {
        cancelSync();
        dashboard.show();
        banner.hide();
        scheduleAutoSync();
    }

    private void cancelSync() {
        attempt = null;
        preparing = false;
        automatic = false;
        handler.removeCallbacks(waitForWeek);
        handler.removeCallbacks(autoLoginTimeout);
        stopProbe(true);
        schoolpp.cancel();
        closeSource();
    }

    private void failPage(String message) {
        pageReady = false;
        pageFailed = true;
        finishProbe(message);
    }

    private void scheduleAutoSync() {
        handler.removeCallbacks(autoSync);
        if (!resumed || attempt != null || !settings.getBoolean(HAS_SYNCED, false)) return;
        long now = System.currentTimeMillis();
        long last = Math.min(now, settings.getLong(LAST_ATTEMPT, now));
        handler.postDelayed(autoSync, Math.max(3_000, AUTO_INTERVAL - (now - last)));
    }

    private void tryAutoSync() {
        dashboard.canAutoSync(available -> {
            if (!resumed || attempt != null) return;
            if (available) beginSync(true);
            else handler.postDelayed(autoSync, 60_000);
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        scheduleAutoSync();
    }

    @Override
    protected void onPause() {
        resumed = false;
        handler.removeCallbacks(autoSync);
        super.onPause();
    }

    @Override
    protected void onStop() {
        if (attempt != null) finishProbe("");
        super.onStop();
    }

    @Override
    public void onBackPressed() {
        goBack();
    }

    private void goBack() {
        if (attempt != null && !automatic) cancelAndReturn();
        else if (!dashboard.goBack()) finishAfterTransition();
    }

    @Override
    protected void onDestroy() {
        stopProbe(false);
        handler.removeCallbacksAndMessages(null);
        schoolpp.cancel();
        schoolpp.dispose();
        dashboard.dispose();
        closeSource();
        super.onDestroy();
    }

    private void closeSource() {
        if (diary == null) return;
        WebView previous = diary;
        diary = null;
        previous.stopLoading();
        pages.removeView(previous);
        previous.destroy();
    }

    private final class DiaryClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame() || isAllowedPageUrl(request.getUrl().toString())) return false;
            if (view == diary) finishProbe("Переход на внешний сайт заблокирован.");
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request.isForMainFrame() && !isAllowedPageUrl(request.getUrl().toString())) {
                return new WebResourceResponse("text/plain", "UTF-8", null);
            }
            return null;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            if (view != diary) return;
            handler.removeCallbacks(waitForWeek);
            pageReady = false;
            pageFailed = false;
            if (!isAllowedPageUrl(url)) {
                view.stopLoading();
                failPage("Переход на внешний сайт заблокирован.");
                return;
            }
            if (attempt == null) return;
            if (preparing) {
                stopProbe(false);
                finishProbe("Страница дневника изменилась. Повторите синхронизацию.");
            } else if (!isDiaryUrl(url)) {
                if (automatic) finishProbe("");
                else banner.update("Синхронизация · войдите через ИЯ РИОС");
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (view != diary || pageFailed || !isDiaryUrl(url) || !url.equals(view.getUrl())) return;
            pageReady = true;
            handler.removeCallbacks(waitForWeek);
            if (attempt != null && !preparing) handler.post(waitForWeek);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (view == diary && request.isForMainFrame())
                failPage("Не удалось открыть госдневник. Проверьте интернет и попробуйте снова.");
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler callback, SslError error) {
            callback.cancel();
            if (view == diary && (error.getUrl().equals(view.getUrl()) || !pageReady))
                failPage("Не удалось подтвердить защищённое соединение.");
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (view != diary) return true;
            stopProbe(false);
            pages.removeView(view);
            view.destroy();
            if (diary == view) diary = null;
            failPage("Госдневник закрылся. Повторите синхронизацию.");
            return true;
        }
    }
}
