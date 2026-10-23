use serde::Serialize;

/// An error the interface can show: `code` picks the translated message,
/// `detail` carries the original text (a path, a command's output).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct StudioError {
    pub code: &'static str,
    pub detail: String,
}

impl StudioError {
    pub fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self { code, detail: detail.into() }
    }
}

impl std::fmt::Display for StudioError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.detail)
    }
}

impl From<std::io::Error> for StudioError {
    fn from(error: std::io::Error) -> Self {
        Self::new("io", error.to_string())
    }
}

pub type Result<T> = std::result::Result<T, StudioError>;
