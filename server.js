const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Keshni o'chirish
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

// Serve static files from current directory
app.use(express.static(path.join(__dirname)));

// Baza bilan ulanish
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), (err) => {
    if (err) {
        console.error('Baza bilan ulanishda xato:', err.message);
    } else {
        console.log('SQLite bazasiga muvaffaqiyatli ulandi.');
        
        // Jadvallarni yaratish
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                login TEXT UNIQUE NOT NULL,
                parol TEXT NOT NULL,
                role TEXT DEFAULT 'user'
            )`);

            // Adminni bazaga avtomatik qo'shish (agar yo'q bo'lsa)
            db.get(`SELECT * FROM users WHERE login = 'admin'`, [], (err, row) => {
                if (!row) {
                    db.run(`INSERT INTO users (login, parol, role) VALUES ('admin', '1234', 'admin')`);
                }
            });

            db.run(`CREATE TABLE IF NOT EXISTS carpets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                number TEXT NOT NULL,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                width REAL,
                length REAL,
                price TEXT,
                cost REAL,
                quantity REAL DEFAULT 0
            )`);
            
            db.run(`ALTER TABLE carpets ADD COLUMN quantity REAL DEFAULT 0`, (err) => {});

            db.run(`CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )`);

            const defaultSettings = {
                dollar_rate: '12500',
                shop_name: 'GILAMLAR OLAMI',
                shop_phone: '+998 90 123 45 67',
                shop_phone2: '+998 99 987 65 43',
                shop_address: 'Toshkent shahri',
                receipt_footer: 'Xaridingiz uchun rahmat!',
                receipt_paper_width: '80mm'
            };

            Object.entries(defaultSettings).forEach(([k, v]) => {
                db.get(`SELECT * FROM settings WHERE key = ?`, [k], (err, row) => {
                    if (!row) {
                        db.run(`INSERT INTO settings (key, value) VALUES (?, ?)`, [k, v]);
                    }
                });
            });

            db.run(`CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT,
                phone2 TEXT,
                address TEXT,
                notes TEXT
            )`);

            db.all(`PRAGMA table_info(customers)`, (err, columns) => {
                if (!err && columns) {
                    const colNames = columns.map(c => c.name);
                    if (!colNames.includes('phone2')) db.run(`ALTER TABLE customers ADD COLUMN phone2 TEXT`);
                    if (!colNames.includes('address')) db.run(`ALTER TABLE customers ADD COLUMN address TEXT`);
                    if (!colNames.includes('notes')) db.run(`ALTER TABLE customers ADD COLUMN notes TEXT`);
                }
            });

            db.run(`CREATE TABLE IF NOT EXISTS sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER,
                customer_name TEXT,
                total REAL,
                paid_amount REAL,
                payment_type TEXT,
                payments_json TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            )`);

            db.all(`PRAGMA table_info(sales)`, (err, columns) => {
                if (!err && columns) {
                    const colNames = columns.map(c => c.name);
                    if (!colNames.includes('payments_json')) db.run(`ALTER TABLE sales ADD COLUMN payments_json TEXT`);
                }
            });

            db.run(`CREATE TABLE IF NOT EXISTS sale_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sale_id INTEGER,
                carpet_id INTEGER,
                carpet_name TEXT,
                carpet_number TEXT,
                width REAL,
                length REAL,
                type TEXT,
                quantity REAL,
                price TEXT,
                jami REAL
            )`);

            db.all(`PRAGMA table_info(sale_items)`, (err, columns) => {
                if (!err && columns) {
                    const colNames = columns.map(c => c.name);
                    if (!colNames.includes('width')) db.run(`ALTER TABLE sale_items ADD COLUMN width REAL`);
                    if (!colNames.includes('length')) db.run(`ALTER TABLE sale_items ADD COLUMN length REAL`);
                    if (!colNames.includes('type')) db.run(`ALTER TABLE sale_items ADD COLUMN type TEXT`);
                }
            });

            db.run(`CREATE TABLE IF NOT EXISTS kassa_withdrawals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amount REAL NOT NULL,
                payment_type TEXT,
                payments_json TEXT,
                reason TEXT,
                created_by TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            )`);
        });
    }
});

// ======================= API YO'NALISHLARI =======================

// 1. Tizimga kirish (Login)
app.post('/api/login', (req, res) => {
    const { login, parol } = req.body;
    
    db.get('SELECT * FROM users WHERE login = ? AND parol = ?', [login, parol], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (row) {
            res.json({ success: true, role: row.role || 'user' });
        } else {
            res.json({ success: false, message: "Login yoki parol noto'g'ri!" });
        }
    });
});

// 2. Foydalanuvchilarni olish (admindan tashqari boshqalarni ko'rsatish)
app.get('/api/users', (req, res) => {
    db.all('SELECT * FROM users WHERE login != "admin"', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 3. Yangi foydalanuvchi qo'shish
app.post('/api/users', (req, res) => {
    const { login, parol } = req.body;
    
    db.run('INSERT INTO users (login, parol, role) VALUES (?, ?, "user")', [login, parol], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: 'Bu login band!' });
            }
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, id: this.lastID });
    });
});

// 4. Foydalanuvchini tahrirlash (yoki parolini almashtirish)
app.put('/api/users/:oldLogin', (req, res) => {
    const { login, parol } = req.body;
    const oldLogin = req.params.oldLogin;

    db.run('UPDATE users SET login = ?, parol = ? WHERE login = ?', [login, parol, oldLogin], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: 'Bu login band!' });
            }
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true });
    });
});

// 5. Foydalanuvchini o'chirish
app.delete('/api/users/:login', (req, res) => {
    db.run('DELETE FROM users WHERE login = ?', [req.params.login], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 6. Gilamlarni ro'yxatini olish (sotilgan miqdori hisoblangan holda)
app.get('/api/carpets', (req, res) => {
    const query = `
        SELECT 
            c.*,
            COALESCE(SUM(si.quantity), 0) AS total_sold
        FROM carpets c
        LEFT JOIN sale_items si ON si.carpet_id = c.id
        GROUP BY c.id
        ORDER BY c.name ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 7. Yangi gilam qo'shish
app.post('/api/carpets', (req, res) => {
    const { number, name, type, width, length, price, cost } = req.body;
    db.run(`INSERT INTO carpets (number, name, type, width, length, price, cost) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`, 
        [number, name, type, width, length, price, cost], 
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

// Gilamni tahrirlash
app.put('/api/carpets/:id', (req, res) => {
    const { number, name, type, width, length, price, cost } = req.body;
    db.run(`UPDATE carpets SET number = ?, name = ?, type = ?, width = ?, length = ?, price = ?, cost = ? WHERE id = ?`, 
        [number, name, type, width, length, price, cost, req.params.id], 
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Gilamga kirim qilish
app.post('/api/carpets/:id/kirim', (req, res) => {
    const { quantity } = req.body;
    db.run('UPDATE carpets SET quantity = COALESCE(quantity, 0) + ? WHERE id = ?', [quantity, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Gilamni kovrikka aylantirish
app.post('/api/carpets/:id/kovrik', (req, res) => {
    const carpetId = req.params.id;
    const quantity = parseFloat(req.body.quantity) || 0;
    const price = req.body.price ? String(req.body.price).trim() : '20 000';

    if (quantity <= 0) {
        return res.status(400).json({ error: "Коврик сони нолдан катта бўлиши керак!" });
    }

    db.serialize(() => {
        // 1. Tanlangan gilam miqdorini 0 ga tushirish va raqamini bo'shatish
        db.run('UPDATE carpets SET quantity = 0, number = \'\' WHERE id = ?', [carpetId], function(err) {
            if (err) return res.status(500).json({ error: err.message });

            // 2. Bazadan 'Коврик' nomli mahsulotni qidirish
            db.get(
                "SELECT * FROM carpets WHERE LOWER(TRIM(name)) = 'коврик' OR LOWER(TRIM(name)) = 'kovrik' LIMIT 1",
                [],
                (err, kovrikRow) => {
                    if (err) return res.status(500).json({ error: err.message });

                    if (kovrikRow) {
                        // Agar kovrik mavjud bo'lsa, sonini oshiramiz va narxini yangilaymiz
                        db.run(
                            'UPDATE carpets SET quantity = COALESCE(quantity, 0) + ?, price = ? WHERE id = ?',
                            [quantity, price, kovrikRow.id],
                            function(updateErr) {
                                if (updateErr) return res.status(500).json({ error: updateErr.message });
                                res.json({ success: true, kovrikId: kovrikRow.id });
                            }
                        );
                    } else {
                        // Agar mavjud bo'lmasa, yangi 'Коврик' tovarini yaratamiz
                        db.run(
                            'INSERT INTO carpets (number, name, type, width, length, price, cost, quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                            ['', 'Коврик', 'dona', 0, 0, price, 0, quantity],
                            function(insertErr) {
                                if (insertErr) return res.status(500).json({ error: insertErr.message });
                                res.json({ success: true, kovrikId: this.lastID });
                            }
                        );
                    }
                }
            );
        });
    });
});

// Customers - ro'yxat (qarzdorlik hisoblangan holda)
app.get('/api/customers', (req, res) => {
    const query = `
        SELECT 
            c.*,
            MAX(0, COALESCE(SUM(s.total), 0) - COALESCE(SUM(s.paid_amount), 0)) AS debt
        FROM customers c
        LEFT JOIN sales s ON (s.customer_id = c.id OR (s.customer_id IS NULL AND s.customer_name = c.name))
        GROUP BY c.id
        ORDER BY c.name ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Haridorning qarz to'lovini qabul qilish (Kassaga kirim qilish)
app.post('/api/customers/:id/pay-debt', (req, res) => {
    const customerId = parseInt(req.params.id);
    const { payments, total_paid, payment_type } = req.body;
    const numPaid = parseFloat(total_paid) || 0;

    if (numPaid <= 0) {
        return res.status(400).json({ error: "To'lov summasi 0 dan katta bo'lishi kerak!" });
    }

    db.get('SELECT * FROM customers WHERE id = ?', [customerId], (err, customer) => {
        if (err || !customer) {
            return res.status(404).json({ error: "Haridor topilmadi!" });
        }

        let finalPayments = payments;
        let finalPaymentType = payment_type || '';
        if (payments && Array.isArray(payments) && payments.length > 0) {
            finalPaymentType = payments.map(p => `${p.type}: ${Number(p.amount || 0).toLocaleString('ru-RU').replace(/,/g, ' ')} so'm`).join(', ');
        } else {
            finalPayments = [{ type: payment_type || 'Naqd', amount: numPaid }];
            finalPaymentType = payment_type || 'Naqd';
        }
        const paymentsJsonStr = JSON.stringify(finalPayments || []);

        db.serialize(() => {
            // 1. Yangi to'lov (kassa kirimi) yozuvini sales jadvaliga qo'shish (total = 0, paid_amount = numPaid)
            db.run(
                `INSERT INTO sales (customer_id, customer_name, total, paid_amount, payment_type, payments_json) 
                 VALUES (?, ?, 0, ?, ?, ?)`,
                [customer.id, customer.name, numPaid, finalPaymentType, paymentsJsonStr],
                function(insertErr) {
                    if (insertErr) return res.status(500).json({ error: insertErr.message });
                    const saleId = this.lastID;

                    // 2. sale_items ga qarz to'lovi tafsilotini yozish
                    db.run(
                        `INSERT INTO sale_items (sale_id, carpet_name, carpet_number, quantity, price, jami)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [saleId, "Qarz to'lovi", "", 1, numPaid.toLocaleString('ru-RU').replace(/,/g, ' '), numPaid],
                        function(itemErr) {
                            if (itemErr) return res.status(500).json({ error: itemErr.message });

                            res.json({
                                success: true,
                                saleId,
                                sale: {
                                    id: saleId,
                                    customer_id: customer.id,
                                    customer_name: customer.name,
                                    total: numPaid,
                                    paid_amount: numPaid,
                                    payment_type: finalPaymentType,
                                    payments: finalPayments,
                                    items: [
                                        {
                                            carpet_name: "Qarz to'lovi",
                                            carpet_number: "",
                                            quantity: 1,
                                            price: numPaid.toLocaleString('ru-RU').replace(/,/g, ' '),
                                            jami: numPaid
                                        }
                                    ],
                                    created_at: new Date().toLocaleString('uz-UZ')
                                }
                            });
                        }
                    );
                }
            );
        });
    });
});

// Customers - yangi qo'shish
app.post('/api/customers', (req, res) => {
    const { name, phone, phone2, address, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Ism kiritilmadi' });
    db.run(
        'INSERT INTO customers (name, phone, phone2, address, notes) VALUES (?, ?, ?, ?, ?)',
        [name, phone || '', phone2 || '', address || '', notes || ''],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({
                success: true,
                id: this.lastID,
                name,
                phone: phone || '',
                phone2: phone2 || '',
                address: address || '',
                notes: notes || '',
                debt: 0
            });
        }
    );
});

// Customers - tahrirlash
app.put('/api/customers/:id', (req, res) => {
    const { name, phone, phone2, address, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Ism kiritilmadi' });
    db.run(
        'UPDATE customers SET name = ?, phone = ?, phone2 = ?, address = ?, notes = ? WHERE id = ?',
        [name, phone || '', phone2 || '', address || '', notes || '', req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Customers - o'chirish
app.delete('/api/customers/:id', (req, res) => {
    db.run('DELETE FROM customers WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Savatdagi tovarlarni sotish
app.post('/api/sell', (req, res) => {
    const { cart, customer_id, customer_name, paid_amount, payment_type, payments } = req.body;
    if (!cart || !Array.isArray(cart)) return res.status(400).json({ error: "Noto'g'ri ma'lumot" });

    const total = cart.reduce((sum, item) => sum + (item.jami || 0), 0);

    let finalPaymentType = payment_type || '';
    let finalPaidAmount = paid_amount !== undefined ? paid_amount : total;

    let finalPayments = payments;
    if (payments && Array.isArray(payments) && payments.length > 0) {
        finalPaymentType = payments.map(p => `${p.type}: ${Number(p.amount || 0).toLocaleString('ru-RU').replace(/,/g, ' ')} so'm`).join(', ');
        finalPaidAmount = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        if (total > finalPaidAmount) {
            finalPaymentType += `, Nasiya: ${(total - finalPaidAmount).toLocaleString('ru-RU').replace(/,/g, ' ')} so'm`;
        }
    } else {
        finalPayments = finalPaidAmount > 0 ? [{ type: payment_type || 'Naqd', amount: finalPaidAmount }] : [];
    }
    const paymentsJsonStr = JSON.stringify(finalPayments || []);

    db.serialize(() => {
        // 1. Sotuvni saqlash
        db.run(
            `INSERT INTO sales (customer_id, customer_name, total, paid_amount, payment_type, payments_json) VALUES (?, ?, ?, ?, ?, ?)`,
            [customer_id || null, customer_name || '', total, finalPaidAmount, finalPaymentType, paymentsJsonStr],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                const saleId = this.lastID;

                // 2. Sotilgan mahsulotlarni saqlash
                const itemStmt = db.prepare(
                    `INSERT INTO sale_items (sale_id, carpet_id, carpet_name, carpet_number, width, length, type, quantity, price, jami)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                );
                cart.forEach(item => {
                    itemStmt.run([saleId, item.carpetId, item.name, item.number, item.width || null, item.length || null, item.type || '', item.quantity, item.price, item.jami]);
                });
                itemStmt.finalize();

                // 3. Gilam miqdorini kamaytirish
                const carpetStmt = db.prepare('UPDATE carpets SET quantity = COALESCE(quantity, 0) - ? WHERE id = ?');
                cart.forEach(item => {
                    carpetStmt.run([item.quantity, item.carpetId]);
                });
                carpetStmt.finalize((err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    db.run(`UPDATE carpets SET number = '' WHERE quantity <= 0`, [], function(err) {
                        res.json({
                            success: true,
                            saleId,
                            sale: {
                                id: saleId,
                                customer_id: customer_id || null,
                                customer_name: customer_name || 'Oddiy xaridor',
                                total,
                                paid_amount: finalPaidAmount,
                                payment_type: finalPaymentType,
                                payments: finalPayments,
                                items: cart,
                                created_at: new Date().toLocaleString('uz-UZ')
                            }
                        });
                    });
                });
            }
        );
    });
});

// 7.2. Savdolar (Kassa) ro'yxatini olish
app.get('/api/sales', (req, res) => {
    db.all('SELECT * FROM sales ORDER BY id DESC', [], (err, salesRows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!salesRows || salesRows.length === 0) return res.json([]);

        db.all('SELECT * FROM sale_items ORDER BY id ASC', [], (err2, itemRows) => {
            if (err2) return res.status(500).json({ error: err2.message });
            
            const sales = salesRows.map(sale => ({
                ...sale,
                items: (itemRows || []).filter(item => item.sale_id === sale.id)
            }));
            res.json(sales);
        });
    });
});

// 7.3. Kassadan pul yechish (Chiqim)
app.post('/api/kassa/withdraw', (req, res) => {
    const { amount, payment_type, payments, reason, created_by } = req.body;
    const numAmount = parseFloat(amount) || 0;
    if (numAmount <= 0) return res.status(400).json({ error: "Yechiladigan summa 0 dan katta bo'lishi kerak" });

    // Kassadagi mavjud qoldiqni tekshirish
    db.all('SELECT paid_amount, payment_type, payments_json FROM sales', [], (errSales, salesRows) => {
        if (errSales) return res.status(500).json({ error: errSales.message });

        db.all('SELECT amount, payment_type, payments_json FROM kassa_withdrawals', [], (errWithdraw, withdrawRows) => {
            if (errWithdraw) return res.status(500).json({ error: errWithdraw.message });

            let totalCashIncome = 0;
            let totalCardIncome = 0;
            let totalIncome = 0;

            (salesRows || []).forEach(s => {
                const paid = parseFloat(s.paid_amount) || 0;
                totalIncome += paid;

                let parsed = false;
                if (s.payments_json) {
                    try {
                        const arr = JSON.parse(s.payments_json);
                        if (Array.isArray(arr) && arr.length > 0) {
                            arr.forEach(p => {
                                const amt = parseFloat(p.amount) || 0;
                                const t = (p.type || '').toLowerCase();
                                if (t.includes('naqd')) totalCashIncome += amt;
                                else if (t.includes('plastik') || t.includes('karta')) totalCardIncome += amt;
                                else if (!t.includes('nasiya')) totalCardIncome += amt;
                            });
                            parsed = true;
                        }
                    } catch(e) {}
                }

                if (!parsed) {
                    const pType = (s.payment_type || '').toLowerCase();
                    if (pType.includes(':')) {
                        const parts = (s.payment_type || '').split(',');
                        parts.forEach(part => {
                            const [t, val] = part.split(':');
                            if (t && val) {
                                const cleanVal = parseFloat(val.replace(/\D/g, '')) || 0;
                                const lowT = t.toLowerCase().trim();
                                if (lowT.includes('naqd')) totalCashIncome += cleanVal;
                                else if (lowT.includes('plastik') || lowT.includes('karta')) totalCardIncome += cleanVal;
                            }
                        });
                    } else {
                        if (pType.includes('plastik') || pType.includes('karta')) totalCardIncome += paid;
                        else if (!pType.includes('nasiya')) totalCashIncome += paid;
                    }
                }
            });

            let totalCashWithdraw = 0;
            let totalCardWithdraw = 0;
            let totalWithdraw = 0;

            (withdrawRows || []).forEach(w => {
                const wAmt = parseFloat(w.amount) || 0;
                totalWithdraw += wAmt;

                let parsed = false;
                if (w.payments_json) {
                    try {
                        const arr = JSON.parse(w.payments_json);
                        if (Array.isArray(arr) && arr.length > 0) {
                            arr.forEach(p => {
                                const amt = parseFloat(p.amount) || 0;
                                const t = (p.type || '').toLowerCase();
                                if (t.includes('naqd')) totalCashWithdraw += amt;
                                else if (t.includes('plastik') || t.includes('karta')) totalCardWithdraw += amt;
                                else totalCardWithdraw += amt;
                            });
                            parsed = true;
                        }
                    } catch(e) {}
                }

                if (!parsed) {
                    const pType = (w.payment_type || '').toLowerCase();
                    if (pType.includes('plastik') || pType.includes('karta')) totalCardWithdraw += wAmt;
                    else totalCashWithdraw += wAmt;
                }
            });

            const availCash = totalCashIncome - totalCashWithdraw;
            const availCard = totalCardIncome - totalCardWithdraw;
            const availTotal = totalIncome - totalWithdraw;

            // Yechilayotgan turlarni tekshirish
            let reqCash = 0;
            let reqCard = 0;

            if (payments && Array.isArray(payments) && payments.length > 0) {
                payments.forEach(p => {
                    const amt = parseFloat(p.amount) || 0;
                    const t = (p.type || '').toLowerCase();
                    if (t.includes('naqd')) reqCash += amt;
                    else reqCard += amt;
                });
            } else {
                const pType = (payment_type || '').toLowerCase();
                if (pType.includes('plastik') || pType.includes('karta')) reqCard = numAmount;
                else reqCash = numAmount;
            }

            if (reqCash > 0 && reqCash > availCash) {
                return res.status(400).json({
                    error: `Kassada yetarli naqd pul mavjud emas! Mavjud naqd: ${availCash.toLocaleString('ru-RU').replace(/,/g, ' ')} so'm. So'ralgan: ${reqCash.toLocaleString('ru-RU').replace(/,/g, ' ')} so'm.`
                });
            }

            if (reqCard > 0 && reqCard > availCard) {
                return res.status(400).json({
                    error: `Plastik hisobida yetarli mablag' mavjud emas! Mavjud: ${availCard.toLocaleString('ru-RU').replace(/,/g, ' ')} so'm. So'ralgan: ${reqCard.toLocaleString('ru-RU').replace(/,/g, ' ')} so'm.`
                });
            }

            if (numAmount > availTotal) {
                return res.status(400).json({
                    error: `Kassada yetarli umumiy mablag' mavjud emas! Mavjud qoldiq: ${availTotal.toLocaleString('ru-RU').replace(/,/g, ' ')} so'm. So'ralgan: ${numAmount.toLocaleString('ru-RU').replace(/,/g, ' ')} so'm.`
                });
            }

            const payments_json = payments ? JSON.stringify(payments) : '[]';

            db.run(
                `INSERT INTO kassa_withdrawals (amount, payment_type, payments_json, reason, created_by) VALUES (?, ?, ?, ?, ?)`,
                [numAmount, payment_type || 'Naqd', payments_json, reason || 'Kassadan yechildi', created_by || 'admin'],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true, id: this.lastID });
                }
            );
        });
    });
});

// 7.4. Kassadan yechilgan pullar (Chiqimlar) ro'yxati
app.get('/api/kassa/withdrawals', (req, res) => {
    db.all('SELECT * FROM kassa_withdrawals ORDER BY id DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// 7.5. Chiqimni bekor qilish / o'chirish
app.delete('/api/kassa/withdrawals/:id', (req, res) => {
    db.run('DELETE FROM kassa_withdrawals WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Gilamni o'chirish
app.delete('/api/carpets/:id', (req, res) => {
    db.run('DELETE FROM carpets WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 8. Barcha sozlamalarni olish (Do'kon nomi, telefon, printer va boshqalar)
app.get('/api/settings', (req, res) => {
    db.all("SELECT key, value FROM settings", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const settings = {};
        (rows || []).forEach(r => {
            settings[r.key] = r.value;
        });
        res.json(settings);
    });
});

// 8.1. Sozlamalarni yangilash (bir nechta kalitlarni birdaniga saqlash)
app.post('/api/settings', (req, res) => {
    const data = req.body;
    if (!data || typeof data !== 'object') return res.status(400).json({ error: "Noto'g'ri ma'lumot" });

    db.serialize(() => {
        const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
        Object.entries(data).forEach(([k, v]) => {
            if (v !== undefined && v !== null) {
                stmt.run([k, String(v)]);
            }
        });
        stmt.finalize((err) => {
            if (err) return res.status(500).json({ error: err.message });

            // Agar dollar kursi o'zgargan bo'lsa, gilamlar sotish narxini qayta hisoblash
            if (data.dollar_rate) {
                const rate = parseFloat(data.dollar_rate) || 0;
                if (rate > 0) {
                    db.all("SELECT id, cost, type, width FROM carpets WHERE cost IS NOT NULL AND cost > 0", [], (err, carpets) => {
                        if (err || !carpets) return res.json({ success: true });
                        const cStmt = db.prepare("UPDATE carpets SET price = ? WHERE id = ?");
                        carpets.forEach(c => {
                            let calculated = c.cost * rate * 1.2;
                            if (c.type === 'kvadrat' && c.width > 0) {
                                calculated = calculated * c.width;
                            }
                            const formattedPrice = Number(Math.round(calculated)).toLocaleString('ru-RU').replace(/,/g, ' ');
                            cStmt.run([formattedPrice, c.id]);
                        });
                        cStmt.finalize();
                        return res.json({ success: true });
                    });
                    return;
                }
            }
            res.json({ success: true });
        });
    });
});

// 8.2. Dollar kursini olish (Eski endpoint bilan moslik uchun)
app.get('/api/settings/dollar', (req, res) => {
    db.get("SELECT value FROM settings WHERE key = 'dollar_rate'", [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ rate: row ? row.value : '0' });
    });
});

// 8.3. Dollar kursini yangilash
app.put('/api/settings/dollar', (req, res) => {
    const { rate } = req.body;
    db.run("UPDATE settings SET value = ? WHERE key = 'dollar_rate'", [rate], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Avtomatik ravishda barcha gilamlar narxini ham yangilab qo'yamiz (Sotish narxi = cost * rate * 1.2)
        db.all("SELECT id, cost, type, width FROM carpets WHERE cost IS NOT NULL AND cost > 0", [], (err, carpets) => {
            if (err || !carpets) {
                return res.json({ success: true });
            }
            const stmt = db.prepare("UPDATE carpets SET price = ? WHERE id = ?");
            carpets.forEach(c => {
                let calculated = c.cost * rate * 1.2;
                if (c.type === 'kvadrat' && c.width > 0) {
                    calculated = calculated * c.width;
                }
                const formattedPrice = Number(Math.round(calculated)).toLocaleString('ru-RU').replace(/,/g, ' ');
                stmt.run([formattedPrice, c.id]);
            });
            stmt.finalize();
            res.json({ success: true });
        });
    });
});

// 10. Barcha o'zgarishlar index.html ga borishi uchun catch-all
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serverni ishga tushirish
app.listen(port, () => {
    console.log(`Server ishga tushdi: http://localhost:${port}`);
});
