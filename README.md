# Manuals Web App

`manuals/` 配下のfrontmatterとMarkdownから検索インデックスを生成し、現場スマホで教材を検索・参照するための静的Webアプリです。

## 公開対象ファイル

- `index.html`
- `styles.css`
- `app.js`
- `data/search-index.json`
- `config/normalization-map.json`
- 必要なPDF: `manuals/house-cleaning-manual/exports/*.pdf`

公開先で検索インデックスを再生成する運用を行う場合のみ、次も含めます。

- `package.json`
- `serve.mjs`
- `scripts/generate-index.mjs`
- `scripts/search-qa.mjs`

## 公開対象外

- `qa/`
- `debug/`
- `health/`
- `logs/`
- `node_modules/`
- スクリーンショット、確認用画像、常駐プロセス由来の出力

教材本体のMarkdown、PDF、SVG、DBはこのWebアプリの公開作業では変更しません。

## GitHub Pages公開手順

会社サーバーは使わず、GitHub Pagesで静的ファイルとして公開します。

1. GitHubで公開用リポジトリを作成します。
   例: `manuals-webapp`
2. この `manuals-webapp/` 配下の公開対象ファイルをリポジトリへ配置します。
3. PDFを公開する場合は、`manuals-webapp/manuals/house-cleaning-manual/exports/` 配下に必要なPDFを配置します。
   `search-index.json` のPDFパスは `manuals/house-cleaning-manual/exports/...` 形式です。
4. `npm run prepublish:check` を実行し、検索インデックスとQAが通ることを確認します。
5. GitHubへpushします。
6. GitHubリポジトリで `Settings` → `Pages` を開きます。
7. `Build and deployment` を `Deploy from a branch` にします。
8. `Branch` は公開するブランチ、`folder` は `/root` または `/docs` を選びます。
   `manuals-webapp` リポジトリ直下に `index.html` を置く場合は `/root` を選びます。
9. 公開URLを確認します。

公開URL例:

- `https://ユーザー名.github.io/manuals-webapp/`
- `https://ユーザー名.github.io/manuals-webapp/#/manual/chapter09-bathroom-mirror`
- `https://ユーザー名.github.io/manuals-webapp/#/search?q=%E6%B0%B4%E5%9E%A2`

GitHub Pagesでは、PDFリンクは `manuals/house-cleaning-manual/exports/*.pdf` を同一リポジトリ内に配置する前提です。PDFを置かない場合、Webアプリの検索と詳細表示は動きますが、PDFリンクは404になります。

## 公開前チェック

```powershell
cd manuals-webapp
npm run prepublish:check
```

このコマンドで構文確認、検索インデックス生成、検索QAをまとめて実行します。

## 検索インデックス更新

```powershell
cd manuals-webapp
npm run generate:index
```

教材frontmatterを更新した後は、公開前に `data/search-index.json` を再生成してください。

## 検索QA

```powershell
cd manuals-webapp
npm run qa:search
```

代表クエリ、正規化、関連リンク切れ、0件候補を確認します。

## ローカル確認

```powershell
node manuals-webapp/serve.mjs
```

確認URL例:

- `http://127.0.0.1:4280/manuals-webapp/`
- `http://127.0.0.1:4280/manuals-webapp/#/manual/chapter09-bathroom-mirror`
- `http://127.0.0.1:4280/manuals-webapp/#/search?q=%E6%B0%B4%E5%9E%A2`

## 公開後確認

公開先のURLで次を確認します。

- トップ画面が表示される
- `data/search-index.json` が200で取得できる
- キーワード検索が動く
- 詳細画面が開く
- PDFリンクが公開先の配置と一致している
- 関連ガイドリンクが切れていない
- ブラウザ戻る/進むが動く
- スマホ幅で表示が崩れない
