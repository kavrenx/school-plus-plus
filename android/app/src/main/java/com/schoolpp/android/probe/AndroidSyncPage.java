package com.schoolpp.android.probe;

import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Handler;
import android.view.View;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

final class AndroidSyncPage {
    static final String HOST = "schoolpp.com";
    static final String ORIGIN = "https://" + HOST;
    private static final String SYNC_URL = ORIGIN + "/android-sync.html";
    private final FrameLayout layout;
    private final Handler handler;
    private final Runnable timeout = () -> fail("Сервер School++ не ответил. Попробуй снова.");
    private WebView view;
    private WebMessagePort port;
    private Listener listener;
    private String attempt;
    private boolean ready;
    private boolean saving;

    interface Listener {
        void onReady();
        void onSaved();
        void onError(String message);
    }

    AndroidSyncPage(FrameLayout layout, Handler handler) {
        this.layout = layout;
        this.handler = handler;
    }

    void prepare(String id, Listener listener) {
        cancel();
        dispose();
        this.attempt = id;
        this.listener = listener;
        WebView browser = browser();
        browser.setVisibility(View.INVISIBLE);
        handler.postDelayed(timeout, 25_000);
        browser.loadUrl(SYNC_URL);
    }

    void save(String export) {
        if (!ready || saving || port == null || !SYNC_URL.equals(view.getUrl())) {
            fail("Страница School++ изменилась. Запусти синхронизацию заново.");
            return;
        }
        saving = true;
        handler.postDelayed(timeout, 30_000);
        port.postMessage(new WebMessage(export));
    }

    void cancel() {
        handler.removeCallbacks(timeout);
        if (port != null) {
            port.postMessage(new WebMessage("cancel"));
            port.close();
            port = null;
        }
        boolean wasSyncing = listener != null;
        listener = null;
        attempt = null;
        ready = saving = false;
        if (wasSyncing) dispose();
    }

    void dispose() {
        if (view == null) return;
        WebView browser = view;
        view = null;
        layout.removeView(browser);
        browser.destroy();
    }

    private WebView browser() {
        if (view == null) {
            view = new WebView(layout.getContext());
            DiaryProbeActivity.configureBrowser(view);
            view.setWebViewClient(new Client());
            layout.addView(view, new FrameLayout.LayoutParams(-1, -1));
        }
        return view;
    }

    private void connect(WebView browser) {
        WebMessagePort[] channel = browser.createWebMessageChannel();
        port = channel[0];
        port.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
            @Override
            public void onMessage(WebMessagePort sender, WebMessage message) {
                if (sender != port || listener == null || !SYNC_URL.equals(browser.getUrl())) return;
                String data = message.getData();
                if (data == null) return;
                if (!ready && "ready".equals(data)) {
                    handler.removeCallbacks(timeout);
                    ready = true;
                    listener.onReady();
                } else if (saving && "saved".equals(data)) {
                    handler.removeCallbacks(timeout);
                    Listener completed = listener;
                    listener = null;
                    port.close();
                    port = null;
                    attempt = null;
                    ready = saving = false;
                    dispose();
                    completed.onSaved();
                } else if (data.startsWith("error:")) {
                    fail(errorMessage(data));
                }
            }
        });
        browser.postWebMessage(
            new WebMessage("schoolpp-android-sync-v1:" + attempt, new WebMessagePort[]{channel[1]}),
            Uri.parse(ORIGIN)
        );
    }

    private void fail(String message) {
        Listener failed = listener;
        cancel();
        if (failed != null) failed.onError(message);
    }

    private static String errorMessage(String code) {
        return switch (code) {
            case "error:linked_device", "error:pair_owner_required" ->
                "Это устройство подключено по коду. Обнови дневник на основном устройстве.";
            case "error:diary_snapshot_conflict" ->
                "Дневник уже обновился на другом устройстве. Запусти синхронизацию заново.";
            case "error:invalid_snapshot" ->
                "Собранный дневник не прошёл проверку. Повтори синхронизацию.";
            case "error:diary_write_context_required", "error:diary_client_outdated" ->
                "Не удалось подтвердить версию дневника. Попробуй позже.";
            default -> "School++ не подтвердил сохранение. Проверь интернет и повтори.";
        };
    }

    private boolean allows(String url) {
        return listener != null && SYNC_URL.equals(url);
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView browser, WebResourceRequest request) {
            return request.isForMainFrame() && !allows(request.getUrl().toString());
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView browser, WebResourceRequest request) {
            if (request.isForMainFrame() && !SYNC_URL.equals(request.getUrl().toString()))
                return new WebResourceResponse("text/plain", "UTF-8", null);
            return null;
        }

        @Override
        public void onPageStarted(WebView browser, String url, Bitmap icon) {
            if (browser != view) return;
            if (!allows(url) || port != null) {
                browser.stopLoading();
                fail("Страница синхронизации School++ изменилась. Попробуй снова.");
            }
        }

        @Override
        public void onPageFinished(WebView browser, String url) {
            if (browser == view && listener != null && port == null
                && SYNC_URL.equals(url) && url.equals(browser.getUrl())) connect(browser);
        }

        @Override
        public void onReceivedError(WebView browser, WebResourceRequest request, WebResourceError error) {
            if (browser == view && request.isForMainFrame() && listener != null)
                fail("Не удалось открыть School++. Проверь интернет и повтори.");
        }

        @Override
        public void onReceivedHttpError(WebView browser, WebResourceRequest request, WebResourceResponse error) {
            if (browser == view && request.isForMainFrame() && listener != null)
                fail("Страница синхронизации School++ пока недоступна.");
        }

        @Override
        public void onReceivedSslError(WebView browser, SslErrorHandler callback, SslError error) {
            callback.cancel();
            if (browser == view && listener != null)
                fail("Не удалось подтвердить защищённое соединение со School++.");
        }

        @Override
        public boolean onRenderProcessGone(WebView browser, RenderProcessGoneDetail detail) {
            if (browser != view) return true;
            fail("School++ закрылся. Открой дневник и попробуй снова.");
            dispose();
            return true;
        }
    }
}
