"""
FastAPI Server & WebSocket Gateway for Industrial Machine Stop Tracking
Strict hardware connectivity, multi-PLC profiles, dynamic tag mapping, and RBAC authentication.
"""

import os
import shutil
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from io import BytesIO

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Form, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from database import init_db, get_connection, hash_password
from engine import ProductionEngine

# Initialize database
init_db()

app = FastAPI(title="Industrial PLC Stop Tracking System", version="2.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads", "stops")
os.makedirs(UPLOAD_DIR, exist_ok=True)

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: Dict[str, Any]):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()
engine = ProductionEngine(broadcast_callback=manager.broadcast)

@app.on_event("startup")
async def startup_event():
    await engine.start()

@app.on_event("shutdown")
async def shutdown_event():
    await engine.stop()

# ----------------- Request Models -----------------
class LoginRequest(BaseModel):
    username: str
    password: str

class StartProductionRequest(BaseModel):
    pilot_id: int
    shift: str = "Morning"
    target_rate: float = 50.0
    notes: Optional[str] = None

class AssignmentRequest(BaseModel):
    operator_id: int
    machine_id: int
    assigned_by: int

class AnnotateStopRequest(BaseModel):
    reason_id: int
    operator_comment: Optional[str] = None
    annotated_by: int

class AddUserRequest(BaseModel):
    username: str
    password: str
    full_name: str
    role: str

class AddReasonRequest(BaseModel):
    category: str
    name: str
    code: str

class PlcConnectionRequest(BaseModel):
    name: str
    brand: str
    protocol: str
    ip_address: str
    port: int = 9600
    node_id: int = 1
    rack: int = 0
    slot: int = 1
    unit_id: int = 1

class MachineMappingRequest(BaseModel):
    name: str
    plc_id: int
    register_area: str
    status_register: int
    run_bit_word: Optional[int] = None
    run_bit_index: Optional[int] = None
    rate_register: Optional[int] = None

# ----------------- Auth Endpoints -----------------
@app.post("/api/auth/login")
def login(req: LoginRequest):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, username, full_name, role, password_hash FROM users WHERE username = ?", (req.username.strip(),))
    row = cur.fetchone()
    conn.close()

    if not row or row["password_hash"] != hash_password(req.password.strip()):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    return {
        "success": True,
        "token": f"token_{row['id']}_{int(datetime.now().timestamp())}",
        "user": {
            "id": row["id"],
            "username": row["username"],
            "full_name": row["full_name"],
            "role": row["role"]
        }
    }

@app.get("/api/auth/users")
def get_users():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, username, full_name, role, created_at FROM users ORDER BY role, username")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

@app.post("/api/auth/users")
def add_user(req: AddUserRequest):
    conn = get_connection()
    cur = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        cur.execute("""
            INSERT INTO users (username, password_hash, full_name, role, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (req.username.strip(), hash_password(req.password.strip()), req.full_name.strip(), req.role, now_iso))
        conn.commit()
        uid = cur.lastrowid
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Failed to create user: {str(e)}")
    conn.close()
    return {"success": True, "user_id": uid}

@app.delete("/api/auth/users/{user_id}")
def delete_user(user_id: int):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return {"success": True}

@app.post("/api/auth/users/{user_id}/reset-password")
def reset_password(user_id: int):
    new_pw = "123456"
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new_pw), user_id))
    conn.commit()
    conn.close()
    return {"success": True, "message": f"Password reset to '{new_pw}'"}

# ----------------- Multi-PLC Hardware Management -----------------
@app.get("/api/plcs")
def get_plcs():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM plc_connections ORDER BY id")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

@app.post("/api/plcs")
def add_plc(req: PlcConnectionRequest):
    conn = get_connection()
    cur = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        cur.execute("""
            INSERT INTO plc_connections (name, brand, protocol, ip_address, port, node_id, rack, slot, unit_id, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        """, (req.name, req.brand, req.protocol, req.ip_address, req.port, req.node_id, req.rack, req.slot, req.unit_id, now_iso))
        conn.commit()
        pid = cur.lastrowid
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=str(e))
    conn.close()
    return {"success": True, "plc_id": pid}

@app.put("/api/plcs/{plc_id}/activate")
async def activate_plc(plc_id: int):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("UPDATE plc_connections SET is_active = 0")
    cur.execute("UPDATE plc_connections SET is_active = 1 WHERE id = ?", (plc_id,))
    conn.commit()
    conn.close()

    engine.reload_config()
    if engine.fins_client:
        await engine.fins_client.connect(timeout=1.5)

    return {"success": True, "message": f"Activated PLC #{plc_id}"}

@app.delete("/api/plcs/{plc_id}")
def delete_plc(plc_id: int):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM plc_connections WHERE id = ?", (plc_id,))
    conn.commit()
    conn.close()
    engine.reload_config()
    return {"success": True}

# ----------------- Machine Tag & Address Mapping -----------------
@app.get("/api/machines")
def get_machines():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT m.*, p.name as plc_name, p.brand as plc_brand, p.protocol as plc_protocol, p.ip_address as plc_ip
        FROM machines m
        LEFT JOIN plc_connections p ON m.plc_id = p.id
        WHERE m.is_active = 1
        ORDER BY m.id
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

@app.put("/api/machines/{machine_id}/mapping")
def update_machine_mapping(machine_id: int, req: MachineMappingRequest):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        UPDATE machines
        SET name = ?, plc_id = ?, register_area = ?, status_register = ?,
            run_bit_word = ?, run_bit_index = ?, rate_register = ?
        WHERE id = ?
    """, (req.name, req.plc_id, req.register_area, req.status_register, req.run_bit_word, req.run_bit_index, req.rate_register, machine_id))
    conn.commit()
    conn.close()
    engine.reload_config()
    return {"success": True}

# ----------------- Production Gating -----------------
@app.get("/api/production/status")
def get_production_status():
    session = engine.get_active_session()
    return {
        "is_active": session is not None,
        "session": session
    }

@app.post("/api/production/start")
def start_production(req: StartProductionRequest):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id FROM production_sessions WHERE is_active=1")
    if cur.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Production session is already running.")

    now_iso = datetime.now(timezone.utc).isoformat()
    cur.execute("""
        INSERT INTO production_sessions (pilot_id, shift, started_at, is_active, target_rate, notes)
        VALUES (?, ?, ?, 1, ?, ?)
    """, (req.pilot_id, req.shift, now_iso, req.target_rate, req.notes))
    conn.commit()
    sid = cur.lastrowid
    conn.close()

    engine.active_production_session = engine.get_active_session()
    return {"success": True, "session_id": sid, "started_at": now_iso}

@app.post("/api/production/end")
def end_production(pilot_id: int = Query(...)):
    conn = get_connection()
    cur = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()
    cur.execute("""
        UPDATE production_sessions
        SET is_active = 0, ended_at = ?
        WHERE is_active = 1
    """, (now_iso,))
    conn.commit()
    conn.close()

    engine.active_stops.clear()
    engine.active_production_session = None
    return {"success": True, "ended_at": now_iso}

# ----------------- Line Assignments -----------------
@app.get("/api/assignments")
def get_assignments():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT oa.id, oa.operator_id, u.full_name as operator_name, u.username as operator_username,
               oa.machine_id, m.code as machine_code, m.name as machine_name,
               oa.assigned_at, p.full_name as assigned_by_name
        FROM operator_assignments oa
        JOIN users u ON oa.operator_id = u.id
        JOIN machines m ON oa.machine_id = m.id
        JOIN users p ON oa.assigned_by = p.id
        WHERE oa.is_active = 1
        ORDER BY m.id
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

@app.post("/api/assignments")
def create_assignment(req: AssignmentRequest):
    conn = get_connection()
    cur = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()
    cur.execute("UPDATE operator_assignments SET is_active=0 WHERE operator_id=? OR machine_id=?", (req.operator_id, req.machine_id))
    cur.execute("""
        INSERT INTO operator_assignments (operator_id, machine_id, assigned_by, assigned_at, is_active)
        VALUES (?, ?, ?, ?, 1)
    """, (req.operator_id, req.machine_id, req.assigned_by, now_iso))
    conn.commit()
    conn.close()
    return {"success": True}

# ----------------- Stop Annotations & Photo Upload -----------------
@app.get("/api/stops/active")
def get_active_stops():
    return list(engine.active_stops.values())

@app.get("/api/reasons")
def get_reasons():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM stop_reasons WHERE is_active = 1 ORDER BY category, name")
    reasons = [dict(r) for r in cur.fetchall()]
    conn.close()
    return reasons

@app.post("/api/reasons")
def add_reason(req: AddReasonRequest):
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO stop_reasons (category, name, code, is_active)
            VALUES (?, ?, ?, 1)
        """, (req.category, req.name, req.code))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=str(e))
    conn.close()
    return {"success": True}

@app.post("/api/stops/{stop_id}/annotate")
def annotate_stop(stop_id: int, req: AnnotateStopRequest):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT category, name FROM stop_reasons WHERE id = ?", (req.reason_id,))
    reason = cur.fetchone()
    if not reason:
        conn.close()
        raise HTTPException(status_code=404, detail="Reason not found")

    now_iso = datetime.now(timezone.utc).isoformat()
    cur.execute("""
        UPDATE stop_logs
        SET reason_id = ?, reason_category = ?, reason_name = ?,
            operator_comment = ?, annotated_by = ?, annotated_at = ?
        WHERE id = ?
    """, (req.reason_id, reason["category"], reason["name"], req.operator_comment, req.annotated_by, now_iso, stop_id))
    conn.commit()
    conn.close()

    for s in engine.active_stops.values():
        if s["stop_id"] == stop_id:
            s["reason_category"] = reason["category"]
            s["reason_name"] = reason["name"]
            s["operator_comment"] = req.operator_comment

    return {"success": True}

@app.post("/api/stops/{stop_id}/photo")
async def upload_stop_photo(stop_id: int, file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename)[1] or ".jpg"
    filename = f"stop_{stop_id}_{int(datetime.now().timestamp())}{ext}"
    dest_path = os.path.join(UPLOAD_DIR, filename)

    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    rel_url = f"/uploads/stops/{filename}"
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("UPDATE stop_logs SET photo_path = ? WHERE id = ?", (rel_url, stop_id))
    conn.commit()
    conn.close()

    for s in engine.active_stops.values():
        if s["stop_id"] == stop_id:
            s["photo_path"] = rel_url

    return {"success": True, "photo_url": rel_url}

# ----------------- History & Reports -----------------
@app.get("/api/stops/history")
def get_stop_history(
    machine_id: Optional[int] = None,
    shift: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 100
):
    conn = get_connection()
    cur = conn.cursor()
    query = """
        SELECT sl.id, sl.machine_id, m.code as machine_code, m.name as machine_name,
               sl.production_session_id, ps.shift,
               sl.start_time, sl.end_time, sl.duration_seconds,
               sl.state_code, sl.state_label,
               sl.reason_id, sl.reason_category, sl.reason_name,
               sl.operator_comment, sl.photo_path,
               u.full_name as operator_name, sl.annotated_at
        FROM stop_logs sl
        JOIN machines m ON sl.machine_id = m.id
        LEFT JOIN production_sessions ps ON sl.production_session_id = ps.id
        LEFT JOIN users u ON sl.annotated_by = u.id
        WHERE 1=1
    """
    params = []
    if machine_id:
        query += " AND sl.machine_id = ?"
        params.append(machine_id)
    if shift:
        query += " AND ps.shift = ?"
        params.append(shift)
    if date_from:
        query += " AND DATE(sl.start_time) >= DATE(?)"
        params.append(date_from)
    if date_to:
        query += " AND DATE(sl.start_time) <= DATE(?)"
        params.append(date_to)

    query += " ORDER BY sl.id DESC LIMIT ?"
    params.append(limit)

    cur.execute(query, params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

@app.get("/api/reports/export-excel")
def export_excel(
    machine_id: Optional[int] = None,
    shift: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None
):
    stops = get_stop_history(machine_id=machine_id, shift=shift, date_from=date_from, date_to=date_to, limit=5000)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Downtime_Stops"
    ws.views.sheetView[0].showGridLines = True

    ws.merge_cells("A1:K1")
    title_cell = ws["A1"]
    title_cell.value = "INDUSTRIAL STOP & DOWNTIME ANALYSIS REPORT"
    title_cell.font = Font(name="Segoe UI", size=13, bold=True, color="FFFFFF")
    title_cell.fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    title_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 32

    headers = [
        "Stop ID", "Machine Code", "Machine Name", "Shift", "Start Time",
        "End Time", "Duration (sec)", "Duration (min)", "Stop Status",
        "Reason Category", "Detailed Reason / Operator Notes"
    ]
    ws.row_dimensions[3].height = 22
    header_fill = PatternFill(start_color="334155", end_color="334155", fill_type="solid")
    header_font = Font(name="Segoe UI", size=9, bold=True, color="FFFFFF")
    border_thin = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )

    for col_idx, h in enumerate(headers, 1):
        c = ws.cell(row=3, column=col_idx, value=h)
        c.fill = header_fill
        c.font = header_font
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = border_thin

    row_idx = 4
    for s in stops:
        ws.row_dimensions[row_idx].height = 19
        dur_sec = s["duration_seconds"] or 0
        dur_min = round(dur_sec / 60.0, 2)
        notes = s["reason_name"] or "Pending Annotation"
        if s["operator_comment"]:
            notes += f" ({s['operator_comment']})"

        row_data = [
            s["id"],
            s["machine_code"],
            s["machine_name"],
            s["shift"] or "N/A",
            s["start_time"],
            s["end_time"] or "ONGOING",
            dur_sec,
            dur_min,
            s["state_label"],
            s["reason_category"] or "Unassigned",
            notes
        ]

        row_bg = "FFFFFF" if row_idx % 2 == 1 else "F8FAFC"
        row_fill = PatternFill(start_color=row_bg, end_color=row_bg, fill_type="solid")

        for col_idx, val in enumerate(row_data, 1):
            c = ws.cell(row=row_idx, column=col_idx, value=val)
            c.fill = row_fill
            c.font = Font(name="Segoe UI", size=9)
            c.border = border_thin
            if col_idx in [1, 7, 8]:
                c.alignment = Alignment(horizontal="right", vertical="center")
            elif col_idx in [2, 4, 9, 10]:
                c.alignment = Alignment(horizontal="center", vertical="center")
            else:
                c.alignment = Alignment(horizontal="left", vertical="center")

        row_idx += 1

    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            if cell.row < 3:
                continue
            if cell.value:
                max_len = max(max_len, len(str(cell.value)))
        ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

    output = BytesIO()
    wb.save(output)
    output.seek(0)

    filename = f"downtime_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# ----------------- Documentation Endpoint -----------------
@app.get("/api/system/docs")
def get_system_docs():
    doc_path = os.path.join(os.path.dirname(__file__), "PROJECT_SPECIFICATION_AND_CONVERSATION.md")
    if os.path.exists(doc_path):
        with open(doc_path, "r", encoding="utf-8") as f:
            return {"content": f.read()}
    return {"content": "# Documentation not found"}

# ----------------- WebSocket Live Telemetry -----------------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        kpis = engine.compute_daily_kpis()
        kpis["production_active"] = engine.active_production_session is not None
        kpis["production_session"] = engine.active_production_session
        kpis["active_stops"] = list(engine.active_stops.values())
        kpis["plc_connected"] = bool(engine.fins_client and engine.fins_client.connected)
        kpis["active_plc_info"] = engine.active_plc

        await websocket.send_json({
            "type": "SNAPSHOT",
            "data": kpis
        })

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static"), html=True), name="static")
