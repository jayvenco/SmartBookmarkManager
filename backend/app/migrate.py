"""Tiny additive migrations: `create_all` never alters existing tables, so new columns are added here."""

ADDED_COLUMNS = {
    "bookmarks": [
        ("starred", "BOOLEAN NOT NULL DEFAULT 0"),
        ("pinned", "BOOLEAN NOT NULL DEFAULT 0"),
        ("image", "TEXT NOT NULL DEFAULT ''"),
        ("boards", "JSON NOT NULL DEFAULT '[]'"),
    ],
}


def migrate(engine) -> None:
    with engine.begin() as conn:
        for table, columns in ADDED_COLUMNS.items():
            existing = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            if not existing:
                continue  # table does not exist yet; create_all makes it complete
            for name, ddl in columns:
                if name not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
