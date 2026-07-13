use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};

use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::models::{
    ChatConversationSummary, ChatMessage, ChatToolCall, DownloadTask, PlaylistItem,
};

const DEFAULT_CONVERSATION_TITLE: &str = "新会话";

fn chat_db_file_name() -> &'static str {
    if cfg!(debug_assertions) {
        "chat-history.dev.sqlite3"
    } else {
        "chat-history.sqlite3"
    }
}

fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn resolve_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法解析聊天记录目录: {error}"))?;

    fs::create_dir_all(&app_data_dir).map_err(|error| format!("无法创建聊天记录目录: {error}"))?;
    Ok(app_data_dir.join(chat_db_file_name()))
}

fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    let db_path = resolve_db_path(app)?;
    let connection =
        Connection::open(db_path).map_err(|error| format!("无法打开聊天记录数据库: {error}"))?;
    connection
        .execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS conversations (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              created_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              timestamp TEXT NOT NULL,
              created_at TEXT,
              tool_call_json TEXT,
              streaming INTEGER NOT NULL DEFAULT 0,
              sort_index INTEGER NOT NULL,
              FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conversation_sort
              ON messages(conversation_id, sort_index);

            CREATE TABLE IF NOT EXISTS download_history (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              status TEXT NOT NULL,
              progress INTEGER NOT NULL,
              speed TEXT NOT NULL,
              total_bytes INTEGER,
              created_at_ms INTEGER,
              file_path TEXT NOT NULL,
              source TEXT NOT NULL,
              download_url TEXT,
              aria2_gid TEXT,
              sort_index INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_download_history_sort
              ON download_history(sort_index);

            CREATE TABLE IF NOT EXISTS playlist_history (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              source TEXT NOT NULL,
              kind TEXT NOT NULL,
              origin TEXT NOT NULL,
              added_at TEXT NOT NULL,
              sort_index INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_playlist_history_sort
              ON playlist_history(sort_index);
            ",
        )
        .map_err(|error| format!("初始化聊天记录数据库失败: {error}"))?;

    Ok(connection)
}

fn derive_conversation_title(messages: &[ChatMessage]) -> String {
    messages
        .iter()
        .find(|message| message.role == "user" && !message.content.trim().is_empty())
        .map(|message| {
            let trimmed = message.content.trim();
            let preview = trimmed.chars().take(40).collect::<String>();
            if trimmed.chars().count() > 40 {
                format!("{preview}...")
            } else {
                preview
            }
        })
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| DEFAULT_CONVERSATION_TITLE.to_string())
}

fn row_to_chat_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatMessage> {
    let tool_call_json = row.get::<_, Option<String>>(5)?;
    let tool_call = tool_call_json
        .as_deref()
        .map(serde_json::from_str::<ChatToolCall>)
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;

    Ok(ChatMessage {
        id: row.get(0)?,
        role: row.get(1)?,
        content: row.get(2)?,
        timestamp: row.get(3)?,
        created_at: row.get(4)?,
        tool_call,
        streaming: Some(row.get::<_, i64>(6)? != 0),
    })
}

fn row_to_conversation_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatConversationSummary> {
    Ok(ChatConversationSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at_ms: row.get::<_, i64>(2)? as u64,
        updated_at_ms: row.get::<_, i64>(3)? as u64,
        message_count: row.get::<_, i64>(4)? as u32,
    })
}

fn row_to_download_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<DownloadTask> {
    Ok(DownloadTask {
        id: row.get(0)?,
        name: row.get(1)?,
        status: row.get(2)?,
        progress: row.get::<_, i64>(3)? as u8,
        speed: row.get(4)?,
        total_bytes: row.get::<_, Option<i64>>(5)?.map(|value| value as u64),
        created_at_ms: row.get::<_, Option<i64>>(6)?.map(|value| value as u64),
        file_path: row.get(7)?,
        source: row.get(8)?,
        download_url: row.get(9)?,
        aria2_gid: row.get(10)?,
    })
}

fn row_to_playlist_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<PlaylistItem> {
    Ok(PlaylistItem {
        id: row.get(0)?,
        title: row.get(1)?,
        source: row.get(2)?,
        kind: row.get(3)?,
        origin: row.get(4)?,
        added_at: row.get(5)?,
    })
}

pub fn list_chat_conversations(app: &AppHandle) -> Result<Vec<ChatConversationSummary>, String> {
    let connection = open_connection(app)?;
    let mut statement = connection
        .prepare(
            "
            SELECT
              conversations.id,
              conversations.title,
              conversations.created_at_ms,
              conversations.updated_at_ms,
              COUNT(messages.id) AS message_count
            FROM conversations
            LEFT JOIN messages
              ON messages.conversation_id = conversations.id
            GROUP BY conversations.id
            ORDER BY conversations.updated_at_ms DESC, conversations.created_at_ms DESC
            ",
        )
        .map_err(|error| format!("读取会话列表失败: {error}"))?;

    let rows = statement
        .query_map([], row_to_conversation_summary)
        .map_err(|error| format!("解析会话列表失败: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("收集会话列表失败: {error}"))
}

pub fn create_chat_conversation(app: &AppHandle) -> Result<ChatConversationSummary, String> {
    let connection = open_connection(app)?;
    let now = current_timestamp_ms();
    let id = Uuid::new_v4().to_string();

    connection
        .execute(
            "
            INSERT INTO conversations (id, title, created_at_ms, updated_at_ms)
            VALUES (?, ?, ?, ?)
            ",
            params![id, DEFAULT_CONVERSATION_TITLE, now, now],
        )
        .map_err(|error| format!("创建会话失败: {error}"))?;

    Ok(ChatConversationSummary {
        id,
        title: DEFAULT_CONVERSATION_TITLE.to_string(),
        created_at_ms: now as u64,
        updated_at_ms: now as u64,
        message_count: 0,
    })
}

pub fn delete_chat_conversation(app: &AppHandle, conversation_id: &str) -> Result<(), String> {
    let connection = open_connection(app)?;
    connection
        .execute(
            "DELETE FROM conversations WHERE id = ?",
            [conversation_id],
        )
        .map_err(|error| format!("删除会话失败: {error}"))?;

    Ok(())
}

pub fn load_chat_messages(
    app: &AppHandle,
    conversation_id: &str,
) -> Result<Vec<ChatMessage>, String> {
    let connection = open_connection(app)?;
    let mut statement = connection
        .prepare(
            "
            SELECT id, role, content, timestamp, created_at, tool_call_json, streaming
            FROM messages
            WHERE conversation_id = ?
            ORDER BY sort_index ASC
            ",
        )
        .map_err(|error| format!("读取聊天记录失败: {error}"))?;

    let rows = statement
        .query_map([conversation_id], row_to_chat_message)
        .map_err(|error| format!("解析聊天记录失败: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("收集聊天记录失败: {error}"))
}

pub fn save_chat_messages(
    app: &AppHandle,
    conversation_id: &str,
    messages: &[ChatMessage],
) -> Result<ChatConversationSummary, String> {
    let mut connection = open_connection(app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开启聊天记录事务失败: {error}"))?;

    let now = current_timestamp_ms();
    let title = derive_conversation_title(messages);
    let existing_created_at = transaction
        .query_row(
            "SELECT created_at_ms FROM conversations WHERE id = ?",
            [conversation_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| format!("读取会话信息失败: {error}"))?
        .unwrap_or(now);

    transaction
        .execute(
            "
            INSERT INTO conversations (id, title, created_at_ms, updated_at_ms)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              updated_at_ms = excluded.updated_at_ms
            ",
            params![conversation_id, title, existing_created_at, now],
        )
        .map_err(|error| format!("保存会话信息失败: {error}"))?;

    transaction
        .execute(
            "DELETE FROM messages WHERE conversation_id = ?",
            [conversation_id],
        )
        .map_err(|error| format!("清理旧聊天记录失败: {error}"))?;

    for (index, message) in messages.iter().enumerate() {
        let tool_call_json = message
            .tool_call
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| format!("序列化工具调用失败: {error}"))?;

        transaction
            .execute(
                "
                INSERT INTO messages (
                  id, conversation_id, role, content, timestamp, created_at,
                  tool_call_json, streaming, sort_index
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ",
                params![
                    message.id,
                    conversation_id,
                    message.role,
                    message.content,
                    message.timestamp,
                    message.created_at,
                    tool_call_json,
                    if message.streaming.unwrap_or(false) { 1 } else { 0 },
                    index as i64,
                ],
            )
            .map_err(|error| format!("写入聊天消息失败: {error}"))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("提交聊天记录事务失败: {error}"))?;

    Ok(ChatConversationSummary {
        id: conversation_id.to_string(),
        title,
        created_at_ms: existing_created_at as u64,
        updated_at_ms: now as u64,
        message_count: messages.len() as u32,
    })
}

pub fn list_download_history(app: &AppHandle) -> Result<Vec<DownloadTask>, String> {
    let connection = open_connection(app)?;
    let mut statement = connection
        .prepare(
            "
            SELECT
              id, name, status, progress, speed, total_bytes, created_at_ms,
              file_path, source, download_url, aria2_gid
            FROM download_history
            ORDER BY sort_index ASC
            ",
        )
        .map_err(|error| format!("读取下载历史失败: {error}"))?;

    let rows = statement
        .query_map([], row_to_download_task)
        .map_err(|error| format!("解析下载历史失败: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("收集下载历史失败: {error}"))
}

pub fn save_download_history(app: &AppHandle, tasks: &[DownloadTask]) -> Result<(), String> {
    let mut connection = open_connection(app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开启下载历史事务失败: {error}"))?;

    transaction
        .execute("DELETE FROM download_history", [])
        .map_err(|error| format!("清理旧下载历史失败: {error}"))?;

    for (index, task) in tasks.iter().enumerate() {
        transaction
            .execute(
                "
                INSERT INTO download_history (
                  id, name, status, progress, speed, total_bytes, created_at_ms,
                  file_path, source, download_url, aria2_gid, sort_index
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ",
                params![
                    task.id,
                    task.name,
                    task.status,
                    task.progress as i64,
                    task.speed,
                    task.total_bytes.map(|value| value as i64),
                    task.created_at_ms.map(|value| value as i64),
                    task.file_path,
                    task.source,
                    task.download_url,
                    task.aria2_gid,
                    index as i64,
                ],
            )
            .map_err(|error| format!("写入下载历史失败: {error}"))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("提交下载历史事务失败: {error}"))
}

pub fn list_playlist_history(app: &AppHandle) -> Result<Vec<PlaylistItem>, String> {
    let connection = open_connection(app)?;
    let mut statement = connection
        .prepare(
            "
            SELECT id, title, source, kind, origin, added_at
            FROM playlist_history
            ORDER BY sort_index ASC
            ",
        )
        .map_err(|error| format!("读取播放历史失败: {error}"))?;

    let rows = statement
        .query_map([], row_to_playlist_item)
        .map_err(|error| format!("解析播放历史失败: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("收集播放历史失败: {error}"))
}

pub fn save_playlist_history(app: &AppHandle, items: &[PlaylistItem]) -> Result<(), String> {
    let mut connection = open_connection(app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开启播放历史事务失败: {error}"))?;

    transaction
        .execute("DELETE FROM playlist_history", [])
        .map_err(|error| format!("清理旧播放历史失败: {error}"))?;

    for (index, item) in items.iter().enumerate() {
        transaction
            .execute(
                "
                INSERT INTO playlist_history (
                  id, title, source, kind, origin, added_at, sort_index
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ",
                params![
                    item.id,
                    item.title,
                    item.source,
                    item.kind,
                    item.origin,
                    item.added_at,
                    index as i64,
                ],
            )
            .map_err(|error| format!("写入播放历史失败: {error}"))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("提交播放历史事务失败: {error}"))
}
