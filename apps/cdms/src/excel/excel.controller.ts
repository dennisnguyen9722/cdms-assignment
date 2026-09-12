import {
  BadRequestException,
  Controller,
  HttpCode,
  Logger,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'crypto';
import * as XLSX from 'xlsx';
import { DbService } from '../db/db.service';

/** Chỉ khai báo những field thực sự dùng, tránh phụ thuộc vào global types của multer */
interface UploadedExcelFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

@Controller('upload')
export class ExcelController {
  private readonly log = new Logger('Excel');

  constructor(private db: DbService) {}

  @Post('products')
  @HttpCode(202)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  async upload(@UploadedFile() file: UploadedExcelFile) {
    if (!file) throw new BadRequestException('Thiếu file');

    // Khóa chống trùng = hash nội dung file.
    // Upload lại đúng file cũ là lỗi phổ biến nhất của người vận hành.
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const key = `excel:${fileHash}`;

    let rows: any[];
    try {
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet);
    } catch {
      throw new BadRequestException('Không đọc được file Excel');
    }

    if (!rows.length) throw new BadRequestException('File rỗng');

    const products = rows.map((r) => this.normalize(r));
    const invalid = products.filter((p) => !p.id);
    if (invalid.length) {
      throw new BadRequestException(
        `${invalid.length} dòng thiếu cột id, không xử lý file`,
      );
    }

    const res = await this.db.query(
      `INSERT INTO raw_events (source, idempotency_key, payload)
       VALUES ('excel', $1, $2::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [key, JSON.stringify(products)],
    );

    if (res.rowCount === 0) {
      this.log.log(`Bỏ qua file đã upload trước đó: ${file.originalname}`);
      return { status: 'duplicate_ignored', file_hash: fileHash };
    }

    this.log.log(
      `Nhận file ${file.originalname} (#${res.rows[0].id}) với ${products.length} dòng`,
    );
    return {
      status: 'accepted',
      event_id: res.rows[0].id,
      rows: products.length,
    };
  }

  /**
   * Ép kiểu về đúng dạng như dữ liệu từ Vietful.
   * Excel đọc ra price có thể là chuỗi "12000" trong khi API trả số 12000;
   * hai thứ đó băm ra hash khác nhau và sẽ bị hiểu nhầm là có thay đổi.
   */
  private normalize(row: any) {
    return {
      id: row.id != null ? String(row.id) : '',
      sku: row.sku != null ? String(row.sku) : '',
      name: row.name != null ? String(row.name) : '',
      category: row.category != null ? String(row.category) : '',
      price: Number(row.price) || 0,
      stock: Number(row.stock) || 0,
      unit: row.unit != null ? String(row.unit) : '',
    };
  }
}
