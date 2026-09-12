import { Body, Controller, Headers, HttpCode, Logger, Post } from '@nestjs/common';
import { createHash } from 'crypto';
import { DbService } from '../db/db.service';

@Controller('webhook')
export class WebhookController {
  private readonly log = new Logger('Webhook');

  constructor(private db: DbService) {}

  @Post('products')
  @HttpCode(202) // Accepted: đã nhận, sẽ xử lý sau
  async receive(
    @Body() body: any,
    @Headers('x-delivery-id') deliveryId?: string,
  ) {
    const products = Array.isArray(body) ? body : body?.data ?? [body];
    const payload = JSON.stringify(products);

    // Ưu tiên delivery-id do bên gửi cung cấp (chuẩn của webhook thật).
    // Không có thì băm nội dung làm khóa dự phòng.
    const key = deliveryId
      ? `webhook:${deliveryId}`
      : 'webhook:' + createHash('sha256').update(payload).digest('hex');

    const res = await this.db.query(
      `INSERT INTO raw_events (source, idempotency_key, payload)
       VALUES ('webhook', $1, $2::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [key, payload],
    );

    if (res.rowCount === 0) {
      this.log.log(`Bỏ qua callback trùng: ${key}`);
      return { status: 'duplicate_ignored', key };
    }

    this.log.log(`Nhận callback #${res.rows[0].id} với ${products.length} sản phẩm`);
    return { status: 'accepted', event_id: res.rows[0].id };
  }
}
