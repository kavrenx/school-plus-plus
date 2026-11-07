package com.schoolpp.android.probe;

import android.app.Activity;
import android.graphics.Color;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

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
    private static final String READY = "Открой неделю в госдневнике и нажми «Обновить».";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable poll = this::readProbe;
    private final Runnable timeout = () -> finishProbe("Дневник отвечает слишком долго. Попробуй ещё раз.");
    private LinearLayout layout;
    private TextView status;
    private Button check;
    private FrameLayout pages;
    private WebView diary;
    private AndroidSyncPage schoolpp;
    private String probeScript;
    private String probeKey;
    private long deadline;
    private boolean pageReady;
    private boolean pageFailed;
    private boolean syncing;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        layout = new LinearLayout(this);
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

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(16), dp(8), dp(16), dp(8));
        TextView title = new TextView(this);
        title.setText("School++");
        title.setTextSize(19);
        title.setTextColor(Color.rgb(28, 48, 38));
        header.addView(title);

        status = new TextView(this);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        status.setTextColor(Color.rgb(36, 58, 46));
        status.setPadding(0, dp(5), 0, dp(5));
        header.addView(status);

        LinearLayout actions = new LinearLayout(this);
        Button reopen = new Button(this);
        reopen.setText("Госдневник");
        reopen.setOnClickListener(view -> openDiary());
        actions.addView(reopen, new LinearLayout.LayoutParams(0, -2, 1));
        check = new Button(this);
        check.setText("Обновить");
        check.setEnabled(false);
        check.setOnClickListener(view -> beginSync());
        actions.addView(check, new LinearLayout.LayoutParams(0, -2, 1));
        Button showSchoolpp = new Button(this);
        showSchoolpp.setText("School++");
        showSchoolpp.setOnClickListener(view -> openSchoolpp());
        actions.addView(showSchoolpp, new LinearLayout.LayoutParams(0, -2, 1));
        header.addView(actions);
        layout.addView(header);
        pages = new FrameLayout(this);
        layout.addView(pages, new LinearLayout.LayoutParams(-1, 0, 1));
        schoolpp = new AndroidSyncPage(pages, handler);
        setContentView(layout);

        try (InputStream asset = getAssets().open("diary-probe.js")) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            for (int read; (read = asset.read(chunk)) != -1; ) buffer.write(chunk, 0, read);
            probeScript = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException error) {
            status.setText("Не удалось загрузить проверку. Установи APK заново.");
            reopen.setEnabled(false);
            return;
        }
        openDiary();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void openDiary() {
        cancelSync();
        schoolpp.hide();
        if (diary != null && pageReady && isDiaryUrl(diary.getUrl())) {
            diary.setVisibility(View.VISIBLE);
            status.setText(READY);
            check.setEnabled(true);
            return;
        }
        pageReady = false;
        pageFailed = false;
        check.setEnabled(false);
        status.setText("Открываем e-schools.by…");
        if (diary == null) {
            diary = new WebView(this);
            configureBrowser(diary);
            diary.setWebViewClient(new DiaryClient());
            pages.addView(diary, new FrameLayout.LayoutParams(-1, -1));
        }
        diary.setVisibility(View.VISIBLE);
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

    private void openSchoolpp() {
        cancelSync();
        if (diary != null) diary.setVisibility(View.GONE);
        check.setEnabled(false);
        status.setText("Дневник School++");
        schoolpp.openDiary();
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
        return pageReady && diary != null && diary.getVisibility() == View.VISIBLE
            && isDiaryUrl(diary.getUrl());
    }

    private void beginSync() {
        if (!canCollect() || syncing) return;
        String id = UUID.randomUUID().toString().replace("-", "");
        syncing = true;
        check.setEnabled(false);
        status.setText("Подключаем School++…");
        schoolpp.prepare(id, new AndroidSyncPage.Listener() {
            @Override
            public void onReady() {
                if (canCollect()) startProbe("__schoolppAndroidProbe_" + id);
                else finishProbe("Открой неделю в госдневнике и повтори синхронизацию.");
            }

            @Override
            public void onSaved() {
                openSchoolpp();
                status.setText("Дневник обновлён в School++.");
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
        check.setEnabled(false);
        status.setText("Проверяем, доступны ли уроки и оценки…");
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
                            status.setText("Собираем недели: " + report.optInt("loadedWeeks") + " из " + total);
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
                status.setText("Сохраняем дневник в School++…");
                schoolpp.save(export);
            } catch (JSONException error) {
                finishProbe("Не удалось прочитать собранный дневник.");
            }
        });
    }

    private static String errorMessage(String reason) {
        return switch (reason) {
            case "sign_in_or_session_unavailable" -> "Войди в госдневник, открой неделю и повтори проверку.";
            case "switch_week_then_retry" -> "Переключись на другую неделю и нажми «Обновить».";
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
        cancelSync();
        status.setText(message);
        check.setEnabled(canCollect());
    }

    private void cancelSync() {
        syncing = false;
        stopProbe(true);
        schoolpp.cancel();
    }

    private void failPage(String message) {
        pageReady = false;
        pageFailed = true;
        finishProbe(message);
    }

    @Override
    protected void onStop() {
        if (syncing) finishProbe("Синхронизация остановлена. Повтори её, когда вернёшься к дневнику.");
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        stopProbe(false);
        schoolpp.cancel();
        schoolpp.dispose();
        if (diary != null) {
            pages.removeView(diary);
            diary.destroy();
            diary = null;
        }
        super.onDestroy();
    }

    private final class DiaryClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame() || isAllowedPageUrl(request.getUrl().toString())) return false;
            finishProbe("Переход на внешний сайт заблокирован.");
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
            stopProbe(false);
            if (syncing) cancelSync();
            pageReady = false;
            pageFailed = false;
            check.setEnabled(false);
            if (!isAllowedPageUrl(url)) {
                view.stopLoading();
                failPage("Переход на внешний сайт заблокирован.");
                return;
            }
            if (view.getVisibility() == View.VISIBLE)
                status.setText(isDiaryUrl(url) ? "Открываем e-schools.by…" : "Вход через ИЯ РИОС");
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (view != diary || pageFailed || !isDiaryUrl(url) || !url.equals(view.getUrl())) return;
            pageReady = true;
            check.setEnabled(canCollect() && !syncing);
            if (canCollect() && !syncing) status.setText(READY);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) failPage("Не удалось открыть страницу. Проверь интернет и повтори.");
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler callback, SslError error) {
            callback.cancel();
            failPage("Не удалось подтвердить защищённое соединение.");
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            stopProbe(false);
            pages.removeView(view);
            view.destroy();
            if (diary == view) diary = null;
            failPage("Страница закрылась. Нажми «Открыть дневник».");
            return true;
        }
    }
}
