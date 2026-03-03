use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use crate::danmaku::WsMessage;

pub const WS_PORT: u16 = 1422;

pub struct WsState {
    pub tx: broadcast::Sender<String>,
    pub client_count: Arc<RwLock<u64>>,
}

impl WsState {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            tx,
            client_count: Arc::new(RwLock::new(0)),
        }
    }
}

pub async fn start_ws_server() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    start_ws_server_on_port(WS_PORT).await
}

pub async fn start_ws_server_on_port(
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state = Arc::new(WsState::new());

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("WebSocket server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    axum::extract::State(state): axum::extract::State<Arc<WsState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<WsState>) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.tx.subscribe();

    // Increment client count
    {
        let mut count = state.client_count.write().await;
        *count += 1;
        println!("Client connected. Total: {}", *count);
    }

    let tx = state.tx.clone();
    let client_count = state.client_count.clone();

    // Forward broadcast messages to this client
    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Receive messages from this client and broadcast
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    // Parse and validate the message
                    if let Ok(ws_msg) = serde_json::from_str::<WsMessage>(&text) {
                        match ws_msg {
                            WsMessage::Ping => {
                                let pong =
                                    serde_json::to_string(&WsMessage::Pong).unwrap_or_default();
                                let _ = tx.send(pong);
                            }
                            _ => {
                                // Broadcast to all clients
                                let _ = tx.send(text.to_string());
                            }
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // Wait for either task to finish
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    };

    // Decrement client count
    {
        let mut count = client_count.write().await;
        *count = count.saturating_sub(1);
        println!("Client disconnected. Total: {}", *count);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ws_state_new() {
        let state = WsState::new();
        let _rx = state.tx.subscribe();
    }

    #[test]
    fn test_ws_port_constant() {
        assert_eq!(WS_PORT, 1422);
    }

    #[tokio::test]
    async fn test_broadcast_channel() {
        let state = WsState::new();
        let mut rx1 = state.tx.subscribe();
        let mut rx2 = state.tx.subscribe();

        let msg = serde_json::to_string(&WsMessage::Danmaku(
            crate::danmaku::DanmakuMessage::new("test".to_string()),
        ))
        .unwrap();

        state.tx.send(msg.clone()).unwrap();

        let received1 = rx1.recv().await.unwrap();
        let received2 = rx2.recv().await.unwrap();

        assert_eq!(received1, msg);
        assert_eq!(received2, msg);
    }

    #[tokio::test]
    async fn test_client_count() {
        let state = WsState::new();
        {
            let mut count = state.client_count.write().await;
            *count += 1;
        }
        {
            let count = state.client_count.read().await;
            assert_eq!(*count, 1);
        }
        {
            let mut count = state.client_count.write().await;
            *count = count.saturating_sub(1);
        }
        {
            let count = state.client_count.read().await;
            assert_eq!(*count, 0);
        }
    }

    #[tokio::test]
    async fn test_ws_server_starts_and_accepts_connection() {
        use tokio_tungstenite::connect_async;

        // Start server on a random available port
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let state = Arc::new(WsState::new());
        let app = Router::new()
            .route("/ws", get(ws_handler))
            .with_state(state);

        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        // Give server a moment to start
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Connect
        let url = format!("ws://127.0.0.1:{}/ws", port);
        let (mut ws, _) = connect_async(&url).await.expect("Failed to connect");

        // Send a danmaku message
        let msg = serde_json::to_string(&WsMessage::Danmaku(
            crate::danmaku::DanmakuMessage::new("integration test".to_string()),
        ))
        .unwrap();

        use tokio_tungstenite::tungstenite::Message as TungMsg;
        ws.send(TungMsg::Text(msg.clone().into())).await.unwrap();

        // Should receive the broadcasted message back
        let received = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            ws.next(),
        )
        .await
        .expect("timeout")
        .expect("stream ended")
        .expect("ws error");

        if let TungMsg::Text(text) = received {
            let parsed: WsMessage = serde_json::from_str(&text).unwrap();
            match parsed {
                WsMessage::Danmaku(d) => assert_eq!(d.text, "integration test"),
                _ => panic!("Expected danmaku message"),
            }
        } else {
            panic!("Expected text message");
        }

        ws.close(None).await.ok();
        server.abort();
    }

    #[tokio::test]
    async fn test_ping_pong() {
        use tokio_tungstenite::connect_async;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let state = Arc::new(WsState::new());
        let app = Router::new()
            .route("/ws", get(ws_handler))
            .with_state(state);

        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let url = format!("ws://127.0.0.1:{}/ws", port);
        let (mut ws, _) = connect_async(&url).await.expect("Failed to connect");

        // Send ping
        let ping = serde_json::to_string(&WsMessage::Ping).unwrap();
        use tokio_tungstenite::tungstenite::Message as TungMsg;
        ws.send(TungMsg::Text(ping.into())).await.unwrap();

        // Should receive pong
        let received = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            ws.next(),
        )
        .await
        .expect("timeout")
        .expect("stream ended")
        .expect("ws error");

        if let TungMsg::Text(text) = received {
            let parsed: WsMessage = serde_json::from_str(&text).unwrap();
            assert_eq!(parsed, WsMessage::Pong);
        } else {
            panic!("Expected text message");
        }

        ws.close(None).await.ok();
        server.abort();
    }
}
