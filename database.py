"""
Database Schema and Storage Layer for Production Stop Tracking
Supports multi-PLC connections, dynamic tag mappings, and RBAC authentication.
"""

import sqlite3
import os
import hashlib
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "production.db")

def get_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def init_db():
    conn = get_connection()
    cur = conn.cursor()

    # Users Table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    """)

    # Multi-PLC Connections Table (Global commercial multi-brand support)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS plc_connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        brand TEXT NOT NULL, -- Omron, Modbus TCP, Siemens S7, Delta, Rockwell
        protocol TEXT NOT NULL, -- OMRON_FINS_TCP, MODBUS_TCP, SIEMENS_S7, DELTA_MODBUS
        ip_address TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 9600,
        node_id INTEGER NOT NULL DEFAULT 1,
        rack INTEGER DEFAULT 0,
        slot INTEGER DEFAULT 1,
        unit_id INTEGER DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
    );
    """)

    # Machines Table with dynamic register tag mappings
    cur.execute("""
    CREATE TABLE IF NOT EXISTS machines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        plc_id INTEGER,
        register_area TEXT NOT NULL DEFAULT 'DM', -- DM, WR, CIO, EM, HOLDING_REG, COIL, DB
        status_register INTEGER NOT NULL DEFAULT 1200,
        run_bit_word INTEGER,
        run_bit_index INTEGER,
        rate_register INTEGER DEFAULT 2050,
        is_active INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY(plc_id) REFERENCES plc_connections(id)
    );
    """)

    # Operator Line Assignments
    cur.execute("""
    CREATE TABLE IF NOT EXISTS operator_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operator_id INTEGER NOT NULL,
        machine_id INTEGER NOT NULL,
        assigned_by INTEGER NOT NULL,
        assigned_at TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY(operator_id) REFERENCES users(id),
        FOREIGN KEY(machine_id) REFERENCES machines(id),
        FOREIGN KEY(assigned_by) REFERENCES users(id)
    );
    """)

    # Production Sessions (Pilot gated tracking)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS production_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pilot_id INTEGER NOT NULL,
        shift TEXT NOT NULL DEFAULT 'Morning',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        target_rate REAL DEFAULT 50.0,
        notes TEXT,
        FOREIGN KEY(pilot_id) REFERENCES users(id)
    );
    """)

    # Stop Reasons Catalog
    cur.execute("""
    CREATE TABLE IF NOT EXISTS stop_reasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        is_active INTEGER NOT NULL DEFAULT 1
    );
    """)

    # Stop Logs
    cur.execute("""
    CREATE TABLE IF NOT EXISTS stop_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        machine_id INTEGER NOT NULL,
        production_session_id INTEGER,
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        state_code INTEGER NOT NULL,
        state_label TEXT NOT NULL,
        reason_id INTEGER,
        reason_category TEXT,
        reason_name TEXT,
        operator_comment TEXT,
        photo_path TEXT,
        annotated_by INTEGER,
        annotated_at TEXT,
        supervisor_reviewed INTEGER NOT NULL DEFAULT 0,
        supervisor_comment TEXT,
        FOREIGN KEY(machine_id) REFERENCES machines(id),
        FOREIGN KEY(production_session_id) REFERENCES production_sessions(id),
        FOREIGN KEY(reason_id) REFERENCES stop_reasons(id),
        FOREIGN KEY(annotated_by) REFERENCES users(id)
    );
    """)

    # Seed Default Users
    cur.execute("SELECT COUNT(*) as count FROM users")
    if cur.fetchone()["count"] == 0:
        now_iso = datetime.now(timezone.utc).isoformat()
        users_seed = [
            ("admin", hash_password("admin123"), "System Administrator", "admin", now_iso),
            ("director", hash_password("director123"), "Plant Operations Director", "director", now_iso),
            ("supervisor", hash_password("supervisor123"), "Production Supervisor", "supervisor", now_iso),
            ("pilot", hash_password("pilot123"), "Line Pilot (Production Lead)", "pilot", now_iso),
            ("operator1", hash_password("op123"), "Karim (Volcador Operator)", "operator", now_iso),
            ("operator2", hash_password("op123"), "Hassan (Fillers Operator)", "operator", now_iso),
            ("operator3", hash_password("op123"), "Youssef (Sizer Operator)", "operator", now_iso),
        ]
        cur.executemany("INSERT INTO users (username, password_hash, full_name, role, created_at) VALUES (?, ?, ?, ?, ?)", users_seed)

    # Seed PLC Connections (Omron factory line + global templates)
    cur.execute("SELECT COUNT(*) as count FROM plc_connections")
    if cur.fetchone()["count"] == 0:
        now_iso = datetime.now(timezone.utc).isoformat()
        plc_seed = [
            ("Morocco Packing Line 1 (Omron CJ2M)", "Omron", "OMRON_FINS_TCP", "192.168.111.99", 9600, 1, 0, 0, 1, 1, now_iso),
            ("Sorting Line Secondary (Modbus TCP)", "Modbus Standard", "MODBUS_TCP", "192.168.1.150", 502, 1, 0, 0, 1, 0, now_iso),
            ("Delta DVP Line Station (Delta Modbus)", "Delta Electronics", "DELTA_MODBUS", "192.168.1.160", 502, 1, 0, 0, 2, 0, now_iso),
            ("Palletizer Line (Siemens S7-1200)", "Siemens", "SIEMENS_S7", "192.168.1.200", 102, 1, 0, 1, 1, 0, now_iso),
        ]
        cur.executemany("""
            INSERT INTO plc_connections (name, brand, protocol, ip_address, port, node_id, rack, slot, unit_id, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, plc_seed)

    # Seed Machines linked to PLC connection 1
    cur.execute("SELECT COUNT(*) as count FROM machines")
    if cur.fetchone()["count"] == 0:
        cur.execute("SELECT id FROM plc_connections WHERE is_active=1 LIMIT 1")
        default_plc = cur.fetchone()["id"]
        machines_seed = [
            ("VOLC-01", "Box Tipper / Volcador Cajas", default_plc, "DM", 1200, 214, 3, 2068, 1),
            ("LLEN-01", "Box Filler 1 / Llenadora 1", default_plc, "DM", 1201, None, None, None, 1),
            ("LLEN-02", "Box Filler 2 / Llenadora 2", default_plc, "DM", 1202, None, None, None, 1),
            ("LLEN-03", "Box Filler 3 / Llenadora 3", default_plc, "DM", 1203, None, None, None, 1),
            ("CAL-01", "Central Sizer / Calibrador Principal", default_plc, "WR", 213, 213, 3, 2050, 1),
            ("DEST-01", "Waste Conveyor / Cinta Destríos", default_plc, "WR", 211, 211, 3, None, 1),
        ]
        cur.executemany("""
            INSERT INTO machines (code, name, plc_id, register_area, status_register, run_bit_word, run_bit_index, rate_register, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, machines_seed)

    # Seed Stop Reasons
    cur.execute("SELECT COUNT(*) as count FROM stop_reasons")
    if cur.fetchone()["count"] == 0:
        reasons_seed = [
            ("Mechanical", "Conveyor belt obstruction / mechanical jam", "MEC_JAM"),
            ("Mechanical", "Pneumatic cylinder fault / pressure drop", "MEC_PNEU"),
            ("Mechanical", "Roller chain misalignment / breakage", "MEC_CHAIN"),
            ("Electrical", "Emergency stop tripped / safety fence open", "ELEC_ESTOP"),
            ("Electrical", "Photocell reflection sensor blinded / dirty", "ELEC_PHOTO"),
            ("Electrical", "VFD Inverter motor overload trip", "ELEC_VFD"),
            ("Operational", "Empty box supply shortage from depalletizer", "OPS_BOX_DEP"),
            ("Operational", "Downstream accumulation saturation", "OPS_SAT"),
            ("Operational", "Defect fruit sorting purge", "OPS_FRUIT"),
            ("Quality & Prep", "Caliber grading recipe changeover", "CALIB_CHANGE"),
            ("Staff & Break", "Scheduled operator rotation / meal break", "STAFF_BREAK"),
            ("Cleaning", "Sanitation washdown & debris clearing", "CLEAN_WASH"),
        ]
        cur.executemany("INSERT INTO stop_reasons (category, name, code, is_active) VALUES (?, ?, ?, 1)", reasons_seed)

    # Default Operator Assignments
    cur.execute("SELECT COUNT(*) as count FROM operator_assignments")
    if cur.fetchone()["count"] == 0:
        now_iso = datetime.now(timezone.utc).isoformat()
        cur.execute("SELECT id FROM users WHERE username='pilot'")
        p_row = cur.fetchone()
        pid = p_row["id"] if p_row else 4

        cur.execute("SELECT id, code FROM machines")
        machs = {r["code"]: r["id"] for r in cur.fetchall()}
        cur.execute("SELECT id, username FROM users WHERE role='operator'")
        ops = {r["username"]: r["id"] for r in cur.fetchall()}

        assigns = []
        if "operator1" in ops and "VOLC-01" in machs:
            assigns.append((ops["operator1"], machs["VOLC-01"], pid, now_iso, 1))
        if "operator2" in ops and "LLEN-01" in machs:
            assigns.append((ops["operator2"], machs["LLEN-01"], pid, now_iso, 1))
        if "operator3" in ops and "CAL-01" in machs:
            assigns.append((ops["operator3"], machs["CAL-01"], pid, now_iso, 1))

        if assigns:
            cur.executemany("""
                INSERT INTO operator_assignments (operator_id, machine_id, assigned_by, assigned_at, is_active)
                VALUES (?, ?, ?, ?, ?)
            """, assigns)

    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("Database schema initialized.")
