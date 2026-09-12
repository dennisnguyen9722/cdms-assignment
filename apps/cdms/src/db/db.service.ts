import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

@Injectable()
export class DbService implements OnModuleDestroy {
  private pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://cdms:cdms@localhost:5432/cdms',
    max: 10,
  });

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
