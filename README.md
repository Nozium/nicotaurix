# NicoTauriX - ニコニコXブラウザ

Tauri v2で構築した軽量ニコニコ弾幕ブラウザ。X.comの引用リポスト(Quote Repost)のコメントをリアルタイムでニコニコスタイルのCanvas弾幕として表示する。

## アーキテクチャ

```
PC (Tauri Desktop)
├── Rustバックエンド (core crate)
│   ├── Axum WebSocketサーバー (0.0.0.0:1422, 弾幕同期)
│   ├── QRコード生成 (qrcode crate)
│   └── LAN IP自動取得 (local-ip-address)
│
├── マルチWebView
│   ├── ツールバー WebView (ナビバー・設定・QR)
│   └── ブラウザ WebView (X.com等を表示)
│       └── danmaku-inject.js (Canvas弾幕オーバーレイ + Quote Post検知)
│
└── Frontend (Vite + Vanilla JS)
    ├── DanmakuEngine (Canvas弾幕レンダラー)
    └── WebSocketクライアント (弾幕リアルタイム同期)

iPhone (Tauri iOS) [開発中]
└── QRコード or URL入力 → PCのWebSocketに接続 → 弾幕ミラー表示
```

## 前提条件

- **Node.js** 18+
- **Rust** stable (1.70+)
- **Tauri CLI** v2 (`npx tauri` で自動利用)
- macOS: Xcode Command Line Tools
- iOS開発: Xcode, CocoaPods, iOS Rustターゲット

## セットアップ

```bash
# 依存インストール
npm install

# テスト実行
npm test                       # JS tests (Vitest, 59 tests)
cargo test --manifest-path core/Cargo.toml   # Rust tests (20 tests)
```

## 起動方法

```bash
# 開発モード (ホットリロード付き)
npm run tauri dev
```

初回起動時はRustのコンパイルに数分かかります。起動後:
1. X.comがブラウザWebViewに表示される
2. ツールバーのURLバーでサイト移動可能
3. 引用リポストのコメントが弾幕として自動表示
4. 歯車アイコンから弾幕設定(速度・フォントサイズ・色)を変更可能

## プロダクションビルド

```bash
npm run tauri build
```

## テスト

TDD (t-wada スタイル) で開発:

| 種別 | コマンド | テスト数 | 内容 |
|------|---------|---------|------|
| JS | `npm test` | 59 | DanmakuEngine, WebSocketクライアント, Quote Post検知 |
| Rust | `cargo test --manifest-path core/Cargo.toml` | 20 | danmakuプロトコル, QR生成, WSサーバー |

## 機能

- **ブラウザ**: X.comをWebViewで開き、戻る/進む/リロードに対応
- **弾幕**: 引用リポスト(Quote Repost)のコメントのみを検知し、ニコニコ風Canvas弾幕で表示
- **リモートミラー**: QRコードでWebSocket URLを共有 → iPhoneで弾幕をリアルタイムミラー
- **リモコン**: 弾幕の速度・色・ON/OFFをリアルタイム同期
- **軽量**: Tauri v2でバイナリサイズ小、RAM消費極小

## プロジェクト構成

```
nicotaurix/
├── core/                  # Rust core crate (Tauri非依存、テスト可能)
│   └── src/
│       ├── danmaku.rs     # 弾幕メッセージプロトコル
│       ├── qr.rs          # QRコード生成 + LAN IP取得
│       └── ws.rs          # Axum WebSocketブロードキャストサーバー
├── src-tauri/             # Tauri アプリケーション
│   └── src/
│       ├── lib.rs         # メインロジック (デスクトップ/iOS両対応)
│       └── main.rs        # エントリポイント
├── frontend/              # Vite フロントエンド
│   ├── index.html         # UI (デスクトップ: ツールバー / モバイル: 弾幕ビューア)
│   └── src/
│       ├── main.js        # アプリロジック (プラットフォーム分岐)
│       ├── danmaku-engine.js      # Canvas弾幕エンジン
│       ├── ws-client.js           # WebSocketクライアント
│       ├── danmaku-inject.js      # X.com注入スクリプト (Quote Post検知)
│       ├── danmaku-engine.test.js # エンジンテスト (30)
│       ├── ws-client.test.js      # WSクライアントテスト (15)
│       └── danmaku-inject.test.js # Quote Post検知テスト (14)
└── package.json
```
