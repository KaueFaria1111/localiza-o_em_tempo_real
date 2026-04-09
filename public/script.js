const socket = io();

const map = L.map("map").setView([-14.235, -51.9253], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");
const loggedArea = document.getElementById("loggedArea");
const loggedUserCard = document.getElementById("loggedUserCard");
const message = document.getElementById("message");

const tabRegister = document.getElementById("tabRegister");
const tabLogin = document.getElementById("tabLogin");
const logoutBtn = document.getElementById("logoutBtn");
const startTrackingBtn = document.getElementById("startTrackingBtn");

let currentUser = null;
let watchId = null;
const markers = {};

function setMessage(text, isError = false) {
    message.textContent = text;
    message.style.color = isError ? "#dc2626" : "#111827";
}

function showRegister() {
    registerForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");
}

function showLogin() {
    loginForm.classList.remove("hidden");
    registerForm.classList.add("hidden");
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
}

tabRegister.addEventListener("click", showRegister);
tabLogin.addEventListener("click", showLogin);

function buildAvatarHTML(user) {
    if (user.photo) {
        return `<div class="marker-avatar"><img src="${user.photo}" alt="${user.name}" /></div>`;
    }

    const initial = user.name ? user.name.charAt(0).toUpperCase() : "?";
    return `<div class="marker-avatar">${initial}</div>`;
}

function buildUserCardHTML(user) {
    const avatar = user.photo
        ? `<div class="user-avatar"><img src="${user.photo}" alt="${user.name}" /></div>`
        : `<div class="user-avatar">${user.name.charAt(0).toUpperCase()}</div>`;

    return `
    <div class="user-badge">
      ${avatar}
      <div>
        <strong>${user.name}</strong>
        <p>${user.email}</p>
      </div>
    </div>
  `;
}

function createCustomIcon(user) {
    return L.divIcon({
        className: "custom-marker",
        html: buildAvatarHTML(user),
        iconSize: [42, 42],
        iconAnchor: [21, 21],
        popupAnchor: [0, -20]
    });
}

function popupHTML(user) {
    const initial = user.name ? user.name.charAt(0).toUpperCase() : "?";

    const photoHtml = user.photo
        ? `<img src="${user.photo}" alt="${user.name}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;" />`
        : `<div style="width:60px;height:60px;border-radius:50%;background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:bold;">${initial}</div>`;

    return `
    <div style="display:flex;align-items:center;gap:10px;">
      ${photoHtml}
      <div>
        <strong>${user.name}</strong>
      </div>
    </div>
  `;
}

function addOrUpdateMarker(user) {
    if (user.lat == null || user.lng == null) return;

    if (markers[user.id]) {
        markers[user.id].setLatLng([user.lat, user.lng]);
        markers[user.id].setIcon(createCustomIcon(user));
        markers[user.id].setPopupContent(popupHTML(user));
    } else {
        markers[user.id] = L.marker([user.lat, user.lng], {
            icon: createCustomIcon(user)
        })
            .addTo(map)
            .bindPopup(popupHTML(user));
    }
}

function removeMarker(userId) {
    if (markers[userId]) {
        map.removeLayer(markers[userId]);
        delete markers[userId];
    }
}

async function loadUsers() {
    try {
        const response = await fetch("/api/users");
        const users = await response.json();

        users.forEach((user) => addOrUpdateMarker(user));
    } catch (error) {
        setMessage("Erro ao carregar usuários.", true);
    }
}

async function checkLoggedUser() {
    try {
        const response = await fetch("/api/me");

        if (!response.ok) {
            currentUser = null;
            loggedArea.classList.add("hidden");
            return;
        }

        const user = await response.json();
        currentUser = user;
        loggedArea.classList.remove("hidden");
        loggedUserCard.innerHTML = buildUserCardHTML(user);
    } catch (error) {
        currentUser = null;
        loggedArea.classList.add("hidden");
    }
}

function startRealtimeLocation() {
    if (!currentUser) {
        setMessage("Faça login antes de ativar a localização.", true);
        return;
    }

    if (!navigator.geolocation) {
        setMessage("Seu navegador não suporta geolocalização.", true);
        return;
    }

    if (watchId !== null) {
        setMessage("A localização em tempo real já está ativa.");
        return;
    }

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            currentUser.lat = lat;
            currentUser.lng = lng;

            addOrUpdateMarker(currentUser);
            map.setView([lat, lng], 16);

            socket.emit("updateLocation", {
                userId: currentUser.id,
                lat,
                lng
            });

            setMessage("Localização em tempo real ativa.");
        },
        (error) => {
            if (error.code === 1) {
                setMessage("Permissão de localização negada.", true);
            } else {
                setMessage("Erro ao obter localização.", true);
            }
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 10000
        }
    );
}

function stopRealtimeLocation() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
}

socket.on("userLocationUpdated", (user) => {
    addOrUpdateMarker(user);
});

socket.on("userRemoved", (data) => {
    removeMarker(data.id);
});

registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = new FormData(registerForm);

    try {
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
        registerForm.reset();
        loggedArea.classList.remove("hidden");
        loggedUserCard.innerHTML = buildUserCardHTML(currentUser);

        setMessage(data.message);
    } catch (error) {
        setMessage("Erro no cadastro.", true);
    }
});

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = new FormData(loginForm);

    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email: formData.get("email"),
                password: formData.get("password")
            })
        });

        const data = await response.json();

        if (!response.ok) {
            setMessage(data.error || "Erro no login.", true);
            return;
        }

        currentUser = data.user;
        loginForm.reset();
        loggedArea.classList.remove("hidden");
        loggedUserCard.innerHTML = buildUserCardHTML(currentUser);

        setMessage(data.message);
    } catch (error) {
        setMessage("Erro ao fazer login.", true);
    }
});

startTrackingBtn.addEventListener("click", startRealtimeLocation);

logoutBtn.addEventListener("click", async () => {
    try {
        stopRealtimeLocation();

        const userIdToRemove = currentUser ? currentUser.id : null;

        const response = await fetch("/api/remove-user", {
            method: "POST"
        });

        const data = await response.json();

        if (!response.ok) {
            setMessage(data.error || "Erro ao sair.", true);
            return;
        }

        if (userIdToRemove) {
            removeMarker(userIdToRemove);
        }

        currentUser = null;
        loggedArea.classList.add("hidden");
        loggedUserCard.innerHTML = "";

        setMessage(data.message);
    } catch (error) {
        setMessage("Erro ao sair.", true);
    }
});

loadUsers();
checkLoggedUser();