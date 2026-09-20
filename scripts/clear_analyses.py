#!/usr/bin/env python3
"""Supprime toutes les analyses CV de la base locale.
Usage: python scripts/clear_analyses.py
"""
from backend.config import Settings
import sqlite3
import sys

settings = Settings.from_env()
db_path = settings.database_path

print(f"Using database: {db_path}")
resp = input("Are you sure you want to DELETE ALL analyses? Type 'yes' to confirm: ")
if resp.strip().lower() != "yes":
    print("Aborted.")
    sys.exit(1)

conn = sqlite3.connect(str(db_path))
conn.execute("PRAGMA foreign_keys=ON")
try:
    conn.execute("BEGIN IMMEDIATE")
    # Delete all analyses; sections and token_usage will be removed by cascade.
    conn.execute("DELETE FROM analyses")
    conn.commit()
    conn.close()
    # Reclaim space
    conn2 = sqlite3.connect(str(db_path))
    conn2.execute("VACUUM")
    conn2.close()
    print("All analyses deleted.")
except Exception as e:
    print("Error:", e)
    try:
        conn.rollback()
        conn.close()
    except Exception:
        pass
    sys.exit(2)
