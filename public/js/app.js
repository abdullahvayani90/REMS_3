// ====================================================
// REMS V2.0 - AGENCY MODEL (FRONTEND LOGIC)
// ====================================================

// ADMIN CREDENTIALS
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";

function checkAdminCredentials(u, p) {
  return u === ADMIN_USERNAME && p === ADMIN_PASSWORD;
}

function logout() {
  sessionStorage.removeItem("rems_logged_in");
  window.location.href = "index.html";
}

// ----------------------------------------------------
// STATE VARIABLES
// ----------------------------------------------------
let propertiesArray = [];
let transactions = [];
let customers = [];
let meetingsArray = [];
let undoStack = []; 

// ----------------------------------------------------
// LOAD DATA FROM BACKEND (V2 Oracle DB)
// ----------------------------------------------------
async function loadAllData() {
  try {
    // Ngrok ki warning screen API calls ko block na kare, isliye yeh header add karein
    const headers = {
      'ngrok-skip-browser-warning': 'true',
      'Content-Type': 'application/json'
    };

    // 'http://localhost:3000' hata diya gaya hai. Ab yeh automatically ngrok ka URL uthayega.
    const [propRes, custRes, transRes, meetRes] = await Promise.all([
      fetch('/api/properties', { headers }),
      fetch('/api/customers', { headers }),
      fetch('/api/transactions', { headers }),
      fetch('/api/meetings', { headers })
    ]);
    
    // ... aapka baqi ka code yahan aayega (e.g., await propRes.json(), etc.)

    const propData = await propRes.json();
    const custData = await custRes.json();
    const transData = await transRes.json();
    const meetData = await meetRes.json();

    // V2 Mapping for Properties (Includes Area, Dimensions, Owner)
    propertiesArray = propData.map(p => ({
      id: p.ID, 
      type: p.PROPERTY_TYPE, 
      area: p.AREA,
      address: p.ADDRESS,
      dimensions: p.DIMENSIONS,
      price: p.PRICE, 
      status: p.STATUS,
      ownerName: p.OWNER_NAME,
      ownerPhone: p.OWNER_PHONE
    }));

    customers = custData.map(c => ({
      id: c.ID, name: c.NAME, phone: c.PHONE, email: c.EMAIL
    }));

    // V2 Mapping for Transactions (Includes Commission and Buyer/Seller links)
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
    console.error("Error loading data from database:", error);
  }
}

async function loadPropertiesFromDB() {
  await loadAllData();
}

// ----------------------------------------------------
// PROPERTY FUNCTIONS (V2)
// ----------------------------------------------------
async function addPropertyV2(type, area, address, dimensions, price, ownerName, ownerPhone) {
  try {
    const response = await fetch('http://localhost:3000/api/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, area, address, dimensions, price, ownerName, ownerPhone })
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText); 
    }
    
    await loadAllData();
    alert("Property and Owner linked successfully in Database!");
    
    // Clear inputs (if on properties page)
    ['p_type', 'p_area', 'p_address', 'p_dimensions', 'p_price', 'p_ownerName', 'p_ownerPhone'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.value = '';
    });

  } catch (error) {
    console.error("Error adding property:", error);
    alert("Database Error: " + error.message);
  }
}

async function deleteProperty(id) {
  try {
    await fetch(`http://localhost:3000/api/properties/${id}`, { method: 'DELETE' });
    undoStack.push(id);
    await loadAllData();
  } catch (error) {
    console.error("Error deleting property:", error);
    alert("Failed to delete property.");
  }
}

async function undo() {
  if (undoStack.length === 0) {
    alert("Nothing to undo! (No recently deleted properties)");
    return;
  }
  const lastDeletedId = undoStack.pop();
  try {
    await fetch(`http://localhost:3000/api/properties/restore/${lastDeletedId}`, { method: 'PUT' });
    await loadAllData();
    alert("Undo Successful! Property restored.");
  } catch (error) {
    console.error("Error restoring property:", error);
    alert("Failed to undo.");
  }
}

// ----------------------------------------------------
// TRANSACTIONS (V2 - Agency Model)
// ----------------------------------------------------
async function recordSaleV2(propertyId, buyerName, buyerPhone, propertyPrice, agencyCommission, date) {
  try {
    const response = await fetch('http://localhost:3000/api/transactions/sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId, buyerName, buyerPhone, propertyPrice, agencyCommission, date })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
    }
    
    await loadAllData();
    alert("Deal Closed! Commission added to revenue.");

  } catch (error) {
    console.error("Error recording sale:", error);
    alert("Database Error: " + error.message);
  }
}

// ----------------------------------------------------
// MEETINGS (Connected to Oracle DB)
// ----------------------------------------------------
async function addMeeting(name, phone, date, time, comments) {
  try {
    const response = await fetch('http://localhost:3000/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, date, time, comments })
    });

    if (!response.ok) throw new Error(await response.text());
    
    await loadAllData();
    alert("Meeting Scheduled Successfully in Database!");
    
    ['m_name', 'm_phone', 'm_date', 'm_time', 'm_comments'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.value = '';
    });

  } catch (error) {
    console.error("Error adding meeting:", error);
    alert("Database Error: " + error.message);
  }
}

async function callNextMeeting() {
  try {
    const response = await fetch('http://localhost:3000/api/meetings/next', { method: 'PUT' });
    if (response.status === 404) return alert("No meetings left in the queue!");
    if (!response.ok) throw new Error(await response.text());

    const next = await response.json();
    await loadAllData();
    alert(`Next Meeting Called:\nName: ${next.CUSTOMER_NAME}\nPhone: ${next.PHONE}\nTime: ${next.MEETING_TIME}`);

  } catch (error) {
    console.error("Error calling next meeting:", error);
    alert("Database Error: " + error.message);
  }
}

// ----------------------------------------------------
// DASHBOARD & REPORTS (V2 Logic)
// ----------------------------------------------------
function updateDashboardStats() {
  const total = propertiesArray.length;
  const available = propertiesArray.filter(p=>p.status==="Available").length;
  const sold = propertiesArray.filter(p=>p.status==="Sold").length;
  
  // V2: Revenue is strictly your Agency Commission
  let totalCommission = 0;
  transactions.forEach(t => { totalCommission += Number(t.commission || 0); });

  const setText = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  
  setText("statTotal", total);
  setText("statAvailable", available);
  setText("statSold", sold);
  setText("statRevenue", "Rs " + totalCommission.toLocaleString());
}

function updateReports() {
  // Similar logic for reports page
  const total = propertiesArray.length;
  const available = propertiesArray.filter(p=>p.status==="Available").length;
  const sold = propertiesArray.filter(p=>p.status==="Sold").length;
  
  let totalCommission = 0;
  let totalDealVolume = 0; // Total value of properties moved
  transactions.forEach(t => { 
      totalCommission += Number(t.commission || 0); 
      totalDealVolume += Number(t.price || 0);
  });

  const setText = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  
  setText("reportTotal", total);
  setText("reportAvailable", available);
  setText("reportSold", sold);
  setText("reportRevenue", "Rs " + totalCommission.toLocaleString());
  // If you have a specific element for deal volume, you can set it here
}

// ----------------------------------------------------
// UI REFRESHERS
// ----------------------------------------------------
function refreshUI() {
  if (document.getElementById("propertyTable")) refreshPropertyTable();
  if (document.getElementById("customerTable")) refreshCustomerTable(); 
  if (document.getElementById("meetingTable")) refreshMeetingTable(); 
  if (document.getElementById("reportTotal")) updateReports();
  if (document.getElementById("statTotal")) updateDashboardStats();
}

function refreshPropertyTable(list = propertiesArray) {
  const tbody = document.getElementById("propertyTable");
  if (!tbody) return;
  tbody.innerHTML = "";
  list.forEach(p => {
    tbody.innerHTML += `<tr>
      <td>${p.id}</td>
      <td>${p.type}</td>
      <td>${p.area}</td>
      <td>${p.address}</td>
      <td>${p.dimensions}</td>
      <td>Rs ${Number(p.price).toLocaleString()}</td>
      <td>${p.ownerName} <br><small>${p.ownerPhone}</small></td>
      <td><span style="color: ${p.status === 'Available' ? 'green' : 'red'}; font-weight: bold;">${p.status}</span></td>
      <td>
        <button class="btn-sm btn-delete" onclick="deleteProperty(${p.id})">Delete</button>
      </td>
    </tr>`;
  });
}

function refreshCustomerTable(list = customers) {
  const tbody = document.getElementById("customerTable");
  if (!tbody) return;
  tbody.innerHTML = "";
  list.forEach(c => {
    tbody.innerHTML += `<tr>
      <td>${c.id}</td>
      <td>${c.name}</td>
      <td>${c.phone}</td>
    </tr>`;
  });
}

function handleCustomerSearch() {
  const input = document.getElementById("searchCustomer");
  if (!input) return;
  const keyword = input.value.trim().toLowerCase();
  if(!keyword) return refreshCustomerTable();
  const filtered = customers.filter(c => c.name.toLowerCase().includes(keyword) || c.phone.includes(keyword));
  refreshCustomerTable(filtered);
}

function refreshMeetingTable() {
  const tbody = document.getElementById("meetingTable");
  if (!tbody) return;
  tbody.innerHTML = "";
  meetingsArray.forEach(m => {
    tbody.innerHTML += `<tr>
        <td>${m.name}</td>
        <td>${m.phone}</td>
        <td>${m.date}</td>
        <td>${m.time}</td>
        <td>${m.comments}</td>
      </tr>`;
  });
}

// ====================================================
// NEW FEATURES: SEARCH & PRINTING
// ====================================================

// Feature: Search Properties
function handlePropertySearch() {
  const input = document.getElementById("searchProperty");
  if (!input) return;
  const keyword = input.value.trim().toLowerCase();
  
  if(!keyword) return refreshPropertyTable(); // Agar search khali hai toh sab dikhao
  
  const filtered = propertiesArray.filter(p => 
    p.area.toLowerCase().includes(keyword) || 
    p.type.toLowerCase().includes(keyword) || 
    p.address.toLowerCase().includes(keyword) ||
    p.id.toString().includes(keyword)
  );
  refreshPropertyTable(filtered);
}

// Feature: Print Monthly Transactions
function printMonthlyReport() {
  const monthInput = document.getElementById("reportMonth").value; // Format: YYYY-MM
  if(!monthInput) return alert("Please select a month first!");

  // Filter deals by the selected month
  const filtered = transactions.filter(t => t.date && t.date.startsWith(monthInput));
  
  if(filtered.length === 0) return alert("No transactions found for this month!");

  // Create a new window for printing
  let printWindow = window.open('', '_blank');
  let html = `
    <h2 style="font-family: sans-serif;">Deals Report: ${monthInput}</h2>
    <table border="1" cellpadding="8" style="width:100%; border-collapse: collapse; text-align:left; font-family: sans-serif;">
      <tr style="background-color: #f2f2f2;">
        <th>Date</th><th>Address</th><th>Seller</th><th>Buyer</th><th>Deal Price</th><th>Commission</th>
      </tr>`;
  
  let totalComm = 0;
  filtered.forEach(t => {
      totalComm += Number(t.commission);
      html += `<tr>
        <td>${t.date.split('T')[0]}</td><td>${t.address}</td><td>${t.sellerName}</td>
        <td>${t.buyerName}</td><td>Rs ${Number(t.price).toLocaleString()}</td>
        <td style="color: green; font-weight: bold;">Rs ${Number(t.commission).toLocaleString()}</td>
      </tr>`;
  });
  
  html += `</table><h3 style="font-family: sans-serif;">Total Commission Earned: Rs ${totalComm.toLocaleString()}</h3>`;
  
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.print(); // Auto-open print dialog
}

// Feature: Print Current Active Listings
function printListings() {
  const available = propertiesArray.filter(p => p.status === 'Available');
  
  let printWindow = window.open('', '_blank');
  let html = `
    <h2 style="font-family: sans-serif;">Current Active Listings (Available Properties)</h2>
    <table border="1" cellpadding="8" style="width:100%; border-collapse: collapse; text-align:left; font-family: sans-serif;">
      <tr style="background-color: #f2f2f2;">
        <th>ID</th><th>Type</th><th>Area</th><th>Dimensions</th><th>Demand Price</th><th>Owner Info</th>
      </tr>`;
  
  available.forEach(p => {
      html += `<tr>
        <td>${p.id}</td><td>${p.type}</td><td>${p.area}</td><td>${p.dimensions}</td>
        <td>Rs ${Number(p.price).toLocaleString()}</td><td>${p.ownerName} (${p.ownerPhone})</td>
      </tr>`;
  });
  
  html += `</table>`;
  
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.print();
}

// ----------------------------------------------------
// INITIAL LOAD 
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  if (typeof loadAllData === "function") {
    loadAllData();
  }
});