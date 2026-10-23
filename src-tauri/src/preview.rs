//! Generator preview (D5): the real `php flo make:…` runs in a temporary copy
//! of the project, with vendor/ linked (not copied); the files it created or
//! changed there are what Create will write. The copy is deleted afterwards.

use std::collections::BTreeMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{Result, StudioError};
use crate::settings::Settings;
use crate::tasks::{self, Output, Program};

/// Not copied: big, generated, or not read by generators.
const SKIP: &[&str] = &["vendor", "node_modules", ".git", "storage", "views/cache", "public/uploads"];
/// A project bigger than this (without the folders above) is not copied.
const MAX_BYTES: u64 = 300 * 1024 * 1024;
/// Text shown per file
const MAX_TEXT: usize = 400 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// Relative, with forward slashes
    pub path: String,
    /// created, changed or deleted
    pub change: &'static str,
    pub content: Option<String>,
    pub before: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub output: Output,
    pub files: Vec<FileChange>,
}

pub fn run(settings: &Settings, project: &Path, args: &[String]) -> Result<Preview> {
    if !args.first().is_some_and(|a| a.starts_with("make:")) {
        return Err(StudioError::new("not_allowed", args.join(" ")));
    }
    if !project.join("vendor").is_dir() {
        return Err(StudioError::new("no_vendor", project.to_string_lossy()));
    }
    let temp =
        std::env::temp_dir().join(format!("flocms-studio-preview-{}-{}", std::process::id(), crate::server::now_ms()));
    let result = (|| {
        let mut size = 0;
        copy_tree(project, &temp, project, &mut size)?;
        link_vendor(&project.join("vendor"), &temp.join("vendor"))?;
        // storage/ is skipped; the CLI may write logs there
        fs::create_dir_all(temp.join("storage").join("logs"))?;
        let before = snapshot(&temp);
        let output = tasks::capture(settings, Program::Flo, &temp, args)?;
        let after = snapshot(&temp);
        Ok(Preview { output, files: compare(&temp, &before, &after) })
    })();
    cleanup(&temp);
    result
}

fn skipped(root: &Path, path: &Path) -> bool {
    let relative = path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/");
    SKIP.iter().any(|s| relative == *s || relative.starts_with(&format!("{s}/")))
}

fn copy_tree(from: &Path, to: &Path, root: &Path, size: &mut u64) -> Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let path = entry.path();
        if skipped(root, &path) {
            continue;
        }
        let kind = entry.file_type()?;
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_tree(&path, &target, root, size)?;
        } else if kind.is_file() || kind.is_symlink() {
            if let Ok(meta) = fs::metadata(&path) {
                if meta.is_dir() {
                    continue; // a link to a folder: generators do not need it
                }
                *size += meta.len();
                if *size > MAX_BYTES {
                    return Err(StudioError::new("preview_too_big", root.to_string_lossy()));
                }
                fs::copy(&path, &target)?;
            }
        }
    }
    Ok(())
}

#[cfg(unix)]
fn link_vendor(vendor: &Path, link: &Path) -> Result<()> {
    std::os::unix::fs::symlink(vendor, link)?;
    Ok(())
}

/// A junction: needs no administrator rights, unlike a symbolic link.
#[cfg(windows)]
fn link_vendor(vendor: &Path, link: &Path) -> Result<()> {
    let mut command = crate::tools::command(Path::new("cmd"));
    command.arg("/C").arg("mklink").arg("/J").arg(link).arg(vendor);
    let out = crate::tools::run_capture(command, std::time::Duration::from_secs(20))?;
    if out.code != Some(0) {
        return Err(StudioError::new("io", format!("mklink /J: {} {}", out.stdout.trim(), out.stderr.trim())));
    }
    Ok(())
}

/// Removes the copy. The vendor link goes first, as a link, so nothing of the
/// real vendor/ can ever be deleted.
fn cleanup(temp: &Path) {
    let link = temp.join("vendor");
    if link.exists() || fs::symlink_metadata(&link).is_ok() {
        #[cfg(unix)]
        let _ = fs::remove_file(&link);
        #[cfg(windows)]
        let _ = fs::remove_dir(&link);
    }
    if fs::symlink_metadata(&link).is_err() {
        let _ = fs::remove_dir_all(temp);
    }
}

#[derive(Debug, Clone, PartialEq)]
struct Seen {
    len: u64,
    hash: u64,
}

fn snapshot(root: &Path) -> BTreeMap<String, Seen> {
    let mut files = BTreeMap::new();
    walk(root, root, &mut files);
    files
}

fn walk(root: &Path, dir: &Path, files: &mut BTreeMap<String, Seen>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let relative = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
        if relative == "vendor" || relative.starts_with("storage/") || relative == "storage" {
            continue;
        }
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            walk(root, &path, files);
        } else if kind.is_file() {
            let bytes = fs::read(&path).unwrap_or_default();
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            bytes.hash(&mut hasher);
            files.insert(relative, Seen { len: bytes.len() as u64, hash: hasher.finish() });
        }
    }
}

fn text(path: &PathBuf) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if bytes.contains(&0) {
        return None; // binary
    }
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if text.len() > MAX_TEXT {
        let mut end = MAX_TEXT;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str("\n…");
    }
    Some(text)
}

fn compare(root: &Path, before: &BTreeMap<String, Seen>, after: &BTreeMap<String, Seen>) -> Vec<FileChange> {
    let mut changes = Vec::new();
    for (path, seen) in after {
        let file = root.join(path);
        match before.get(path) {
            None => {
                changes.push(FileChange { path: path.clone(), change: "created", content: text(&file), before: None })
            }
            Some(old) if old != seen => {
                changes.push(FileChange { path: path.clone(), change: "changed", content: text(&file), before: None })
            }
            _ => {}
        }
    }
    for path in before.keys() {
        if !after.contains_key(path) {
            changes.push(FileChange { path: path.clone(), change: "deleted", content: None, before: None });
        }
    }
    changes
}

/// The content of a changed file before the generator ran, for the diff.
pub fn with_before(project: &Path, mut preview: Preview) -> Preview {
    for change in &mut preview.files {
        if change.change == "changed" {
            change.before = text(&project.join(&change.path));
        }
    }
    preview
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_the_big_folders() {
        let root = Path::new("/p");
        assert!(skipped(root, Path::new("/p/vendor")));
        assert!(skipped(root, Path::new("/p/storage/logs")));
        assert!(skipped(root, Path::new("/p/public/uploads/a.jpg")));
        assert!(!skipped(root, Path::new("/p/public/index.php")));
        assert!(!skipped(root, Path::new("/p/vendors.txt")));
    }

    #[test]
    fn finds_created_changed_and_deleted_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.php"), "a").unwrap();
        fs::write(dir.path().join("b.php"), "b").unwrap();
        let before = snapshot(dir.path());
        fs::write(dir.path().join("a.php"), "a2").unwrap();
        fs::remove_file(dir.path().join("b.php")).unwrap();
        fs::create_dir_all(dir.path().join("admin/Resources")).unwrap();
        fs::write(dir.path().join("admin/Resources/X.php"), "<?php").unwrap();
        let after = snapshot(dir.path());
        let changes = compare(dir.path(), &before, &after);
        let summary: Vec<(&str, &str)> = changes.iter().map(|c| (c.path.as_str(), c.change)).collect();
        assert_eq!(summary, vec![("a.php", "changed"), ("admin/Resources/X.php", "created"), ("b.php", "deleted")]);
        assert_eq!(changes[1].content.as_deref(), Some("<?php"));
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_never_touches_the_real_vendor() {
        let real = tempfile::tempdir().unwrap();
        fs::create_dir_all(real.path().join("vendor/hostkurd")).unwrap();
        fs::write(real.path().join("vendor/autoload.php"), "<?php").unwrap();
        let temp = tempfile::tempdir().unwrap().keep();
        link_vendor(&real.path().join("vendor"), &temp.join("vendor")).unwrap();
        cleanup(&temp);
        assert!(!temp.exists());
        assert!(real.path().join("vendor/autoload.php").is_file());
    }

    /// The real thing: FLOCMS_STUDIO_TEST_PROJECT = a FloCMS 2.0 project with
    /// flocms-admin installed.
    #[test]
    fn previews_a_real_generator() {
        let Ok(project) = std::env::var("FLOCMS_STUDIO_TEST_PROJECT") else { return };
        let project = PathBuf::from(project);
        let args: Vec<String> =
            ["make:controller", "StudioPreviewProbe", "--model"].iter().map(|s| s.to_string()).collect();
        let preview = run(&Settings::default(), &project, &args).unwrap();
        assert_eq!(preview.output.code, Some(0), "{:?}", preview.output);
        let paths: Vec<&str> = preview.files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"controllers/StudioPreviewProbeController.php"), "{paths:?}");
        assert!(paths.contains(&"models/StudioPreviewProbeModel.php"), "{paths:?}");
        // Nothing in the real project
        assert!(!project.join("controllers/StudioPreviewProbeController.php").exists());
        assert!(project.join("vendor/autoload.php").is_file());
    }
}
