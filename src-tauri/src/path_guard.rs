use std::{
    fs,
    path::{Component, Path, PathBuf},
};

/// Resolve the download root used as the allowlist boundary.
/// Prefers a non-empty configured directory; otherwise falls back to the default.
pub fn resolve_download_root(configured: Option<&str>, fallback: &Path) -> PathBuf {
    configured
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| fallback.to_path_buf())
}

/// Ensure `candidate` resolves under `allowed_root`.
/// Creates the root directory when needed so canonicalize can succeed for new installs.
pub fn ensure_within_allowed_root(
    candidate: &Path,
    allowed_root: &Path,
) -> Result<PathBuf, String> {
    if candidate.as_os_str().is_empty() {
        return Err("路径不能为空".into());
    }

    fs::create_dir_all(allowed_root)
        .map_err(|error| format!("无法创建允许的根目录: {error}"))?;

    let root = normalize_path(allowed_root)
        .map_err(|error| format!("无效的允许根目录: {error}"))?;
    let resolved = normalize_path(candidate)
        .map_err(|error| format!("无效路径: {error}"))?;

    if !is_path_within(&resolved, &root) {
        return Err(format!(
            "路径不在允许的下载目录内: {} (允许根目录: {})",
            resolved.display(),
            root.display()
        ));
    }

    Ok(resolved)
}

pub fn is_remote_media_url(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.starts_with("http://") || trimmed.starts_with("https://")
}

fn normalize_path(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return path
            .canonicalize()
            .map(strip_verbatim_prefix)
            .map_err(|error| error.to_string());
    }

    let mut absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        env_current_dir()?.join(path)
    };

    absolute = normalize_lexically(&absolute);
    if let Some(parent) = absolute.parent() {
        if parent.as_os_str().is_empty() {
            return Ok(absolute);
        }
        let canonical_parent = if parent.exists() {
            parent
                .canonicalize()
                .map(strip_verbatim_prefix)
                .map_err(|error| error.to_string())?
        } else {
            normalize_lexically(parent)
        };
        let file_name = absolute
            .file_name()
            .ok_or_else(|| "路径缺少文件名".to_string())?;
        Ok(canonical_parent.join(file_name))
    } else {
        Ok(absolute)
    }
}

fn env_current_dir() -> Result<PathBuf, String> {
    std::env::current_dir().map_err(|error| format!("无法读取当前目录: {error}"))
}

fn normalize_lexically(path: &Path) -> PathBuf {
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                components.pop();
            }
            other => components.push(other),
        }
    }
    components.iter().collect()
}

fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(stripped) = text.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path
    }
}

fn is_path_within(candidate: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let candidate_key = path_key(candidate);
        let root_key = path_key(root);
        candidate_key == root_key
            || candidate_key.starts_with(&(root_key.clone() + "\\"))
    }
    #[cfg(not(windows))]
    {
        candidate == root || candidate.starts_with(root)
    }
}

#[cfg(windows)]
fn path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn rejects_path_outside_root() {
        let temp = env::temp_dir().join("kiya-path-guard-root");
        let _ = fs::create_dir_all(&temp);
        let outside = env::temp_dir().join("kiya-path-guard-outside").join("file.bin");
        let result = ensure_within_allowed_root(&outside, &temp);
        assert!(result.is_err());
    }

    #[test]
    fn accepts_path_inside_root() {
        let temp = env::temp_dir().join("kiya-path-guard-root-ok");
        let _ = fs::create_dir_all(&temp);
        let inside = temp.join("clip.mp4");
        let result = ensure_within_allowed_root(&inside, &temp);
        assert!(result.is_ok());
    }

    #[test]
    fn detects_remote_urls() {
        assert!(is_remote_media_url("https://example.com/a.mp4"));
        assert!(!is_remote_media_url(r"C:\Videos\a.mp4"));
    }
}
