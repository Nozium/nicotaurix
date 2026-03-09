use local_ip_address::local_ip;
use qrcode::QrCode;

/// Get the LAN IP address of this machine
pub fn get_lan_ip() -> Result<String, String> {
    local_ip()
        .map(|ip| ip.to_string())
        .map_err(|e| format!("Failed to get local IP: {}", e))
}

/// Generate an SVG QR code pointing to http://<lan_ip>:<port>
pub fn generate_qr_svg(port: u16) -> Result<String, String> {
    let ip = get_lan_ip()?;
    let url = format!("http://{}:{}", ip, port);
    generate_qr_svg_for_url(&url)
}

/// Generate an SVG QR code for a given URL string
pub fn generate_qr_svg_for_url(url: &str) -> Result<String, String> {
    let code = QrCode::new(url.as_bytes()).map_err(|e| format!("QR generation failed: {}", e))?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(200, 200)
        .build();
    Ok(svg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_qr_svg_for_url_returns_svg() {
        let result = generate_qr_svg_for_url("http://192.168.1.1:1420");
        assert!(result.is_ok());
        let svg = result.unwrap();
        assert!(svg.contains("<svg"));
        assert!(svg.contains("</svg>"));
    }

    #[test]
    fn test_generate_qr_svg_for_url_with_empty_string() {
        // QR code can encode empty string
        let result = generate_qr_svg_for_url("");
        assert!(result.is_ok());
    }

    #[test]
    fn test_generate_qr_svg_for_url_produces_different_output_for_different_urls() {
        let svg1 = generate_qr_svg_for_url("http://192.168.1.1:1420").unwrap();
        let svg2 = generate_qr_svg_for_url("http://10.0.0.1:8080").unwrap();
        assert_ne!(svg1, svg2);
    }

    #[test]
    fn test_get_lan_ip_format() {
        // In CI/container this might fail, so we just check it doesn't panic
        if let Ok(ip) = get_lan_ip() {
            // Should look like an IP address
            assert!(ip.contains('.') || ip.contains(':'));
        }
    }
}
