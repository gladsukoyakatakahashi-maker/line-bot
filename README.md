# 整骨院 LINE予約ボット セットアップガイド

## 📁 ファイル構成
```
line-bot/
├── index.js        ← メインのボットコード
├── package.json    ← 依存パッケージ定義
├── .env            ← 環境変数（要作成）
└── README.md       ← このファイル
```

---

## 🚀 セットアップ手順

### 1. LINE Developersでチャンネルを作成
1. [LINE Developers](https://developers.line.biz/) にログイン
2. 「新規チャンネル作成」→「Messaging API」を選択
3. 必要事項を入力して作成
4. 以下の情報をメモ:
   - **チャンネルシークレット**
   - **チャンネルアクセストークン**（長期）

### 2. 環境変数を設定
プロジェクトフォルダに `.env` ファイルを作成:
```
LINE_CHANNEL_SECRET=あなたのチャンネルシークレット
LINE_CHANNEL_ACCESS_TOKEN=あなたのアクセストークン
PORT=3000
```

### 3. パッケージをインストール
```bash
npm install
```

`.env` を読み込むため `index.js` の先頭に以下を追加:
```js
require('dotenv').config();
```

### 4. サーバーを起動
```bash
npm start
```

### 5. Webhookを公開（ローカル開発時）
```bash
# ngrokをインストール済みの場合
npx ngrok http 3000
```
表示された `https://xxxx.ngrok.io/webhook` を
LINE Developers の Webhook URL に設定する。

---

## 🗂 データベース連携について

現在のコードは **スタブ（ダミー）** です。
本番運用では以下に置き換えてください:

| 関数 | 説明 | 置き換え先 |
|------|------|-----------|
| `saveBooking()` | 予約を保存 | MySQL / PostgreSQL / Firestore |
| `deleteBooking()` | 予約を削除 | 同上 |
| `handleCancelSearch()` | 電話番号で検索 | DBクエリ |
| `sessions` オブジェクト | セッション管理 | Redis / DynamoDB |

---

## 💬 対応している機能

| 機能 | 説明 |
|------|------|
| ① 新規予約 | 日時 → 施術メニュー → 氏名・電話番号 → 確認 → 完了 |
| ② 予約確認・変更・取消 | 電話番号で検索 → 変更 or キャンセル |
| ③ メニュー案内 | 施術一覧をカルーセルで表示・詳細確認 |
| キーワードリセット | 「メニュー」「最初」等で最初の画面に戻る |

---

## 📋 カスタマイズポイント

### 院名・連絡先を変更
`index.js` 内の以下を編集:
- `○○整骨院` → 実際の院名
- `0X-XXXX-XXXX` → 実際の電話番号
- 営業時間の文字列

### 施術メニューを変更
`MENUS` 配列と `MENU_DESCRIPTIONS` オブジェクトを編集:
```js
const MENUS = [
  { id: 'sekkotsu', label: '骨格矯正・整復', time: '30分', price: '3,000円' },
  // ← ここを編集・追加
];
```

### 予約可能日・時間を変更
- `makeDatePicker()` 内の `i <= 7`（先読み日数）を変更
- `d.getDay() === 0` 休院曜日を変更（0=日, 6=土）
- `slots` 配列で受付時間帯を変更

---

## ⚠️ 本番公開前チェックリスト

- [ ] LINE DevelopersでWebhookを有効化
- [ ] 応答メッセージを「オフ」に設定
- [ ] DBと連携してsaveBooking/deleteBookingを実装
- [ ] Redisなどでsessionsを永続化
- [ ] HTTPS対応のサーバーにデプロイ
- [ ] エラーハンドリングを強化
- [ ] キャンセル期限チェック（前日20時まで）を実装
