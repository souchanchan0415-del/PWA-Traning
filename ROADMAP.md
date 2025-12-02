# Train Punch 今後のタスクロードマップ

---

## Phase 0 : コンセプトの整理（完了 ✅）

- [✅] 想定ユーザーを「一般のトレーニー」に統一
  - [✅] `index.html` の説明文を「部活」→「トレーニング記録を続けたい人全般」に修正
  - [✅] `session.html` のサブタイトルも同様に修正
- [✅] `<title>` の見直し
  - [✅] `index.html` → `Train Punch | トレーニング記録アプリ`
  - [✅] `session.html` → `Train Punch | ワークアウト記録`
  - [✅] `shop.html` → `Train Punch | ショップ`
  - [✅] `blog.html` → `Train Punch | ブログ`

---

## Phase 1 : ブログ方式を決める（完了 ✅）

### 採用案: GitHub 内 `posts/` 方式（静的ブログ）

- [✅] `/posts/index.json` を作成（記事の目次）
  - 形式：`[{ "slug": "...", "title": "...", "date": "YYYY-MM-DD", "summary": "..." }]`
- [✅] 記事本文ファイルを `/posts/*.txt` で用意
  - 例：`/posts/welcome.txt`, `/posts/how-to-keep-training-log.txt`
- [✅] `blog.html` を「目次＋一覧ページ」に変更
  - [✅] JavaScript で `/posts/index.json` を `fetch` → 一覧表示（タイトル＋日付＋概要）
  - [✅] タイトルクリックで `post.html?slug=XXX` に遷移するリンクにする
- [✅] `post.html`（個別記事ページ）
  - [✅] URL の `?slug=welcome` などを読んで、対応する `/posts/welcome.txt` を `fetch` して本文表示
  - [✅] `<title>` と `<meta description>` を記事ごとに動的にセット
- [✅] 記事追加フローを決める
  - [✅] iPhone の GitHub アプリから  
        `/posts/index.json` に1行追加 → `/posts/slug名.txt` を追加 → コミット → 公開

※旧 `posts.json` 方式は廃止。今後は `posts/index.json` + `posts/*.txt` で運用。

---

## Phase 2 : AdSense を意識したコンテンツ整備（進行中）

- [✅] index.html かフッターに「アプリの説明」「プライバシーポリシー」へのリンクを置く  
  - 例：about.html / privacy.html への小さなテキストリンク

- [✅] 「アプリの説明ページ」（例: about.html）を新規作成  
  - [✅] Train Punch の概要  
  - [✅] 誰向けのアプリか（一般のトレーニー）  
  - [✅] 主な機能  
  - [✅] 今後追加したい機能  
  - [✅] 運営者情報（ハンドルネーム＋簡単なプロフィール程度）

- [✅] プライバシーポリシー `privacy.html`  
  - [✅] 利用しているデータ（ローカルストレージに保存される記録）  
  - [✅] Google AdSense / アクセス解析を入れる場合の文言

- [✅] お問い合わせ方法  
  - [✅] X のアカウント or メールアドレスなど、連絡手段を1つ書いておく

- [ ] ブログ記事をある程度用意  
  - [✅] 導入記事：`Train Punch ブログへようこそ` (welcome)  
  - [✅] 記録習慣系：`三日坊主にならないトレーニング記録のつけ方`  
  - [ ] アプリの使い方ガイド（スクショ付きだとなお良い）  
  - [ ] RPE の解説記事  
  - [ ] 例：合計 3〜5 本、1 本あたり 1000〜2000 文字を目標

---

## Phase 3 : UI/UX の微調整（未着手）

- [ ] ホームの3ボタンのテキスト・順番を調整  
  例：`ワークアウト記録` / `ショップ` / `ブログ`
- [ ] `session.html` の「選択中の種目」表示を少し大きく・太字に
- [ ] 「全データ削除」系のボタンは赤＆注意テキストを追加
- [ ] PC 画面幅で見たときの崩れチェック（Chrome のレスポンシブモードで確認）

---

## Phase 4 : 技術まわり＆PWAまわり（未着手）

- [ ] `manifest.webmanifest` の中身を見直し
  - [ ] アプリ名・short_name・説明文を一般向けにチューニング
- [ ] `sw.js` のキャッシュ戦略を一度整理
  - [ ] 使っていないキャッシュ名や不要なファイル指定がないかチェック
- [ ] 主要ページの Lighthouse チェック（Performance / SEO / PWA）

---

## Phase 5 : AdSense 申請（今後）

- [ ] サイト構成が整ったら AdSense 申請
  - [ ] トップ：`index.html`
  - [ ] 説明：`about.html`
  - [ ] プライバシーポリシー：`privacy.html`
  - [ ] 記事：複数本（できれば 3〜5 本以上）
- [ ] 承認後、広告を表示したいページだけにコードを埋め込む
  - 例：ブログ記事ページのみ / about + ブログのみ など

---

## メモ

- まずは **Phase 0 → Phase 1 → Phase 2** が終わると、  
  「一般向けのちゃんとしたサービスサイト＋ブログ」として形になる。
- Phase 3 以降は、空き時間に少しずつ進めていく。
