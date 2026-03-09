# NicoTauriX 実装ハンドオーバー

> Tauri v2 を使ったニコニコ風弾幕ブラウザの実装詳細。
> Tauri 初学者がこのプロジェクトを理解・改修できることを目的としたドキュメント。

---

## 目次

1. [全体像](#1-全体像)
2. [Tauri v2 の基礎知識](#2-tauri-v2-の基礎知識)
3. [プロジェクト構成](#3-プロジェクト構成)
4. [Rust バックエンド詳解](#4-rust-バックエンド詳解)
5. [フロントエンド詳解](#5-フロントエンド詳解)
6. [弾幕システム](#6-弾幕システム)
7. [WebSocket 通信プロトコル](#7-websocket-通信プロトコル)
8. [マルチWebView アーキテクチャ](#8-マルチwebview-アーキテクチャ)
9. [iOS 対応](#9-ios-対応)
10. [ビルドとテスト](#10-ビルドとテスト)
11. [開発フロー](#11-開発フロー)
12. [トラブルシューティング](#12-トラブルシューティング)
13. [今後の課題](#13-今後の課題)

---

## 1. 全体像

### コンセプト

X.com (旧Twitter) を内蔵ブラウザで開き、引用リポスト (Quote Repost) のコメントをニコニコ動画風の弾幕として画面上に流す。iPhoneからも弾幕をリアルタイムで見られるよう、ローカルネットワーク内でWebSocket同期する。

### データフロー

```
┌─────────────────── PC (Tauri Desktop) ───────────────────┐
│                                                           │
│  ブラウザWebView (X.com)                                   │
│  └─ danmaku-inject.js                                     │
│      ├─ MutationObserver で Quote Post を検知               │
│      ├─ Canvas弾幕をオーバーレイ描画                         │
│      └─ WebSocket で弾幕データを送信 ──┐                     │
│                                        │                   │
│  Rust バックエンド                       │                   │
│  └─ Axum WebSocketサーバー (port 1422) ◄┘                   │
│      └─ 全クライアントにブロードキャスト ──────────┐           │
│                                                   │         │
│  ツールバーWebView (frontend/index.html)           │         │
│  └─ main.js → DanmakuWsClient ◄──────────────────┘         │
│      └─ 設定変更 → sendControl() → サーバー → 全端末に反映    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                          │
                   WebSocket (LAN)
                          │
              ┌───────────▼───────────┐
              │  iPhone (Tauri iOS)    │
              │  └─ WS URL入力で接続    │
              │  └─ 弾幕をCanvas描画    │
              └───────────────────────┘
```

---

## 2. Tauri v2 の基礎知識

### Tauri とは

Electron の代替となるデスクトップアプリフレームワーク。バックエンドが **Rust**、フロントエンドが **Web技術** (HTML/CSS/JS)。

| 比較 | Electron | Tauri v2 |
|------|---------|---------|
| バックエンド | Node.js | Rust |
| レンダラー | Chromium同梱 | OS標準WebView |
| バイナリサイズ | 150MB+ | 5-10MB |
| メモリ使用量 | 300MB+ | 50MB程度 |
| モバイル対応 | なし | iOS / Android |

### Tauri v2 の主要概念

#### 1. Tauri Command (Rust → JS の橋渡し)

```rust
// Rust側: #[tauri::command] でJS から呼べる関数を定義
#[tauri::command]
fn navigate(app: tauri::AppHandle, url: String) -> Result<(), String> {
    // ...処理...
    Ok(())
}

// Builder に登録
.invoke_handler(tauri::generate_handler![navigate])
```

```javascript
// JS側: invoke() で Rust関数を呼ぶ
const result = await window.__TAURI__.core.invoke("navigate", { url: "https://x.com" });
```

**ポイント:**
- 引数名は Rust と JS で一致させる必要がある (`url` → `{ url: "..." }`)
- 戻り値は `Result<T, String>` → JS の Promise<T> にマッピングされる
- `tauri::AppHandle` は自動注入される (JS側から渡す必要なし)

#### 2. Manager トレイト

Tauri の中核トレイト。Window, WebView, State へのアクセスを提供。

```rust
// WebView 取得
app.get_webview("browser")  // WebView名で取得

// Window 取得
app.get_window("main")      // Window名で取得

// State 取得 (アプリ全体で共有するデータ)
app.try_state::<BrowserState>()
```

#### 3. State 管理

```rust
// 定義
struct BrowserState {
    current_url: Mutex<String>,  // スレッドセーフにするため Mutex
}

// 登録
tauri::Builder::default()
    .manage(BrowserState {
        current_url: Mutex::new("https://x.com".to_string()),
    })
```

#### 4. setup() — アプリ初期化

```rust
.setup(|app| {
    // ここでウィンドウ作成、WebView追加、非同期タスク起動などを行う
    // app は &mut tauri::App
    // app.handle() で AppHandle (clone可能) を取得
    Ok(())
})
```

#### 5. WebView への JS 注入

```rust
// eval() で任意の JS を WebView 内で実行
webview.eval("window.location.reload()")

// include_str!() でファイルからJSを読み込んで注入
webview.eval(include_str!("../../frontend/src/danmaku-inject.js"))
```

`include_str!()` はコンパイル時にファイル内容を文字列リテラルとしてバイナリに埋め込むRustマクロ。

---

## 3. プロジェクト構成

```
nicotaurix/
│
├── core/                          # Rust core crate (Tauri に依存しない)
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                 # モジュールエクスポート
│       ├── danmaku.rs             # 弾幕メッセージのデータ構造 + シリアライズ
│       ├── qr.rs                  # QRコード SVG 生成 + LAN IP 取得
│       └── ws.rs                  # Axum WebSocket ブロードキャストサーバー
│
├── src-tauri/                     # Tauri アプリケーション本体
│   ├── Cargo.toml                 # tauri + core への依存
│   ├── tauri.conf.json            # Tauri 設定 (ウィンドウサイズ, CSP, etc.)
│   ├── src/
│   │   ├── main.rs                # エントリポイント (run() を呼ぶだけ)
│   │   └── lib.rs                 # コマンド定義 + マルチWebViewセットアップ
│   ├── icons/                     # アプリアイコン (各プラットフォーム用)
│   └── gen/
│       ├── schemas/               # Tauri自動生成スキーマ
│       └── apple/                 # iOS Xcode プロジェクト (tauri ios init で生成)
│
├── frontend/                      # Vite フロントエンド
│   ├── index.html                 # HTML + CSS (デスクトップ・モバイル両対応)
│   ├── public/                    # 静的ファイル (アイコン, manifest)
│   └── src/
│       ├── main.js                # エントリポイント (プラットフォーム分岐)
│       ├── danmaku-engine.js      # 弾幕レンダリングエンジン (クラス)
│       ├── ws-client.js           # WebSocket クライアント (自動再接続付き)
│       ├── danmaku-inject.js      # X.com に注入するスクリプト
│       ├── danmaku-engine.test.js # エンジン テスト (30)
│       ├── ws-client.test.js      # WS クライアント テスト (15)
│       └── danmaku-inject.test.js # Quote Post 検知テスト (14)
│
├── dist/                          # Vite ビルド出力 (gitignore)
├── vite.config.js                 # Vite 設定
├── vitest.config.js               # Vitest テスト設定
└── package.json                   # npm スクリプト + 依存
```

### なぜ core crate を分離するのか

Tauri の `tauri` クレートは macOS では GTK/WebKit のシステムライブラリに依存する。
CI やユニットテスト環境ではこれらが利用できないことがある。

`core` クレートは **Tauri に一切依存しない** ため:
- `cargo test --manifest-path core/Cargo.toml` で単独テスト可能
- ビジネスロジック (弾幕プロトコル, WS通信) がフレームワークと分離
- 将来別のフレームワークに移行する際もそのまま使える

---

## 4. Rust バックエンド詳解

### 4.1 src-tauri/src/lib.rs — メインロジック

このファイルがアプリの心臓部。やっていることは3つ:

#### A. Tauri Command の定義

```rust
#[tauri::command]
fn navigate(app: tauri::AppHandle, url: String) -> Result<(), String> {
    // 1. URL をパース (http:// が無ければ自動付与)
    let parsed_url = if url.starts_with("http://") || url.starts_with("https://") {
        url.clone()
    } else {
        format!("https://{}", url)
    };

    // 2. ブラウザ WebView を名前で取得してナビゲート
    if let Some(webview) = app.get_webview("browser") {
        let tauri_url: Url = parsed_url.parse().map_err(|e| format!("Invalid URL: {}", e))?;
        webview.navigate(tauri_url)?;

        // 3. 2秒後に弾幕スクリプトを注入 (ページ読み込みを待つ)
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if let Some(wv) = app2.get_webview("browser") {
                let _ = wv.eval(include_str!("../../frontend/src/danmaku-inject.js"));
            }
        });
    }
    Ok(())
}
```

**学びポイント:**
- `app.clone()` — `AppHandle` は Clone 可能。async タスクに渡す際は clone する
- `tauri::async_runtime::spawn()` — Tauri 内蔵の Tokio ランタイムで非同期タスクを実行
- `include_str!()` — コンパイル時にファイルを文字列として埋め込む

#### B. マルチWebView セットアップ (setup 内)

```rust
.setup(|app| {
    // WebSocket サーバーを非同期タスクとして起動
    tauri::async_runtime::spawn(async move {
        ws::start_ws_server().await;
    });

    // "main" ウィンドウを取得
    let window = app.get_window("main").unwrap();

    // ブラウザ用の子WebView を作成
    let browser_webview = WebviewBuilder::new(
        "browser",                                          // 名前 (get_webview で使う)
        WebviewUrl::External("https://x.com".parse().unwrap()), // 初期URL
    )
    .auto_resize()                    // ウィンドウリサイズに自動追従
    .on_navigation(|_url| true)       // すべてのナビゲーションを許可
    .on_new_window(|_url, _features| {
        NewWindowResponse::Allow      // ポップアップを許可 (OAuth用)
    });

    // ウィンドウの子として配置
    window.add_child(
        browser_webview,
        tauri::Position::Logical(tauri::LogicalPosition::new(0.0, 42.0)),  // y=42 (ツールバーの下)
        tauri::Size::Logical(tauri::LogicalSize::new(1280.0, 758.0)),      // 残りの領域
    )?;

    Ok(())
})
```

**学びポイント:**
- `WebviewBuilder` は `tauri` の `unstable` feature が必要 (`features = ["unstable"]`)
- `on_new_window(Allow)` がないと Google OAuth のポップアップが開かない
- `auto_resize()` でウィンドウリサイズ時にWebViewもリサイズされる

#### C. プラットフォーム分岐

```rust
// コンパイル時に iOS かどうかで分岐
#[cfg(not(target_os = "ios"))]
{
    // デスクトップ: マルチWebView + WSサーバー
}

// iOS ではマルチWebViewもWSサーバーも不要
// フロントエンドのJS側でモバイルUIに切り替わる

// モバイルエントリポイントのマーカー
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { ... }
```

### 4.2 core/src/danmaku.rs — 弾幕プロトコル

WebSocket で送受信するメッセージの型定義。serde で JSON シリアライズ。

```rust
// 弾幕メッセージ本体
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DanmakuMessage {
    pub text: String,
    #[serde(default = "default_color")]
    pub color: String,      // "#FFFFFF"
    #[serde(default = "default_speed")]
    pub speed: u8,          // 1〜5 (自動クランプ)
    #[serde(default = "default_font_size")]
    pub font_size: u16,     // 12〜72 (自動クランプ)
}

// WebSocket メッセージの種別 (タグ付きenum)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]      // ← JSON の "type" フィールドで判別
pub enum WsMessage {
    #[serde(rename = "danmaku")]
    Danmaku(DanmakuMessage),
    #[serde(rename = "control")]
    Control { action: ControlAction },
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "pong")]
    Pong,
}
```

**JSON 例:**
```json
{ "type": "danmaku", "text": "すごい！", "color": "#FFFFFF", "speed": 3, "font_size": 28 }
{ "type": "control", "action": { "action": "set_speed", "value": 5 } }
{ "type": "ping" }
```

### 4.3 core/src/ws.rs — WebSocket サーバー

Axum (Rust の Web フレームワーク) でブロードキャスト型WSサーバーを実装。

```rust
pub const WS_PORT: u16 = 1422;

pub struct WsState {
    pub tx: broadcast::Sender<String>,   // Tokio の broadcast チャネル
    pub client_count: Arc<RwLock<u64>>,
}
```

**仕組み:**
1. クライアントが `/ws` に接続
2. `broadcast::channel` にサブスクライブ (受信用)
3. クライアントからのメッセージは `tx.send()` で全クライアントにブロードキャスト
4. `Ping` メッセージには `Pong` で応答 (ヘルスチェック)
5. 切断時に `client_count` をデクリメント

**なぜ `0.0.0.0` でバインドするのか:**
`127.0.0.1` (localhost) では同じマシンからしか接続できない。
`0.0.0.0` にすることで LAN 内の他のデバイス (iPhone) からも接続可能。

### 4.4 core/src/qr.rs — QR コード生成

```rust
pub fn get_lan_ip() -> Result<String, String> {
    // local-ip-address クレートで LAN IP (192.168.x.x) を自動取得
    local_ip().map(|ip| ip.to_string())
}

pub fn generate_qr_svg_for_url(url: &str) -> Result<String, String> {
    // qrcode クレートで SVG 文字列を生成
    let code = QrCode::new(url.as_bytes())?;
    Ok(code.render::<qrcode::render::svg::Color>()
        .min_dimensions(200, 200)
        .build())
}
```

---

## 5. フロントエンド詳解

### 5.1 index.html — 2モードのUI

1つのHTMLでデスクトップとモバイル両方のUIを持つ。JS が `body` に `desktop` or `mobile` クラスを付与して切り替え。

```html
<!-- デスクトップ: ツールバーのみ表示 (ブラウザ部分は Tauri の WebView) -->
<body class="desktop">  <!-- height: 42px -->
  <nav id="navbar">...</nav>

<!-- モバイル: フルスクリーン弾幕ビューア -->
<body class="mobile">   <!-- height: 100vh -->
  <div id="mobile-app">
    <canvas id="mobile-danmaku-canvas"></canvas>
    <div id="mobile-connect">...</div>
  </div>
```

**CSS変数によるダークテーマ:**
```css
:root {
  --bar-h: 42px;          /* ツールバーの高さ */
  --bg: #0d0d0d;          /* 背景 */
  --surface: #181818;     /* カード等の表面 */
  --border: #2a2a2a;      /* ボーダー */
  --accent: #1d9bf0;      /* Twitter ブルー */
}
```

### 5.2 main.js — プラットフォーム分岐

```javascript
async function init() {
  const platform = await detectPlatform();
  // → Tauri の get_platform コマンドを呼ぶ
  // → "desktop" or "ios" が返る

  document.body.classList.add(platform === "ios" ? "mobile" : "desktop");

  if (platform === "ios") {
    initMobile();   // 弾幕ビューアモード
  } else {
    initDesktop();  // ブラウザツールバーモード
  }
}
```

#### デスクトップモード (initDesktop)

```javascript
// URL バー: Enter で navigate コマンドを呼ぶ
urlBar.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  await invoke("navigate", { url: urlBar.value.trim() });
});

// ナビゲーションボタン
document.getElementById("btn-back").addEventListener("click", () => invoke("browser_back"));

// 弾幕トグル: WSで全端末に同期
danmakuPill.addEventListener("click", () => {
  danmakuEnabled = !danmakuEnabled;
  wsClient.sendControl({ action: "toggle", enabled: danmakuEnabled });
});

// QR モーダル: WebSocket URL の QR を表示
const svg = await invoke("get_ws_qr");       // ws://192.168.x.x:1422/ws のQR
const wsUrl = await invoke("get_ws_url");
```

#### モバイルモード (initMobile)

```javascript
// WebSocket URL を手動入力して接続
connectBtn.addEventListener("click", () => {
  const url = wsUrlInput.value.trim();  // "ws://192.168.1.5:1422/ws"
  ws = new WebSocket(url);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "danmaku") {
      addDanmaku(msg.text, msg.color, msg.speed, msg.font_size);
    }
  };
});

// 前回のURLを localStorage に保存/復元
localStorage.setItem("nicotaurix_ws_url", url);
```

### 5.3 danmaku-engine.js — 弾幕エンジン (クラス)

再利用可能な Canvas 弾幕レンダラー。

```javascript
class DanmakuEngine {
  constructor(canvas, options = {}) {
    this.maxDanmaku = 100;    // 同時表示上限
    this.baseSpeed = 3;       // 1〜5
    this.defaultColor = "#FFFFFF";
    this.defaultFontSize = 28;
    this.items = [];          // 画面上の弾幕アイテム
    this.lanes = [];          // レーン割り当て (LRU)
  }

  addDanmaku({ text, color, speed, font_size }) {
    // 1. レーンを割り当て (LRU: 最も古いレーンを選択)
    // 2. テキスト幅を計測
    // 3. items に追加 (x = 画面右端から開始)
  }

  update(deltaMs) {
    // 各アイテムを左に移動 (速度 × 経過時間)
    // 画面外に出たアイテムを除去
  }

  render() {
    // Canvas に描画: 白文字 + 黒アウトライン
    ctx.strokeText(item.text, item.x, item.y);  // アウトライン
    ctx.fillText(item.text, item.x, item.y);    // 本体
  }
}
```

**レーン割り当て (LRU):**
画面を水平のレーンに分割し、最も長く使われていないレーンに新しい弾幕を配置。
これにより弾幕が縦に分散し、読みやすくなる。

```
レーン0: ────[弾幕A]──────────→
レーン1: ──────────[弾幕B]────→
レーン2: ────────────────[弾幕C]→   ← 最近使用
レーン3:                             ← 次に割り当てられる (LRU)
```

### 5.4 ws-client.js — WebSocket クライアント

```javascript
class DanmakuWsClient {
  constructor(url, callbacks = {}) {
    // callbacks: onDanmaku, onControl, onOpen, onClose, onError
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;  // 指数バックオフ (最大30秒)
    this.pingInterval = 30000;   // 30秒ごとにPing
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "danmaku": this.callbacks.onDanmaku?.(msg); break;
        case "control": this.callbacks.onControl?.(msg.action); break;
        case "pong":    /* heartbeat OK */ break;
      }
    };
  }

  // 送信ヘルパー
  sendDanmaku(text, opts = {}) { ... }
  sendControl(action) { ... }
}
```

**自動再接続:** 接続が切れたら指数バックオフで再接続。
`1s → 2s → 4s → 8s → 16s → 30s (上限)` × 最大10回

### 5.5 danmaku-inject.js — X.com 注入スクリプト

Tauri が `webview.eval()` で X.com のWebView に注入するスクリプト。
IIFE (即時実行関数式) でスコープを閉じている。

```javascript
(function () {
  "use strict";

  // 二重注入防止
  if (window.__nicotaurix_injected) return;
  window.__nicotaurix_injected = true;

  // 1. Canvas オーバーレイ作成 (z-index: 999999, pointer-events: none)
  // 2. 弾幕エンジン (インライン実装)
  // 3. Quote Post 検知 (MutationObserver)
  // 4. WebSocket 接続 (ws://localhost:1422/ws)
})();
```

**Quote Post 検知の仕組み:**

```javascript
// X.com の DOM 構造:
// article[data-testid="tweet"]
//   ├── div > [data-testid="tweetText"]   ← 引用コメント (弾幕にする)
//   └── div[role="link"]                  ← 引用元ツイートのカード
//       └── [data-testid="tweetText"]     ← 元ツイートのテキスト (無視)

function extractQuoteComment(article) {
  const tweetTexts = article.querySelectorAll('[data-testid="tweetText"]');
  if (tweetTexts.length < 2) return null;  // 引用でなければ無視
  return tweetTexts[0].textContent?.trim();  // 最初のテキスト = 引用コメント
}
```

**なぜ MutationObserver を使うのか:**
X.com は SPA (Single Page Application) で、画面遷移やスクロール時に DOM が動的に変化する。
`MutationObserver` はDOMの変更をリアルタイムで監視できるブラウザAPI。

---

## 6. 弾幕システム

### レンダリングパイプライン

```
テキスト検知 → addDanmaku() → items配列に追加
                                    ↓
requestAnimationFrame ループ → update(delta) → 位置更新
                                    ↓
                              render() → Canvas描画
                                    ↓
                              画面外チェック → alive=false → 除去
```

### Canvas 描画テクニック

```javascript
// 黒いアウトライン + 白い文字 = どんな背景でも読みやすい
ctx.strokeStyle = "#000000";
ctx.lineWidth = 2;
ctx.strokeText(text, x, y);   // まずアウトライン

ctx.fillStyle = item.color;
ctx.fillText(text, x, y);     // その上に文字本体
```

### 速度の正規化

```javascript
// deltaTime ベース: フレームレートに依存しない移動
const factor = delta / 16.667;  // 60FPSを基準に正規化
item.x -= item.speed * factor;
```

---

## 7. WebSocket 通信プロトコル

### メッセージ形式 (JSON)

すべてのメッセージは `type` フィールドで種別を判別する。

| type | 方向 | 用途 | ペイロード |
|------|------|------|-----------|
| `danmaku` | inject → server → all | 弾幕データ | text, color, speed, font_size |
| `control` | UI → server → all | 設定変更 | action: {action, value/enabled} |
| `ping` | client → server | ヘルスチェック | (なし) |
| `pong` | server → client | 応答 | (なし) |

### Control Action の種類

```json
{ "action": "set_speed", "value": 4 }       // 速度変更 (1-5)
{ "action": "set_color", "value": "#FF0000" } // 色変更
{ "action": "toggle", "enabled": false }      // 弾幕ON/OFF
{ "action": "set_font_size", "value": 36 }   // フォントサイズ
```

### ブロードキャストの流れ

```
Client A (inject.js) ─→ Server ─→ Client A (inject.js)
                                ─→ Client B (desktop main.js)
                                ─→ Client C (mobile main.js)
```

全クライアントが同じメッセージを受信する (自分自身も含む)。

---

## 8. マルチWebView アーキテクチャ

### Tauri v2 の `unstable` feature

```toml
# src-tauri/Cargo.toml
tauri = { version = "2", features = ["unstable"] }
```

この feature を有効にすると `WebviewBuilder` と `add_child()` が使える。
1つの Window 内に複数の WebView を配置できる。

### レイアウト

```
┌───────────────────────────────────┐
│ ツールバーWebView (main)  h=42px  │ ← frontend/index.html
├───────────────────────────────────┤
│                                   │
│                                   │
│  ブラウザWebView (browser)         │ ← X.com 等の外部サイト
│  h = ウィンドウ高さ - 42px         │
│                                   │
│  + Canvas弾幕オーバーレイ          │ ← danmaku-inject.js で作成
│                                   │
└───────────────────────────────────┘
```

### なぜ iframe ではなくマルチWebView か

- **セキュリティ**: iframe では X.com の CSP (Content Security Policy) で制限される
- **Cookie**: WebView はネイティブブラウザと同じ Cookie を共有できる
- **OAuth**: `on_new_window(Allow)` でポップアップログインが可能
- **パフォーマンス**: OS ネイティブの WebView エンジンを使用

---

## 9. iOS 対応

### セットアップ手順

```bash
# 1. Rust iOS ターゲット追加
rustup target add aarch64-apple-ios aarch64-apple-ios-sim

# 2. CocoaPods インストール (Tauri iOS の依存)
brew install cocoapods

# 3. Tauri iOS プロジェクト初期化
npx tauri ios init

# 4. iOS シミュレータで実行
npx tauri ios dev
```

### プラットフォーム分岐の仕組み

**Rust 側 (コンパイル時):**
```rust
#[cfg(not(target_os = "ios"))]   // デスクトップのみ
#[cfg(target_os = "ios")]         // iOS のみ
#[cfg_attr(mobile, tauri::mobile_entry_point)]  // モバイルエントリポイント
```

**JS 側 (ランタイム):**
```javascript
const platform = await invoke("get_platform");  // "desktop" or "ios"
```

### iOS アプリの役割

iOS アプリは「弾幕ビューア」専用:
1. WebSocket URL を入力 (PCのQRコードに表示されたURL)
2. PCの WebSocket サーバーに接続
3. 受信した弾幕をフルスクリーン Canvas で描画
4. ブラウザ機能は不要 (PCが X.com を閲覧)

---

## 10. ビルドとテスト

### 開発モード

```bash
npm run tauri dev
```

これにより以下が同時に起動:
1. Vite 開発サーバー (localhost:1420) — ホットリロード対応
2. Rust のコンパイル + Tauri アプリの起動
3. WebSocket サーバー (0.0.0.0:1422)

初回はRustコンパイルに2-3分。以降は差分ビルドで10-20秒。

### テスト

```bash
# JavaScript テスト (Vitest + jsdom)
npm test                # 59テスト: エンジン(30) + WS(15) + QuotePost(14)
npm run test:watch      # ウォッチモード

# Rust テスト
cargo test --manifest-path core/Cargo.toml   # 20テスト
```

### プロダクションビルド

```bash
npm run tauri build
# → src-tauri/target/release/bundle/ にインストーラーが生成される
```

### iOS ビルド

```bash
npx tauri ios dev       # シミュレータで実行
npx tauri ios build     # IPA 生成
```

---

## 11. 開発フロー

### 新しい Tauri Command を追加する手順

1. **Rust 側で関数定義:**
```rust
#[tauri::command]
fn my_command(app: tauri::AppHandle, arg1: String) -> Result<String, String> {
    Ok(format!("Hello {}", arg1))
}
```

2. **invoke_handler に登録:**
```rust
.invoke_handler(tauri::generate_handler![
    // ...既存コマンド...
    my_command  // ← 追加
])
```

3. **JS 側で呼び出し:**
```javascript
const result = await invoke("my_command", { arg1: "World" });
```

### WebView に新しいスクリプトを注入する手順

1. `frontend/src/` にJSファイルを作成
2. `include_str!()` で Rust に埋め込み
3. `webview.eval()` で注入

### フロントエンドの変更

- `frontend/` 配下のファイルは Vite のホットリロードで自動反映 (開発モード時)
- `danmaku-inject.js` はホットリロード**不可** (Rust にコンパイル時埋め込みされるため、Rustの再ビルドが必要)

---

## 12. トラブルシューティング

### ポート 1420 が使用中

```bash
lsof -ti:1420 | xargs kill -9
```

### Rust コンパイルが遅い

初回は依存クレートのコンパイルで2-3分。`target/` を消すと再発。
増分ビルドを活かすため `cargo clean` は避ける。

### Google ログインが動かない

`on_new_window` が `NewWindowResponse::Allow` を返しているか確認。
OAuth はポップアップウィンドウを開く必要がある。

### 弾幕が表示されない

1. WebSocket の接続状態を確認 (ツールバーの緑/赤ドット)
2. 歯車 → 「弾幕スクリプトを再注入」をクリック
3. DevTools で `window.__nicotaurix` を確認:
   ```javascript
   window.__nicotaurix.getItems()  // 現在の弾幕アイテム
   window.__nicotaurix.addDanmaku("テスト")  // 手動追加
   ```

### Cargo.toml の `unstable` feature

マルチWebView (`WebviewBuilder`, `add_child`) は Tauri v2 の unstable API。
将来のバージョンで変更される可能性がある。

### CSP (Content Security Policy)

`tauri.conf.json` の `"csp": null` は CSP を無効化している。
これは外部サイトの読み込みとスクリプト注入に必要だが、セキュリティ上のリスクがある。
本番環境では適切な CSP ルールを設定すべき。

---

## 13. 今後の課題

### 機能面

- [ ] **iOS シミュレータ/実機での動作確認**: `tauri ios dev` でのビルド検証
- [ ] **QR コードスキャン**: カメラでQRを読み取ってWS URLを自動入力
- [ ] **弾幕の永続化**: 過去の弾幕をローカルDBに保存・再生
- [ ] **ユーザー名表示**: 誰の引用リポストかを弾幕に付記

### 技術的改善

- [ ] **Quote Post 検知の堅牢化**: X.com のDOM構造変更への対応
- [ ] **ナビゲーションイベント**: Tauri の `on_navigation` で URL バーを自動更新
- [ ] **CSP 設定**: 適切なセキュリティポリシーの設定
- [ ] **E2E テスト**: Tauri のテストユーティリティを使った統合テスト
- [ ] **エラーハンドリング**: WebSocket切断時のUI通知改善
