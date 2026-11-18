use tauri::Url;

pub fn same_origin(url: &Url, origin: &Url) -> bool {
    url.scheme() == "http" && url.origin() == origin.origin() && !has_credentials(url)
}

fn has_credentials(url: &Url) -> bool {
    !url.username().is_empty() || url.password().is_some()
}

pub fn safe_external(url: &Url) -> bool {
    !has_credentials(url)
        && match url.scheme() {
            "http" | "https" => url.host().is_some(),
            "mailto" => !url.path().is_empty() && !url.path().starts_with("//"),
            _ => false,
        }
}

pub fn download_url(url: &Url, origin: &Url) -> bool {
    same_origin(url, origin)
        || match url.scheme() {
            "blob" => Url::parse(url.path()).is_ok_and(|inner| same_origin(&inner, origin)),
            "data" => [
                "application/pdf",
                "image/png",
                "text/csv",
                "application/zip",
            ]
            .iter()
            .any(|mime| url.path().split([';', ',']).next() == Some(*mime)),
            _ => false,
        }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }
    #[test]
    fn origin_and_download_policies_are_exact() {
        let origin = url("http://127.0.0.1:49000");
        assert!(same_origin(&url("http://127.0.0.1:49000/journal"), &origin));
        for bad in [
            "http://127.0.0.1:49001",
            "https://127.0.0.1:49000",
            "http://localhost:49000",
            "http://username@127.0.0.1:49000",
        ] {
            assert!(!same_origin(&url(bad), &origin));
        }
        assert!(download_url(
            &url("blob:http://127.0.0.1:49000/test"),
            &origin
        ));
        assert!(download_url(&url("data:image/png;base64,AAAA"), &origin));
        assert!(!download_url(&url("data:text/html,hello"), &origin));
        assert!(!download_url(
            &url("blob:http://127.0.0.1:49001/test"),
            &origin
        ));
    }
    #[test]
    fn external_urls_exclude_credentials_and_privileged_schemes() {
        for good in [
            "https://example.com",
            "http://example.com",
            "mailto:name@example.com",
        ] {
            assert!(safe_external(&url(good)));
        }
        for bad in [
            "https://secret@example.com",
            "https://user:secret@example.com",
            "mailto://user@evil.com",
            "file:///etc/passwd",
            "javascript:alert(1)",
        ] {
            assert!(!safe_external(&url(bad)));
        }
    }
}
