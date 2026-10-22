CREATE TABLE custom_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'openai',
  base_url TEXT NOT NULL,
  default_model TEXT NOT NULL,
  image_model TEXT NOT NULL DEFAULT '',
  auth_type TEXT NOT NULL DEFAULT 'bearer',
  ciphertext TEXT,
  iv TEXT,
  reasoning_style TEXT NOT NULL DEFAULT 'none',
  effort_levels TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE chats ADD COLUMN settings TEXT NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN settings TEXT NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
CREATE TABLE generated_images (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_generated_images_chat ON generated_images(chat_id);
CREATE TABLE generated_image_chunks (
  image_id TEXT NOT NULL REFERENCES generated_images(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (image_id,position)
);
