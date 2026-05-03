// ====================================================
// REMS V2.0 - AGENCY MODEL (FRONTEND LOGIC)
// ====================================================

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";

function checkAdminCredentials(u, p) { return u === ADMIN_USERNAME && p === ADMIN_PASSWORD; }
function logout() { sessionStorage.removeItem("rems_logged_in"); globalThis.location.href = "index.html"; }

// ----------------------------------------------------
// HELPERS
// ----------------------------------------------------
const API = (path, options = {}) => fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
const clearFields = (...ids) => ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

async function apiFetch(path, options = {}) {
  const res = await API(path, options);
  if (!res.ok) throw new Error(await res.text());
  return res.headers.get('content-type')?.includes('json') ? res.json() : res;
}

function openPrintWindow(html) {
  const win = window.open('', '_blank');
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  win.location.href = url;
  win.onload = () => win.print();
}

// ----------------------------------------------------
// STATE
// ----------------------------------------------------
let propertiesArray = [], transactions = [], customers = [], meetingsArray = [], undoStack = [];

// ----------------------------------------------------
// LOAD DATA
// ----------------------------------------------------
async function loadAllData() {
  try {
    const [propData, custData, transData, meetData] = await Promise.all([
      apiFetch('/api/properties'),
      apiFetch('/api/customers'),
      apiFetch('/api/transactions'),
      apiFetch('/api/meetings')
    ]);

    propertiesArray = propData.map(p => ({
      id: p.ID, type: p.PROPERTY_TYPE, area: p.AREA, address: p.ADDRESS,
      dimensions: p.DIMENSIONS, price: p.PRICE, status: p.STATUS,
      ownerName: p.OWNER_NAME, ownerPhone: p.OWNER_PHONE
    }));

    customers = custData.map(c => ({ id: c.ID, name: c.NAME, phone: c.PHONE, email: c.EMAIL }));

    transactions = transData.map(t => ({
      id: t.ID, type: t.TRANSACTION_TYPE, propertyId: t.PROPERTY_ID,
      address: t.ADDRESS, sellerName: t.SELLER_NAME, buyerName: t.BUYER_NAME,
      price: t.PROPERTY_PRICE, commission: t.AGENCY_COMMISSION, date: t.TRANSACTION_DATE
    }));

    meetingsArray = meetData.map(m => ({
      id: m.ID, name: m.CUSTOMER_NAME, phone: m.PHONE,
      date: m.MEETING_DATE ? m.MEETING_DATE.split('T')[0] : '',
      time: m.MEETING_TIME, comments: m.COMMENTS || '-'
    }));

    refreshUI();
  } catch (error) {
    console.error("Error loading data:", error);
  }
}

const loadPropertiesFromDB = loadAllData;

// ----------------------------------------------------
// PROPERTY FUNCTIONS
// ----------------------------------------------------
async function addPropertyV2(type, area, address, dimensions, price, ownerName, ownerPhone) {
  try {
    await apiFetch('/api/properties', { method: 'POST', body: JSON.stringify({ type, area, address, dimensions, price, ownerName, ownerPhone }) });
    await loadAllData();
    alert("Property and Owner linked successfully in Database!");
    clearFields('p_type', 'p_area', 'p_address', 'p_dimensions', 'p_price', 'p_ownerName', 'p_ownerPhone');
  } catch (error) { console.error("Error deleting property:", error); alert("Failed to delete property."); }
}

async function deleteProperty(id) {
  try {
    await apiFetch(`/api/properties/${id}`, { method: 'DELETE' });
    undoStack.push(id);
    await loadAllData();
  } catch (error) { alert("Failed to delete property."); }
}

async function undo() {
  if (!undoStack.length) return alert("Nothing to undo!");
  try {
    await apiFetch(`/api/properties/restore/${undoStack.pop()}`, { method: 'PUT' });
    await loadAllData();
    alert("Undo Successful! Property restored.");
  } catch (error) { console.error("Error restoring property:", error); alert("Failed to undo."); }
}

// ----------------------------------------------------
// TRANSACTIONS
// ----------------------------------------------------
async function recordSaleV2(propertyId, buyerName, buyerPhone, propertyPrice, agencyCommission, date) {
  try {
    await apiFetch('/api/transactions/sale', { method: 'POST', body: JSON.stringify({ propertyId, buyerName, buyerPhone, propertyPrice, agencyCommission, date }) });
    await loadAllData();
    alert("Deal Closed! Commission added to revenue.");
  } catch (error) { alert("Database Error: " + error.message); }
}

// ----------------------------------------------------
// MEETINGS
// ----------------------------------------------------
async function addMeeting(name, phone, date, time, comments) {
  try {
    await apiFetch('/api/meetings', { method: 'POST', body: JSON.stringify({ name, phone, date, time, comments }) });
    await loadAllData();
    alert("Meeting Scheduled Successfully in Database!");
    clearFields('m_name', 'm_phone', 'm_date', 'm_time', 'm_comments');
  } catch (error) { alert("Database Error: " + error.message); }
}

async function callNextMeeting() {
  try {
    const res = await fetch('/api/meetings/next', { method: 'PUT' });
    if (res.status === 404) return alert("No meetings left in the queue!");
    if (!res.ok) throw new Error(await res.text());
    const next = await res.json();
    await loadAllData();
    alert(`Next Meeting Called:\nName: ${next.CUSTOMER_NAME}\nPhone: ${next.PHONE}\nTime: ${next.MEETING_TIME}`);
  } catch (error) { alert("Database Error: " + error.message); }
}

// ----------------------------------------------------
// DASHBOARD & REPORTS
// ----------------------------------------------------
function calcStats() {
  const total = propertiesArray.length;
  const available = propertiesArray.filter(p => p.status === "Available").length;
  const sold = propertiesArray.filter(p => p.status === "Sold").length;
  const totalCommission = transactions.reduce((sum, t) => sum + Number(t.commission || 0), 0);
  const totalDealVolume = transactions.reduce((sum, t) => sum + Number(t.price || 0), 0);
  return { total, available, sold, totalCommission, totalDealVolume };
}

function updateDashboardStats() {
  const { total, available, sold, totalCommission } = calcStats();
  setText("statTotal", total);
  setText("statAvailable", available);
  setText("statSold", sold);
  setText("statRevenue", "Rs " + totalCommission.toLocaleString());
}

function updateReports() {
  const { total, available, sold, totalCommission } = calcStats();
  setText("reportTotal", total);
  setText("reportAvailable", available);
  setText("reportSold", sold);
  setText("reportRevenue", "Rs " + totalCommission.toLocaleString());
}

// ----------------------------------------------------
// UI REFRESHERS
// ----------------------------------------------------
let refreshUI = function() {
  if (document.getElementById("propertyTable"))  refreshPropertyTable();
  if (document.getElementById("customerTable"))  refreshCustomerTable();
  if (document.getElementById("meetingTable"))   refreshMeetingTable();
  if (document.getElementById("reportTotal"))    updateReports();
  if (document.getElementById("statTotal"))      updateDashboardStats();
};

function refreshPropertyTable(list = propertiesArray) {
  const tbody = document.getElementById("propertyTable");
  if (!tbody) return;
  tbody.innerHTML = list.map(p => `<tr>
    <td>${p.id}</td><td>${p.type}</td><td>${p.area}</td><td>${p.address}</td>
    <td>${p.dimensions}</td><td>Rs ${Number(p.price).toLocaleString()}</td>
    <td>${p.ownerName}<br><small>${p.ownerPhone}</small></td>
    <td><span style="color:${p.status === 'Available' ? 'green' : 'red'};font-weight:bold">${p.status}</span></td>
    <td><button class="btn-sm btn-delete" onclick="deleteProperty(${p.id})">Delete</button></td>
  </tr>`).join('');
}

function refreshCustomerTable(list = customers) {
  const tbody = document.getElementById("customerTable");
  if (!tbody) return;
  tbody.innerHTML = list.map(c => `<tr><td>${c.id}</td><td>${c.name}</td><td>${c.phone}</td></tr>`).join('');
}

function refreshMeetingTable() {
  const tbody = document.getElementById("meetingTable");
  if (!tbody) return;
  tbody.innerHTML = meetingsArray.map(m => `<tr>
    <td>${m.name}</td><td>${m.phone}</td><td>${m.date}</td><td>${m.time}</td><td>${m.comments}</td>
  </tr>`).join('');
}

// ----------------------------------------------------
// SEARCH & PRINTING
// ----------------------------------------------------
function handlePropertySearch() {
  const input = document.getElementById("searchProperty");
  if (!input) return;
  const kw = input.value.trim().toLowerCase();
  if (!kw) return refreshPropertyTable();
  refreshPropertyTable(propertiesArray.filter(p =>
    [p.area, p.type, p.address, p.id.toString()].some(v => v.toLowerCase().includes(kw))
  ));
}

function handleCustomerSearch() {
  const input = document.getElementById("searchCustomer");
  if (!input) return;
  const kw = input.value.trim().toLowerCase();
  if (!kw) return refreshCustomerTable();
  refreshCustomerTable(customers.filter(c => c.name.toLowerCase().includes(kw) || c.phone.includes(kw)));
}

function printMonthlyReport() {
  const monthInput = document.getElementById("reportMonth").value;
  if (!monthInput) return alert("Please select a month first!");
  const filtered = transactions.filter(t => t.date?.startsWith(monthInput));
  if (!filtered.length) return alert("No transactions found for this month!");

  let totalComm = 0;
  const rows = filtered.map(t => {
    totalComm += Number(t.commission);
    return `<tr>
      <td>${t.date.split('T')[0]}</td><td>${t.address}</td><td>${t.sellerName}</td>
      <td>${t.buyerName}</td><td>Rs ${Number(t.price).toLocaleString()}</td>
      <td style="color:green;font-weight:bold">Rs ${Number(t.commission).toLocaleString()}</td>
    </tr>`;
  }).join('');

  openPrintWindow(`
    <h2 style="font-family:sans-serif">Deals Report: ${monthInput}</h2>
    <table border="1" cellpadding="8" style="width:100%;border-collapse:collapse;text-align:left;font-family:sans-serif">
      <tr style="background:#f2f2f2"><th>Date</th><th>Address</th><th>Seller</th><th>Buyer</th><th>Deal Price</th><th>Commission</th></tr>
      ${rows}
    </table>
    <h3 style="font-family:sans-serif">Total Commission Earned: Rs ${totalComm.toLocaleString()}</h3>
  `);
}

function printListings() {
  const rows = propertiesArray.filter(p => p.status === 'Available').map(p => `<tr>
    <td>${p.id}</td><td>${p.type}</td><td>${p.area}</td><td>${p.dimensions}</td>
    <td>Rs ${Number(p.price).toLocaleString()}</td><td>${p.ownerName} (${p.ownerPhone})</td>
  </tr>`).join('');

  openPrintWindow(`
    <h2 style="font-family:sans-serif">Current Active Listings (Available Properties)</h2>
    <table border="1" cellpadding="8" style="width:100%;border-collapse:collapse;text-align:left;font-family:sans-serif">
      <tr style="background:#f2f2f2"><th>ID</th><th>Type</th><th>Area</th><th>Dimensions</th><th>Demand Price</th><th>Owner Info</th></tr>
      ${rows}
    </table>
  `);
}

// ----------------------------------------------------
// INITIAL LOAD
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => { if (typeof loadAllData === "function") loadAllData(); });