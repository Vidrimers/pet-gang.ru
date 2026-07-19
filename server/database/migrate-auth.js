/**
 * Миграция: добавление полей для email+password авторизации
 */
export function migrateAuth(db) {
  return new Promise((resolve) => {
    const migrations = [
      `ALTER TABLE users ADD COLUMN password_hash TEXT`,
      `ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN email_verification_token TEXT`,
      `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`,
      `ALTER TABLE users ADD COLUMN auth_method TEXT DEFAULT 'telegram'`,
    ];

    let completed = 0;
    let errors = 0;

    migrations.forEach(sql => {
      db.run(sql, (err) => {
        if (err) {
          if (err.message.includes('duplicate column')) {
            // Колонка уже существует — это нормально
          } else {
            console.error('Ошибка миграции auth:', err.message);
            errors++;
          }
        }
        completed++;
        
        if (completed === migrations.length) {
          if (errors > 0) {
            console.error(`⚠️ Миграция auth завершена с ${errors} ошибками`);
          } else {
            console.log('✅ Миграция auth выполнена успешно');
          }
          resolve({ success: errors === 0 });
        }
      });
    });
  });
}
