#!/usr/bin/env python3
"""Supprime toutes les entrées du journal d'activité (table audit_events).
Usage: python scripts/clear_activity_log.py
"""
from backend.config import Settings
import sqlite3
import sys

settings = Settings.from_env()
db_path = settings.database_path

print(f"Using database: {db_path}")
resp = input("Are you sure you want to DELETE ALL audit events? Type 'yes' to confirm: ")
if resp.strip().lower() != "yes":
    print("Aborted.")
    sys.exit(1)

conn = sqlite3.connect(str(db_path))
conn.execute("PRAGMA foreign_keys=ON")
try:
    conn.execute("BEGIN IMMEDIATE")
    conn.execute("DELETE FROM audit_events")
    conn.commit()
    conn.close()
    # Reclaim space
    conn2 = sqlite3.connect(str(db_path))
    conn2.execute("VACUUM")
    conn2.close()
    print("All audit events deleted.")
except Exception as e:
    print("Error:", e)
    try:
        conn.rollback()
        conn.close()
    except Exception:
        pass
    sys.exit(2)
