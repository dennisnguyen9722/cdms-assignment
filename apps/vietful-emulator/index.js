const express = require('express');
const { faker } = require('@faker-js/faker');

const app = express();
app.use(express.json());

// seed cố định -> mỗi lần khởi động ra cùng bộ dữ liệu, dễ tái lập khi test
faker.seed(12345);

const TOTAL = 500;
let products = Array.from({ length: TOTAL }, (_, i) => ({
  id: `SP${String(i + 1).padStart(5, '0')}`,
  sku: faker.string.alphanumeric(8).toUpperCase(),
  name: faker.commerce.productName(),
  category: faker.commerce.department(),
  price: faker.number.int({ min: 10000, max: 500000 }),
  stock: faker.number.int({ min: 0, max: 1000 }),
  unit: faker.helpers.arrayElement(['cái', 'thùng', 'lốc']),
  updated_at: new Date().toISOString(),
}));

// tỉ lệ trả lỗi 500, dùng cho kịch bản test chịu lỗi
let chaosRate = 0;

app.use((req, res, next) => {
  if (req.path.startsWith('/_')) return next();
  if (Math.random() < chaosRate) {
    return res.status(500).json({ message: 'Injected failure' });
  }
  next();
});

// API chính: danh sách sản phẩm có phân trang
app.get('/products', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const start = (page - 1) * limit;
  res.json({
    data: products.slice(start, start + limit),
    meta: {
      page, limit, total: products.length,
      total_pages: Math.ceil(products.length / limit)
    },
  });
});

// đổi ngẫu nhiên N sản phẩm -> dùng để demo change detection
app.post('/_mutate', (req, res) => {
  faker.seed();
  const count = parseInt(req.query.count) || 5;
  const changed = [];
  for (let i = 0; i < count; i++) {
    const p = faker.helpers.arrayElement(products);
    p.price = faker.number.int({ min: 10000, max: 500000 });
    p.stock = faker.number.int({ min: 0, max: 1000 });
    p.updated_at = new Date().toISOString();
    changed.push(p.id);
  }
  res.json({ changed });
});

// thêm sản phẩm mới -> demo loại CREATED
app.post('/_add', (req, res) => {
  faker.seed();
  const count = parseInt(req.query.count) || 1;
  const added = [];
  for (let i = 0; i < count; i++) {
    const id = `SP${String(products.length + 1).padStart(5, '0')}`;
    products.push({
      id, sku: faker.string.alphanumeric(8).toUpperCase(),
      name: faker.commerce.productName(),
      category: faker.commerce.department(),
      price: faker.number.int({ min: 10000, max: 500000 }),
      stock: faker.number.int({ min: 0, max: 1000 }),
      unit: 'cái', updated_at: new Date().toISOString(),
    });
    added.push(id);
  }
  res.json({ added });
});

// bật/tắt chaos: POST /_chaos?rate=0.3
app.post('/_chaos', (req, res) => {
  chaosRate = Math.min(1, Math.max(0, parseFloat(req.query.rate) || 0));
  res.json({ chaosRate });
});

app.listen(3001, () => console.log('Vietful emulator on :3001'));
