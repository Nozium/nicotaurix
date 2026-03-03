use serde::{Deserialize, Serialize};

/// Represents a single danmaku (bullet comment) message
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DanmakuMessage {
    /// The text content of the danmaku
    pub text: String,
    /// Color in hex format (e.g., "#FFFFFF")
    pub color: String,
    /// Speed: 1 (slow) to 5 (fast)
    pub speed: u8,
    /// Font size in pixels
    pub font_size: u16,
}

impl DanmakuMessage {
    pub fn new(text: String) -> Self {
        Self {
            text,
            color: "#FFFFFF".to_string(),
            speed: 3,
            font_size: 28,
        }
    }

    pub fn with_color(mut self, color: String) -> Self {
        self.color = color;
        self
    }

    pub fn with_speed(mut self, speed: u8) -> Self {
        self.speed = speed.clamp(1, 5);
        self
    }

    pub fn with_font_size(mut self, size: u16) -> Self {
        self.font_size = size.clamp(12, 72);
        self
    }
}

/// Protocol messages sent over WebSocket
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum WsMessage {
    /// A new danmaku to display
    #[serde(rename = "danmaku")]
    Danmaku(DanmakuMessage),

    /// Control command from PWA to PC
    #[serde(rename = "control")]
    Control { action: ControlAction },

    /// Heartbeat ping/pong
    #[serde(rename = "ping")]
    Ping,

    #[serde(rename = "pong")]
    Pong,
}

/// Control actions sent from PWA remote
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "action")]
pub enum ControlAction {
    #[serde(rename = "set_speed")]
    SetSpeed { value: u8 },
    #[serde(rename = "set_color")]
    SetColor { value: String },
    #[serde(rename = "toggle")]
    Toggle { enabled: bool },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_danmaku_message_new_defaults() {
        let msg = DanmakuMessage::new("Hello".to_string());
        assert_eq!(msg.text, "Hello");
        assert_eq!(msg.color, "#FFFFFF");
        assert_eq!(msg.speed, 3);
        assert_eq!(msg.font_size, 28);
    }

    #[test]
    fn test_danmaku_message_builder() {
        let msg = DanmakuMessage::new("Test".to_string())
            .with_color("#FF0000".to_string())
            .with_speed(5)
            .with_font_size(36);
        assert_eq!(msg.color, "#FF0000");
        assert_eq!(msg.speed, 5);
        assert_eq!(msg.font_size, 36);
    }

    #[test]
    fn test_danmaku_speed_clamped() {
        let msg = DanmakuMessage::new("Test".to_string()).with_speed(10);
        assert_eq!(msg.speed, 5);

        let msg = DanmakuMessage::new("Test".to_string()).with_speed(0);
        assert_eq!(msg.speed, 1);
    }

    #[test]
    fn test_danmaku_font_size_clamped() {
        let msg = DanmakuMessage::new("Test".to_string()).with_font_size(5);
        assert_eq!(msg.font_size, 12);

        let msg = DanmakuMessage::new("Test".to_string()).with_font_size(100);
        assert_eq!(msg.font_size, 72);
    }

    #[test]
    fn test_ws_message_danmaku_serialize() {
        let msg = WsMessage::Danmaku(DanmakuMessage::new("弾幕テスト".to_string()));
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"danmaku\""));
        assert!(json.contains("弾幕テスト"));
    }

    #[test]
    fn test_ws_message_danmaku_deserialize() {
        let json = r##"{"type":"danmaku","text":"Hello","color":"#FFFFFF","speed":3,"font_size":28}"##;
        let msg: WsMessage = serde_json::from_str(json).unwrap();
        match msg {
            WsMessage::Danmaku(d) => {
                assert_eq!(d.text, "Hello");
                assert_eq!(d.color, "#FFFFFF");
            }
            _ => panic!("Expected Danmaku variant"),
        }
    }

    #[test]
    fn test_ws_message_control_serialize() {
        let msg = WsMessage::Control {
            action: ControlAction::SetSpeed { value: 4 },
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"control\""));
        assert!(json.contains("set_speed"));
    }

    #[test]
    fn test_ws_message_control_toggle_deserialize() {
        let json = r#"{"type":"control","action":{"action":"toggle","enabled":false}}"#;
        let msg: WsMessage = serde_json::from_str(json).unwrap();
        match msg {
            WsMessage::Control { action } => {
                assert_eq!(action, ControlAction::Toggle { enabled: false });
            }
            _ => panic!("Expected Control variant"),
        }
    }

    #[test]
    fn test_ws_message_ping_pong() {
        let ping_json = serde_json::to_string(&WsMessage::Ping).unwrap();
        assert!(ping_json.contains("\"type\":\"ping\""));

        let pong_json = serde_json::to_string(&WsMessage::Pong).unwrap();
        assert!(pong_json.contains("\"type\":\"pong\""));
    }

    #[test]
    fn test_danmaku_message_roundtrip() {
        let original = DanmakuMessage::new("ニコニコ".to_string())
            .with_color("#00FF00".to_string())
            .with_speed(2)
            .with_font_size(32);
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: DanmakuMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }
}
