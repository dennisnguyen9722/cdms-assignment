// Sinh file Excel mẫu để test upload.
// Dùng: node scripts/make-excel.js [số dòng] [tên file]
const XLSX = require('./../apps/cdms/node_modules/xlsx');

const n = parseInt(process.argv[2]) || 20;
const out = process.argv[3] || '/tmp/products.xlsx';
const stamp = Date.now();

const rows = Array.from({ length: n }, (_, i) => ({
  id: `XLS${stamp}-${i}`,
  sku: `SKU${i}`,
  name: `Sản phẩm từ Excel ${i}`,
  category: 'Excel Import',
  price: 10000 + i * 1000,
  stock: 100 + i,
  unit: 'cái',
}));

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Products');
XLSX.writeFile(wb, out);
console.log(`Đã tạo ${out} với ${n} dòng`);
