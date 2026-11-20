# INDUSTRIAL PLC STOP MONITORING & MES APPLICATION
## Complete Technical Specification & Conversation Record
*Project Codename: PRT-SCADA (AEG Morocco Packing Line & Commercial Multi-PLC)*
*Generated on: 2026-11-20*

---

## 1. Executive Summary & Commercial Objective

The objective of this application is to deliver a commercial-grade, multi-tenant industrial SCADA / MES (Manufacturing Execution System) stop tracking application. The system connects directly to factory PLCs over local Ethernet, continuously polls machine state words and safety registers, enforces strict production gating, streams live telemetry to operators, supervisors, and directors via WebSockets, and logs stoppage root causes with photo evidence for continuous improvement.

While the primary production deployment is configured for the **Omron SYSMAC CJ2M PLC** at the **Morocco Packing Facility (`AEG001_AGV_Morocco_24R4N`)**, the application is architected for **global commercial multi-factory deployment**:
* The Administrator can register and switch between multiple PLC hardware connections (Omron FINS over TCP, Modbus TCP, Siemens S7comm, Delta Electronics Modbus, Rockwell EtherNet/IP).
* All machine registers, run status bits, and cycle rate addresses are dynamically mapped through an administrative user interface.

---

## 2. Chronological Conversation Record & Requirements Traceability

### Step 1: Diagnostics, PC Optimization, and Clean Host Setup
* The user requested an initial network and PC health check.
* Unnecessary startup and resource-draining software (Free Download Manager, Fing Network Scanner, Docker Desktop) were identified, terminated, and removed from automatic startup.
* The host environment was verified with Python 3.14 on Windows, connected to the local industrial subnet (`192.168.111.0/24`).

### Step 2: Global Commercial Multi-PLC Architecture
* **User Directive:** *"The type of communication... in the future I will provide this app for selling. There are multiple PLCs so the admin will choose one PLC in there, then the app will communicate... put the parameters and also put the addresses of the inputs that will be read by the app."*
* **Architectural Decision:** Built a generic driver abstraction layer with database-backed PLC profiles (`plc_connections`) and dynamic register mappings (`machines`), supporting Omron, Modbus, Siemens, and Delta protocols.

### Step 3: Real-Time Dashboard & WebSocket Streaming
* **User Directive:** *"There is the dashboard that will kill us... how many stops for today, the time... the dashboard of course will be live, so it counts live."*
* **Architectural Decision:** Implemented native WebSocket bi-directional streaming at `/ws`, updating today's stop count, cumulative downtime, active stop stopwatches, and machine statuses every second.

### Step 4: Strict Role-Based Access Control (RBAC) & Authentication
* **User Directive:** *"Why should choose the user? Isn't there a pass? Isn't there something?"*
* **Architectural Decision:** Implemented a secure authentication gateway (`/api/auth/login`) with username and password verification. Removed client-side role dropdowns in favor of authenticated role sessions.

#### 5-Tier User Permissions Matrix:
1. **Director**:
   * Restricted strictly to **two screens**:
     * Live KPI Dashboard.
     * Downtime Reports & Export screen with multi-parameter filters (Shift, Date range, Machine) and 1-click **Download Excel (`.xlsx`)**.
2. **Supervisor**:
   * Live KPI Dashboard.
   * Historical Stop Logs review and annotation review.
   * Stoppage Reasons catalog management (adding/editing root causes).
   * User Management Console (Create user, Delete user, and a single-click **Reset Password** button to reset passwords to default).
3. **Pilot (Production Lead)**:
   * **Production Gating Controller:** Controls the **Start Production** and **End Production** toggle. Machine stops and alarms are **only counted and recorded in official KPIs when Pilot production is started**. Stops during setup, cleaning, or breaks prior to production start are ignored.
   * **Line Allocation:** Assigns operators to their designated machines.
   * Live KPI Dashboard and Historical Stop Logs.
4. **Operator**:
   * Clean, distraction-free interface restricted **only to the machine assigned by the Pilot**.
   * Live status indicator and downtime stopwatch when their machine halts.
   * Stoppage reason classifier, notes input, and **HTML5 camera snapshot / photo upload** for visual defect evidence.
5. **System Administrator**:
   * Full access to all modules.
   * Hardware Management: Adding and configuring PLC profiles (IP, Port, Node, Rack, Slot, Unit ID).
   * Dynamic Tag Mapping: Assigning machines to PLCs and configuring memory areas (`DM`, `WR`, `CIO`), status registers, run bits, and cycle registers.

### Step 5: Strict Hardware Comms (Zero Simulation Fallback)
* **User Directive:** *"For the part of the simulation, I don't want the simulation. I want the PLC to be connected with the app. If it's not connected, it will show in the mean."*
* **Architectural Decision:** Completely eliminated simulation fallback code. The driver strictly talks to the physical hardware (`192.168.111.99:9600`). If hardware is unreachable or disconnected, the application unambiguously reports `PLC DISCONNECTED / OFFLINE` across all status badges and machine cards.

### Step 6: Professional Enterprise UI (Standard Proportions)
* **User Directive:** *"The front end should be beautiful and should not look like it was built with AI... do not make the buttons and the interface look bigger like the AI does. It should be simple, standard, good, and working."*
* **Architectural Decision:** Crafted an authentic, high-contrast European industrial SCADA interface using standard system typography, 32px standard button heights, crisp borders, and a professional enterprise slate color scheme.

---

## 3. Omron Memory Map & CX-Programmer Logic

Extracted directly from the plant documentation (`addresses.pdf` and `PRGR.pdf` for project `AEG001_AGV_Morocco_24R4N`):

### Machine State Words (`estado_maq` in DM Data Memory):
* **`D1200`**: Volcador Cajas Llenas / Box Tipper (`estado_maq[0]`)
* **`D1201`**: Llenadora Automática 1 / Automatic Box Filler 1 (`estado_maq[1]`)
* **`D1202`**: Llenadora Automática 2 / Automatic Box Filler 2 (`estado_maq[2]`)
* **`D1203`**: Llenadora Automática 3 / Automatic Box Filler 3 (`estado_maq[3]`)

#### PLC State Values (MOV instruction decoding from ladder):
* `&0`: **STOPPED / PARADA** (Neither auto nor manual)
* `&1`: **RUNNING / AUTOMÁTICO** (Normal production cycle)
* `&2`: **MANUAL** (Manual operator jogging / maintenance)
* `&3`: **ALARM / DEFECT** (`alarma_pantalla` active fault)
* `&4`: **SATURATION / JAM** (Downstream line accumulation)
* `&5`: **COMMUNICATION ERROR** (`tim_red` network timeout)

### Group Running Bits (Work Area `WR`):
* `W211.03`: Group 1 Running (Destríos / Waste Sorting Conveyor)
* `W212.03`: Group 2 Running (Salidas / Box Outfeed Lines)
* `W213.03`: Group 3 Running (Calibrador / Main Fruit Sizer)
* `W214.03`: Group 4 Running (Volcador / Box Tipper Infeed)

### Performance & Rate Registers:
* `D2050`: Cycles per minute (REAL IEEE float / integer) - Calibrador production rate
* `D2052`: Cycles per hour (REAL)
* `D2058`: Partial cycle counter
* `D2080`: Total cumulative cycle counter
* `D2068`: Box count in tipper

### Alarm Bits:
* `W400.00` – `W400.15`: Safety Circuit & Emergency Stops (`ARRÊT D'URGENCE`)
* `W401.00` – `W419.15`: Drives, VFDs, motors, photocells, and communication alarms (`DÉFAUT CONNEXION`)

---

## 4. Database Schema Specification (`data/production.db`)

* `users`: `id`, `username`, `password_hash`, `full_name`, `role`, `created_at`
* `plc_connections`: `id`, `name`, `brand`, `protocol`, `ip_address`, `port`, `node_id`, `rack`, `slot`, `unit_id`, `is_active`, `created_at`
* `machines`: `id`, `code`, `name`, `plc_id`, `register_area`, `status_register`, `run_bit_word`, `run_bit_index`, `rate_register`, `is_active`
* `operator_assignments`: `id`, `operator_id`, `machine_id`, `assigned_by`, `assigned_at`, `is_active`
* `production_sessions`: `id`, `pilot_id`, `shift`, `started_at`, `ended_at`, `is_active`, `target_rate`, `notes`
* `stop_logs`: `id`, `machine_id`, `production_session_id`, `start_time`, `end_time`, `duration_seconds`, `state_code`, `state_label`, `reason_id`, `reason_category`, `reason_name`, `operator_comment`, `photo_path`, `annotated_by`, `annotated_at`, `supervisor_reviewed`, `supervisor_comment`
* `stop_reasons`: `id`, `category`, `name`, `code`, `is_active`

---

## 5. REST & WebSocket API Specification

* **Auth Gateway**:
  * `POST /api/auth/login`: Authenticate with `{ username, password }`
  * `GET /api/auth/users`: List users (Supervisor/Admin)
  * `POST /api/auth/users`: Add user account
  * `DELETE /api/auth/users/{id}`: Delete user
  * `POST /api/auth/users/{id}/reset-password`: Single-click password reset to default (`123456`)
* **Multi-PLC Management**:
  * `GET /api/plcs`: Retrieve all configured PLC profiles
  * `POST /api/plcs`: Register a new PLC connection
  * `PUT /api/plcs/{id}/activate`: Switch active factory PLC
  * `DELETE /api/plcs/{id}`: Remove PLC connection
* **Dynamic Machine Tag Mapping**:
  * `GET /api/machines`: List machines with assigned PLC parameters
  * `PUT /api/machines/{id}/mapping`: Update memory registers, bits, and areas
* **Production Gating**:
  * `GET /api/production/status`: Current production state and active session details
  * `POST /api/production/start`: Pilot starts shift production
  * `POST /api/production/end`: Pilot stops shift production
* **Operator Stations & Annotations**:
  * `GET /api/assignments`: Active operator-to-line assignments
  * `POST /api/assignments`: Pilot assigns operator to machine
  * `GET /api/stops/active`: Ongoing stoppage incidents
  * `POST /api/stops/{id}/annotate`: Operator submits root cause and comment
  * `POST /api/stops/{id}/photo`: Upload defect camera snapshot
  * `GET /api/reasons`: Fetch root causes catalog
  * `POST /api/reasons`: Supervisor adds new root cause
* **Reporting & Export**:
  * `GET /api/stops/history`: Filtered stop logs
  * `GET /api/reports/export-excel`: Generate formatted `.xlsx` workbook
* **Live Telemetry Gateway**:
  * `WebSocket /ws`: Bi-directional real-time feed broadcasting live KPIs, stopwatch ticks, and machine state transitions every 1 second.
