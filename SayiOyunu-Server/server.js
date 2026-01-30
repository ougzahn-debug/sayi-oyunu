const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const cors = require('cors');
const path = require('path'); // EKLE
app.use(cors());
app.use(express.static('public')); // BU SATIRI EKLE

// Ana sayfa route'u EKLE
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Oyun odaları
const rooms = {};

// Oyun geçmişi
const gameHistory = {};

// Rastgele oda kodu oluştur
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('Yeni bağlantı:', socket.id);

  // Oda oluştur
  socket.on('createRoom', ({ playerName, avatar, settings }) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      players: [{ id: socket.id, name: playerName, avatar: avatar || '😎' }],
      gameState: 'waiting',
      selectedMode: null,
      selectedNumbers: {},
      eliminatedPlayers: [],
      calledNumbers: [],
      currentTurnIndex: 0,
      jokers: {},
      theme: settings?.theme || 'default',
      colorBlindMode: settings?.colorBlindMode || false,
      timerEnabled: settings?.timerEnabled || false,
      timerDuration: 42,
      password: settings?.password || null,
      messages: []
    };
    
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, playerName, avatar });
    io.to(roomCode).emit('updateRoom', rooms[roomCode]);
    
    console.log(`Oda oluşturuldu: ${roomCode}`);
  });

  // Odaya katıl
  socket.on('joinRoom', ({ roomCode, playerName, avatar, password }) => {
    if (!rooms[roomCode]) {
      socket.emit('error', 'Oda bulunamadı!');
      return;
    }

    // Şifre kontrolü
    if (rooms[roomCode].password && rooms[roomCode].password !== password) {
      socket.emit('error', 'Şifre yanlış!');
      return;
    }

    if (rooms[roomCode].gameState !== 'waiting') {
      socket.emit('error', 'Oyun zaten başlamış!');
      return;
    }

    rooms[roomCode].players.push({ id: socket.id, name: playerName, avatar: avatar || '😎' });
    socket.join(roomCode);
    socket.emit('roomJoined', { roomCode, playerName, avatar });
    io.to(roomCode).emit('updateRoom', rooms[roomCode]);
    
    // Chat mesajı: Oyuncu katıldı
    const systemMessage = {
      type: 'system',
      text: `${playerName} odaya katıldı!`,
      timestamp: Date.now()
    };
    rooms[roomCode].messages.push(systemMessage);
    io.to(roomCode).emit('newMessage', systemMessage);
    
    console.log(`${playerName} odaya katıldı: ${roomCode}`);
  });

  // Mod seç
  socket.on('selectMode', ({ roomCode, mode }) => {
    if (rooms[roomCode]) {
      rooms[roomCode].selectedMode = mode;
      rooms[roomCode].gameState = 'numberSelect';
      
      // Her oyuncuya 1 joker ver
      rooms[roomCode].players.forEach(player => {
        rooms[roomCode].jokers[player.name] = 1;
      });
      
      io.to(roomCode).emit('updateRoom', rooms[roomCode]);
    }
  });

  // Sayı seç
  socket.on('selectNumber', ({ roomCode, playerName, number }) => {
    if (rooms[roomCode]) {
      rooms[roomCode].selectedNumbers[playerName] = number;
      
      // Herkes seçti mi?
      if (Object.keys(rooms[roomCode].selectedNumbers).length === rooms[roomCode].players.length) {
        rooms[roomCode].gameState = 'playing';
        rooms[roomCode].currentTurnIndex = 0;
      }
      
      io.to(roomCode).emit('updateRoom', rooms[roomCode]);
    }
  });

  // Joker kullan
  socket.on('useJoker', ({ roomCode, playerName }) => {
    if (!rooms[roomCode]) return;

    const room = rooms[roomCode];
    const currentPlayer = room.players[room.currentTurnIndex];

    if (currentPlayer.name !== playerName) return;
    if (room.jokers[playerName] <= 0) return;

    // Joker'i kullan
    room.jokers[playerName]--;
    
    // Chat mesajı
    const message = {
      type: 'system',
      text: `${playerName} joker kullandı! 🃏`,
      timestamp: Date.now()
    };
    room.messages.push(message);
    io.to(roomCode).emit('newMessage', message);
    
    // Sırayı atla
    nextTurn(roomCode);
    io.to(roomCode).emit('updateRoom', room);
  });

  // Rakam söyle
  socket.on('callNumber', ({ roomCode, number }) => {
    if (!rooms[roomCode]) return;

    const room = rooms[roomCode];
    const currentPlayer = room.players[room.currentTurnIndex];

    // Kendi rakamını mı seçiyor?
    if (room.selectedNumbers[currentPlayer.name] === number) {
      socket.emit('ownNumberBlocked');
      return;
    }

    // Daha önce söylendi mi?
    if (room.calledNumbers.includes(number)) {
      return;
    }

    room.calledNumbers.push(number);

    // Bu sayıyı kim seçti?
    const playerWithNumber = room.players.find(
      p => room.selectedNumbers[p.name] === number && !room.eliminatedPlayers.includes(p.name)
    );

    if (playerWithNumber) {
      // Oyuncu elendi
      room.eliminatedPlayers.push(playerWithNumber.name);
      io.to(roomCode).emit('playerEliminated', playerWithNumber.name);

      // Son kalan mı?
      if (room.eliminatedPlayers.length === room.players.length - 1) {
        room.gameState = 'finished';
        const loser = room.players.find(p => !room.eliminatedPlayers.includes(p.name));
        
        // Oyun geçmişine kaydet
        saveGameHistory(roomCode, room, loser.name);
        
        io.to(roomCode).emit('gameFinished', { loser: loser.name, winners: room.eliminatedPlayers });
      } else {
        // Sıradaki oyuncuya geç
        nextTurn(roomCode);
      }
    } else {
      // Kimse seçmemiş
      io.to(roomCode).emit('noPlayerHadNumber', number);
      setTimeout(() => nextTurn(roomCode), 1000);
    }

    io.to(roomCode).emit('updateRoom', room);
  });

  // Chat mesajı gönder
  socket.on('sendMessage', ({ roomCode, playerName, text }) => {
    if (!rooms[roomCode]) return;

    const message = {
      type: 'player',
      playerName,
      text,
      timestamp: Date.now()
    };

    rooms[roomCode].messages.push(message);
    io.to(roomCode).emit('newMessage', message);
  });

  // Sıradaki tur
  function nextTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    // Aktif oyuncular arasında sıradakini bul
    do {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
    } while (room.eliminatedPlayers.includes(room.players[room.currentTurnIndex].name));

    io.to(roomCode).emit('updateRoom', room);
  }

  // Oyun geçmişini kaydet
  function saveGameHistory(roomCode, room, loserName) {
    if (!gameHistory[roomCode]) {
      gameHistory[roomCode] = [];
    }

    gameHistory[roomCode].push({
      winners: room.eliminatedPlayers,
      loser: loserName,
      mode: room.selectedMode,
      timestamp: Date.now()
    });
  }

  // Oyun geçmişini getir
  socket.on('getGameHistory', (roomCode) => {
    socket.emit('gameHistory', gameHistory[roomCode] || []);
  });

  // Yeni oyun
  socket.on('resetGame', (roomCode) => {
    if (rooms[roomCode]) {
      rooms[roomCode].gameState = 'waiting';
      rooms[roomCode].selectedMode = null;
      rooms[roomCode].selectedNumbers = {};
      rooms[roomCode].eliminatedPlayers = [];
      rooms[roomCode].calledNumbers = [];
      rooms[roomCode].currentTurnIndex = 0;
      rooms[roomCode].jokers = {};
      io.to(roomCode).emit('updateRoom', rooms[roomCode]);
    }
  });

  // Bağlantı koptu
  socket.on('disconnect', () => {
    console.log('Bağlantı koptu:', socket.id);
    
    // Oyuncuyu tüm odalardan çıkar
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        const playerName = room.players[playerIndex].name;
        room.players.splice(playerIndex, 1);
        
        // Chat mesajı
        const message = {
          type: 'system',
          text: `${playerName} ayrıldı.`,
          timestamp: Date.now()
        };
        room.messages.push(message);
        io.to(roomCode).emit('newMessage', message);
        
        // Oda boşaldı mı?
        if (room.players.length === 0) {
          delete rooms[roomCode];
          console.log(`Oda silindi: ${roomCode}`);
        } else {
          io.to(roomCode).emit('updateRoom', room);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`🚀 Sunucu çalışıyor: http://localhost:${PORT}`);
});