package com.schoolpp.android.probe;

import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.view.View;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.net.URI;

final class AndroidDashboard {
    private static final String HOME = AndroidSyncPage.ORIGIN + "/";
    private static final String START = HOME + "android-sync.html?start=1";
    private final FrameLayout layout;
    private final Runnable synchronize;
    private final Runnable showError;
    private final Runnable onNavigation;
    private WebView view;

    AndroidDashboard(FrameLayout layout, Runnable synchronize, Runnable showError, Runnable onNavigation) {
        this.layout = layout;
        this.synchronize = synchronize;
        this.showError = showError;
        this.onNavigation = onNavigation;
    }

    void show() {
        if (view == null) load(HOME);
        view.setVisibility(View.VISIBLE);
    }

    void hide() {
        if (view != null) view.setVisibility(View.GONE);
    }

    void showUpdated(boolean keepSection) {
        String section = view == null || view.getUrl() == null
            ? null : Uri.parse(view.getUrl()).getFragment();
        load(HOME + "#" + (keepSection && isSection(section)
            ? section : "diary"));
    }

    private static boolean isSection(String section) {
        return "diary".equals(section) || "schedule".equals(section)
            || "results".equals(section) || "profile".equals(section);
    }

    void retry() {
        load(view != null && isAllowed(view.getUrl()) ? view.getUrl() : HOME);
    }

    boolean goBack() {
        if (view == null || !view.canGoBack()) return false;
        view.goBack();
        return true;
    }

    void canAutoSync(ValueCallback<Boolean> callback) {
        WebView current = view;
        if (current == null || current.getVisibility() != View.VISIBLE || !isAllowed(current.getUrl())) {
            callback.onReceiveValue(false);
            return;
        }
        current.evaluateJavascript(
            "location.origin === 'https://schoolpp.com' && window.top === window"
                + " && /^#(?:diary|schedule|results|profile)$/.test(location.hash)"
                + " && document.getElementById('onboardingScreen')?.classList.contains('hidden')"
                + " && document.getElementById('studentAndroidSync')?.hidden === false",
            result -> callback.onReceiveValue(current == view && "true".equals(result))
        );
    }

    void dispose() {
        if (view == null) return;
        WebView previous = view;
        view = null;
        layout.removeView(previous);
        previous.destroy();
    }

    private void load(String url) {
        dispose();
        view = new WebView(layout.getContext());
        DiaryProbeActivity.configureBrowser(view);
        view.getSettings().setUserAgentString(
            view.getSettings().getUserAgentString() + " SchoolppAndroid/1");
        view.setWebViewClient(new Client());
        layout.addView(view, new FrameLayout.LayoutParams(-1, -1));
        view.loadUrl(url);
    }

    private static boolean isAllowed(String url) {
        return DiaryProbeActivity.isHttpsUrlOnHost(url, AndroidSyncPage.HOST);
    }

    static boolean isSyncAction(String source, String destination, boolean userGesture) {
        if (!userGesture || !START.equals(destination) || !isAllowed(source)) return false;
        String path = URI.create(source).getRawPath();
        return "/".equals(path) || "/index.html".equals(path);
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView browser, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            String url = request.getUrl().toString();
            if (START.equals(url)) {
                if (browser == view && isSyncAction(browser.getUrl(), url, request.hasGesture()))
                    browser.post(synchronize);
                return true;
            }
            return !isAllowed(url);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView browser, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (request.isForMainFrame() && (!isAllowed(url) || START.equals(url)))
                return new WebResourceResponse("text/plain", "UTF-8", null);
            return null;
        }

        @Override
        public void onPageStarted(WebView browser, String url, Bitmap icon) {
            if (browser != view) return;
            onNavigation.run();
            if (!isAllowed(url) || START.equals(url)) browser.stopLoading();
        }

        @Override
        public void onReceivedError(WebView browser, WebResourceRequest request, WebResourceError error) {
            if (browser == view && request.isForMainFrame()) showError.run();
        }

        @Override
        public void onReceivedHttpError(WebView browser, WebResourceRequest request, WebResourceResponse error) {
            if (browser == view && request.isForMainFrame()) showError.run();
        }

        @Override
        public void onReceivedSslError(WebView browser, SslErrorHandler handler, SslError error) {
            handler.cancel();
            if (browser == view && error.getUrl().equals(browser.getUrl())) showError.run();
        }

        @Override
        public boolean onRenderProcessGone(WebView browser, RenderProcessGoneDetail detail) {
            if (browser == view) {
                dispose();
                showError.run();
            }
            return true;
        }
    }
}
