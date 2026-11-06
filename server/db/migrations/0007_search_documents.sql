INSERT INTO search_index(search_index)
 * VALUES('rebuild')

CREATE TABLE IF NOT EXISTS search_documents (
    kind TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (kind, ref_id)
  )

CREATE INDEX IF NOT EXISTS idx_search_documents_kind ON search_documents(kind)

CREATE TRIGGER IF NOT EXISTS search_clients_ai AFTER INSERT ON clients BEGIN
    INSERT INTO search_documents(kind, ref_id, title, body)
    VALUES ('client', new.id, new.display_name, ${clientBody})
    ON CONFLICT(kind, ref_id) DO UPDATE SET title = excluded.title, body = excluded.body;
  END

CREATE TRIGGER IF NOT EXISTS search_clients_au AFTER UPDATE ON clients BEGIN
    INSERT INTO search_documents(kind, ref_id, title, body)
    VALUES ('client', new.id, new.display_name, ${clientBody})
    ON CONFLICT(kind, ref_id) DO UPDATE SET title = excluded.title, body = excluded.body;
  END

CREATE TRIGGER IF NOT EXISTS search_clients_ad AFTER DELETE ON clients BEGIN
    DELETE FROM search_documents WHERE kind = 'client' AND ref_id = old.id;
  END

CREATE TRIGGER IF NOT EXISTS search_invoices_ai AFTER INSERT ON invoices BEGIN
    INSERT INTO search_documents(kind, ref_id, title, body)
    VALUES ('invoice', new.id, new.number,
      COALESCE(new.po_number, '') || ' ' || COALESCE(new.notes, ''))
    ON CONFLICT(kind, ref_id) DO UPDATE SET title = excluded.title, body = excluded.body;
  END

CREATE TRIGGER IF NOT EXISTS search_invoices_au AFTER UPDATE ON invoices BEGIN
    INSERT INTO search_documents(kind, ref_id, title, body)
    VALUES ('invoice', new.id, new.number,
      COALESCE(new.po_number, '') || ' ' || COALESCE(new.notes, ''))
    ON CONFLICT(kind, ref_id) DO UPDATE SET title = excluded.title, body = excluded.body;
  END

CREATE TRIGGER IF NOT EXISTS search_invoices_ad AFTER DELETE ON invoices BEGIN
    DELETE FROM search_documents WHERE kind = 'invoice' AND ref_id = old.id;
  END

CREATE TRIGGER IF NOT EXISTS search_quotes_ai AFTER INSERT ON quotes BEGIN
    INSERT INTO search_documents(kind, ref_id, title, body)
    VALUES ('quote', new.id, new.number, '')
    ON CONFLICT(kind, ref_id) DO UPDATE SET title = excluded.title, body = excluded.body;
  END

CREATE TRIGGER IF NOT EXISTS search_quotes_au AFTER UPDATE ON quotes BEGIN
    INSERT INTO search_documents(kind, ref_id, title, body)
    VALUES ('quote', new.id, new.number, '')
    ON CONFLICT(kind, ref_id) DO UPDATE SET title = excluded.title, body = excluded.body;
  END

CREATE TRIGGER IF NOT EXISTS search_quotes_ad AFTER DELETE ON quotes BEGIN
    DELETE FROM search_documents WHERE kind = 'quote' AND ref_id = old.id;
  END

CREATE TRIGGER IF NOT EXISTS search_products_ai AFTER INSERT ON products BEGIN
    INSERT INTO search_documents(kind, ref_id, title, body)
    VALUES ('product', new.id, new.name, ${productBody})
    ON CONFLICT(kind, ref_id) DO UPDATE SET title = excluded.title, body = excluded.body;
  END

CREATE TRIGGER IF NOT EXISTS search_products_au AFTER UPDATE ON products BEGIN
    INSERT INTO search_documents(kind, ref_id, title, body)
    VALUES ('product', new.id, new.name, ${productBody})
    ON CONFLICT(kind, ref_id) DO UPDATE SET title = excluded.title, body = excluded.body;
  END

CREATE TRIGGER IF NOT EXISTS search_products_ad AFTER DELETE ON products BEGIN
    DELETE FROM search_documents WHERE kind = 'product' AND ref_id = old.id;
  END

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    title, body, content='search_documents', content_rowid='rowid', ${TOKENIZER}
  )

CREATE TRIGGER IF NOT EXISTS search_index_ai AFTER INSERT ON search_documents BEGIN
    INSERT INTO search_index(rowid, title, body) VALUES (new.rowid, new.title, new.body);
  END

CREATE TRIGGER IF NOT EXISTS search_index_ad AFTER DELETE ON search_documents BEGIN
    INSERT INTO search_index(search_index, rowid, title, body)
    VALUES ('delete', old.rowid, old.title, old.body);
  END

CREATE TRIGGER IF NOT EXISTS search_index_au AFTER UPDATE ON search_documents BEGIN
    INSERT INTO search_index(search_index, rowid, title, body)
    VALUES ('delete', old.rowid, old.title, old.body);
    INSERT INTO search_index(rowid, title, body) VALUES (new.rowid, new.title, new.body);
  END

INSERT INTO search_index(search_index) VALUES('rebuild')

INSERT INTO search_index(search_index) VALUES('rebuild')
