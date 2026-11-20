/**
 * AGV Morocco Packing Line SCADA & Stop Monitoring
 * Real-time Hardware Telemetry, Strict RBAC Authentication & Multi-PLC Management
 */

// Application State
const state = {
  currentUser: null, // { id, username, full_name, role }
  authToken: null,
  activeTab: "dashboard",
  ws: null,
  machines: [],
  activeStops: [],
  productionActive: false,
  productionSession: null,
  stopReasons: [],
  plcConnections: [],
  selectedStopForPhoto: null,
  mediaStream: null
};

// Available tabs per authenticated role
const ROLE_TABS = {
  director: [
    { id: "dashboard", label: "Dashboard (Live KPIs)" },
    { id: "reports", label: "Downtime Reports & Excel Export" },
    { id: "docs", label: "Documentation & Specs" }
  ],
  supervisor: [
    { id: "dashboard", label: "Dashboard (Live KPIs)" },
    { id: "history", label: "Historical Stop Logs" },
    { id: "supervisor", label: "User Management & Reasons" },
    { id: "docs", label: "Documentation & Specs" }
  ],
  pilot: [
    { id: "dashboard", label: "Dashboard (Live KPIs)" },
    { id: "pilot", label: "Production Session & Line Allocations" },
    { id: "history", label: "Historical Stop Logs" },
    { id: "docs", label: "Documentation & Specs" }
  ],
  operator: [
    { id: "operator", label: "My Assigned Line Station" },
    { id: "docs", label: "Documentation & Specs" }
  ],
  admin: [
    { id: "dashboard", label: "Dashboard (Live KPIs)" },
    { id: "reports", label: "Reports & Export" },
    { id: "pilot", label: "Pilot & Lines" },
    { id: "supervisor", label: "Supervisor & Users" },
    { id: "history", label: "Historical Logs" },
    { id: "admin", label: "Multi-PLC & Tag Mapping" },
    { id: "docs", label: "Documentation & Specs" }
  ]
};

// DOM References
const el = {
  loginScreen: document.getElementById("login-screen"),
  loginForm: document.getElementById("login-form"),
  loginUsername: document.getElementById("login-username"),
  loginPassword: document.getElementById("login-password"),
  loginErrorMsg: document.getElementById("login-error-msg"),

  appScreen: document.getElementById("app-screen"),
  userDisplay: document.getElementById("user-display"),
  btnLogout: document.getElementById("btn-logout"),
  liveClock: document.getElementById("live-clock"),
  topbarPlcBadge: document.getElementById("topbar-plc-badge"),
  plcPill: document.getElementById("plc-status-pill"),
  plcText: document.getElementById("plc-status-text"),
  prodPill: document.getElementById("prod-status-pill"),
  prodText: document.getElementById("prod-status-text"),
  prodBanner: document.getElementById("production-banner"),
  bannerTitle: document.getElementById("banner-title"),
  bannerDesc: document.getElementById("banner-desc"),
  bannerDot: document.getElementById("banner-dot"),
  bannerActionWrap: document.getElementById("banner-action-wrap"),
  navTabs: document.getElementById("nav-tabs"),

  // KPI
  kpiStopsToday: document.getElementById("kpi-stops-today"),
  kpiDowntime: document.getElementById("kpi-downtime"),
  kpiActiveStops: document.getElementById("kpi-active-stops"),
  kpiActiveFooter: document.getElementById("kpi-active-footer"),
  kpiUnannotated: document.getElementById("kpi-unannotated-text"),
  kpiCycleRate: document.getElementById("kpi-cycle-rate"),
  driverModeTag: document.getElementById("driver-mode-tag"),
  machineGrid: document.getElementById("machine-cards-grid"),
  activeStopsTbody: document.getElementById("active-stops-tbody"),

  // Reports
  reportShift: document.getElementById("report-shift"),
  reportDateFrom: document.getElementById("report-date-from"),
  reportDateTo: document.getElementById("report-date-to"),
  reportMachine: document.getElementById("report-machine"),
  btnApplyReportFilter: document.getElementById("btn-apply-report-filter"),
  btnDownloadExcel: document.getElementById("btn-download-excel"),
  reportPreviewTbody: document.getElementById("report-preview-tbody"),

  // Pilot
  pilotStatusText: document.getElementById("pilot-session-status-text"),
  pilotSessionMeta: document.getElementById("pilot-session-meta"),
  pilotSessionBtns: document.getElementById("pilot-session-btns"),
  pilotShiftSelect: document.getElementById("pilot-shift-select"),
  pilotTargetRate: document.getElementById("pilot-target-rate"),
  pilotAssignmentsTbody: document.getElementById("pilot-assignments-tbody"),

  // Supervisor
  supervisorUsersTbody: document.getElementById("supervisor-users-tbody"),
  supervisorReasonsTbody: document.getElementById("supervisor-reasons-tbody"),
  btnOpenAddUser: document.getElementById("btn-open-add-user"),
  btnOpenAddReason: document.getElementById("btn-open-add-reason"),

  // History
  historyStopsTbody: document.getElementById("history-stops-tbody"),
  btnRefreshHistory: document.getElementById("btn-refresh-history"),

  // Operator
  opAssignedBadge: document.getElementById("op-assigned-machine-badge"),
  opMachineTitle: document.getElementById("op-machine-title"),
  opMachineDesc: document.getElementById("op-machine-desc"),
  opStatusBadge: document.getElementById("op-status-badge"),
  opStopwatchBox: document.getElementById("op-stopwatch-box"),
  opStopwatchTimer: document.getElementById("op-stopwatch-timer"),
  opReasonSelect: document.getElementById("op-reason-select"),
  opNotesInput: document.getElementById("op-notes-input"),
  opBtnOpenCamera: document.getElementById("op-btn-open-camera"),
  opBtnSaveAnnotation: document.getElementById("op-btn-save-annotation"),
  opPhotoPreviewWrap: document.getElementById("op-photo-preview-wrap"),
  opPhotoPreviewImg: document.getElementById("op-photo-preview-img"),

  // Admin
  adminPlcTbody: document.getElementById("admin-plc-tbody"),
  adminMappingTbody: document.getElementById("admin-mapping-tbody"),
  btnOpenAddPlc: document.getElementById("btn-open-add-plc"),

  // Docs
  docsContentBody: document.getElementById("docs-content-body"),
  btnRefreshDocs: document.getElementById("btn-refresh-docs"),

  // Modals
  modalCamera: document.getElementById("modal-camera"),
  cameraVideo: document.getElementById("camera-video"),
  cameraCanvas: document.getElementById("camera-canvas"),
  cameraFallbackMsg: document.getElementById("camera-fallback-msg"),
  btnSnapCamera: document.getElementById("btn-snap-camera"),
  cameraFileInput: document.getElementById("camera-file-input"),
  btnCloseCamera: document.getElementById("btn-close-camera"),
  btnCancelCamera: document.getElementById("btn-cancel-camera"),
  btnSaveCameraPhoto: document.getElementById("btn-save-camera-photo"),

  modalAnnotate: document.getElementById("modal-annotate"),
  modalAnnotateStopId: document.getElementById("modal-annotate-stop-id"),
  modalAnnotateReason: document.getElementById("modal-annotate-reason"),
  modalAnnotateComment: document.getElementById("modal-annotate-comment"),
  btnCloseAnnotate: document.getElementById("btn-close-annotate"),
  btnCancelAnnotate: document.getElementById("btn-cancel-annotate"),
  btnSubmitAnnotate: document.getElementById("btn-submit-annotate"),

  modalAddUser: document.getElementById("modal-add-user"),
  newUsername: document.getElementById("new-user-username"),
  newFullname: document.getElementById("new-user-fullname"),
  newPassword: document.getElementById("new-user-password"),
  newUserRole: document.getElementById("new-user-role"),
  btnCloseAddUser: document.getElementById("btn-close-add-user"),
  btnCancelAddUser: document.getElementById("btn-cancel-add-user"),
  btnSubmitAddUser: document.getElementById("btn-submit-add-user"),

  modalAddReason: document.getElementById("modal-add-reason"),
  newReasonCat: document.getElementById("new-reason-category"),
  newReasonName: document.getElementById("new-reason-name"),
  newReasonCode: document.getElementById("new-reason-code"),
  btnCloseAddReason: document.getElementById("btn-close-add-reason"),
  btnCancelAddReason: document.getElementById("btn-cancel-add-reason"),
  btnSubmitAddReason: document.getElementById("btn-submit-add-reason"),

  modalAddPlc: document.getElementById("modal-add-plc"),
  newPlcName: document.getElementById("new-plc-name"),
  newPlcBrand: document.getElementById("new-plc-brand"),
  newPlcProtocol: document.getElementById("new-plc-protocol"),
  newPlcIp: document.getElementById("new-plc-ip"),
  newPlcPort: document.getElementById("new-plc-port"),
  newPlcNode: document.getElementById("new-plc-node"),
  newPlcUnit: document.getElementById("new-plc-unit"),
  btnCloseAddPlc: document.getElementById("btn-close-add-plc"),
  btnCancelAddPlc: document.getElementById("btn-cancel-add-plc"),
  btnSubmitAddPlc: document.getElementById("btn-submit-add-plc"),

  modalEditMapping: document.getElementById("modal-edit-mapping"),
  editMappingId: document.getElementById("edit-mapping-id"),
  editMappingName: document.getElementById("edit-mapping-name"),
  editMappingPlc: document.getElementById("edit-mapping-plc"),
  editMappingArea: document.getElementById("edit-mapping-area"),
  editMappingStatusReg: document.getElementById("edit-mapping-status-reg"),
  editMappingRunWord: document.getElementById("edit-mapping-run-word"),
  editMappingRunBit: document.getElementById("edit-mapping-run-bit"),
  editMappingRateReg: document.getElementById("edit-mapping-rate-reg"),
  btnCloseEditMapping: document.getElementById("btn-close-edit-mapping"),
  btnCancelEditMapping: document.getElementById("btn-cancel-edit-mapping"),
  btnSubmitEditMapping: document.getElementById("btn-submit-edit-mapping")
};

function formatDuration(sec) {
  if (!sec || sec < 0) return "00:00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateClock() {
  const now = new Date();
  el.liveClock.textContent = now.toTimeString().split(' ')[0] + " UTC";
}
setInterval(updateClock, 1000);
updateClock();

// ----------------- Authentication Handlers -----------------
async function handleLogin(e) {
  e.preventDefault();
  const username = el.loginUsername.value.trim();
  const password = el.loginPassword.value.trim();
  el.loginErrorMsg.style.display = "none";

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Authentication failed");

    state.currentUser = data.user;
    state.authToken = data.token;
    localStorage.setItem("prt_auth_user", JSON.stringify(data.user));
    localStorage.setItem("prt_auth_token", data.token);

    initAuthenticatedApp();
  } catch (err) {
    el.loginErrorMsg.textContent = err.message;
    el.loginErrorMsg.style.display = "block";
  }
}

function handleLogout() {
  localStorage.removeItem("prt_auth_user");
  localStorage.removeItem("prt_auth_token");
  state.currentUser = null;
  state.authToken = null;
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  el.appScreen.style.display = "none";
  el.loginScreen.style.display = "flex";
  el.loginPassword.value = "";
}

function initAuthenticatedApp() {
  el.loginScreen.style.display = "none";
  el.appScreen.style.display = "flex";

  const user = state.currentUser;
  el.userDisplay.textContent = `${user.full_name} (${user.role.toUpperCase()})`;

  // Render tabs authorized for this user's role
  const tabs = ROLE_TABS[user.role] || ROLE_TABS.director;
  el.navTabs.innerHTML = "";
  tabs.forEach((tab, index) => {
    const btn = document.createElement("button");
    btn.className = `nav-tab ${index === 0 ? "active" : ""}`;
    btn.textContent = tab.label;
    btn.onclick = () => switchTab(tab.id);
    btn.dataset.tabId = tab.id;
    el.navTabs.appendChild(btn);
  });

  switchTab(tabs[0].id);
  initWebSocket();
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll(".nav-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tabId === tabId);
  });

  document.querySelectorAll(".app-view").forEach(v => {
    v.style.display = "none";
  });
  const activeView = document.getElementById(`view-${tabId}`);
  if (activeView) activeView.style.display = "block";

  if (tabId === "reports") loadReportPreview();
  if (tabId === "pilot") loadAssignments();
  if (tabId === "supervisor") { loadUsers(); loadReasons(); }
  if (tabId === "history") loadHistoricalStops();
  if (tabId === "operator") loadOperatorAssignedLine();
  if (tabId === "admin") { loadAdminPlcs(); loadAdminMappings(); }
  if (tabId === "docs") loadSystemDocs();
}

// ----------------- WebSocket Live Telemetry -----------------
function initWebSocket() {
  if (state.ws) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "SNAPSHOT" || msg.type === "TELEMETRY_TICK") {
        updateTelemetryUI(msg.data);
      }
    } catch (err) {
      console.error("WS Parse error:", err);
    }
  };

  state.ws.onclose = () => {
    el.plcPill.innerHTML = `<span class="dot dot-red"></span><span>PLC OFFLINE</span>`;
    state.ws = null;
    if (state.currentUser) setTimeout(initWebSocket, 2000);
  };
}

function updateTelemetryUI(data) {
  // 1. Connection status from hardware
  const isConnected = Boolean(data.plc_connected);
  const activePlc = data.active_plc_info;

  if (isConnected && activePlc) {
    el.plcPill.innerHTML = `<span class="dot dot-green"></span><span>${activePlc.brand.toUpperCase()} ONLINE</span>`;
    el.topbarPlcBadge.textContent = `${activePlc.protocol}`;
    el.driverModeTag.textContent = `PLC: ${activePlc.name} (${activePlc.ip_address}:${activePlc.port})`;
  } else {
    const ip = activePlc ? activePlc.ip_address : "192.168.111.99";
    const port = activePlc ? activePlc.port : 9600;
    el.plcPill.innerHTML = `<span class="dot dot-red"></span><span>PLC OFFLINE (${ip})</span>`;
    el.driverModeTag.textContent = `PLC: DISCONNECTED (${ip}:${port})`;
  }

  // 2. Production Gating Status
  state.productionActive = data.production_active;
  state.productionSession = data.production_session;

  if (state.productionActive) {
    el.prodBanner.className = "prod-banner active";
    el.bannerDot.className = "dot dot-green";
    el.bannerTitle.textContent = `PRODUCTION RUNNING • ${state.productionSession?.shift || 'Current'} Shift`;
    el.bannerDesc.textContent = `Started by ${state.productionSession?.pilot_name || 'Pilot'}. Machine stops and alarm faults are actively logged.`;
    el.prodPill.innerHTML = `<span class="dot dot-green"></span><span>PRODUCTION ACTIVE</span>`;

    el.pilotStatusText.textContent = "RUNNING (ACTIVE)";
    el.pilotStatusText.style.color = "#34d399";
    el.pilotSessionMeta.textContent = `Shift: ${state.productionSession?.shift} | Started: ${new Date(state.productionSession?.started_at).toLocaleTimeString()}`;
    el.pilotSessionBtns.innerHTML = `<button class="btn btn-danger btn-sm" onclick="endProductionSession()">End Production Shift</button>`;
  } else {
    el.prodBanner.className = "prod-banner inactive";
    el.bannerDot.className = "dot dot-red";
    el.bannerTitle.textContent = "PRODUCTION IS STOPPED / IDLE";
    el.bannerDesc.textContent = "Pilot has not started active production. Machine stops and faults are currently ignored to prevent false downtime penalties during setup/cleaning.";
    el.prodPill.innerHTML = `<span class="dot dot-red"></span><span>PRODUCTION IDLE</span>`;

    el.pilotStatusText.textContent = "INACTIVE / STOPPED";
    el.pilotStatusText.style.color = "#ef4444";
    el.pilotSessionMeta.textContent = "No active shift session. Stoppages are NOT tracked.";
    el.pilotSessionBtns.innerHTML = `<button class="btn btn-success btn-sm" onclick="startProductionSession()">Start Production Shift</button>`;
  }

  // Banner action button for Pilot
  if (state.currentUser && (state.currentUser.role === "pilot" || state.currentUser.role === "admin")) {
    if (state.productionActive) {
      el.bannerActionWrap.innerHTML = `<button class="btn btn-danger btn-sm" onclick="endProductionSession()">Stop Production</button>`;
    } else {
      el.bannerActionWrap.innerHTML = `<button class="btn btn-success btn-sm" onclick="startProductionSession()">Start Production</button>`;
    }
  } else {
    el.bannerActionWrap.innerHTML = "";
  }

  // 3. KPIs
  if (data.total_stops_today !== undefined) el.kpiStopsToday.textContent = data.total_stops_today;
  if (data.total_downtime_formatted) el.kpiDowntime.textContent = data.total_downtime_formatted;
  
  if (data.active_stops_count !== undefined) {
    el.kpiActiveStops.textContent = data.active_stops_count;
    if (data.active_stops_count > 0) {
      el.kpiActiveStops.style.color = "#f87171";
      el.kpiActiveFooter.textContent = `${data.active_stops_count} machine(s) stopped!`;
      el.kpiActiveFooter.style.color = "#fca5a5";
    } else {
      el.kpiActiveStops.style.color = "#34d399";
      el.kpiActiveFooter.textContent = "All lines running";
      el.kpiActiveFooter.style.color = "var(--text-muted)";
    }
  }

  if (data.unannotated_stops_count !== undefined) {
    el.kpiUnannotated.textContent = `${data.unannotated_stops_count} pending operator reason`;
  }

  if (data.cycles_per_minute !== undefined) {
    el.kpiCycleRate.innerHTML = `${data.cycles_per_minute} <span style="font-size: 13px; font-weight: normal; color: var(--text-secondary);">cpm</span>`;
  }

  // 4. Machines Grid
  if (data.machine_status) {
    renderMachineCards(data.machine_status, data.active_stops || []);
  }

  // 5. Active Stops Table
  renderActiveStopsTable(data.active_stops || []);

  // 6. Operator Screen Live Update
  if (state.currentUser && state.currentUser.role === "operator") {
    updateOperatorScreenLive(data.machine_status, data.active_stops || []);
  }
}

function renderMachineCards(statusMap, activeStops) {
  el.machineGrid.innerHTML = "";
  Object.values(statusMap).forEach(m => {
    const isOnline = m.plc_online;
    const isRunning = m.is_running;
    const card = document.createElement("div");
    
    let cardClass = "offline";
    let badgeClass = "badge-offline";

    if (isOnline) {
      if (isRunning) {
        cardClass = "running";
        badgeClass = "badge-running";
      } else if (m.state_code === 3 || m.state_code === 4) {
        cardClass = "alarm";
        badgeClass = "badge-alarm";
      } else if (m.state_code === 2) {
        cardClass = "running";
        badgeClass = "badge-manual";
      } else {
        cardClass = "stopped";
        badgeClass = "badge-stopped";
      }
    }

    card.className = `machine-card ${cardClass}`;

    const active = activeStops.find(s => s.machine_code === m.code);
    let stopwatchHtml = "";
    if (active) {
      stopwatchHtml = `
        <div class="stopwatch-alert">
          <div>
            <div style="font-size: 10px; font-weight: 700; color: #f87171; text-transform: uppercase;">Active Stop Incident</div>
            <div style="font-size: 11px; color: #fca5a5;">${active.reason_name || 'Pending Classification'}</div>
          </div>
          <div class="stopwatch-time">${formatDuration(active.current_duration || 0)}</div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="machine-card-header">
        <div>
          <div class="machine-code">${m.code}</div>
          <div class="machine-name">${m.name}</div>
        </div>
        <span class="status-badge ${badgeClass}">${m.state_text}</span>
      </div>
      <div class="machine-details">
        <div class="detail-item">
          <span class="detail-label">Hardware Signal</span>
          <span class="detail-val">${isOnline ? `&${m.state_code} (${m.state_desc})` : 'NO CARRIER'}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Operational State</span>
          <span class="detail-val">${isOnline ? (isRunning ? "RUNNING" : "STOPPED") : "DISCONNECTED"}</span>
        </div>
      </div>
      ${stopwatchHtml}
    `;
    el.machineGrid.appendChild(card);
  });
}

function renderActiveStopsTable(activeStops) {
  if (!activeStops || activeStops.length === 0) {
    el.activeStopsTbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 18px;">
          No active machine stoppages at this moment.
        </td>
      </tr>
    `;
    return;
  }

  el.activeStopsTbody.innerHTML = "";
  activeStops.forEach(s => {
    const tr = document.createElement("tr");
    const photoCell = s.photo_path 
      ? `<a href="${s.photo_path}" target="_blank" style="color: #38bdf8; text-decoration: underline;">View Photo</a>` 
      : `<span style="color: var(--text-muted);">None</span>`;

    tr.innerHTML = `
      <td style="font-family: var(--font-mono); font-weight: 700; color: #f87171;">${s.machine_code}</td>
      <td>${s.machine_name}</td>
      <td>${new Date(s.start_time).toLocaleTimeString()}</td>
      <td style="font-family: var(--font-mono); font-weight: 700; color: #fca5a5;">${formatDuration(s.current_duration || 0)}</td>
      <td><span class="status-badge badge-stopped">${s.state_label}</span></td>
      <td>${s.reason_name || '<em style="color: #fbbf24;">Pending Classification</em>'}</td>
      <td>${photoCell}</td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="openAnnotateModal(${s.stop_id})">Classify</button>
      </td>
    `;
    el.activeStopsTbody.appendChild(tr);
  });
}

// ----------------- Pilot Production Gating -----------------
async function startProductionSession() {
  const shift = el.pilotShiftSelect ? el.pilotShiftSelect.value : "Morning";
  const rate = el.pilotTargetRate ? parseFloat(el.pilotTargetRate.value) : 50.0;

  try {
    const res = await fetch("/api/production/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pilot_id: state.currentUser.id,
        shift: shift,
        target_rate: rate,
        notes: `Started by ${state.currentUser.full_name}`
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Error starting production");
  } catch (err) {
    alert("Failed to start production: " + err.message);
  }
}

async function endProductionSession() {
  if (!confirm("Are you sure you want to end active production? Machine stops will no longer be tracked.")) return;
  try {
    const res = await fetch(`/api/production/end?pilot_id=${state.currentUser.id}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Error ending production");
  } catch (err) {
    alert("Failed to end production: " + err.message);
  }
}

// ----------------- Pilot Line Allocations -----------------
async function loadAssignments() {
  try {
    const [machRes, userRes, assignRes] = await Promise.all([
      fetch("/api/machines"),
      fetch("/api/auth/users"),
      fetch("/api/assignments")
    ]);

    const machines = await machRes.json();
    const users = await userRes.json();
    const assignments = await assignRes.json();

    const operators = users.filter(u => u.role === "operator");
    state.machines = machines;

    el.pilotAssignmentsTbody.innerHTML = "";
    machines.forEach(m => {
      const currentAssign = assignments.find(a => a.machine_id === m.id);
      const tr = document.createElement("tr");

      let opOptions = `<option value="">-- Unassigned --</option>`;
      operators.forEach(op => {
        const selected = currentAssign && currentAssign.operator_id === op.id ? "selected" : "";
        opOptions += `<option value="${op.id}" ${selected}>${op.full_name} (${op.username})</option>`;
      });

      tr.innerHTML = `
        <td style="font-family: var(--font-mono); font-weight: 700;">${m.code}</td>
        <td>${m.name}</td>
        <td>
          <select class="select-field" id="assign-select-${m.id}">
            ${opOptions}
          </select>
        </td>
        <td>${currentAssign ? currentAssign.assigned_by_name : "N/A"}</td>
        <td>${currentAssign ? new Date(currentAssign.assigned_at).toLocaleDateString() : "N/A"}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="saveAssignment(${m.id})">Save Allocation</button>
        </td>
      `;
      el.pilotAssignmentsTbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error loading assignments:", err);
  }
}

async function saveAssignment(machineId) {
  const select = document.getElementById(`assign-select-${machineId}`);
  const opId = parseInt(select.value);
  if (!opId) {
    alert("Please select an operator to allocate.");
    return;
  }

  try {
    const res = await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machine_id: machineId,
        operator_id: opId,
        assigned_by: state.currentUser.id
      })
    });
    if (res.ok) {
      alert("Line assignment updated.");
      loadAssignments();
    }
  } catch (err) {
    alert("Failed to allocate operator: " + err.message);
  }
}

// ----------------- Operator Station -----------------
async function loadOperatorAssignedLine() {
  try {
    const res = await fetch("/api/assignments");
    const assigns = await res.json();
    const myAssign = assigns.find(a => a.operator_id === state.currentUser.id) || assigns[0];

    if (myAssign) {
      el.opAssignedBadge.textContent = `STATION: ${myAssign.machine_code}`;
      el.opMachineTitle.textContent = myAssign.machine_code;
      el.opMachineDesc.textContent = myAssign.machine_name;
    }
    loadReasonsIntoSelect(el.opReasonSelect);
  } catch (err) {
    console.error("Error loading operator station:", err);
  }
}

function updateOperatorScreenLive(statusMap, activeStops) {
  const currentMachCode = el.opMachineTitle.textContent;
  const status = statusMap ? statusMap[currentMachCode] : null;

  if (status) {
    if (!status.plc_online) {
      el.opStatusBadge.className = "status-badge badge-offline";
      el.opStatusBadge.textContent = "OFFLINE";
      el.opStopwatchBox.style.display = "none";
    } else if (status.is_running) {
      el.opStatusBadge.className = "status-badge badge-running";
      el.opStatusBadge.textContent = "RUNNING";
      el.opStopwatchBox.style.display = "none";
    } else {
      el.opStatusBadge.className = "status-badge badge-stopped";
      el.opStatusBadge.textContent = status.state_text;
      el.opStopwatchBox.style.display = "flex";

      const active = activeStops.find(s => s.machine_code === currentMachCode);
      if (active) {
        el.opStopwatchTimer.textContent = formatDuration(active.current_duration || 0);
        state.selectedStopForPhoto = active.stop_id;
      }
    }
  }
}

// ----------------- Reports & Export (Director) -----------------
async function loadReportPreview() {
  if (el.reportMachine.options.length <= 1) {
    const mRes = await fetch("/api/machines");
    const machs = await mRes.json();
    machs.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.code} - ${m.name}`;
      el.reportMachine.appendChild(opt);
    });
  }

  const shift = el.reportShift.value;
  const dateFrom = el.reportDateFrom.value;
  const dateTo = el.reportDateTo.value;
  const machineId = el.reportMachine.value;

  let query = `/api/stops/history?limit=100`;
  if (shift) query += `&shift=${encodeURIComponent(shift)}`;
  if (dateFrom) query += `&date_from=${dateFrom}`;
  if (dateTo) query += `&date_to=${dateTo}`;
  if (machineId) query += `&machine_id=${machineId}`;

  try {
    const res = await fetch(query);
    const stops = await res.json();
    renderReportPreviewTable(stops);
  } catch (err) {
    console.error("Error loading report preview:", err);
  }
}

function renderReportPreviewTable(stops) {
  if (!stops || stops.length === 0) {
    el.reportPreviewTbody.innerHTML = `
      <tr>
        <td colspan="12" style="text-align: center; color: var(--text-muted); padding: 18px;">
          No stops matching the specified filter criteria.
        </td>
      </tr>
    `;
    return;
  }

  el.reportPreviewTbody.innerHTML = "";
  stops.forEach(s => {
    const tr = document.createElement("tr");
    const photoCell = s.photo_path 
      ? `<a href="${s.photo_path}" target="_blank" style="color: #38bdf8; text-decoration: underline;">View Photo</a>` 
      : `<span style="color: var(--text-muted);">None</span>`;

    tr.innerHTML = `
      <td style="font-family: var(--font-mono);">${s.id}</td>
      <td style="font-family: var(--font-mono); font-weight: 700;">${s.machine_code}</td>
      <td>${s.machine_name}</td>
      <td>${s.shift || "N/A"}</td>
      <td>${new Date(s.start_time).toLocaleString()}</td>
      <td>${s.end_time ? new Date(s.end_time).toLocaleString() : "<strong style='color:#f87171'>ONGOING</strong>"}</td>
      <td style="font-family: var(--font-mono); font-weight: 600;">${s.duration_seconds}</td>
      <td><span class="status-badge badge-stopped">${s.state_label}</span></td>
      <td>${s.reason_category || "Unassigned"}</td>
      <td>${s.reason_name || "Pending"} ${s.operator_comment ? `(${s.operator_comment})` : ""}</td>
      <td>${s.operator_name || "N/A"}</td>
      <td>${photoCell}</td>
    `;
    el.reportPreviewTbody.appendChild(tr);
  });
}

function downloadExcel() {
  const shift = el.reportShift.value;
  const dateFrom = el.reportDateFrom.value;
  const dateTo = el.reportDateTo.value;
  const machineId = el.reportMachine.value;

  let url = `/api/reports/export-excel?`;
  if (shift) url += `shift=${encodeURIComponent(shift)}&`;
  if (dateFrom) url += `date_from=${dateFrom}&`;
  if (dateTo) url += `date_to=${dateTo}&`;
  if (machineId) url += `machine_id=${machineId}&`;

  window.location.href = url;
}

// ----------------- Supervisor User Management -----------------
async function loadUsers() {
  try {
    const res = await fetch("/api/auth/users");
    const users = await res.json();
    el.supervisorUsersTbody.innerHTML = "";
    users.forEach(u => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="font-family: var(--font-mono);">${u.id}</td>
        <td style="font-weight: 600;">${u.username}</td>
        <td>${u.full_name}</td>
        <td><span class="status-badge badge-manual">${u.role.toUpperCase()}</span></td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
        <td style="display: flex; gap: 6px;">
          <button class="btn btn-secondary btn-sm" onclick="resetUserPassword(${u.id}, '${u.username}')">Reset Password</button>
          <button class="btn btn-danger btn-sm" onclick="deleteUserAccount(${u.id}, '${u.username}')">Delete</button>
        </td>
      `;
      el.supervisorUsersTbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error loading users:", err);
  }
}

async function resetUserPassword(userId, username) {
  if (!confirm(`Reset password for user '${username}' to default '123456'?`)) return;
  try {
    const res = await fetch(`/api/auth/users/${userId}/reset-password`, { method: "POST" });
    const data = await res.json();
    alert(`Success: ${data.message}`);
  } catch (err) {
    alert("Failed to reset password: " + err.message);
  }
}

async function deleteUserAccount(userId, username) {
  if (!confirm(`Permanently delete user '${username}'?`)) return;
  try {
    const res = await fetch(`/api/auth/users/${userId}`, { method: "DELETE" });
    if (res.ok) {
      alert(`User '${username}' deleted.`);
      loadUsers();
    }
  } catch (err) {
    alert("Failed to delete user: " + err.message);
  }
}

// ----------------- Supervisor Stoppage Reasons -----------------
async function loadReasons() {
  try {
    const res = await fetch("/api/reasons");
    const reasons = await res.json();
    state.stopReasons = reasons;
    el.supervisorReasonsTbody.innerHTML = "";
    reasons.forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="font-family: var(--font-mono);">${r.id}</td>
        <td><strong>${r.category}</strong></td>
        <td>${r.name}</td>
        <td style="font-family: var(--font-mono); font-size: 11px;">${r.code}</td>
        <td><span class="status-badge badge-running">ACTIVE</span></td>
      `;
      el.supervisorReasonsTbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error loading reasons:", err);
  }
}

async function loadReasonsIntoSelect(selectEl) {
  if (!selectEl) return;
  if (state.stopReasons.length === 0) {
    const res = await fetch("/api/reasons");
    state.stopReasons = await res.json();
  }
  selectEl.innerHTML = `<option value="">-- Select Root Cause Reason --</option>`;
  
  const categories = {};
  state.stopReasons.forEach(r => {
    if (!categories[r.category]) categories[r.category] = [];
    categories[r.category].push(r);
  });

  Object.entries(categories).forEach(([cat, list]) => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = cat;
    list.forEach(r => {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = `${r.name} (${r.code})`;
      optgroup.appendChild(opt);
    });
    selectEl.appendChild(optgroup);
  });
}

// ----------------- Historical Logs -----------------
async function loadHistoricalStops() {
  try {
    const res = await fetch("/api/stops/history?limit=100");
    const stops = await res.json();
    el.historyStopsTbody.innerHTML = "";
    if (stops.length === 0) {
      el.historyStopsTbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 18px;">No recorded historical stops yet.</td></tr>`;
      return;
    }
    stops.forEach(s => {
      const tr = document.createElement("tr");
      const photoCell = s.photo_path 
        ? `<a href="${s.photo_path}" target="_blank" style="color: #38bdf8; text-decoration: underline;">View Photo</a>` 
        : `<span style="color: var(--text-muted);">None</span>`;

      tr.innerHTML = `
        <td style="font-family: var(--font-mono);">${s.id}</td>
        <td style="font-family: var(--font-mono); font-weight: 700;">${s.machine_code}</td>
        <td>${s.shift || "N/A"}</td>
        <td>${new Date(s.start_time).toLocaleTimeString()}</td>
        <td>${s.end_time ? new Date(s.end_time).toLocaleTimeString() : "<strong style='color:#f87171'>Active</strong>"}</td>
        <td style="font-family: var(--font-mono);">${formatDuration(s.duration_seconds)}</td>
        <td><span class="status-badge badge-stopped">${s.state_label}</span></td>
        <td>${s.reason_category || "Unassigned"}</td>
        <td>${s.reason_name || "Pending Annotation"} ${s.operator_comment ? `(${s.operator_comment})` : ""}</td>
        <td>${photoCell}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="openAnnotateModal(${s.id})">Edit</button></td>
      `;
      el.historyStopsTbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error loading history:", err);
  }
}

// ----------------- Admin Multi-PLC & Tag Mapping -----------------
async function loadAdminPlcs() {
  try {
    const res = await fetch("/api/plcs");
    const plcs = await res.json();
    state.plcConnections = plcs;
    el.adminPlcTbody.innerHTML = "";
    plcs.forEach(p => {
      const tr = document.createElement("tr");
      const statusBadge = p.is_active === 1 
        ? `<span class="status-badge badge-running">ACTIVE PROFILE</span>` 
        : `<span class="status-badge badge-manual">INACTIVE</span>`;

      const actionBtn = p.is_active === 1 
        ? `<span style="font-size: 11px; color: var(--color-success);">Current Connection</span>` 
        : `<button class="btn btn-primary btn-sm" onclick="activatePlcProfile(${p.id})">Activate</button>`;

      tr.innerHTML = `
        <td style="font-family: var(--font-mono);">${p.id}</td>
        <td><strong>${p.name}</strong></td>
        <td>${p.brand}</td>
        <td><code>${p.protocol}</code></td>
        <td>${p.ip_address}</td>
        <td>${p.port}</td>
        <td>${p.node_id}</td>
        <td>${statusBadge}</td>
        <td>${actionBtn}</td>
      `;
      el.adminPlcTbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error loading PLCs:", err);
  }
}

async function activatePlcProfile(plcId) {
  try {
    const res = await fetch(`/api/plcs/${plcId}/activate`, { method: "PUT" });
    if (res.ok) {
      alert("Activated PLC profile. Reconnecting hardware driver...");
      loadAdminPlcs();
    }
  } catch (err) {
    alert("Error activating PLC: " + err.message);
  }
}

async function loadAdminMappings() {
  try {
    const res = await fetch("/api/machines");
    const machines = await res.json();
    el.adminMappingTbody.innerHTML = "";
    machines.forEach(m => {
      const tr = document.createElement("tr");
      const runBitText = (m.run_bit_word !== null && m.run_bit_index !== null)
        ? `W${m.run_bit_word}.${String(m.run_bit_index).padStart(2, '0')}`
        : 'Internal Auto';

      tr.innerHTML = `
        <td style="font-family: var(--font-mono); font-weight: 700;">${m.code}</td>
        <td>${m.name}</td>
        <td>${m.plc_name || 'Default PLC'}</td>
        <td><code>${m.register_area}</code></td>
        <td><code>${m.register_area}${m.status_register}</code></td>
        <td><code>${runBitText}</code></td>
        <td><code>${m.rate_register ? `D${m.rate_register}` : 'None'}</code></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openEditMappingModal(${m.id})">Configure Mapping</button>
        </td>
      `;
      el.adminMappingTbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error loading machine mappings:", err);
  }
}

async function openEditMappingModal(machineId) {
  try {
    const res = await fetch("/api/machines");
    const machines = await res.json();
    const mach = machines.find(m => m.id === machineId);
    if (!mach) return;

    el.editMappingId.value = mach.id;
    el.editMappingName.value = mach.name;
    el.editMappingArea.value = mach.register_area;
    el.editMappingStatusReg.value = mach.status_register;
    el.editMappingRunWord.value = mach.run_bit_word !== null ? mach.run_bit_word : "";
    el.editMappingRunBit.value = mach.run_bit_index !== null ? mach.run_bit_index : "";
    el.editMappingRateReg.value = mach.rate_register !== null ? mach.rate_register : "";

    // Populate PLC dropdown
    el.editMappingPlc.innerHTML = "";
    state.plcConnections.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.brand} - ${p.ip_address})`;
      if (p.id === mach.plc_id) opt.selected = true;
      el.editMappingPlc.appendChild(opt);
    });

    el.modalEditMapping.style.display = "flex";
  } catch (err) {
    console.error("Error opening mapping modal:", err);
  }
}

async function saveMachineMapping() {
  const mId = parseInt(el.editMappingId.value);
  const name = el.editMappingName.value.trim();
  const plcId = parseInt(el.editMappingPlc.value);
  const area = el.editMappingArea.value;
  const statusReg = parseInt(el.editMappingStatusReg.value);
  const runWord = el.editMappingRunWord.value.trim() !== "" ? parseInt(el.editMappingRunWord.value) : null;
  const runBit = el.editMappingRunBit.value.trim() !== "" ? parseInt(el.editMappingRunBit.value) : null;
  const rateReg = el.editMappingRateReg.value.trim() !== "" ? parseInt(el.editMappingRateReg.value) : null;

  try {
    const res = await fetch(`/api/machines/${mId}/mapping`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        plc_id: plcId,
        register_area: area,
        status_register: statusReg,
        run_bit_word: runWord,
        run_bit_index: runBit,
        rate_register: rateReg
      })
    });
    if (res.ok) {
      el.modalEditMapping.style.display = "none";
      alert("Machine address mapping saved successfully.");
      loadAdminMappings();
    }
  } catch (err) {
    alert("Error saving mapping: " + err.message);
  }
}

// ----------------- Documentation Viewer -----------------
async function loadSystemDocs() {
  try {
    const res = await fetch("/api/system/docs");
    const data = await res.json();
    el.docsContentBody.innerHTML = formatMarkdown(data.content);
  } catch (err) {
    el.docsContentBody.textContent = "Failed to load documentation.";
  }
}

function formatMarkdown(text) {
  if (!text) return "";
  let html = text
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    .replace(/\n\n/gim, '</p><p>')
    .replace(/^\* (.*$)/gim, '<li>$1</li>');
  return `<p>${html}</p>`;
}

// ----------------- Modals (Annotate & Camera) -----------------
function openAnnotateModal(stopId) {
  el.modalAnnotateStopId.value = stopId;
  loadReasonsIntoSelect(el.modalAnnotateReason);
  el.modalAnnotateComment.value = "";
  el.modalAnnotate.style.display = "flex";
}

async function submitAnnotation() {
  const stopId = parseInt(el.modalAnnotateStopId.value);
  const reasonId = parseInt(el.modalAnnotateReason.value);
  const comment = el.modalAnnotateComment.value;

  if (!reasonId) {
    alert("Please select a root cause reason from the catalog.");
    return;
  }

  try {
    const res = await fetch(`/api/stops/${stopId}/annotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason_id: reasonId,
        operator_comment: comment,
        annotated_by: state.currentUser.id
      })
    });
    if (res.ok) {
      el.modalAnnotate.style.display = "none";
      alert("Stoppage classification saved.");
      if (state.activeTab === "history") loadHistoricalStops();
    }
  } catch (err) {
    alert("Failed to save annotation: " + err.message);
  }
}

async function openCameraModal(stopId) {
  state.selectedStopForPhoto = stopId;
  el.modalCamera.style.display = "flex";
  el.cameraCanvas.style.display = "none";
  el.cameraVideo.style.display = "block";
  el.cameraFallbackMsg.style.display = "none";

  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      state.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "environment" }
      });
      el.cameraVideo.srcObject = state.mediaStream;
    } else {
      throw new Error("getUserMedia not supported");
    }
  } catch (err) {
    console.warn("Camera access failed:", err);
    el.cameraVideo.style.display = "none";
    el.cameraFallbackMsg.style.display = "block";
  }
}

function closeCameraModal() {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(track => track.stop());
    state.mediaStream = null;
  }
  el.modalCamera.style.display = "none";
}

function snapCameraPhoto() {
  const video = el.cameraVideo;
  const canvas = el.cameraCanvas;
  if (!video.videoWidth) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  video.style.display = "none";
  canvas.style.display = "block";
}

async function uploadCapturedPhoto() {
  const stopId = state.selectedStopForPhoto;
  if (!stopId) {
    alert("No stoppage incident selected for photo attachment.");
    return;
  }

  const canvas = el.cameraCanvas;
  canvas.toBlob(async (blob) => {
    if (!blob) {
      alert("Please snap a photo first or select a file.");
      return;
    }

    const formData = new FormData();
    formData.append("file", blob, `stop_${stopId}.jpg`);

    try {
      const res = await fetch(`/api/stops/${stopId}/photo`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        closeCameraModal();
        alert("Photo attached to stoppage successfully!");
        if (state.currentUser && state.currentUser.role === "operator") {
          el.opPhotoPreviewWrap.style.display = "block";
          el.opPhotoPreviewImg.src = data.photo_url;
        }
      }
    } catch (err) {
      alert("Photo upload error: " + err.message);
    }
  }, "image/jpeg", 0.85);
}

// ----------------- Initialization & Event Listeners -----------------
function initEventListeners() {
  el.loginForm.addEventListener("submit", handleLogin);
  el.btnLogout.addEventListener("click", handleLogout);

  // Reports
  el.btnApplyReportFilter.addEventListener("click", loadReportPreview);
  el.btnDownloadExcel.addEventListener("click", downloadExcel);

  // History & Docs
  el.btnRefreshHistory.addEventListener("click", loadHistoricalStops);
  el.btnRefreshDocs.addEventListener("click", loadSystemDocs);

  // Operator Console
  el.opBtnOpenCamera.addEventListener("click", () => {
    if (!state.selectedStopForPhoto) {
      const currentMachCode = el.opMachineTitle.textContent;
      const active = state.activeStops.find(s => s.machine_code === currentMachCode);
      if (active) state.selectedStopForPhoto = active.stop_id;
    }
    openCameraModal(state.selectedStopForPhoto);
  });

  el.opBtnSaveAnnotation.addEventListener("click", async () => {
    const reasonId = parseInt(el.opReasonSelect.value);
    const comment = el.opNotesInput.value;
    const currentMachCode = el.opMachineTitle.textContent;
    const active = state.activeStops.find(s => s.machine_code === currentMachCode);

    if (!active) {
      alert("No active stoppage underway on this machine to classify.");
      return;
    }
    if (!reasonId) {
      alert("Please select a root cause reason from the catalog.");
      return;
    }

    try {
      const res = await fetch(`/api/stops/${active.stop_id}/annotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason_id: reasonId,
          operator_comment: comment,
          annotated_by: state.currentUser.id
        })
      });
      if (res.ok) alert("Classification saved!");
    } catch (err) {
      alert("Error: " + err.message);
    }
  });

  // Camera Modal
  el.btnCloseCamera.addEventListener("click", closeCameraModal);
  el.btnCancelCamera.addEventListener("click", closeCameraModal);
  el.btnSnapCamera.addEventListener("click", snapCameraPhoto);
  el.btnSaveCameraPhoto.addEventListener("click", uploadCapturedPhoto);
  el.cameraFileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          el.cameraCanvas.width = img.width;
          el.cameraCanvas.height = img.height;
          const ctx = el.cameraCanvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          el.cameraVideo.style.display = "none";
          el.cameraCanvas.style.display = "block";
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  });

  // Annotate Modal
  el.btnCloseAnnotate.addEventListener("click", () => el.modalAnnotate.style.display = "none");
  el.btnCancelAnnotate.addEventListener("click", () => el.modalAnnotate.style.display = "none");
  el.btnSubmitAnnotate.addEventListener("click", submitAnnotation);

  // Add User Modal
  el.btnOpenAddUser.addEventListener("click", () => el.modalAddUser.style.display = "flex");
  el.btnCloseAddUser.addEventListener("click", () => el.modalAddUser.style.display = "none");
  el.btnCancelAddUser.addEventListener("click", () => el.modalAddUser.style.display = "none");
  el.btnSubmitAddUser.addEventListener("click", async () => {
    const un = el.newUsername.value.trim();
    const fn = el.newFullname.value.trim();
    const pw = el.newPassword.value.trim();
    const ro = el.newUserRole.value;

    if (!un || !fn || !pw) {
      alert("All fields are required.");
      return;
    }

    try {
      const res = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: un, full_name: fn, password: pw, role: ro })
      });
      if (res.ok) {
        el.modalAddUser.style.display = "none";
        alert("User account created successfully.");
        loadUsers();
      } else {
        const err = await res.json();
        alert(err.detail || "Error creating user");
      }
    } catch (err) {
      alert("Network error: " + err.message);
    }
  });

  // Add Reason Modal
  el.btnOpenAddReason.addEventListener("click", () => el.modalAddReason.style.display = "flex");
  el.btnCloseAddReason.addEventListener("click", () => el.modalAddReason.style.display = "none");
  el.btnCancelAddReason.addEventListener("click", () => el.modalAddReason.style.display = "none");
  el.btnSubmitAddReason.addEventListener("click", async () => {
    const cat = el.newReasonCat.value;
    const name = el.newReasonName.value.trim();
    const code = el.newReasonCode.value.trim();

    if (!name || !code) {
      alert("Name and code are required.");
      return;
    }

    try {
      const res = await fetch("/api/reasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: cat, name: name, code: code })
      });
      if (res.ok) {
        el.modalAddReason.style.display = "none";
        alert("Reason added to catalog.");
        loadReasons();
      }
    } catch (err) {
      alert("Error: " + err.message);
    }
  });

  // Add PLC Modal
  el.btnOpenAddPlc.addEventListener("click", () => el.modalAddPlc.style.display = "flex");
  el.btnCloseAddPlc.addEventListener("click", () => el.modalAddPlc.style.display = "none");
  el.btnCancelAddPlc.addEventListener("click", () => el.modalAddPlc.style.display = "none");
  el.btnSubmitAddPlc.addEventListener("click", async () => {
    const name = el.newPlcName.value.trim();
    const brand = el.newPlcBrand.value;
    const protocol = el.newPlcProtocol.value;
    const ip = el.newPlcIp.value.trim();
    const port = parseInt(el.newPlcPort.value);
    const node = parseInt(el.newPlcNode.value);
    const unit = parseInt(el.newPlcUnit.value);

    if (!name || !ip || !port) {
      alert("Profile name, IP address, and Port are required.");
      return;
    }

    try {
      const res = await fetch("/api/plcs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, brand, protocol, ip_address: ip, port, node_id: node, unit_id: unit
        })
      });
      if (res.ok) {
        el.modalAddPlc.style.display = "none";
        alert("PLC Profile registered.");
        loadAdminPlcs();
      }
    } catch (err) {
      alert("Error: " + err.message);
    }
  });

  // Machine Mapping Modal
  el.btnCloseEditMapping.addEventListener("click", () => el.modalEditMapping.style.display = "none");
  el.btnCancelEditMapping.addEventListener("click", () => el.modalEditMapping.style.display = "none");
  el.btnSubmitEditMapping.addEventListener("click", saveMachineMapping);
}

// Check saved authentication state
document.addEventListener("DOMContentLoaded", () => {
  initEventListeners();
  const savedUser = localStorage.getItem("prt_auth_user");
  const savedToken = localStorage.getItem("prt_auth_token");

  if (savedUser && savedToken) {
    try {
      state.currentUser = JSON.parse(savedUser);
      state.authToken = savedToken;
      initAuthenticatedApp();
    } catch (e) {
      handleLogout();
    }
  } else {
    el.loginScreen.style.display = "flex";
    el.appScreen.style.display = "none";
  }
});
