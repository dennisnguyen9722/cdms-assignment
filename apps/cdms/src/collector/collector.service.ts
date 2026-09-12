import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { DbService } from '../db/db.service';

@Injectable()
export class CollectorService {
  private readonly log = new Logger('Collector');
  private running = false;
  private readonly baseUrl = process.env.VIETFUL_URL ?? 'http://localhost:3001';

  constructor(private db: DbService) {}

  @Cron('*/30 * * * * *') // 30 giây một lần
  async poll() {
    if (this.running) {
      this.log.warn('Lần poll trước chưa xong, bỏ qua lượt này');
      return; // chống chồng job
    }
    this.running = true;
    try {
      const products = await this.fetchAllProducts();
      await this.enqueue(products);
    } catch (e) {
      this.log.error(`Poll thất bại: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }

  private async fetchAllProducts() {
    const all: any[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(`${this.baseUrl}/products?page=${page}&limit=100`);
      if (!res.ok) throw new Error(`Vietful trả ${res.status}`);
      const body = await res.json();
      all.push(...body.data);
      if (page >= body.meta.total_pages) break;
      page++;
    }
    return all;
  }

  private async enqueue(products: any[]) {
    const payload = JSON.stringify(products);
    // khóa chống trùng = vân tay của cả lô.
    // Lô giống hệt lần trước -> UNIQUE chặn -> không tạo việc thừa.
    const key = 'poll:' + createHash('sha256').update(payload).digest('hex');

    const res = await this.db.query(
      `INSERT INTO raw_events (source, idempotency_key, payload)
       VALUES ('poll', $1, $2::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [key, payload],
    );

    if (res.rowCount === 0) {
      this.log.log(`Lô ${products.length} sản phẩm không đổi so với lần trước, bỏ qua`);
    } else {
      this.log.log(`Đã nhận lô #${res.rows[0].id} với ${products.length} sản phẩm`);
    }
  }
}
