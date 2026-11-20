"""
Industrial Stop Tracking Engine & Production Gating
Monitors PLC registers via strict hardware comms, enforces Pilot production session gating,
and dispatches real-time WebSocket events. Zero simulation.
"""

import asyncio
import time
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Callable

from database import get_connection
from fins_driver import OmronFinsTcpClient

logger = logging.getLogger("engine")

class ProductionEngine:
    def __init__(self, broadcast_callback: Optional[Callable[[Dict[str, Any]], Any]] = None):
        self.broadcast_callback = broadcast_callback
        self.running = False
        self.active_production_session: Optional[Dict[str, Any]] = None
        self.active_stops: Dict[str, Dict[str, Any]] = {}
        self.previous_states: Dict[str, bool] = {}
        self.machine_configs: List[Dict[str, Any]] = []
        self.active_plc: Optional[Dict[str, Any]] = None
        self.fins_client: Optional[OmronFinsTcpClient] = None
        self.last_reconnect_attempt: float = 0

    def reload_config(self):
        """Reloads active PLC connection and machine mappings from database."""
        conn = get_connection()
        cur = conn.cursor()
        
        # Load active PLC
        cur.execute("SELECT * FROM plc_connections WHERE is_active = 1 LIMIT 1")
        plc_row = cur.fetchone()
        self.active_plc = dict(plc_row) if plc_row else None

        # Load machines
        cur.execute("SELECT * FROM machines WHERE is_active = 1 ORDER BY id")
        self.machine_configs = [dict(r) for r in cur.fetchall()]
        conn.close()

        if self.active_plc:
            host = self.active_plc["ip_address"]
            port = self.active_plc["port"]
            node = self.active_plc["node_id"]
            if not self.fins_client or self.fins_client.host != host or self.fins_client.port != port or self.fins_client.plc_node != node:
                self.fins_client = OmronFinsTcpClient(host=host, port=port, plc_node=node)

    def get_active_session(self) -> Optional[Dict[str, Any]]:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT ps.*, u.full_name as pilot_name 
            FROM production_sessions ps
            JOIN users u ON ps.pilot_id = u.id
            WHERE ps.is_active=1
            ORDER BY ps.id DESC LIMIT 1
        """)
        row = cur.fetchone()
        conn.close()
        return dict(row) if row else None

    async def start(self):
        self.running = True
        self.reload_config()
        if self.fins_client:
            await self.fins_client.connect(timeout=1.5)
        asyncio.create_task(self._poll_loop())

    async def stop(self):
        self.running = False
        if self.fins_client:
            await self.fins_client.disconnect()

    async def _poll_loop(self):
        logger.info("Starting industrial hardware polling loop (1.0s interval)...")
        while self.running:
            try:
                # 1. Maintain PLC connection (attempt reconnect every 5s if disconnected)
                now_ts = time.time()
                if self.fins_client and not self.fins_client.connected:
                    if now_ts - self.last_reconnect_attempt > 5.0:
                        self.last_reconnect_attempt = now_ts
                        await self.fins_client.connect(timeout=1.0)

                # 2. Check production session gating status
                self.active_production_session = self.get_active_session()
                is_production_active = self.active_production_session is not None

                # 3. Poll machines from physical PLC
                machine_configs_for_driver = []
                for m in self.machine_configs:
                    machine_configs_for_driver.append({
                        "code": m["code"],
                        "name": m["name"],
                        "register_type": m["register_area"],
                        "register_addr": m["status_register"],
                        "run_bit_word": m["run_bit_word"],
                        "run_bit_index": m["run_bit_index"]
                    })

                poll_results = {}
                if self.fins_client:
                    poll_results = await self.fins_client.poll_all_machines(machine_configs_for_driver)
                else:
                    for mc in machine_configs_for_driver:
                        poll_results[mc["code"]] = {
                            "code": mc["code"],
                            "name": mc["name"],
                            "is_running": False,
                            "state_code": -1,
                            "state_text": "OFFLINE",
                            "state_desc": "No active PLC connection configured",
                            "raw_value": None,
                            "plc_online": False,
                            "timestamp": now_ts
                        }

                # 4. Process each machine
                now_dt = datetime.now(timezone.utc)
                now_iso = now_dt.isoformat()

                conn = get_connection()
                cur = conn.cursor()

                for code, status in poll_results.items():
                    is_running = status["is_running"]
                    prev_running = self.previous_states.get(code, False)
                    m_id = next((m["id"] for m in self.machine_configs if m["code"] == code), None)

                    # Stoppages are tracked strictly when:
                    # - Production is active
                    # - PLC is online and reported a valid state
                    if is_production_active and status["plc_online"]:
                        # Transition: RUNNING -> STOPPED / ALARM
                        if prev_running and not is_running:
                            if code not in self.active_stops:
                                cur.execute("""
                                    INSERT INTO stop_logs (
                                        machine_id, production_session_id, start_time,
                                        state_code, state_label, duration_seconds
                                    ) VALUES (?, ?, ?, ?, ?, 0)
                                """, (
                                    m_id,
                                    self.active_production_session["id"],
                                    now_iso,
                                    status["state_code"],
                                    status["state_text"]
                                ))
                                stop_id = cur.lastrowid
                                conn.commit()

                                self.active_stops[code] = {
                                    "stop_id": stop_id,
                                    "machine_id": m_id,
                                    "machine_code": code,
                                    "machine_name": status["name"],
                                    "start_time": now_iso,
                                    "start_timestamp": now_ts,
                                    "state_code": status["state_code"],
                                    "state_label": status["state_text"],
                                    "reason_category": None,
                                    "reason_name": None,
                                    "operator_comment": None,
                                    "photo_path": None
                                }

                                if self.broadcast_callback:
                                    await self.broadcast_callback({
                                        "type": "STOP_STARTED",
                                        "data": self.active_stops[code]
                                    })

                        # Transition: STOPPED -> RUNNING
                        elif not prev_running and is_running:
                            if code in self.active_stops:
                                active = self.active_stops.pop(code)
                                duration = int(now_ts - active["start_timestamp"])
                                cur.execute("""
                                    UPDATE stop_logs
                                    SET end_time = ?, duration_seconds = ?
                                    WHERE id = ?
                                """, (now_iso, duration, active["stop_id"]))
                                conn.commit()

                                if self.broadcast_callback:
                                    await self.broadcast_callback({
                                        "type": "STOP_ENDED",
                                        "data": {
                                            "stop_id": active["stop_id"],
                                            "machine_code": code,
                                            "duration_seconds": duration,
                                            "end_time": now_iso
                                        }
                                    })
                    else:
                        # Production is inactive or PLC disconnected
                        if not is_production_active and code in self.active_stops:
                            self.active_stops.pop(code, None)

                    # Update active stop live seconds
                    if code in self.active_stops:
                        self.active_stops[code]["current_duration"] = int(now_ts - self.active_stops[code]["start_timestamp"])

                    self.previous_states[code] = is_running

                conn.close()

                # 5. Read real rate register D2050 from Calibrador if online
                cycles_min = 0
                if self.fins_client and self.fins_client.connected:
                    rate_words = await self.fins_client.read_words(0x82, 2050, count=1)
                    if rate_words:
                        cycles_min = rate_words[0]

                # 6. Calculate KPIs
                kpis = self.compute_daily_kpis()
                kpis["cycles_per_minute"] = cycles_min
                kpis["production_active"] = is_production_active
                kpis["production_session"] = self.active_production_session
                kpis["active_stops"] = list(self.active_stops.values())
                kpis["machine_status"] = poll_results
                kpis["plc_connected"] = bool(self.fins_client and self.fins_client.connected)
                kpis["active_plc_info"] = self.active_plc

                # 7. Broadcast periodic tick
                if self.broadcast_callback:
                    await self.broadcast_callback({
                        "type": "TELEMETRY_TICK",
                        "data": kpis
                    })

            except Exception as e:
                logger.error(f"Error in engine poll loop: {e}", exc_info=True)

            await asyncio.sleep(1.0)

    def compute_daily_kpis(self) -> Dict[str, Any]:
        conn = get_connection()
        cur = conn.cursor()
        today_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        cur.execute("""
            SELECT 
                COUNT(*) as total_stops,
                COALESCE(SUM(duration_seconds), 0) as total_downtime_sec
            FROM stop_logs
            WHERE DATE(start_time) = DATE(?)
        """, (today_date,))
        row = cur.fetchone()
        total_stops = row["total_stops"] if row else 0
        total_downtime_sec = row["total_downtime_sec"] if row else 0

        # Add ongoing active stop durations
        active_extra_sec = sum(s.get("current_duration", 0) for s in self.active_stops.values())
        total_downtime_sec += active_extra_sec

        cur.execute("""
            SELECT COUNT(*) as unannotated
            FROM stop_logs
            WHERE DATE(start_time) = DATE(?) AND reason_name IS NULL
        """, (today_date,))
        unannotated = cur.fetchone()["unannotated"]

        conn.close()

        minutes = total_downtime_sec // 60
        seconds = total_downtime_sec % 60

        return {
            "total_stops_today": total_stops,
            "total_downtime_seconds": total_downtime_sec,
            "total_downtime_formatted": f"{minutes}m {seconds:02d}s",
            "active_stops_count": len(self.active_stops),
            "unannotated_stops_count": unannotated,
            "timestamp": time.time()
        }
