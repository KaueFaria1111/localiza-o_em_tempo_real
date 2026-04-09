const express = require("express");
const cors = require("cors");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: true,
        credentials: true
    }
});

const PORT = process.env.PORT || 3000;

// importante para ambientes com proxy, como Render
app.set("trust proxy", 1);

// cria pasta uploads se não existir
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: process.env.SESSION_SECRET || "segredo-super-seguro",
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false,
            httpOnly: true,
            sameSite: "lax"
        }
    })
);

app.use("/uploads", express.static(uploadDir));
app.use(express.static(path.join(__dirname, "public")));

// upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/\s+/g, "-");
        cb(null, `${Date.now()}-${safeName}`);
    }
});

const upload = multer({ storage });

// banco fake em memória
const users = [];

/*
{
  id,
  name,
  email,
  password,
  photo,
  lat,
  lng
}
*/

function sanitizeUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        photo: user.photo,
        lat: user.lat,
        lng: user.lng
    };
}

function sanitizePublicUser(user) {
    return {
        id: user.id,
        name: user.name,
        photo: user.photo,
        lat: user.lat,
        lng: user.lng
    };
}

// cadastro
app.post("/api/register", upload.single("photo"), (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: "Preencha nome, e-mail e senha." });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        const exists = users.find((u) => u.email === normalizedEmail);
        if (exists) {
            return res.status(400).json({ error: "E-mail já cadastrado." });
        }

        const newUser = {
            id: Date.now().toString(),
            name: String(name).trim(),
            email: normalizedEmail,
            password: String(password),
            photo: req.file ? `/uploads/${req.file.filename}` : null,
            lat: null,
            lng: null
        };

        users.push(newUser);
        req.session.userId = newUser.id;

        return res.status(201).json({
            message: "Usuário cadastrado com sucesso.",
            user: sanitizeUser(newUser)
        });
    } catch (error) {
        console.error("Erro ao cadastrar usuário:", error);
        return res.status(500).json({ error: "Erro ao cadastrar usuário." });
    }
});

// login
app.post("/api/login", (req, res) => {
    try {
        const { email, password } = req.body;

        const normalizedEmail = String(email || "").trim().toLowerCase();

        const user = users.find(
            (u) => u.email === normalizedEmail && u.password === String(password || "")
        );

        if (!user) {
            return res.status(401).json({ error: "E-mail ou senha inválidos." });
        }

        req.session.userId = user.id;

        return res.json({
            message: "Login realizado com sucesso.",
            user: sanitizeUser(user)
        });
    } catch (error) {
        console.error("Erro ao fazer login:", error);
        return res.status(500).json({ error: "Erro ao fazer login." });
    }
});

// usuário logado
app.get("/api/me", (req, res) => {
    const user = users.find((u) => u.id === req.session.userId);

    if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
    }

    return res.json(sanitizeUser(user));
});

// listar usuários
app.get("/api/users", (req, res) => {
    return res.json(users.map(sanitizePublicUser));
});

// atualizar localização por HTTP
app.post("/api/location", (req, res) => {
    const { userId, lat, lng } = req.body;

    if (!userId || typeof lat !== "number" || typeof lng !== "number") {
        return res.status(400).json({ error: "Dados de localização inválidos." });
    }

    const user = users.find((u) => u.id === userId);

    if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado." });
    }

    user.lat = lat;
    user.lng = lng;

    io.emit("userLocationUpdated", sanitizePublicUser(user));

    return res.json({ message: "Localização atualizada com sucesso." });
});

// sair e remover do mapa, mantendo cadastro
app.post("/api/remove-user", (req, res) => {
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ error: "Não autenticado." });
    }

    const user = users.find((u) => u.id === userId);

    if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado." });
    }

    user.lat = null;
    user.lng = null;

    io.emit("userRemoved", { id: user.id });

    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: "Erro ao encerrar sessão." });
        }

        return res.json({ message: "Usuário saiu com sucesso." });
    });
});

// logout comum
app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: "Erro ao fazer logout." });
        }

        return res.json({ message: "Logout realizado com sucesso." });
    });
});

// socket.io
io.on("connection", (socket) => {
    console.log("Cliente conectado:", socket.id);

    socket.on("updateLocation", (data) => {
        const { userId, lat, lng } = data || {};

        if (!userId || typeof lat !== "number" || typeof lng !== "number") {
            return;
        }

        const user = users.find((u) => u.id === userId);
        if (!user) return;

        user.lat = lat;
        user.lng = lng;

        io.emit("userLocationUpdated", sanitizePublicUser(user));
    });

    socket.on("disconnect", () => {
        console.log("Cliente desconectado:", socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});