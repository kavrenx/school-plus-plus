package com.schoolpp.android.probe;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

final class SyncBanner extends LinearLayout {
    private static final int TEXT = Color.rgb(32, 59, 48);
    private static final int ACCENT = Color.rgb(45, 106, 82);
    private final ProgressBar progress;
    private final TextView text;
    private final Button action;
    private final Button dismiss;

    SyncBanner(Context context) {
        super(context);
        setGravity(Gravity.CENTER_VERTICAL);
        setPadding(dp(12), 0, dp(4), 0);
        GradientDrawable surface = new GradientDrawable();
        surface.setColor(Color.rgb(232, 242, 235));
        surface.setCornerRadius(dp(16));
        setBackground(surface);
        progress = new ProgressBar(context, null, android.R.attr.progressBarStyleSmall);
        progress.setIndeterminateTintList(ColorStateList.valueOf(ACCENT));
        LayoutParams spinner = new LayoutParams(dp(18), dp(18));
        spinner.rightMargin = dp(10);
        addView(progress, spinner);
        text = new TextView(context);
        text.setTextSize(14);
        text.setTextColor(TEXT);
        text.setPadding(0, dp(8), 0, dp(8));
        text.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        addView(text, new LayoutParams(0, -2, 1));
        action = button();
        dismiss = button();
        dismiss.setText("×");
        dismiss.setContentDescription("Закрыть сообщение");
        dismiss.setOnClickListener(view -> hide());
        hide();
    }

    private Button button() {
        Button button = new Button(getContext(), null, android.R.attr.borderlessButtonStyle);
        button.setAllCaps(false);
        button.setTextColor(ACCENT);
        button.setMinWidth(dp(44));
        button.setMinimumWidth(dp(44));
        button.setPadding(dp(6), 0, dp(6), 0);
        addView(button, new LayoutParams(-2, -2));
        return button;
    }

    void show(String message, boolean busy, Runnable run) {
        progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        dismiss.setVisibility(busy ? View.GONE : View.VISIBLE);
        action.setText(busy ? "Отмена" : "Повторить");
        action.setOnClickListener(view -> run.run());
        update(message);
        setVisibility(View.VISIBLE);
    }

    void update(String message) {
        if (!message.contentEquals(text.getText())) text.setText(message);
    }

    void hide() {
        setVisibility(View.GONE);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
