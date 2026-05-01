const express = require("express");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 6e6
});

const OWNER_PIN = "stock00qwertyuiop";
let currentRoomKey = "asdfghjkl";

const roomUsers = {};
const inviteTokens = {};
const MAX_USERS = 4;
const INVITE_EXPIRE_TIME = 30 * 60 * 1000;

function cleanRoomUsers(room) {
  if (!roomUsers[room]) roomUsers[room] = [];
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("owner_join", (data) => {
    if (data.ownerPin !== OWNER_PIN) return socket.emit("error_message", "Wrong owner PIN");
    if (data.roomKey !== currentRoomKey) return socket.emit("error_message", "Wrong room key");

    cleanRoomUsers(currentRoomKey);

    if (roomUsers[currentRoomKey].length >= MAX_USERS) {
      return socket.emit("error_message", "Room full. Maximum 4 users allowed.");
    }

    roomUsers[currentRoomKey].push(socket.id);
    socket.join(currentRoomKey);
    socket.room = currentRoomKey;

    socket.emit("system_message", "Owner joined private room");
    io.to(currentRoomKey).emit("user_count", roomUsers[currentRoomKey].length);
  });

  socket.on("change_room_key", (data) => {
    if (data.ownerPin !== OWNER_PIN) return socket.emit("error_message", "Wrong owner PIN");

    const newKey = data.newRoomKey.trim();
    if (!newKey) return socket.emit("error_message", "New room key required");

    currentRoomKey = newKey;
    roomUsers[currentRoomKey] = [];

    socket.emit("room_key_changed", "Room key changed successfully");
  });

  socket.on("generate_invite", (data) => {
    if (data.ownerPin !== OWNER_PIN) return socket.emit("error_message", "Wrong owner PIN");

    const token = crypto.randomBytes(24).toString("hex");

    inviteTokens[token] = {
      room: currentRoomKey,
      used: false,
      expiresAt: Date.now() + INVITE_EXPIRE_TIME
    };

    socket.emit("invite_created", token);
  });

  socket.on("join_with_invite", (token) => {
    const invite = inviteTokens[token];

    if (!invite) return socket.emit("error_message", "Invalid invite link");
    if (invite.used) return socket.emit("error_message", "This invite link is already used");
    if (Date.now() > invite.expiresAt) return socket.emit("error_message", "Invite link expired");

    const room = invite.room;
    cleanRoomUsers(room);

    if (roomUsers[room].length >= MAX_USERS) {
      return socket.emit("error_message", "Room full. Maximum 4 users allowed.");
    }

    invite.used = true;

    roomUsers[room].push(socket.id);
    socket.join(room);
    socket.room = room;

    socket.emit("system_message", "Joined by private invite link");
    io.to(room).emit("user_count", roomUsers[room].length);
  });

  socket.on("send_message", (data) => {
    if (!socket.room) return;

    io.to(socket.room).emit("receive_message", {
      id: crypto.randomBytes(12).toString("hex"),
      senderId: socket.id,
      message: data.message,
      time: new Date().toLocaleTimeString(),
      deleteTime: data.deleteTime,
      type: "text"
    });
  });

  socket.on("send_file", (data) => {
    if (!socket.room) return;

    io.to(socket.room).emit("receive_message", {
      id: crypto.randomBytes(12).toString("hex"),
      senderId: socket.id,
      fileName: data.fileName,
      fileType: data.fileType,
      fileData: data.fileData,
      time: new Date().toLocaleTimeString(),
      deleteTime: data.deleteTime,
      type: "file"
    });
  });

  socket.on("message_seen", (data) => {
    if (!socket.room) return;
    socket.to(socket.room).emit("message_seen_update", {
      messageId: data.messageId
    });
  });

  socket.on("typing", () => {
    if (!socket.room) return;
    socket.to(socket.room).emit("typing_status", "Someone is typing...");
  });

  socket.on("stop_typing", () => {
    if (!socket.room) return;
    socket.to(socket.room).emit("typing_status", "");
  });

  socket.on("disconnect", () => {
    const room = socket.room;

    if (room && roomUsers[room]) {
      roomUsers[room] = roomUsers[room].filter((id) => id !== socket.id);
      io.to(room).emit("user_count", roomUsers[room].length);
    }

    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});