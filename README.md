# 🗳️ Gigabrain — Sistema Boca de Urna v5.0

Sistema electoral completo con backend propio. **Sin Firebase. Sin servicios externos.**
Node.js + SQLite + WebSocket para tiempo real.

---

## 📁 Estructura

```
boca-urna/
├── server.js          ← Servidor Express + WebSocket
├── db.js              ← Base de datos SQLite (queries y helpers)
├── package.json
├── boca_urna.db       ← Se crea automáticamente al iniciar
└── public/
    ├── index.html         ← Página de inicio (selector de rol)
    ├── boca_urna.html     ← App del operador de campo
    └── monitor.html       ← Monitor Central (administrador)
```

---

## 🚀 Instalación y uso

### 1. Instalar dependencias
```bash
cd boca-urna
npm install
```

### 2. Iniciar el servidor
```bash
npm start
```

El Monitor Central pide usuario y contraseña al abrirse.
Por defecto:

```text
Usuario: admin
Contraseña: monitor2026
```

Para cambiar la contraseña:

```bash
MONITOR_PASSWORD="tu-clave-segura" npm start
```

También podés cambiar el usuario:

```bash
MONITOR_USER="central" MONITOR_PASSWORD="tu-clave-segura" npm start
```

### 3. Abrir en el navegador
```
http://localhost:4010           ← Selector de rol
http://localhost:4010/boca_urna.html   ← Operadores
http://localhost:4010/monitor.html     ← Monitor Central
```

---

## 📱 Uso en red LAN (día electoral)

Para que los teléfonos/tablets de los operadores puedan conectarse:

1. Conectá todos los dispositivos al mismo WiFi
2. Buscá la IP local de tu PC:
   ```bash
   ip addr show   # Linux/Zorin
   hostname -I    # alternativa
   ```
3. Los operadores abren en su celular:
   ```
   http://192.168.X.X:4010/boca_urna.html
   ```
4. El administrador abre en su PC:
   ```
   http://192.168.X.X:4010/monitor.html
   ```

---

## ☁️ Deploy en Railway (internet, gratis)

```bash
# 1. Crear cuenta en railway.app
# 2. Instalar CLI
npm install -g @railway/cli
railway login

# 3. Desde la carpeta del proyecto
railway init
railway up
```

Railway asigna una URL pública automáticamente.

---

## ☁️ Deploy en Render (internet, gratis)

1. Subir el proyecto a GitHub
2. Crear cuenta en render.com
3. New → Web Service → conectar repo
4. Build Command: `npm install`
5. Start Command: `npm start`

---

## 🗄️ Base de datos SQLite

El archivo `boca_urna.db` se crea automáticamente en la raíz del proyecto.
Para hacer backup, simplemente copiá ese archivo.

### Tablas
| Tabla | Descripción |
|---|---|
| `colegios` | Locales de votación |
| `candidatos` | Candidatos con partido y cargo |
| `votos_bu` | Votos boca de urna (por colegio + candidato) |
| `votos_oficial` | Votos oficiales (por colegio + candidato + mesa) |
| `config_oficial` | Config de mesas y electores por colegio |
| `monitoreo_config` | Electores habilitados por colegio |
| `monitoreo_mesas` | Votantes por mesa de cada colegio |
| `cortes` | Historial de cortes informativos |

---

## 🔌 API REST

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/estado` | Estado completo del sistema |
| GET/POST | `/api/colegios` | Listar / agregar colegios |
| DELETE | `/api/colegios/:id` | Eliminar colegio |
| GET/POST | `/api/candidatos` | Listar / agregar candidatos |
| DELETE | `/api/candidatos/:id` | Eliminar candidato |
| POST | `/api/votos-bu/:col/:cand` | Sumar/restar votos BU (`{delta: 1}`) |
| POST | `/api/votos-oficial/:col/:cand/:mesa` | Guardar votos oficiales |
| POST | `/api/config-oficial/:col` | Configurar mesas y electores |
| POST | `/api/monitoreo/:col/electores` | Actualizar electores habilitados |
| POST | `/api/monitoreo/:col/mesas` | Agregar mesa de monitoreo |
| DELETE | `/api/monitoreo/:col/mesas/:nombre` | Eliminar mesa |
| GET/POST | `/api/cortes/:col` | Historial de cortes |
| DELETE | `/api/reiniciar/:col` | Reiniciar datos de un colegio |
| DELETE | `/api/reiniciar-todo` | Borrar todo el sistema |

---

## 📡 WebSocket

Al conectar, el servidor envía el estado completo (`type: 'init'`).
Cada acción emite un mensaje broadcast a todos los clientes:

| type | Descripción |
|---|---|
| `init` / `full` | Estado completo del sistema |
| `colegios` | Lista de colegios actualizada |
| `candidatos` | Lista de candidatos actualizada |
| `voto_bu` | Votos BU de un colegio |
| `voto_oficial` | Votos oficiales de un colegio |
| `config_oficial` | Config de mesas de un colegio |
| `monitoreo` | Datos de participación de un colegio |

---

## ⚙️ Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `4010` | Puerto del servidor |

---

## 📊 Flujo de uso el día electoral

```
1. Administrador abre monitor.html
2. En "Configurar": agrega colegios y candidatos
   → Los operadores ven los cambios en tiempo real
3. Operadores abren boca_urna.html en sus celulares
4. Seleccionan su colegio y registran votos
5. Monitor Central muestra todo consolidado en tiempo real
```
