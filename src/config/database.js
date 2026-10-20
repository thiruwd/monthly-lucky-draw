import mysql from 'mysql2/promise';

export function createPool(db) {
  return mysql.createPool({
    ...db, waitForConnections: true, queueLimit: 100,
    timezone: 'Z', dateStrings: true, charset: 'utf8mb4',
    supportBigNumbers: true, bigNumberStrings: true,
    multipleStatements: false, connectTimeout: 10000
  });
}
