"""
Omron FINS over TCP/IP Driver - Strict Hardware Comms
Target: Omron SYSMAC CS/CJ/CP/NJ series over FINS TCP (port 9600).
Strict hardware communication with zero simulation. If offline, reports DISCONNECTED.
"""

import asyncio
import struct
import logging
import time
from typing import Dict, Any, List, Optional

logger = logging.getLogger("fins_driver")

# Omron Memory Area Codes (Words)
AREA_DM = 0x82      # Data Memory (D)
AREA_WR = 0xB1      # Work Area (W)
AREA_EM0 = 0xA0     # Extended Memory Bank 0 (E0)
AREA_CIO = 0xB0     # Core I/O (CIO)

# State mapping from Omron ladder D1200-D1203 (estado_maq)
STATE_MAP = {
    0: ("STOPPED", "Machine is stopped / idle"),
    1: ("RUNNING", "Automatic production running"),
    2: ("MANUAL", "Manual operating mode"),
    3: ("ALARM", "Active fault / alarm stoppage"),
    4: ("SATURATION", "Line saturated / accumulation jam"),
    5: ("COMM_ERROR", "Fieldbus / network communication timeout"),
}

class OmronFinsTcpClient:
    """
    Direct Omron FINS TCP Client implementation according to
    Omron Communications Commands Reference Manual (W342 / W421).
    """

    def __init__(self, host: str = "192.168.111.99", port: int = 9600, plc_node: int = 1, client_node: int = 0):
        self.host = host
        self.port = port
        self.plc_node = plc_node
        self.client_node = client_node
        self.reader: Optional[asyncio.StreamReader] = None
        self.writer: Optional[asyncio.StreamWriter] = None
        self.sid = 1
        self.connected = False
        self.last_error: str = "Not connected"
        self._lock = asyncio.Lock()

    async def connect(self, timeout: float = 2.0) -> bool:
        """Attempts TCP connection and FINS node address handshake."""
        async with self._lock:
            try:
                # Close any dead connection
                if self.writer:
                    try:
                        self.writer.close()
                    except Exception:
                        pass
                    self.writer = None
                    self.reader = None

                self.reader, self.writer = await asyncio.wait_for(
                    asyncio.open_connection(self.host, self.port),
                    timeout=timeout
                )

                # FINS TCP Client Node Address Send Handshake:
                # 'FINS'(4) + Length(4) + Command(4) + ErrorCode(4) + ClientNode(4)
                handshake_cmd = struct.pack(
                    ">4sIIII",
                    b"FINS",
                    12,             # Remaining bytes: Command(4) + Err(4) + ClientNode(4) = 12
                    0x00000000,     # Client Node Address Data Send Command
                    0x00000000,     # Error code 0
                    self.client_node # 0 means auto-allocate node
                )
                self.writer.write(handshake_cmd)
                await self.writer.drain()

                resp = await asyncio.wait_for(self.reader.readexactly(24), timeout=timeout)
                magic, length, cmd, err, client_node, srv_node = struct.unpack(">4sIIIII", resp)

                if magic == b"FINS" and err == 0:
                    self.client_node = client_node
                    self.plc_node = srv_node if srv_node != 0 else self.plc_node
                    self.connected = True
                    self.last_error = ""
                    logger.info(f"Connected to Omron PLC at {self.host}:{self.port}. Client Node: {self.client_node}, PLC Node: {self.plc_node}")
                    return True
                else:
                    self.last_error = f"FINS Handshake rejected with code {err}"
                    logger.error(self.last_error)
            except Exception as e:
                self.last_error = f"PLC connection error: {type(e).__name__} ({e})"
                logger.warning(f"Omron PLC at {self.host}:{self.port} unreachable: {e}")

            self.connected = False
            return False

    async def disconnect(self):
        async with self._lock:
            if self.writer:
                try:
                    self.writer.close()
                    await self.writer.wait_closed()
                except Exception:
                    pass
            self.reader = None
            self.writer = None
            self.connected = False

    def _next_sid(self) -> int:
        self.sid = (self.sid + 1) % 255
        return self.sid or 1

    async def read_words(self, memory_area: int, address: int, count: int = 1) -> Optional[List[int]]:
        """
        Reads contiguous 16-bit registers using FINS 01 01 (Memory Area Read).
        Returns None if PLC is disconnected.
        """
        if not self.connected or not self.writer or not self.reader:
            return None

        async with self._lock:
            try:
                sid = self._next_sid()
                # Build FINS Frame Header (10 bytes)
                fins_header = struct.pack(
                    ">BBBBBBBBBB",
                    0x80,               # ICF: Command requiring response
                    0x00,               # RSV
                    0x02,               # GCT: Max 2 gateway hops
                    0x00,               # DNA: Local network
                    self.plc_node,      # DA1: Target PLC node
                    0x00,               # DA2: Unit 0 (CPU)
                    0x00,               # SNA: Source network (local)
                    self.client_node,   # SA1: Client node
                    0x00,               # SA2: Unit 0
                    sid                 # SID: Service ID
                )

                # Command: 01 01 (Memory Area Read)
                # Parameters: Area(1), Addr(2), Bit(1), Count(2)
                read_cmd = struct.pack(">HHBHBH", 0x0101, memory_area, address, 0x00, count)
                payload = fins_header + read_cmd

                # FINS TCP Frame: 'FINS'(4) + Length(4) + Command 0x00000002(4) + Error(4) + Payload
                tcp_frame = struct.pack(
                    ">4sIII",
                    b"FINS",
                    len(payload) + 8,
                    0x00000002,         # FINS frame send
                    0x00000000          # Error code
                ) + payload

                self.writer.write(tcp_frame)
                await self.writer.drain()

                # Read FINS TCP Header (16 bytes)
                tcp_hdr = await asyncio.wait_for(self.reader.readexactly(16), timeout=2.0)
                magic, frame_len, frame_cmd, frame_err = struct.unpack(">4sIII", tcp_hdr)
                if magic != b"FINS" or frame_err != 0:
                    raise IOError(f"FINS TCP Error code: {frame_err}")

                fins_resp = await asyncio.wait_for(self.reader.readexactly(frame_len - 8), timeout=2.0)
                if len(fins_resp) >= 14:
                    end_code = struct.unpack(">H", fins_resp[12:14])[0]
                    if end_code == 0x0000:
                        data_bytes = fins_resp[14:]
                        words = [struct.unpack(">H", data_bytes[i:i+2])[0] for i in range(0, len(data_bytes), 2)]
                        return words
                    else:
                        logger.warning(f"FINS Read End Code Error: 0x{end_code:04X}")
                        return None
            except Exception as e:
                logger.warning(f"PLC read failed: {e}")
                self.connected = False
                self.last_error = str(e)
                return None

    async def poll_all_machines(self, machine_configs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Polls configured machines and registers from the physical Omron PLC.
        If offline, sets state to OFFLINE with no fake data.
        """
        status_results = {}
        plc_is_up = self.connected

        for mc in machine_configs:
            m_id = mc["code"]
            reg_type = mc.get("register_type", "DM")
            reg_addr = mc.get("register_addr", 1200)
            run_bit_word = mc.get("run_bit_word", None)
            run_bit_index = mc.get("run_bit_index", None)

            if not plc_is_up:
                status_results[m_id] = {
                    "code": m_id,
                    "name": mc.get("name", m_id),
                    "is_running": False,
                    "state_code": -1,
                    "state_text": "OFFLINE",
                    "state_desc": f"PLC Disconnected ({self.host}:{self.port})",
                    "raw_value": None,
                    "plc_online": False,
                    "timestamp": time.time()
                }
                continue

            area_code = AREA_DM if reg_type == "DM" else AREA_WR
            words = await self.read_words(area_code, reg_addr, count=1)

            if words is None:
                # Comms dropped during read
                status_results[m_id] = {
                    "code": m_id,
                    "name": mc.get("name", m_id),
                    "is_running": False,
                    "state_code": -1,
                    "state_text": "COMM_LOSS",
                    "state_desc": "Communication lost during register read",
                    "raw_value": None,
                    "plc_online": False,
                    "timestamp": time.time()
                }
                continue

            raw_val = words[0]
            if run_bit_word is not None and run_bit_index is not None:
                w_words = await self.read_words(AREA_WR, run_bit_word, count=1)
                w_val = w_words[0] if w_words else 0
                bit_set = bool(w_val & (1 << run_bit_index))
                is_running = bit_set
                state_code = 1 if bit_set else 0
                state_text = "RUNNING" if bit_set else "STOPPED"
                state_desc = "Line in motion" if bit_set else "Line stopped"
            else:
                state_code = raw_val
                info = STATE_MAP.get(raw_val, ("UNKNOWN", f"PLC raw value: {raw_val}"))
                state_text = info[0]
                state_desc = info[1]
                is_running = (raw_val == 1)

            status_results[m_id] = {
                "code": m_id,
                "name": mc.get("name", m_id),
                "is_running": is_running,
                "state_code": state_code,
                "state_text": state_text,
                "state_desc": state_desc,
                "raw_value": raw_val,
                "plc_online": True,
                "timestamp": time.time()
            }

        return status_results
