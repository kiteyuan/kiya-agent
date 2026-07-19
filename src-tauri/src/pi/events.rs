use serde_json::Value;

use super::prompt::normalize_tool_name;

pub fn extract_tool_detail(payload: &Value) -> Option<String> {
    let tool_name = payload
        .pointer("/toolExecution/toolName")
        .and_then(Value::as_str)
        .or_else(|| payload.pointer("/toolExecution/name").and_then(Value::as_str))
        .or_else(|| payload.pointer("/toolName").and_then(Value::as_str))
        .or_else(|| payload.pointer("/name").and_then(Value::as_str))?;

    let detail = payload
        .pointer("/toolExecution/arguments")
        .or_else(|| payload.pointer("/toolExecution/args"))
        .or_else(|| payload.pointer("/arguments"))
        .map(|value| value.to_string())
        .unwrap_or_else(|| "{}".into());

    if tool_name == "mcp" {
        return extract_wrapped_mcp_tool_detail(payload);
    }

    Some(format!("{tool_name}: {detail}"))
}

fn extract_wrapped_mcp_tool_detail(payload: &Value) -> Option<String> {
    let wrapper_args = payload
        .pointer("/toolExecution/args")
        .or_else(|| payload.pointer("/toolExecution/arguments"))
        .or_else(|| payload.pointer("/args"))
        .or_else(|| payload.pointer("/arguments"))?;

    if wrapper_args.get("describe").is_some() {
        return None;
    }

    let wrapped_tool_name = wrapper_args
        .get("tool")
        .and_then(Value::as_str)
        .map(normalize_tool_name)?;

    let wrapped_args = wrapper_args.get("args")?;
    let wrapped_detail = if let Some(raw_json) = wrapped_args.as_str() {
        serde_json::from_str::<Value>(raw_json).unwrap_or_else(|_| Value::String(raw_json.into()))
    } else {
        wrapped_args.clone()
    };

    Some(format!("{wrapped_tool_name}: {}", wrapped_detail))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_direct_tool_detail() {
        let payload = json!({
            "toolExecution": {
                "toolName": "download_file",
                "arguments": { "url": "https://example.com/a.mp4", "output": "a.mp4" }
            }
        });
        let detail = extract_tool_detail(&payload).expect("detail");
        assert!(detail.starts_with("download_file:"));
        assert!(detail.contains("a.mp4"));
    }

    #[test]
    fn unwraps_mcp_tool_calls() {
        let payload = json!({
            "toolName": "mcp",
            "args": {
                "tool": "kiya_local_download_file",
                "args": { "url": "https://example.com/b.mp4", "output": "b.mp4" }
            }
        });
        let detail = extract_tool_detail(&payload).expect("detail");
        assert!(detail.starts_with("download_file:"));
    }
}
