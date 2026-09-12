import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { contentHash } from '../common/hash';

@Injectable()
export class WorkerService {
  private readonly log = new Logger('Worker');
  private busy = false;

  constructor(private db: DbService) {}

  @Interval(2000)
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (await this.processOne()) { /* xử lý hết hàng đợi */ }
    } catch (e) {
      this.log.error(`Worker lỗi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.busy = false;
    }
  }

  /** Trả về true nếu đã xử lý 1 event, false nếu hàng đợi rỗng */
  private async processOne(): Promise<boolean> {
    return this.db.withTransaction(async (c) => {
      // Lấy 1 event chưa xử lý và KHOÁ nó lại.
      // SKIP LOCKED: worker khác gặp dòng đang khoá thì bỏ qua, lấy dòng kế tiếp
      // -> nhiều worker chạy song song mà không giẫm chân nhau.
      const picked = await c.query(
        `SELECT id, source, payload FROM raw_events
         WHERE status = 'pending'
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
      );
      if (picked.rowCount === 0) return false;

      const event = picked.rows[0];
      const products = event.payload as any[];
      let created = 0, updated = 0, unchanged = 0;

      for (const p of products) {
        const result = await this.applyProduct(c, p, event.source);
        if (result === 'CREATED') created++;
        else if (result === 'UPDATED') updated++;
        else unchanged++;
      }

      await c.query(
        `UPDATE raw_events
         SET status = 'done', processed_at = now(), attempts = attempts + 1
         WHERE id = $1`,
        [event.id],
      );

      this.log.log(
        `Event #${event.id}: ${created} mới, ${updated} thay đổi, ${unchanged} không đổi`,
      );
      return true;
    });
  }

  private async applyProduct(c: PoolClient, product: any, source: string) {
    const productId = String(product.id);
    const hash = contentHash(product);

    const cur = await c.query(
      `SELECT content_hash FROM products_current WHERE product_id = $1`,
      [productId],
    );

    if (cur.rowCount && cur.rows[0].content_hash === hash) {
      return 'UNCHANGED'; // 99% trường hợp rơi vào đây
    }

    const changeType = cur.rowCount ? 'UPDATED' : 'CREATED';

    // Tầng chống trùng thứ hai: cùng sản phẩm + cùng nội dung không bao giờ ghi 2 lần
    await c.query(
      `INSERT INTO product_changes
         (product_id, change_type, content_hash, payload, source)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (product_id, content_hash) DO NOTHING`,
      [productId, changeType, hash, JSON.stringify(product), source],
    );

    await c.query(
      `INSERT INTO products_current (product_id, content_hash, payload, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (product_id) DO UPDATE
         SET content_hash = EXCLUDED.content_hash,
             payload      = EXCLUDED.payload,
             updated_at   = now()`,
      [productId, hash, JSON.stringify(product)],
    );

    return changeType;
  }
}
