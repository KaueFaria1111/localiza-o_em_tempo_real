const socket = io();

const map = L.map("map").setView([-14.235, -51.9253], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const tabRegister = document.getElementById("tabRegister");
const tabLogin = document.getElementById("tabLogin");
const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");
const loggedArea = document.getElementById("loggedArea");
const loggedUserCard = document.getElementById("loggedUserCard");
const messageEl = document.getElementById("message");
const startTrackingBtn = document.getElementById("startTrackingBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loadingEl = document.getElementById("loadingLocation");
const overlayNotification = document.getElementById("overlayNotification");
const overlayIcon = document.getElementById("overlayIcon");
const overlayTitle = document.getElementById("overlayTitle");
const overlayText = document.getElementById("overlayText");

let currentUser = null;
let watchId = null;
const markers = {};

function setMessage(text, isError = false) {
    messageEl.textContent = text || "";
    messageEl.style.color = isError ? "#dc2626" : "#111827";
}

function getInitial(name = "") {
    return name.trim().charAt(0).toUpperCase() || "?";
}

function getPhotoUrl(photo) {
    if (!photo) return null;
    return photo;
}

function createAvatarHTML(user) {
    const photoUrl = getPhotoUrl(user.photo);
    const color = user.color || "#2563eb";

    if (photoUrl) {
        return `
            <div class="marker-avatar" style="background:${color}">
                <img src="${photoUrl}" alt="${user.name}">
            </div>
        `;
    }

    return `
        <div class="marker-avatar" style="background:${color}">
            ${getInitial(user.name)}
        </div>
    `;
}

function createUserCardHTML(user) {
    const photoUrl = getPhotoUrl(user.photo);
    const color = user.color || "#2563eb";

    return `
        <div class="user-badge">
            <div class="user-avatar" style="background:${color}">
                ${photoUrl
            ? `<img src="${photoUrl}" alt="${user.name}">`
            : getInitial(user.name)
        }
            </div>
            <div>
                <strong>${user.name}</strong>
                <div>${user.email || ""}</div>
            </div>
        </div>
    `;
}

function createPopupHTML(user) {
    const photoUrl = getPhotoUrl(user.photo);
    const color = user.color || "#2563eb";

    return `
        <div class="popup-user">
            <div class="marker-avatar" style="background:${color}">
                ${photoUrl
            ? `<img src="${photoUrl}" alt="${user.name}">`
            : getInitial(user.name)
        }
            </div>
            <div>
                <strong>${user.name}</strong>
                <span>Usuário em tempo real</span>
            </div>
        </div>
    `;
}

function createMarkerIcon(user) {
    return L.divIcon({
        className: "custom-marker",
        html: createAvatarHTML(user),
        iconSize: [42, 42],
        iconAnchor: [21, 21],
        popupAnchor: [0, -20]
    });
}

function upsertUserMarker(user) {
    if (typeof user.lat !== "number" || typeof user.lng !== "number") {
        removeUserMarker(user.id);
        return;
    }

    if (markers[user.id]) {
        markers[user.id].setLatLng([user.lat, user.lng]);
        markers[user.id].setIcon(createMarkerIcon(user));
        markers[user.id].setPopupContent(createPopupHTML(user));
        return;
    }

    const marker = L.marker([user.lat, user.lng], {
        icon: createMarkerIcon(user)
    }).addTo(map);

    marker.bindPopup(createPopupHTML(user));
    markers[user.id] = marker;
}

function removeUserMarker(userId) {
    if (!markers[userId]) return;
    map.removeLayer(markers[userId]);
    delete markers[userId];
}

function showLoggedArea(user) {
    currentUser = user;
    registerForm.classList.add("hidden");
    loginForm.classList.add("hidden");
    loggedArea.classList.remove("hidden");
    tabRegister.classList.remove("active");
    tabLogin.classList.remove("active");
    loggedUserCard.innerHTML = createUserCardHTML(user);
}

function showRegister() {
    registerForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
    loggedArea.classList.add("hidden");
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");
}

function showLogin() {
    registerForm.classList.add("hidden");
    loginForm.classList.remove("hidden");
    loggedArea.classList.add("hidden");
    tabRegister.classList.remove("active");
    tabLogin.classList.add("active");
}

async function loadUsers() {
    try {
        const response = await fetch("/api/users");
        const users = await response.json();

        users.forEach((user) => {
            if (typeof user.lat === "number" && typeof user.lng === "number") {
                upsertUserMarker(user);
            }
        });
    } catch (error) {
        console.error("Erro ao carregar usuários:", error);
    }
}

async function loadMe() {
    try {
        const response = await fetch("/api/me");

        if (!response.ok) {
            showRegister();
            return;
        }

        const user = await response.json();
        showLoggedArea(user);

        if (typeof user.lat === "number" && typeof user.lng === "number") {
            upsertUserMarker(user);
            map.setView([user.lat, user.lng], 16);
        }
    } catch (error) {
        console.error("Erro ao carregar usuário logado:", error);
        showRegister();
    }
}

async function sendLocation(lat, lng) {
    if (!currentUser) return;

    socket.emit("updateLocation", {
        userId: currentUser.id,
        lat,
        lng
    });

    try {
        await fetch("/api/location", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                userId: currentUser.id,
                lat,
                lng
            })
        });
    } catch (error) {
        console.error("Erro ao enviar localização:", error);
    }
}

function startTracking() {
    if (!currentUser) {
        setMessage("Faça login primeiro.", true);
        return;
    }

    if (!navigator.geolocation) {
        setMessage("Seu navegador não suporta geolocalização.", true);
        return;
    }

    if (watchId !== null) {
        setMessage("A localização já está ativa.");
        return;
    }

    showOverlay(
        "Ativando localização",
        "Estamos buscando sua localização em tempo real...",
        "📡"
    );

    watchId = navigator.geolocation.watchPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            currentUser.lat = lat;
            currentUser.lng = lng;

            upsertUserMarker(currentUser);
            map.setView([lat, lng], 16);

            await sendLocation(lat, lng);

            hideOverlay();
            setMessage("Localização em tempo real ativada.");
        },
        (error) => {
            console.error(error);
            hideOverlay();
            setMessage("Não foi possível obter sua localização.", true);
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 10000
        }
    );
}

function stopTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    hideOverlay();
}

tabRegister.addEventListener("click", showRegister);
tabLogin.addEventListener("click", showLogin);

registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        const formData = new FormData(registerForm);

        const response = await fetch("/api/register", {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            setMessage(data.error || "Erro ao cadastrar.", true);
            return;
        }

        currentUser = data.user;
        showLoggedArea(currentUser);
        setMessage(data.message || "Cadastro realizado com sucesso.");
        registerForm.reset();
    } catch (error) {
        console.error(error);
        setMessage("Erro ao cadastrar usuário.", true);
    }
});

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        const formData = new FormData(loginForm);
        const payload = {
            email: formData.get("email"),
            password: formData.get("password")
        };

        const response = await fetch("/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            setMessage(data.error || "Erro ao fazer login.", true);
            return;
        }

        currentUser = data.user;
        showLoggedArea(currentUser);
        setMessage(data.message || "Login realizado com sucesso.");
        loginForm.reset();
    } catch (error) {
        console.error(error);
        setMessage("Erro ao fazer login.", true);
    }
});

startTrackingBtn.addEventListener("click", startTracking);

logoutBtn.addEventListener("click", async () => {
    try {
        showOverlay(
            "Saindo do mapa",
            "Removendo sua localização da tela...",
            "🚪"
        );

        stopTracking();

        const response = await fetch("/api/remove-user", {
            method: "POST"
        });

        const data = await response.json();

        if (!response.ok) {
            hideOverlay();
            setMessage(data.error || "Erro ao sair.", true);
            return;
        }

        if (currentUser) {
            removeUserMarker(currentUser.id);
        }

        currentUser = null;
        loggedUserCard.innerHTML = "";
        showLogin();
        setMessage(data.message || "Usuário saiu com sucesso.");

        showTemporaryOverlay(
            "Você saiu",
            "Sua localização foi removida com sucesso.",
            "✅",
            2000
        );
    } catch (error) {
        console.error(error);
        hideOverlay();
        setMessage("Erro ao sair.", true);
    }
});

socket.on("userLocationUpdated", (user) => {
    upsertUserMarker(user);
});

socket.on("userRemoved", ({ id }) => {
    removeUserMarker(id);
});

loadUsers();
loadMe();

function showOverlay(title, text, icon = "📍") {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayIcon.textContent = icon;
    overlayNotification.classList.remove("hidden");
}

function hideOverlay() {
    overlayNotification.classList.add("hidden");
}

function showTemporaryOverlay(title, text, icon = "✅", duration = 2000) {
    showOverlay(title, text, icon);

    setTimeout(() => {
        hideOverlay();
    }, duration);
}