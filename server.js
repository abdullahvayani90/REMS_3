const express = require('express');
const cors = require('cors');
const oracledb = require('oracledb');
const path = require('path'); // YEH LINE ADD KARNI HAI

const app = express();
app.use(cors()); 
app.use(express.json()); 

// SECURITY FIX: Ab sirf 'public' folder ki files browser mein dikhengi, aapka backend code nahi.
app.use(express.static(path.join(__dirname, 'public')));

const dbConfig = {
    user: "SYSTEM",       
    password: "system123",  
    connectString: "localhost:1521/XE"  
};


// ==========================================
// SMART HELPER: Prevent Duplicate Customers
// ==========================================
async function getOrCreateCustomer(connection, name, phone) {
    // Check if client already exists by phone number
    let result = await connection.execute(
        `SELECT id FROM customers WHERE phone = :phone`, 
        [phone], { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    
    // If exists, return the old ID
    if (result.rows.length > 0) return result.rows[0].ID;

    // If new, save them to the database
    await connection.execute(
        `INSERT INTO customers (name, phone) VALUES (:name, :phone)`, 
        { name, phone }, { autoCommit: true }
    );
    
    // Fetch and return the newly created ID
    result = await connection.execute(
        `SELECT id FROM customers WHERE phone = :phone`, 
        [phone], { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return result.rows[0].ID;
}

// ==========================================
// PROPERTIES ROUTES (V2)
// ==========================================
app.get('/api/properties', async (req, res) => {
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        // SMART FIX: Checking for both 0 and NULL
        const result = await connection.execute(
            `SELECT p.*, c.name AS owner_name, c.phone AS owner_phone 
             FROM properties p 
             LEFT JOIN customers c ON p.owner_id = c.id 
             WHERE p.is_deleted = 0 OR p.is_deleted IS NULL 
             ORDER BY p.id DESC`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        res.json(result.rows); 
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching properties");
    } finally {
        if (connection) { try { await connection.close(); } catch(err){} }
    }
});

app.post('/api/properties', async (req, res) => {
    const { type, area, address, dimensions, price, ownerName, ownerPhone } = req.body;
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        
        // 1. Get or Create Owner
        const ownerId = await getOrCreateCustomer(connection, ownerName, ownerPhone);
        
        // 2. Save Property with Owner ID
        await connection.execute(
            `INSERT INTO properties (property_type, area, address, dimensions, price, owner_id) 
             VALUES (:type, :area, :address, :dim, :price, :ownerId)`,
            { type, area, address, dim: dimensions, price, ownerId }, { autoCommit: true } 
        );
        res.status(201).send({ message: "Property & Owner added successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding property");
    } finally {
        if (connection) { try { await connection.close(); } catch(err){} }
    }
});

app.delete('/api/properties/:id', async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        await connection.execute(`UPDATE properties SET is_deleted = 1 WHERE id = :id`, { id }, { autoCommit: true });
        res.send({ message: "Property soft-deleted successfully" });
    } catch (err) {
        res.status(500).send("Error deleting property");
    } finally {
        if (connection) { try { await connection.close(); } catch(err){} }
    }
});

// ==========================================
// TRANSACTIONS ROUTES (Agency Commission Model)
// ==========================================

app.post('/api/transactions/sale', async (req, res) => {
    const { propertyId, buyerName, buyerPhone, propertyPrice, agencyCommission, date } = req.body;
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        
        // 1. Find the property to get the Seller's ID
        const propResult = await connection.execute(
            `SELECT owner_id FROM properties WHERE id = :propertyId`,
            { propertyId }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const sellerId = propResult.rows[0].OWNER_ID;

        // 2. Get or Create Buyer
        const buyerId = await getOrCreateCustomer(connection, buyerName, buyerPhone);
        
        // 3. Mark Property as Sold
        await connection.execute(
            `UPDATE properties SET status = 'Sold', price = :price WHERE id = :propertyId`,
            { price: propertyPrice, propertyId }, { autoCommit: true }
        );

        // 4. Record Transaction (Linking Seller and Buyer)
        await connection.execute(
            `INSERT INTO transactions (property_id, transaction_type, seller_id, buyer_tenant_id, property_price, agency_commission, transaction_date) 
             VALUES (:propertyId, 'Sale', :sellerId, :buyerId, :propertyPrice, :agencyCommission, TO_DATE(:txnDate, 'YYYY-MM-DD'))`,
            { propertyId, sellerId, buyerId, propertyPrice, agencyCommission, txnDate: date }, { autoCommit: true }
        );

        res.status(201).send({ message: "Sale transaction recorded successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error recording sale");
    } finally {
        if (connection) { try { await connection.close(); } catch(err){} }
    }
});

// ==========================================
// GET DATA ROUTES
// ==========================================

app.get('/api/transactions', async (req, res) => {
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        // JOIN to get names of both Seller and Buyer
        const result = await connection.execute(
            `SELECT t.*, p.address, s.name AS seller_name, b.name AS buyer_name 
             FROM transactions t 
             LEFT JOIN properties p ON t.property_id = p.id
             LEFT JOIN customers s ON t.seller_id = s.id
             LEFT JOIN customers b ON t.buyer_tenant_id = b.id
             ORDER BY t.id DESC`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching transactions");
    } finally {
        if (connection) { try { await connection.close(); } catch(err){} }
    }
});

app.get('/api/customers', async (req, res) => {
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        const result = await connection.execute(`SELECT * FROM customers ORDER BY id DESC`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        res.json(result.rows);
    } catch (err) {
        res.status(500).send("Error fetching customers");
    } finally {
        if (connection) { try { await connection.close(); } catch(err){} }
    }
});

// ==========================================
// RESTORE ROUTE (Missing for Undo Button)
// ==========================================
app.put('/api/properties/restore/:id', async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        await connection.execute(`UPDATE properties SET is_deleted = 0 WHERE id = :id`, { id }, { autoCommit: true });
        res.send({ message: "Property restored successfully" });
    } catch (err) {
        res.status(500).send("Error restoring property");
    } finally {
        if (connection) { try { await connection.close(); } catch(err){} }
    }
});

// ==========================================
// MEETINGS ROUTES (100% Normalized - 3NF)
// ==========================================
app.get('/api/meetings', async (req, res) => {
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        // SMART JOIN: Database meeting aur customer dono tables ko jod kar data layega
        const result = await connection.execute(
            `SELECT m.id, m.meeting_date, m.meeting_time, m.comments, m.status, 
                    c.name AS customer_name, c.phone 
             FROM meetings m
             JOIN customers c ON m.customer_id = c.id
             WHERE m.status = 'Pending' 
             ORDER BY m.meeting_date ASC, m.meeting_time ASC`, 
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching meetings");
    } finally {
        if (connection) { try { await connection.close(); } catch(err){} }
    }
});

app.post('/api/meetings', async (req, res) => {
    const { name, phone, date, time, comments } = req.body;
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        
        // 1. Get or Create Customer (Returns the Customer ID)
        const customerId = await getOrCreateCustomer(connection, name, phone);

        // 2. Save only the Customer ID in the Meetings table
        await connection.execute(
            `INSERT INTO meetings (customer_id, meeting_date, meeting_time, comments, status) 
             VALUES (:customerId, TO_DATE(:m_date, 'YYYY-MM-DD'), :time, :comments, 'Pending')`, 
            { customerId, m_date: date, time, comments: comments || '' }, 
            { autoCommit: true }
        );
        res.status(201).send({ message: "Meeting scheduled" });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error scheduling meeting");
    } finally {
        if (connection) { try { await connection.close(); } catch(err){} }
    }
});

app.put('/api/meetings/next', async (req, res) => {
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        
        // SMART FIX: Use JOIN to get Name and Phone from the customers table
        const result = await connection.execute(
            `SELECT m.id, m.meeting_date, m.meeting_time, m.comments, m.status, 
                    c.name AS customer_name, c.phone 
             FROM meetings m
             JOIN customers c ON m.customer_id = c.id
             WHERE m.status = 'Pending' 
             ORDER BY m.meeting_date ASC, m.meeting_time ASC 
             FETCH FIRST 1 ROWS ONLY`, 
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        
        if (result.rows.length === 0) return res.status(404).send({ message: "No meetings left!" });
        
        const nextMeeting = result.rows[0];
        
        // Mark as completed using the meeting ID
        await connection.execute(
            `UPDATE meetings SET status = 'Completed' WHERE id = :id`, 
            { id: nextMeeting.ID }, 
            { autoCommit: true }
        );
        
        res.send(nextMeeting);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error calling next meeting");
    } finally {
        if (connection) { try { await connection.close(); } catch(err){} }
    }
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`REMS V2 Backend running successfully on http://localhost:${PORT}`);
});