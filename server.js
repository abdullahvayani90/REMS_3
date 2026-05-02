const express = require('express');
const cors = require('cors');
const oracledb = require('oracledb');
const path = require('node:path');

const app = express();
app.disable('x-powered-by'); 
app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json()); 

// SECURITY FIX: Ab sirf 'public' folder ki files browser mein dikhengi, aapka backend code nahi.
app.use(express.static(path.join(__dirname, 'public')));

const dbConfig = {
    user: "SYSTEM",       
    password: "system123",  
    connectString: "localhost:1521/XE"  
};

// ==========================================
// DB HELPER: Handles connection lifecycle
// ==========================================
async function withConnection(res, errorMsg, callback) {
    let connection;
    try {
        connection = await oracledb.getConnection(dbConfig);
        await callback(connection);
    } catch (err) {
        console.error(err);
        res.status(500).send(errorMsg);
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (closeErr) {
                console.error('Error closing connection:', closeErr);
            }
        }
    }
}

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
    await withConnection(res, "Error fetching properties", async (connection) => {
        const result = await connection.execute(
            `SELECT p.*, c.name AS owner_name, c.phone AS owner_phone 
             FROM properties p 
             LEFT JOIN customers c ON p.owner_id = c.id 
             WHERE p.is_deleted = 0 OR p.is_deleted IS NULL 
             ORDER BY p.id DESC`,
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        res.json(result.rows);
    });
});

app.post('/api/properties', async (req, res) => {
    const { type, area, address, dimensions, price, ownerName, ownerPhone } = req.body;
    await withConnection(res, "Error adding property", async (connection) => {
        const ownerId = await getOrCreateCustomer(connection, ownerName, ownerPhone);
        await connection.execute(
            `INSERT INTO properties (property_type, area, address, dimensions, price, owner_id) 
             VALUES (:type, :area, :address, :dim, :price, :ownerId)`,
            { type, area, address, dim: dimensions, price, ownerId }, { autoCommit: true }
        );
        res.status(201).send({ message: "Property & Owner added successfully" });
    });
});

app.delete('/api/properties/:id', async (req, res) => {
    const { id } = req.params;
    await withConnection(res, "Error deleting property", async (connection) => {
        await connection.execute(
            `UPDATE properties SET is_deleted = 1 WHERE id = :id`, 
            { id }, { autoCommit: true }
        );
        res.send({ message: "Property soft-deleted successfully" });
    });
});

// ==========================================
// TRANSACTIONS ROUTES (Agency Commission Model)
// ==========================================

app.post('/api/transactions/sale', async (req, res) => {
    const { propertyId, buyerName, buyerPhone, propertyPrice, agencyCommission, date } = req.body;
    await withConnection(res, "Error recording sale", async (connection) => {
        const propResult = await connection.execute(
            `SELECT owner_id FROM properties WHERE id = :propertyId`,
            { propertyId }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const sellerId = propResult.rows[0].OWNER_ID;
        const buyerId = await getOrCreateCustomer(connection, buyerName, buyerPhone);
        await connection.execute(
            `UPDATE properties SET status = 'Sold', price = :price WHERE id = :propertyId`,
            { price: propertyPrice, propertyId }, { autoCommit: true }
        );
        await connection.execute(
            `INSERT INTO transactions (property_id, transaction_type, seller_id, buyer_tenant_id, property_price, agency_commission, transaction_date) 
             VALUES (:propertyId, 'Sale', :sellerId, :buyerId, :propertyPrice, :agencyCommission, TO_DATE(:txnDate, 'YYYY-MM-DD'))`,
            { propertyId, sellerId, buyerId, propertyPrice, agencyCommission, txnDate: date }, { autoCommit: true }
        );
        res.status(201).send({ message: "Sale transaction recorded successfully" });
    });
});

// ==========================================
// GET DATA ROUTES
// ==========================================

app.get('/api/transactions', async (req, res) => {
    await withConnection(res, "Error fetching transactions", async (connection) => {
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
    });
});

app.get('/api/customers', async (req, res) => {
    await withConnection(res, "Error fetching customers", async (connection) => {
        const result = await connection.execute(
            `SELECT * FROM customers ORDER BY id DESC`, 
            [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        res.json(result.rows);
    });
});

// ==========================================
// RESTORE ROUTE (Missing for Undo Button)
// ==========================================
app.put('/api/properties/restore/:id', async (req, res) => {
    const { id } = req.params;
    await withConnection(res, "Error restoring property", async (connection) => {
        await connection.execute(
            `UPDATE properties SET is_deleted = 0 WHERE id = :id`, 
            { id }, { autoCommit: true }
        );
        res.send({ message: "Property restored successfully" });
    });
});

// ==========================================
// MEETINGS ROUTES (100% Normalized - 3NF)
// ==========================================
app.get('/api/meetings', async (req, res) => {
    await withConnection(res, "Error fetching meetings", async (connection) => {
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
    });
});

app.post('/api/meetings', async (req, res) => {
    const { name, phone, date, time, comments } = req.body;
    await withConnection(res, "Error scheduling meeting", async (connection) => {
        const customerId = await getOrCreateCustomer(connection, name, phone);
        await connection.execute(
            `INSERT INTO meetings (customer_id, meeting_date, meeting_time, comments, status) 
             VALUES (:customerId, TO_DATE(:m_date, 'YYYY-MM-DD'), :time, :comments, 'Pending')`,
            { customerId, m_date: date, time, comments: comments || '' },
            { autoCommit: true }
        );
        res.status(201).send({ message: "Meeting scheduled" });
    });
});

app.put('/api/meetings/next', async (req, res) => {
    await withConnection(res, "Error calling next meeting", async (connection) => {
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
        await connection.execute(
            `UPDATE meetings SET status = 'Completed' WHERE id = :id`,
            { id: nextMeeting.ID }, { autoCommit: true }
        );
        res.send(nextMeeting);
    });
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`REMS V2 Backend running successfully on http://localhost:${PORT}`);
});