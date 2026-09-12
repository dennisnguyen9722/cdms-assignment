import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly log = new Logger('Db');

  private pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://cdms:cdms@localhost:5432/cdms',
    max: 10,
  });

  constructor() {
    // pg phát 'error' trên client nhàn rỗi khi Postgres đóng kết nối.
    // Không bắt ở đây thì Node coi là unhandled và giết tiến trình.
    this.pool.on('error', (err) => {
      this.log.error(`Lỗi kết nối nhàn rỗi (sẽ tự kết nối lại): ${err.message}`);
    });
  }

  query(sql: string, params?: any[]) {
    return this.pool.query(sql, params);
  }

  /** Chạy một khối lệnh trong cùng 1 transaction. Lỗi thì rollback toàn bộ. */
  async withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  onModuleDestroy() {
    return this.pool.end();
  }
}
