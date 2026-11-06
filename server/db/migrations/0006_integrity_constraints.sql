/* A-13: the database refuses what the code must never write. */

CREATE TABLE journal_lines_new (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    account_code TEXT NOT NULL,
    label TEXT NOT NULL,
    debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
    currency TEXT,
    original_amount INTEGER,
    exchange_rate REAL,
    created_at TEXT NOT NULL,
    CHECK (debit = 0 OR credit = 0)
  );

INSERT INTO journal_lines_new
    (id, entry_id, account_code, label, debit, credit, currency, original_amount, exchange_rate, created_at)
   SELECT id, entry_id, account_code, label, debit, credit, currency, original_amount, exchange_rate, created_at
   FROM journal_lines;

DROP TABLE journal_lines;

ALTER TABLE journal_lines_new RENAME TO journal_lines;

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(entry_id);

CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_code);

UPDATE currencies SET is_base = 0 WHERE is_base = 1 AND code <> 'XPF';

CREATE UNIQUE INDEX IF NOT EXISTS idx_currencies_single_base ON currencies(is_base) WHERE is_base = 1;

ALTER TABLE company ADD COLUMN singleton INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_singleton ON company(singleton);

CREATE TRIGGER IF NOT EXISTS trg_payments_amount_insert BEFORE INSERT ON payments
WHEN NEW.amount < 0 BEGIN SELECT RAISE(ABORT, 'PAYMENT_AMOUNT_NEGATIVE'); END;

CREATE TRIGGER IF NOT EXISTS trg_payments_amount_update BEFORE UPDATE ON payments
WHEN NEW.amount < 0 BEGIN SELECT RAISE(ABORT, 'PAYMENT_AMOUNT_NEGATIVE'); END;

CREATE TRIGGER IF NOT EXISTS trg_invoices_balance_insert BEFORE INSERT ON invoices
WHEN NEW.balance < 0 BEGIN SELECT RAISE(ABORT, 'INVOICE_BALANCE_NEGATIVE'); END;

CREATE TRIGGER IF NOT EXISTS trg_invoices_balance_update BEFORE UPDATE ON invoices
WHEN NEW.balance < 0 BEGIN SELECT RAISE(ABORT, 'INVOICE_BALANCE_NEGATIVE'); END;

CREATE TRIGGER IF NOT EXISTS trg_credits_total_insert BEFORE INSERT ON credits
WHEN NEW.total < 0 BEGIN SELECT RAISE(ABORT, 'CREDIT_TOTAL_NEGATIVE'); END;

CREATE TRIGGER IF NOT EXISTS trg_credits_total_update BEFORE UPDATE ON credits
WHEN NEW.total < 0 BEGIN SELECT RAISE(ABORT, 'CREDIT_TOTAL_NEGATIVE'); END;

CREATE TRIGGER IF NOT EXISTS trg_expenses_amount_insert BEFORE INSERT ON expenses
WHEN NEW.amount < 0 BEGIN SELECT RAISE(ABORT, 'EXPENSE_AMOUNT_NEGATIVE'); END;

CREATE TRIGGER IF NOT EXISTS trg_expenses_amount_update BEFORE UPDATE ON expenses
WHEN NEW.amount < 0 BEGIN SELECT RAISE(ABORT, 'EXPENSE_AMOUNT_NEGATIVE'); END;
