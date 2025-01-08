var mysql = require('mysql');
var express = require('express');
var app = express();
const bcrypt = require('bcrypt');
const session = require('express-session');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
var port = 3000;
const path = require('path');
require('dotenv').config();

var mysql = require('mysql');
var cnn = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

cnn.connect(function (err) {
  if (err) throw err;
  console.log("Connected to MySQL!");
});

app.use(session({
  secret: 'your-secret-key', // 替換為更安全的密鑰
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // 如果使用 HTTPS，設為 true
    httpOnly: true,
    maxAge: 3600000 // Session 期限 (1 小時)
  }
}));
app.get('/api/parts', (req, res) => {
  const sql = 'SELECT * FROM Categories'; // 確保資料庫的 categories 表存在
  cnn.query(sql, (err, results) => {
    if (err) {
      console.error('Failed to fetch data from database:', err);
      res.status(500).send('Failed to fetch data');
      return;
    }
    res.json(results); // 返回 JSON 給前端
  });
});
app.get('/api/products/:category_id', (req, res) => {
  const categoryId = req.params.category_id;
  const sql = 'SELECT * FROM Products WHERE category_id = ?';

  cnn.query(sql, [categoryId], (err, results) => {
    if (err) {
      console.error('Failed to fetch products:', err);
      return res.status(500).send('Failed to fetch products');
    }
    res.json(results); // 返回 JSON 給前端
  });
});

// 註冊功能
app.post('/register', (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).send('All fields are required');
  }

  cnn.query('SELECT * FROM Users WHERE username = ?', [username], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Database query failed');
    }

    if (results.length > 0) {
      return res.status(400).send('Username already exists');
    }

    bcrypt.hash(password, 10, (err, hashedPassword) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Password hashing failed');
      }

      const sql = 'INSERT INTO Users (username, email, password, created_at) VALUES (?, ?, ?, NOW())';
      cnn.query(sql, [username, email, hashedPassword], (err) => {
        if (err) {
          console.error(err);
          return res.status(500).send('Database insertion failed');
        }
        res.status(200).send('User registered successfully');
      });
    });
  });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  cnn.query('SELECT * FROM Users WHERE username = ?', [username], (err, results) => {
    if (err) {
      return res.status(500).send('Database query failed');
    }
    if (results.length === 0) {
      return res.status(400).send('Invalid username or password');
    }

    bcrypt.compare(password, results[0].password, (err, isMatch) => {
      if (err) {
        return res.status(500).send('Password comparison failed');
      }
      if (!isMatch) {
        return res.status(400).send('Invalid username or password');
      }

      // 保存用戶資訊到 Session
      req.session.user = {
        id: results[0].user_id,
        username: results[0].username,
        email: results[0].email
      };

      res.status(200).json({ message: 'Login successful', redirectTo: '/dashboard.html' });
    });
  });
});
app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).send('Logout failed');
    }
    res.status(200).send('Logout successful');
  });
});

app.use(express.static('public'));
// 用於取得當前登入用戶的資訊
app.get('/user-info', (req, res) => {
  if (!req.session.user) {
    return res.status(401).send('Unauthorized');
  }
  res.status(200).json({
    user_id: req.session.user.id,
    username: req.session.user.username,
    email: req.session.user.email
  });
});
app.post('/api/cart', (req, res) => {
  if (!req.session.user) {
    return res.status(401).send('Unauthorized');
  }

  const userId = req.session.user.id;
  const { productId, quantity } = req.body;

  if (!productId || quantity <= 0) {
    console.error('Invalid product or quantity:', { productId, quantity });
    return res.status(400).send('Invalid product or quantity');
  }

  // 確保用戶有購物車
  const ensureCartSql = 'INSERT INTO Cart (user_id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM Cart WHERE user_id = ?)';
  cnn.query(ensureCartSql, [userId, userId], (err) => {
    if (err) {
      console.error('Error ensuring cart:', err.message);
      return res.status(500).send('Failed to ensure cart');
    }

    // 獲取購物車 ID
    const cartSql = 'SELECT cart_id FROM Cart WHERE user_id = ?';
    cnn.query(cartSql, [userId], (err, results) => {
      if (err || results.length === 0) {
        console.error('Error finding cart:', err?.message || 'Cart not found');
        return res.status(500).send('Failed to find cart');
      }

      const cartId = results[0].cart_id;

      // 插入或更新購物車項目
      const updateSql = `
        INSERT INTO CartItems (cart_id, product_id, quantity)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity);
      `;

      cnn.query(updateSql, [cartId, productId, quantity], (err) => {
        if (err) {
          console.error('Error updating cart:', err.message);
          return res.status(500).send('Failed to update cart');
        }
        res.status(200).send('Cart updated successfully');
      });
    });
  });
});
app.get('/api/cart', (req, res) => {
  if (!req.session.user) {
    return res.status(401).send('Unauthorized');
  }

  const userId = req.session.user.id;

  const query = `
  SELECT ci.item_id, ci.quantity, p.name AS product_name, p.price, (ci.quantity * p.price) AS total_price
  FROM CartItems ci
  JOIN Cart c ON ci.cart_id = c.cart_id
  JOIN Products p ON ci.product_id = p.product_id
  WHERE c.user_id = ?
`;

  cnn.query(query, [userId], (err, results) => {
    if (err) {
      console.error('Error fetching cart:', err.message);
      return res.status(500).send('Failed to fetch cart');
    }
    res.status(200).json(results); // 返回查詢結果到前端
  });
});
app.delete('/api/cart/:itemId', (req, res) => {
  if (!req.session.user) {
    return res.status(401).send('Unauthorized');
  }

  const itemId = req.params.itemId;

  const query = 'DELETE FROM CartItems WHERE item_id = ?';

  cnn.query(query, [itemId], (err, results) => {
    if (err) {
      console.error('Error deleting item from cart:', err.message);
      return res.status(500).send('Failed to delete item');
    }

    if (results.affectedRows === 0) {
      return res.status(404).send('Item not found');
    }

    res.status(200).send('Item deleted successfully');
  });
});
app.put('/api/cart/:itemId', (req, res) => {
  if (!req.session.user) {
    return res.status(401).send('Unauthorized');
  }

  const itemId = req.params.itemId;
  const { quantity } = req.body;

  if (quantity <= 0) {
    return res.status(400).send('Invalid quantity');
  }

  const query = 'UPDATE CartItems SET quantity = ? WHERE item_id = ?';

  cnn.query(query, [quantity, itemId], (err, results) => {
    if (err) {
      console.error('Error updating cart item:', err.message);
      return res.status(500).send('Failed to update item');
    }

    if (results.affectedRows === 0) {
      return res.status(404).send('Item not found');
    }

    res.status(200).send('Item updated successfully');
  });
});

app.post('/api/checkout', (req, res) => {
  if (!req.session.user) {
    return res.status(401).send('Unauthorized');
  }

  const userId = req.session.user.id;

  // 創建訂單
  const insertOrderQuery = `
    INSERT INTO Orders (user_id, total_price)
    SELECT ?, SUM(ci.quantity * p.price)
    FROM CartItems ci
    JOIN Cart c ON ci.cart_id = c.cart_id
    JOIN Products p ON ci.product_id = p.product_id
    WHERE c.user_id = ?;
  `;

  cnn.query(insertOrderQuery, [userId, userId], (err, results) => {
    if (err) {
      console.error('Error creating order:', err.message);
      return res.status(500).send('Failed to create order');
    }

    const orderId = results.insertId; // 獲取新生成的訂單 ID

    // 將購物車項目插入訂單明細
    const insertOrderDetailsQuery = `
      INSERT INTO OrderDetails (order_id, product_id, quantity, unit_price)
      SELECT ?, ci.product_id, ci.quantity, p.price
      FROM CartItems ci
      JOIN Cart c ON ci.cart_id = c.cart_id
      JOIN Products p ON ci.product_id = p.product_id
      WHERE c.user_id = ?;
    `;

    cnn.query(insertOrderDetailsQuery, [orderId, userId], (err) => {
      if (err) {
        console.error('Error creating order details:', err.message);
        return res.status(500).send('Failed to create order details');
      }

      // 清空購物車
      const clearCartQuery = `
        DELETE ci
        FROM CartItems ci
        JOIN Cart c ON ci.cart_id = c.cart_id
        WHERE c.user_id = ?;
      `;
      cnn.query(clearCartQuery, [userId], (err) => {
        if (err) {
          console.error('Error clearing cart:', err.message);
          return res.status(500).send('Failed to clear cart');
        }

        res.status(200).send('Checkout successful');
      });
    });
  });
});

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
