# Train Punch — 筋トレロガー（PWA, v1.1.0）
- セッション/セットの記録（種目・重量・回数・RPE）
- IndexedDB保存（完全オフライン）
- 直近7日の合計ボリューム簡易グラフ（種目別）
- 休憩タイマー（通知・バイブ・ビープ）
- CSV書き出し/読み込み
- プライバシーポリシー同梱 / 端末内データ消去ボタン

## ストア提出の下準備（Capacitor）
```
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android @capacitor/preferences @capacitor/haptics @capacitor/local-notifications
npx cap init "Train Punch" com.yourname.trainpunch --web-dir=.
npx cap add ios && npx cap add android
npx cap copy
# iOS: Xcodeで Privacy - Local Notifications Usage Description をInfoに追加
# Android: AndroidManifestに POST_NOTIFICATIONS 権限（Android 13+）を自動付与、PlayのData safetyで端末内保存のみを申告
```

- プライバシーポリシーURLは `privacy.html` を Pages に置いてリンク可能。
