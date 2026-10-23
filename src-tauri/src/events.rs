//! Sending events to the window. The Tauri app handle in the app; a recorder
//! in tests, which then need no Tauri runtime.

use serde::Serialize;

pub trait Events: Clone + Send + Sync + 'static {
    fn send<S: Serialize + Clone>(&self, event: &str, payload: S);
}

impl<R: tauri::Runtime> Events for tauri::AppHandle<R> {
    fn send<S: Serialize + Clone>(&self, event: &str, payload: S) {
        use tauri::Emitter;
        let _ = self.emit(event, payload);
    }
}

/// Keeps every event, for tests.
#[cfg(test)]
#[derive(Clone, Default)]
pub struct Recorder(pub std::sync::Arc<std::sync::Mutex<Vec<(String, serde_json::Value)>>>);

#[cfg(test)]
impl Events for Recorder {
    fn send<S: Serialize + Clone>(&self, event: &str, payload: S) {
        if let Ok(mut events) = self.0.lock() {
            events.push((event.to_string(), serde_json::to_value(payload).unwrap_or_default()));
        }
    }
}
