const ANDROID_SYNC_LINK = "./android-sync.html?start=1";
const ANDROID_PLAY_URL =
  "https://play.google.com/store/apps/details?id=com.schoolpp.android";

function isAndroid(navigatorRef = {}) {
  return /\bAndroid\b/i.test(navigatorRef.userAgent || "");
}

function isSchoolppAndroidApp(navigatorRef = {}) {
  return (
    isAndroid(navigatorRef) &&
    /(?:^|\s)SchoolppAndroid\/1(?:\s|$)/.test(navigatorRef.userAgent || "")
  );
}

export { ANDROID_PLAY_URL, ANDROID_SYNC_LINK, isAndroid, isSchoolppAndroidApp };
