# NicoTauriX - ニコニコXブラウザ

Tauri v2で構築した超軽量ニコニコ弾幕ブラウザ。X.comのQuote RepostをリアルタイムでニコニコスタイルのCanvas弾幕として表示する。

## アーキテクチャ

```
PC (Tauriアプリ)
├── Rustバックエンド (core crate)
│   ├── Axum WebSocketサーバー (danmaku同期)
│   ├── QRコード生成 (qrcode crate)
│   └── LAN IP自動取得 (local-ip-address)
│
├── WebView (X.com読み込み)
│   └── danmaku-inject.js (弾幕Canvas注入 + Mutation Observer)
│
└── Frontend (Vite + Vanilla JS)
    ├── DanmakuEngine (共通Canvas弾幕レンダラー)
    ├── WebSocketクライアント (danmakuリアルタイム同期)
    └── PWA対応 (iPhone「ホーム画面に追加」)

iPhone PWA
└── QRスキャン → PCとWebSocket接続 → 弾幕ミラー表示 + リモートコントロール
```

## セットアップ

```bash
# 依存インストール
npm install

# テスト実行
npm test                       # JS tests (vitest)
cd core && cargo test          # Rust tests

# 開発
npm run tauri dev

# ビルド
npm run tauri build
```

## テスト

TDD (t-wada スタイル) で開発:

- **JS Tests**: `npm test` — DanmakuEngine + WebSocketクライアント (45 tests)
- **Rust Tests**: `cd core && cargo test` — danmaku protocol + QR生成 + WS server (20 tests)

## 機能

- **PC**: X.comをWebViewで開き、Quote Repostの弾幕を自動表示
- **PWA Mirror**: iPhone/iPadでQRスキャン → PCの弾幕をリアルタイムミラー
- **リモコン**: PWAから弾幕の速度・色・ON/OFFを遠隔操作
- **軽量**: Tauri v2で5-10MBサイズ、RAM極小
