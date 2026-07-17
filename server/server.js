/**
 * Pet Gang — Сервер
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const { initPetGangDatabase } = require('./database/petgang');
const petgangRoutes = require('./routes/petgang');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(cors({
  origin: [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://pet-gang.ru',
    'http://pet-gang.ru',
    'https://www.pet-gang.ru'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Статика
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// API
app.use('/api', petgangRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', service: 'Pet Gang', timestamp: new Date().toISOString() });
});

// SPA fallback
app.use(express.static(path.join(__dirname, '..', 'dist')));
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

// Запуск
async function startServer() {
  try {
    await initPetGangDatabase();
    console.log('Pet Gang: База данных инициализирована');

    app.listen(PORT, () => {
      console.log(`Pet Gang сервер: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Ошибка запуска:', error);
    process.exit(1);
  }
}

startServer();
