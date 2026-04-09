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

// cria pasta uploads se não existir
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: "segredo-super-seguro",
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false, // se usar https + proxy em produção, depois pode ajustar
            httpOnly: true,
            sameSite: "lax"
        }
    })
);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

// upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const fileName = `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`;
        cb(null, fileName);
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

// cadastro
app.post("/api/register", upload.single("photo"), (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: "Preencha nome, e-mail e senha." });
        }

        const exists = users.find((u) => u.email === email);
        if (exists) {
            return res.status(400).json({ error: "E-mail já cadastrado." });
        }

        const newUser = {
            id: Date.now().toString(),
            name,
            email,
            password,
            photo: req.file ? `/uploads/${req.file.filename}` : null,
            lat: null,
            lng: null
        };

        users.push(newUser);
        req.session.userId = newUser.id;

        res.status(201).json({
            message: "Usuário cadastrado com sucesso.",
            user: {
                id: newUser.id,
                name: newUser.name,
                email: newUser.email,
                photo: newUser.photo,
                lat: newUser.lat,
                lng: newUser.lng
            }
        });
    } catch (error) {
        console.error("Erro ao cadastrar usuário:", error);
        res.status(500).json({ error: "Erro ao cadastrar usuário." });
    }
});

// login
app.post("/api/login", (req, res) => {
    try {
        const { email, password } = req.body;

        const user = users.find((u) => u.email === email && u.password === password);

        if (!user) {
            return res.status(401).json({ error: "E-mail ou senha inválidos." });
        }

        req.session.userId = user.id;

        res.json({
            message: "Login realizado com sucesso.",
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                photo: user.photo,
                lat: user.lat,
                lng: user.lng
            }
        });
    } catch (error) {
        console.error("Erro ao fazer login:", error);
        res.status(500).json({ error: "Erro ao fazer login." });
    }
});

// usuário logado
app.get("/api/me", (req, res) => {
    const user = users.find((u) => u.id === req.session.userId);

    if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
    }

    res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        photo: user.photo,
        lat: user.lat,
        lng: user.lng
    });
});

// listar usuários
app.get("/api/users", (req, res) => {
    const safeUsers = users.map((u) => ({
        id: u.id,
        name: u.name,
        photo: u.photo,
        lat: u.lat,
        lng: u.lng
    }));

    res.json(safeUsers);
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

    io.emit("userLocationUpdated", {
        id: user.id,
        name: user.name,
        photo: user.photo,
        lat: user.lat,
        lng: user.lng
    });

    res.json({ message: "Localização atualizada com sucesso." });
});

// sair e remover do mapa, mas manter cadastro
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

        res.json({ message: "Usuário saiu com sucesso." });
    });
});

// logout comum
app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: "Erro ao fazer logout." });
        }

        res.json({ message: "Logout realizado com sucesso." });
    });
});

// socket.io
io.on("connection", (socket) => {
    console.log("Cliente conectado:", socket.id);

    socket.on("updateLocation", (data) => {
        const { userId, lat, lng } = data;

        if (!userId || typeof lat !== "number" || typeof lng !== "number") {
            return;
        }

        const user = users.find((u) => u.id === userId);
        if (!user) return;

        user.lat = lat;
        user.lng = lng;

        io.emit("userLocationUpdated", {
            id: user.id,
            name: user.name,
            photo: user.photo,
            lat: user.lat,
            lng: user.lng
        });
    });

    socket.on("disconnect", () => {
        console.log("Cliente desconectado:", socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});