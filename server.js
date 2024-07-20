// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('A user connected');
  let currentRoom = null;

  socket.on('join room', (room, username) => {
    if (currentRoom) {
      leaveRoom(socket, currentRoom);
    }
    joinRoom(socket, room, username);
  });

  socket.on('leave room', () => {
    if (currentRoom) {
      leaveRoom(socket, currentRoom);
      currentRoom = null;
      socket.emit('room left');
    }
  });

  socket.on('voice', (data) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('voice', { id: socket.id, data });
    }
  });

  socket.on('speaking', ({ isSpeaking, energy }) => {
    if (currentRoom && rooms.get(currentRoom).has(socket.id)) {
      const user = rooms.get(currentRoom).get(socket.id);
      user.isSpeaking = isSpeaking;
      user.energy = energy;
      io.to(currentRoom).emit('user speaking', { id: socket.id, isSpeaking, energy });
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      leaveRoom(socket, currentRoom);
    }
    console.log('User disconnected');
  });

  function leaveRoom(socket, room) {
    socket.leave(room);
    const roomUsers = rooms.get(room);
    if (roomUsers) {
      roomUsers.delete(socket.id);
      io.to(room).emit('user left', socket.id);
      if (roomUsers.size === 0) {
        rooms.delete(room);
        io.emit('update rooms', Array.from(rooms.keys()));
      }
    }
    console.log(`User ${socket.id} left room: ${room}`);
  }

  function joinRoom(socket, room, username) {
    socket.join(room);
    currentRoom = room;
    if (!rooms.has(room)) {
      rooms.set(room, new Map());
    }
    rooms.get(room).set(socket.id, { username, isSpeaking: false, energy: 0 });
    io.to(room).emit('user joined', { id: socket.id, username });
    socket.emit('room users', Array.from(rooms.get(room).entries()));
    io.emit('update rooms', Array.from(rooms.keys()));
    socket.emit('your id', socket.id);
    console.log(`User ${username} joined room: ${room}`);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});