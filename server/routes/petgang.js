/**
 * API роуты Pet Gang — Паспорт питомца
 */

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const QRCode = require('qrcode');
// requireAuth импортируется для совместимости, но Pet Gang использует свою авторизацию
const petgangDb = require('../database/petgang');
const PetGangTelegram = require('../services/petgang-telegram');

const router = express.Router();

// Pet Gang авторизация — отдельный JWT-секрет
const PETGANG_JWT_SECRET = process.env.PETGANG_JWT_SECRET || 'petgang-secret-key-change-in-production';
const PETGANG_SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 часа

// Хранилище кодов подтверждения Pet Gang
const petgangCodes = new Map();

// Multer для загрузки фото питомцев
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Допустимые форматы: JPEG, PNG, WebP'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB до сжатия
});

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads', 'pets');

// Создаём папку если нет
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Генерация уникального токена для QR-кода
 */
function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

// ==================== АВТОРИЗАЦИЯ PET GANG ====================

/**
 * Middleware для проверки авторизации Pet Gang
 */
function requirePetGangAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Токен отсутствует' });
    }
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, PETGANG_JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Недействительный токен' });
  }
}

/**
 * POST /api/auth/request-code — запросить код подтверждения
 */
router.post('/auth/request-code', async (req, res) => {
  try {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    petgangCodes.set(code, { createdAt: Date.now(), expiresAt: Date.now() + 5 * 60 * 1000 });

    // Отправляем код в Telegram через prod сервер
    let telegramSent = false;
    try {
      const chatId = process.env.PETGANG_TELEGRAM_CHAT_ID;
      const message = `🔐 Код для входа в Pet Gang:\n\n` +
        `<code>${code}</code>\n\n` +
        `⏰ Код действителен 5 минут\n` +
        `🌐 Сайт: pet-gang.ru`;
      const fetch = globalThis.fetch || (await import('node-fetch')).default;
      await fetch('https://vidrimers.site/api/telegram-forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'sendMessage', chat_id: chatId, text: message, parse_mode: 'HTML', bot_token: process.env.TELEGRAM_BOT_TOKEN })
      });
      telegramSent = true;
    } catch (e) {
      console.error('Pet Gang Auth: Ошибка Telegram:', e.message);
    }

    res.json({
      success: true,
      data: {
        message: 'Код подтверждения отправлен',
        telegramSent,
        ...(process.env.NODE_ENV === 'development' && { code })
      }
    });
  } catch (error) {
    console.error('Pet Gang Auth: Ошибка генерации кода:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/auth/verify-code — проверить код и создать сессию
 */
router.post('/auth/verify-code', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: 'Код обязателен' });
    }

    const codeData = petgangCodes.get(code);
    if (!codeData || Date.now() > codeData.expiresAt) {
      petgangCodes.delete(code);
      return res.status(400).json({ success: false, error: 'Неверный или просроченный код' });
    }

    petgangCodes.delete(code);

    // Создаём или находим пользователя в БД
    const db = petgangDb.getDb();
    let user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE id = 1', [], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!user) {
      // Создаём первого пользователя (админ)
      const result = await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO users (name, role, auth_method) VALUES ('Администратор', 'admin', 'telegram')`,
          [],
          function(err) {
            if (err) reject(err);
            else resolve({ userId: this.lastID });
          }
        );
      });
      user = { id: result.userId, role: 'admin' };
    }

    // Создаём JWT сессию
    const token = jwt.sign(
      { userId: user.id, role: user.role, iat: Math.floor(Date.now() / 1000) },
      PETGANG_JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ success: true, data: { token, expiresIn: PETGANG_SESSION_EXPIRY } });
  } catch (error) {
    console.error('Pet Gang Auth: Ошибка верификации:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/auth/logout — выход
 */
router.post('/auth/logout', requirePetGangAuth, async (req, res) => {
  res.json({ success: true, message: 'Вы вышли из системы' });
});

/**
 * GET /api/auth/check — проверка авторизации
 */
router.get('/auth/check', requirePetGangAuth, async (req, res) => {
  res.json({ success: true, data: { authorized: true, userId: req.user.userId } });
});

// ==================== EMAIL АВТОРИЗАЦИЯ ====================

/**
 * POST /api/auth/register — регистрация через email + пароль
 */
router.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Все поля обязательны' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Пароль должен содержать минимум 8 символов' });
    }

    const db = petgangDb.getDb();
    
    // Проверяем, не занят ли email
    const existing = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (existing) {
      return res.status(400).json({ success: false, error: 'Email уже зарегистрирован' });
    }

    // Хешируем пароль
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Генерируем токен подтверждения
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Создаём пользователя
    const result = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO users (name, email, password_hash, email_verified, email_verification_token, role, auth_method)
         VALUES (?, ?, ?, 0, ?, 'user', 'email')`,
        [name, email.toLowerCase(), passwordHash, verificationToken],
        function(err) {
          if (err) reject(err);
          else resolve({ userId: this.lastID });
        }
      );
    });

    // Отправляем email с подтверждением
    try {
      const { sendAuthCodeEmail } = require('../services/emailService.js');
      const publicUrl = process.env.PETGANG_SITE_URL || 'http://localhost:3001';
      const verifyUrl = `${publicUrl}/verify-email/${verificationToken}`;
      
      // Используем sendAuthCodeEmail для отправки ссылки подтверждения
      await sendAuthCodeEmail({
        toEmail: email,
        code: `Подтвердите регистрацию: ${verifyUrl}`,
      });
    } catch (emailErr) {
      console.warn('⚠️ Email подтверждения не отправлен:', emailErr.message);
    }

    res.json({
      success: true,
      data: {
        message: 'Регистрация успешна! Проверьте email для подтверждения.',
        userId: result.userId
      }
    });
  } catch (error) {
    console.error('Pet Gang Auth: Ошибка регистрации:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/auth/login — вход через email + пароль
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email и пароль обязательны' });
    }

    const db = petgangDb.getDb();
    
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!user) {
      return res.status(400).json({ success: false, error: 'Неверный email или пароль' });
    }

    if (!user.password_hash) {
      return res.status(400).json({ success: false, error: 'Этот аккаунт создан через Telegram. Войдите через Telegram.' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(400).json({ success: false, error: 'Неверный email или пароль' });
    }

    // Создаём JWT
    const token = jwt.sign(
      { userId: user.id, role: user.role, iat: Math.floor(Date.now() / 1000) },
      PETGANG_JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      data: {
        token,
        expiresIn: PETGANG_SESSION_EXPIRY,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          emailVerified: Boolean(user.email_verified)
        }
      }
    });
  } catch (error) {
    console.error('Pet Gang Auth: Ошибка входа:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/auth/verify-email — подтверждение email
 */
router.post('/auth/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ success: false, error: 'Токен обязателен' });
    }

    const db = petgangDb.getDb();
    
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE email_verification_token = ?', [token], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!user) {
      return res.status(400).json({ success: false, error: 'Неверный токен' });
    }

    // Подтверждаем email
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET email_verified = 1, email_verification_token = NULL WHERE id = ?',
        [user.id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ success: true, data: { message: 'Email подтверждён' } });
  } catch (error) {
    console.error('Pet Gang Auth: Ошибка подтверждения email:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// ==================== ПРОФИЛЬ ====================

/**
 * GET /api/profile — получить профиль владельца
 */
router.get('/profile', async (req, res) => {
  try {
    const user = await petgangDb.getUser(1);
    if (!user) {
      return res.json({ success: true, data: null });
    }
    res.json({
      success: true,
      data: {
        ...user,
        phones: JSON.parse(user.phones || '[]'),
        visibility_settings: JSON.parse(user.visibility_settings || '{}')
      }
    });
  } catch (error) {
    console.error('Pet Gang: Ошибка получения профиля:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * PUT /api/profile — обновить профиль владельца
 */
router.put('/profile', requirePetGangAuth, async (req, res) => {
  try {
    const { name, phones, country, city, instagram, telegram, email, visibility_settings } = req.body;
    const user = await petgangDb.getOrCreateUser({
      name, phones, country, city, instagram, telegram, email, visibility_settings
    });
    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Pet Gang: Ошибка обновления профиля:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * PUT /api/profile/visibility — обновить только настройки видимости
 */
router.put('/profile/visibility', requirePetGangAuth, async (req, res) => {
  try {
    const { visibility_settings } = req.body;
    await petgangDb.updateVisibility(visibility_settings);
    res.json({ success: true });
  } catch (error) {
    console.error('Pet Gang: Ошибка обновления видимости:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// ==================== ПИТОМЦЫ ====================

/**
 * GET /api/pets — список карточек (только для админа)
 */
router.get('/pets', requirePetGangAuth, async (req, res) => {
  try {
    const pets = await petgangDb.getAllPets();
    res.json({ success: true, data: pets });
  } catch (error) {
    console.error('Pet Gang: Ошибка получения питомцев:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/pets/:id — данные карточки питомца
 */
router.get('/pets/:id', async (req, res) => {
  try {
    const pet = await petgangDb.getPet(req.params.id);
    if (!pet) {
      return res.status(404).json({ success: false, error: 'Питомец не найден' });
    }

    // Получаем профиль владельца с учётом настроек видимости
    const user = await petgangDb.getUser(pet.user_id || 1);
    let ownerContact = null;
    if (user) {
      const vis = JSON.parse(user.visibility_settings || '{}');
      ownerContact = {};
      if (vis.show_name) ownerContact.name = user.name;
      if (vis.show_phones) ownerContact.phones = JSON.parse(user.phones || '[]');
      if (vis.show_instagram) ownerContact.instagram = user.instagram;
      if (vis.show_telegram) ownerContact.telegram = user.telegram;
      if (vis.show_email) ownerContact.email = user.email;
      if (vis.show_city) ownerContact.city = user.city;
    }

    res.json({ success: true, data: { pet, ownerContact } });
  } catch (error) {
    console.error('Pet Gang: Ошибка получения питомца:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/pets — создать карточку питомца
 */
router.post('/pets', requirePetGangAuth, async (req, res) => {
  try {
    const pet = await petgangDb.createPet({ ...req.body, user_id: 1 });
    res.json({ success: true, data: pet });
  } catch (error) {
    console.error('Pet Gang: Ошибка создания питомца:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * PUT /api/pets/:id — обновить карточку питомца
 */
router.put('/pets/:id', requirePetGangAuth, async (req, res) => {
  try {
    const existing = await petgangDb.getPet(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Питомец не найден' });
    }
    const pet = await petgangDb.updatePet(req.params.id, { ...req.body, photos: req.body.photos || existing.photos });
    res.json({ success: true, data: pet });
  } catch (error) {
    console.error('Pet Gang: Ошибка обновления питомца:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * DELETE /api/pets/:id — удалить карточку питомца
 */
router.delete('/pets/:id', requirePetGangAuth, async (req, res) => {
  try {
    await petgangDb.deletePet(req.params.id);
    res.json({ success: true, deleted: true });
  } catch (error) {
    console.error('Pet Gang: Ошибка удаления питомца:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// ==================== ФОТОГРАФИИ ====================

/**
 * POST /api/pets/:id/photos — загрузить фото (max 3, max 5 МБ)
 */
router.post('/pets/:id/photos', requirePetGangAuth, (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Файл слишком большой (макс 5 МБ)' : err.message;
      return res.status(400).json({ success: false, error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Файл не загружен' });
    }

    try {
      const pet = await petgangDb.getPet(req.params.id);
      if (!pet) {
        return res.status(404).json({ success: false, error: 'Питомец не найден' });
      }
      if (pet.photos.length >= 3) {
        return res.status(400).json({ success: false, error: 'Максимум 3 фотографии' });
      }

      // Сжатие через sharp
      let buffer = req.file.buffer;
      let info = await sharp(buffer).metadata();

      if (info.size > 5 * 1024 * 1024 || req.file.size > 5 * 1024 * 1024) {
        // Уменьшаем качество до тех пор, пока не станет <= 5 МБ
        let quality = 80;
        while (quality > 10) {
          buffer = await sharp(req.file.buffer).jpeg({ quality }).toBuffer();
          info = await sharp(buffer).metadata();
          if (info.size <= 5 * 1024 * 1024) break;
          quality -= 10;
        }
      } else {
        buffer = await sharp(req.file.buffer).jpeg({ quality: 85 }).toBuffer();
      }

      const filename = `pet_${req.params.id}_${Date.now()}.jpg`;
      const filepath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(filepath, buffer);

      const photos = [...pet.photos, filename];
      await petgangDb.updatePet(req.params.id, { ...pet, photos });

      res.json({ success: true, data: { filename, photos } });
    } catch (error) {
      console.error('Pet Gang: Ошибка загрузки фото:', error.message);
      res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
  });
});

/**
 * DELETE /api/pets/:id/photos/:photoId — удалить фото (с сервера)
 */
router.delete('/pets/:id/photos/:photoId', requirePetGangAuth, async (req, res) => {
  try {
    const pet = await petgangDb.getPet(req.params.id);
    if (!pet) {
      return res.status(404).json({ success: false, error: 'Питомец не найден' });
    }

    const photoIndex = parseInt(req.params.photoId);
    if (isNaN(photoIndex) || photoIndex < 0 || photoIndex >= pet.photos.length) {
      return res.status(400).json({ success: false, error: 'Некорректный индекс фото' });
    }

    const photoFilename = pet.photos[photoIndex];
    const filepath = path.join(UPLOADS_DIR, photoFilename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    const photos = pet.photos.filter((_, i) => i !== photoIndex);
    await petgangDb.updatePet(req.params.id, { ...pet, photos });

    res.json({ success: true, data: { photos } });
  } catch (error) {
    console.error('Pet Gang: Ошибка удаления фото:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// ==================== QR-КОДЫ ====================

/**
 * POST /api/qr/generate — сгенерировать новый QR-код
 */
router.post('/qr/generate', requirePetGangAuth, async (req, res) => {
  try {
    const token = generateToken();
    const qr = await petgangDb.createQr(token);

    const baseUrl = process.env.PETGANG_SITE_URL || 'https://pet-gang.ru';
    const qrUrl = `${baseUrl}/scan/${token}`;

    // Генерируем изображение QR-кода
    const qrImage = await QRCode.toDataURL(qrUrl, { width: 300, margin: 2 });

    res.json({
      success: true,
      data: {
        id: qr.id,
        token,
        url: qrUrl,
        qr_image: qrImage
      }
    });
  } catch (error) {
    console.error('Pet Gang: Ошибка генерации QR:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/qr/generate-batch — сгенерировать пакет QR-кодов
 */
router.post('/qr/generate-batch', requirePetGangAuth, async (req, res) => {
  try {
    const { count = 10 } = req.body;
    if (count < 1 || count > 100) {
      return res.status(400).json({ success: false, error: 'Количество от 1 до 100' });
    }

    const baseUrl = process.env.PETGANG_SITE_URL || 'https://pet-gang.ru';
    const results = [];

    for (let i = 0; i < count; i++) {
      const token = generateToken();
      const qr = await petgangDb.createQr(token);
      const qrUrl = `${baseUrl}/scan/${token}`;
      const qrImage = await QRCode.toDataURL(qrUrl, { width: 300, margin: 2 });
      results.push({ id: qr.id, token, url: qrUrl, qr_image: qrImage });
    }

    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Pet Gang: Ошибка пакетной генерации QR:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/qr/:token — данные по QR (для сканирования)
 */
router.get('/qr/:token', async (req, res) => {
  try {
    const qr = await petgangDb.getQrByToken(req.params.token);
    if (!qr) {
      return res.status(404).json({ success: false, error: 'QR-код не найден' });
    }

    if (qr.is_bound && qr.pet_id) {
      const pet = await petgangDb.getPet(qr.pet_id);
      const user = await petgangDb.getUser(pet?.user_id || 1);
      let ownerContact = null;
      let petVisibility = null;
      if (user) {
        const vis = JSON.parse(user.visibility_settings || '{}');
        petVisibility = vis;
        ownerContact = {};
        if (vis.show_name) ownerContact.name = user.name;
        if (vis.show_phones) ownerContact.phones = JSON.parse(user.phones || '[]');
        if (vis.show_instagram) ownerContact.instagram = user.instagram;
        if (vis.show_telegram) ownerContact.telegram = user.telegram;
        if (vis.show_email) ownerContact.email = user.email;
        if (vis.show_city) ownerContact.city = user.city;
      }

      // Фильтруем данные питомца по настройкам видимости
      const filteredPet = pet ? {
        ...pet,
        name: petVisibility?.show_pet_name !== false ? pet.name : 'Кличка скрыта',
        species: petVisibility?.show_pet_species !== false ? pet.species : null,
        breed: petVisibility?.show_pet_breed !== false ? pet.breed : null,
        sex: petVisibility?.show_pet_sex !== false ? pet.sex : null,
        birth_date: petVisibility?.show_pet_birth_date !== false ? pet.birth_date : null,
        chip_number: petVisibility?.show_pet_chip_number !== false ? pet.chip_number : null,
        tag_number: petVisibility?.show_pet_tag_number !== false ? pet.tag_number : null,
        sterilized: petVisibility?.show_pet_sterilized !== false ? pet.sterilized : null,
        color: petVisibility?.show_pet_color !== false ? pet.color : null,
        free_walking: petVisibility?.show_pet_free_walking !== false ? pet.free_walking : null,
        address: petVisibility?.show_pet_address !== false ? pet.address : null,
        special_marks: petVisibility?.show_pet_special_marks !== false ? pet.special_marks : null,
        photos: petVisibility?.show_pet_photos !== false ? pet.photos : [],
      } : null;

      return res.json({ success: true, data: { bound: true, pet: filteredPet, ownerContact } });
    }

    res.json({ success: true, data: { bound: false, qr_id: qr.id } });
  } catch (error) {
    console.error('Pet Gang: Ошибка получения QR:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/qr/bind — привязать QR к карточке
 */
router.post('/qr/bind', requirePetGangAuth, async (req, res) => {
  try {
    const { qr_id, pet_id } = req.body;
    if (!qr_id || !pet_id) {
      return res.status(400).json({ success: false, error: 'qr_id и pet_id обязательны' });
    }
    await petgangDb.bindQr(qr_id, pet_id);
    res.json({ success: true, bound: true });
  } catch (error) {
    console.error('Pet Gang: Ошибка привязки QR:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/qr/unbind — отвязать QR от карточки
 */
router.post('/qr/unbind', requirePetGangAuth, async (req, res) => {
  try {
    const { qr_id } = req.body;
    if (!qr_id) {
      return res.status(400).json({ success: false, error: 'qr_id обязателен' });
    }
    const db = petgangDb.getDb();
    await new Promise((resolve, reject) => {
      db.run('UPDATE qr_codes SET pet_id = NULL, is_bound = 0 WHERE id = ?', [qr_id], (err) => {
        err ? reject(err) : resolve();
      });
    });
    res.json({ success: true, unbound: true });
  } catch (error) {
    console.error('Pet Gang: Ошибка отвязки QR:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/qr/pet/:petId — получить QR-код питомца
 */
router.get('/qr/pet/:petId', requirePetGangAuth, async (req, res) => {
  try {
    const db = petgangDb.getDb();
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM qr_codes WHERE pet_id = ? AND is_bound = 1', [req.params.petId], (err, row) => {
        err ? reject(err) : resolve(row);
      });
    });

    if (!row) {
      return res.json({ success: true, data: null });
    }

    const baseUrl = process.env.PETGANG_SITE_URL || 'https://pet-gang.ru';
    const qrUrl = `${baseUrl}/scan/${row.qr_token}`;
    const qrImage = await QRCode.toDataURL(qrUrl, { width: 300, margin: 2 });

    res.json({
      success: true,
      data: { id: row.id, token: row.qr_token, url: qrUrl, qr_image: qrImage }
    });
  } catch (error) {
    console.error('Pet Gang: Ошибка получения QR:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/qr — список всех QR-кодов с данными питомцев
 */
router.get('/qr', requirePetGangAuth, async (req, res) => {
  try {
    const db = petgangDb.getDb();
    const rows = await new Promise((resolve, reject) => {
      db.all(`
        SELECT q.*, p.name as pet_name, p.species as pet_species
        FROM qr_codes q
        LEFT JOIN pets p ON q.pet_id = p.id
        ORDER BY q.created_at DESC
      `, [], (err, rows) => err ? reject(err) : resolve(rows));
    });

    const baseUrl = process.env.PETGANG_SITE_URL || 'https://pet-gang.ru';
    const data = rows.map(row => ({
      id: row.id,
      token: row.qr_token,
      url: `${baseUrl}/scan/${row.qr_token}`,
      is_bound: !!row.is_bound,
      pet_id: row.pet_id,
      pet_name: row.pet_name || null,
      pet_species: row.pet_species || null,
      created_at: row.created_at
    }));

    res.json({ success: true, data });
  } catch (error) {
    console.error('Pet Gang: Ошибка получения QR:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// ==================== СКАНИРОВАНИЕ ====================

/**
 * POST /api/scan — лог сканирования + уведомление в Telegram
 */
router.post('/scan', async (req, res) => {
  try {
    const { qr_token, latitude, longitude, client_ip } = req.body;
    const serverIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const ip = (serverIp && serverIp !== '127.0.0.1' && serverIp !== '::1') ? serverIp : (client_ip || serverIp);
    const userAgent = req.headers['user-agent'] || '';

    const qr = await petgangDb.getQrByToken(qr_token);
    if (!qr) {
      return res.status(404).json({ success: false, error: 'QR-код не найден' });
    }

    // Логируем сканирование
    await petgangDb.logScan(qr.id, qr.pet_id, ip, latitude, longitude, userAgent);

    // Отправляем уведомление в Telegram
    if (qr.is_bound && qr.pet_id) {
      const pet = await petgangDb.getPet(qr.pet_id);
      if (pet) {
        const now = new Date();
        const dateTime = now.toLocaleString('ru-RU', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });

        try {
          const chatId = process.env.PETGANG_TELEGRAM_CHAT_ID;
          const geoText = (latitude && longitude)
            ? `GPS координаты: ${latitude}, ${longitude}`
            : 'GPS координаты: не предоставлены';

          const message =
            `‼️ Паспорт питомца «${pet.name}» был отсканирован.\n` +
            `Дата и время: ${dateTime}\n` +
            `${geoText}\n` +
            `IP адрес: ${ip || 'не определён'}`;

          console.log(`[PetGang Scan] ${pet.name} | IP: ${ip} | GPS: ${latitude},${longitude}`);

          const fetch = globalThis.fetch || (await import('node-fetch')).default;
          const botToken = process.env.TELEGRAM_BOT_TOKEN;
          await fetch('https://vidrimers.site/api/telegram-forward', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'sendMessage', chat_id: chatId, text: message, bot_token: botToken })
          });

          if (latitude && longitude) {
            await fetch('https://vidrimers.site/api/telegram-forward', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ method: 'sendLocation', chat_id: chatId, latitude, longitude, bot_token: botToken })
            });
          }
        } catch (tgErr) {
          console.error('[PetGang Scan] Ошибка Telegram:', tgErr.message);
        }
      }
    }

    res.json({ success: true, logged: true });
  } catch (error) {
    console.error('Pet Gang: Ошибка сканирования:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// ==================== ИСТОРИЯ СКАНИРОВАНИЙ ====================

/**
 * GET /api/pets/:id/scans — история сканирований питомца
 */
router.get('/pets/:id/scans', requirePetGangAuth, async (req, res) => {
  try {
    const db = petgangDb.getDb();
    const limit = parseInt(req.query.limit) || 5;
    const offset = parseInt(req.query.offset) || 0;

    const scans = await new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM scan_logs WHERE pet_id = ? ORDER BY scanned_at DESC LIMIT ? OFFSET ?',
        [req.params.id, limit, offset],
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    });

    const total = await new Promise((resolve, reject) => {
      db.get(
        'SELECT COUNT(*) as count FROM scan_logs WHERE pet_id = ?',
        [req.params.id],
        (err, row) => err ? reject(err) : resolve(row?.count || 0)
      );
    });

    res.json({ success: true, data: scans, total, hasMore: offset + scans.length < total });
  } catch (error) {
    console.error('Pet Gang: Ошибка получения истории:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// ==================== СТАТИСТИКА ====================

/**
 * GET /api/stats — статистика (для админа)
 */
router.get('/stats', requirePetGangAuth, async (req, res) => {
  try {
    const db = petgangDb.getDb();
    const [totalQr, boundQr, totalPets, totalScans] = await Promise.all([
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM qr_codes', [], (err, row) => {
          err ? reject(err) : resolve(row.count);
        });
      }),
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM qr_codes WHERE is_bound = 1', [], (err, row) => {
          err ? reject(err) : resolve(row.count);
        });
      }),
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM pets', [], (err, row) => {
          err ? reject(err) : resolve(row.count);
        });
      }),
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM scan_logs', [], (err, row) => {
          err ? reject(err) : resolve(row.count);
        });
      })
    ]);

    res.json({
      success: true,
      data: {
        total_qr: totalQr,
        bound_qr: boundQr,
        unbound_qr: totalQr - boundQr,
        total_pets: totalPets,
        total_scans: totalScans
      }
    });
  } catch (error) {
    console.error('Pet Gang: Ошибка статистики:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

module.exports = router;
